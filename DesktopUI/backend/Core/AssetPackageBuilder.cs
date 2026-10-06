using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    internal static class AssetPackageBuilder
    {
        private static JObject Manifest(AssetPack pack, bool behavior)
        {
            var version = new JArray(pack.Version.Split('.').Select(int.Parse));
            var manifest = new JObject
            {
                ["format_version"] = 2,
                ["header"] = new JObject
                {
                    ["name"] = pack.Name, ["description"] = "by:" + pack.Author + " | 需要大果喵前置组件",
                    ["uuid"] = behavior ? pack.BehaviorUuid : pack.ResourceUuid,
                    ["version"] = version, ["min_engine_version"] = new JArray(1, 18, 0)
                },
                ["modules"] = new JArray(new JObject
                {
                    ["type"] = behavior ? "data" : "resources",
                    ["uuid"] = behavior ? pack.BehaviorModuleUuid : pack.ResourceModuleUuid,
                    ["version"] = version.DeepClone()
                })
            };
            if (behavior) manifest["dependencies"] = new JArray(new JObject
            {
                ["uuid"] = pack.ResourceUuid, ["version"] = version.DeepClone()
            });
            return manifest;
        }

        private static string ResourcePath(AssetPack pack, string kind, AssetEntry item) =>
            (kind == "textures" ? "textures/ui/" : "sounds/") + pack.ProviderId + "/" + item.Id;

        private static JArray Assets(AssetPack pack, string kind) => new JArray(pack.Entries.Select(item =>
        {
            string type = kind == "textures" ? "texture" : "sound";
            string value = type == "texture" ? ResourcePath(pack, kind, item) : pack.ProviderId + "." + item.Id;
            return new JObject
            {
                ["id"] = item.Id, ["type"] = type, ["name"] = item.Name,
                ["category_id"] = item.CategoryId, ["category_name"] = item.CategoryName,
                [type] = value, ["search_tags"] = new JArray(item.SearchTags),
                ["volume"] = item.Volume, ["pitch"] = item.Pitch
            };
        }));

        // Emit UTF-8 Python literals, not json.loads(): Python 2 registration data stays str.
        private static string PythonValue(JToken value)
        {
            if (value is JObject obj) return "{" + string.Join(",\n", obj.Properties().Select(p =>
                PythonValue(new JValue(p.Name)) + ": " + PythonValue(p.Value))) + "}";
            if (value is JArray array) return "[" + string.Join(",\n", array.Select(PythonValue)) + "]";
            if (value.Type == JTokenType.Null) return "None";
            if (value.Type == JTokenType.Boolean) return (bool)value ? "True" : "False";
            if (value.Type == JTokenType.String)
            {
                // JSON's \uXXXX escapes are not decoded in Python 2 str literals.
                var literal = new StringBuilder("\"");
                foreach (char character in (string)value)
                {
                    if (character == '\\' || character == '"') literal.Append('\\').Append(character);
                    else if (char.IsControl(character))
                        foreach (byte octet in Encoding.UTF8.GetBytes(character.ToString()))
                            literal.Append("\\x").Append(octet.ToString("x2"));
                    else literal.Append(character);
                }
                return literal.Append('"').ToString();
            }
            return JsonConvert.SerializeObject(((JValue)value).Value);
        }

        public static string Build(AssetPack pack, string kind, string directory)
        {
            pack.Validate(kind);
            if (pack.Entries.Count == 0) throw new InvalidDataException("资源列表为空，无法打包");
            if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("输出目录不存在");
            string root = Path.Combine(Path.GetTempPath(), "dgn-assets-" + Guid.NewGuid().ToString("N"));
            string output = Path.Combine(directory, pack.ProviderId + "_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + "_" + Guid.NewGuid().ToString("N").Substring(0, 4) + ".zip");
            string pending = output + ".tmp";
            try
            {
                string bp = Path.Combine(root, pack.ProviderId + "B"), rp = Path.Combine(root, pack.ProviderId + "R");
                // Pack recognition requires these roots even for resource-only extensions.
                // Empty directories are retained as directory entries in the ZIP.
                Directory.CreateDirectory(Path.Combine(bp, "entities"));
                Directory.CreateDirectory(Path.Combine(rp, "textures"));
                ExportText.Write(Path.Combine(bp, "manifest.json"), Manifest(pack, true).ToString());
                ExportText.Write(Path.Combine(rp, "manifest.json"), Manifest(pack, false).ToString());
                string module = pack.ProviderId + "Scripts";
                string scripts = Path.Combine(bp, module);
                ExportText.Write(Path.Combine(scripts, "__init__.py"), "");
                ExportText.Write(Path.Combine(scripts, "config.py"), "# -*- coding: utf-8 -*-\nPROVIDER_ID = " + PythonValue(new JValue(pack.ProviderId)) +
                    "\nPROVIDER_NAME = " + PythonValue(new JValue(pack.Name)) + "\nASSETS = " + PythonValue(Assets(pack, kind)) + "\n");
                ExportText.Write(Path.Combine(scripts, "modMain.py"),
                    "# -*- coding: utf-8 -*-\nfrom mod.common.mod import Mod\nimport mod.client.extraClientApi as clientApi\n\n" +
                    "@Mod.Binding(name=\"" + pack.ProviderId + "\", version=\"" + pack.Version + "\")\nclass AssetPackMod(object):\n" +
                    "    @Mod.InitClient()\n    def InitClient(self):\n        clientApi.RegisterSystem(\"" + pack.ProviderId +
                    "\", \"AssetClientSystem\", \"" + module + ".client.AssetClientSystem\")\n");
                ExportText.Write(Path.Combine(scripts, "client.py"), ClientScript(module));
                var definitions = new JObject();
                foreach (var item in pack.Entries)
                {
                    string resource = ResourcePath(pack, kind, item);
                    string target = Path.Combine(rp, resource.Replace('/', Path.DirectorySeparatorChar) + (kind == "textures" ? ".png" : ".ogg"));
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    File.Copy(item.Path, target);
                    if (kind == "sounds") definitions[pack.ProviderId + "." + item.Id] = new JObject
                    {
                        ["category"] = "ui", ["sounds"] = new JArray(new JObject
                        {
                            ["name"] = resource, ["stream"] = item.Stream, ["load_on_low_memory"] = true
                        })
                    };
                }
                if (kind == "sounds") ExportText.Write(Path.Combine(rp, "sounds", "sound_definitions.json"), new JObject
                {
                    ["format_version"] = "1.14.0", ["sound_definitions"] = definitions
                }.ToString());
                var metadata = JObject.FromObject(pack);
                foreach (JObject item in metadata["Entries"])
                    item["Path"] = ResourcePath(pack, kind, item.ToObject<AssetEntry>()) + (kind == "textures" ? ".png" : ".ogg");
                ExportText.Write(Path.Combine(rp, "modconfigs", pack.ConfigFileName), new JObject
                {
                    ["format"] = "DaGuoNekoAssetPack", ["version"] = 1, ["kind"] = kind, ["pack"] = metadata
                }.ToString());
                ZipFile.CreateFromDirectory(root, pending, CompressionLevel.Optimal, false);
                File.Move(pending, output);
                return output;
            }
            finally
            {
                if (File.Exists(pending)) File.Delete(pending);
                if (Directory.Exists(root)) Directory.Delete(root, true);
            }
        }

        public static AssetPack Import(string path, string kind, string tempRoot)
        {
            string root = WorkspaceFiles.Extract(path, tempRoot);
            // Identify our metadata by format, not filename; legacy assets.json still imports.
            var candidates = new List<Tuple<string, JObject>>();
            foreach (string configPath in Directory.GetFiles(root, "*.json", SearchOption.AllDirectories)
                .Where(p => new DirectoryInfo(Path.GetDirectoryName(p)).Name == "modconfigs"))
            {
                var data = JToken.Parse(ExportText.Read(configPath)) as JObject;
                if (data != null && data["format"]?.Type == JTokenType.String &&
                    (string)data["format"] == "DaGuoNekoAssetPack")
                    candidates.Add(Tuple.Create(configPath, data));
            }
            if (candidates.Count != 1) throw new InvalidDataException("ZIP 必须包含一份工具箱资源拓展配置");
            var document = candidates[0].Item2;
            if ((string)document["format"] != "DaGuoNekoAssetPack" || (int?)document["version"] != 1 || (string)document["kind"] != kind)
                throw new InvalidDataException("拓展包类型或版本不匹配");
            var pack = document["pack"]?.ToObject<AssetPack>() ?? throw new InvalidDataException("资源拓展配置缺失");
            string rp = Directory.GetParent(Path.GetDirectoryName(candidates[0].Item1)).FullName;
            foreach (var item in pack.Entries) item.Path = WorkspaceFiles.ResolveInside(rp, item.Path);
            pack.Validate(kind);
            return pack;
        }

        private static string ClientScript(string module) => @"# -*- coding: utf-8 -*-
import mod.client.extraClientApi as clientApi
from " + module + @".config import PROVIDER_ID, PROVIDER_NAME, ASSETS

class AssetClientSystem(clientApi.GetClientSystemCls()):
    def __init__(self, namespace, systemName):
        super(AssetClientSystem, self).__init__(namespace, systemName)
        self._registered_api = None
        self.ListenForEvent('DAGUOMIAO_API_MOD', 'DAGUOMIAO_API_MODClientSystem',
                            'AssetSelectorRegisterRequest', self, self.OnRegisterRequest)
        self.ListenForEvent(clientApi.GetEngineNamespace(), clientApi.GetEngineSystemName(),
                            'LoadClientAddonScriptsAfter', self, self.OnScriptsReady)

    def OnScriptsReady(self, args):
        self.PublishAssets()

    def OnRegisterRequest(self, args):
        self.PublishAssets()

    def PublishAssets(self):
        api = clientApi.GetSystem('DAGUOMIAO_API_MOD', 'DAGUOMIAO_API_MODClientSystem')
        if api is None:
            print '[AssetPack] Waiting for DAGUOMIAO_API_MOD:', PROVIDER_ID
            return
        if not hasattr(api, 'API_RegisterAssetProvider'):
            print '[AssetPack] Please upgrade DAGUOMIAO_API_MOD:', PROVIDER_ID
            return
        result = api.API_RegisterAssetProvider(PROVIDER_ID, PROVIDER_NAME, ASSETS)
        if not result[0] or '忽略' in result[1]:
            print '[AssetPack] Registration result:', PROVIDER_ID, result[1]
        if result[0]:
            self._registered_api = api

    def Destroy(self):
        self.UnListenForEvent('DAGUOMIAO_API_MOD', 'DAGUOMIAO_API_MODClientSystem',
                              'AssetSelectorRegisterRequest', self, self.OnRegisterRequest)
        self.UnListenForEvent(clientApi.GetEngineNamespace(), clientApi.GetEngineSystemName(),
                              'LoadClientAddonScriptsAfter', self, self.OnScriptsReady)
        api = clientApi.GetSystem('DAGUOMIAO_API_MOD', 'DAGUOMIAO_API_MODClientSystem')
        if api is not None and api is self._registered_api:
            api.API_UnregisterAssetProvider(PROVIDER_ID)
";
    }
}
