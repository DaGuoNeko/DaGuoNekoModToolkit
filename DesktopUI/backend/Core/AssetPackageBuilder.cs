using System;
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
                ExportText.Write(Path.Combine(rp, "modconfigs", "assets.json"), new JObject
                {
                    ["format"] = "DaGuoNekoAssetPack", ["version"] = 1, ["kind"] = kind, ["pack"] = metadata
                }.ToString());
                ExportText.Write(Path.Combine(root, "使用说明.txt"),
                    "请同时安装行为包和资源包，并加载大果喵前置组件。进入游戏后自动注册到公共贴图/音效库。\n" +
                    "包标识: " + pack.ProviderId + "\n需要修改资源时，请在工具箱导入此 ZIP，或打开保存的工程。\n" +
                    "重新导出会保留资源 ID 和 UUID；发布更新前请在拓展包设置中提高版本，两份 manifest 会同步更新。\n" +
                    "不要在同一地图同时加载同一拓展包的新旧两份。素材版权由制作者负责。\n");
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
            var candidates = Directory.GetFiles(root, "assets.json", SearchOption.AllDirectories)
                .Where(p => new DirectoryInfo(Path.GetDirectoryName(p)).Name == "modconfigs").ToList();
            if (candidates.Count != 1) throw new InvalidDataException("ZIP 必须包含一份工具箱资源拓展配置");
            var document = JObject.Parse(ExportText.Read(candidates[0]));
            if ((string)document["format"] != "DaGuoNekoAssetPack" || (int?)document["version"] != 1 || (string)document["kind"] != kind)
                throw new InvalidDataException("拓展包类型或版本不匹配");
            var pack = document["pack"]?.ToObject<AssetPack>() ?? throw new InvalidDataException("资源拓展配置缺失");
            string rp = Directory.GetParent(Path.GetDirectoryName(candidates[0])).FullName;
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
