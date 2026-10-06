using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    internal static class ModelPackageImport
    {
        public static List<ModelEntry> Load(string path, string tempRoot)
        {
            string root = WorkspaceFiles.Extract(path, tempRoot);
            var configs = Directory.GetFiles(root, "*.json", SearchOption.AllDirectories)
                .Where(p => new DirectoryInfo(Path.GetDirectoryName(p)).Name == "modconfigs")
                .Select(p => new { Path = p, Data = Read(p) }).Where(c => c.Data["npcmodelslist"] is JArray).ToList();
            if (configs.Count != 1) throw new InvalidDataException("ZIP 必须包含且仅包含一份 npcmodelslist 模型配置");
            string resourceRoot = Directory.GetParent(Path.GetDirectoryName(configs[0].Path)).FullName;
            var items = (JArray)configs[0].Data["npcmodelslist"];
            if (items.Count == 0 || items.Count > 500) throw new InvalidDataException("模型数量必须在 1 到 500 之间");
            var clients = JsonFiles(Path.Combine(resourceRoot, "entity"));
            var behaviors = Directory.GetFiles(root, "*.json", SearchOption.AllDirectories)
                .Where(p => p.Replace('\\', '/').Contains("/entities/")).ToList();
            var animationFiles = new List<string>();
            foreach (string file in JsonFiles(Path.Combine(resourceRoot, "animations")))
            {
                if (animationFiles.Any(previous => Utils.FilesEqual(previous, file))) continue;
                string name = Path.GetFileName(file);
                if (animationFiles.Any(previous => Path.GetFileName(previous).Equals(name, StringComparison.OrdinalIgnoreCase)))
                    name = animationFiles.Count + "_" + name;
                string destination = Path.Combine(root, "imported-animations", name);
                Utils.WriteTextFile(destination, ExportText.Read(file));
                animationFiles.Add(destination);
            }
            var result = new List<ModelEntry>();
            foreach (JObject item in items)
            {
                string identifier = (string)item["identifier"];
                var match = Regex.Match(identifier ?? "", @"^customnpc:([a-z][a-z0-9_]*)_dlcnpc$");
                if (!match.Success) throw new InvalidDataException("不支持的 NPC 模型标识符: " + identifier);
                string client = FindEntity(clients, "minecraft:client_entity", identifier);
                string behavior = FindEntity(behaviors, "minecraft:entity", identifier);
                var desc = Read(client)["minecraft:client_entity"]["description"];
                var geometry = desc["geometry"] as JObject;
                if (geometry == null || geometry.Count != 1 || geometry["default"]?.Type != JTokenType.String)
                    throw new InvalidDataException("当前导入支持单个 default geometry，不能自动转换多模型资源: " + identifier);
                string geometryId = (string)geometry["default"];
                string geo = null;
                foreach (var file in JsonFiles(Path.Combine(resourceRoot, "models")))
                {
                    var geometries = Read(file)["minecraft:geometry"] as JArray;
                    var found = geometries?.OfType<JObject>().FirstOrDefault(g => (string)g["description"]?["identifier"] == geometryId);
                    if (found == null) continue;
                    if (geo != null) throw new InvalidDataException("模型 geometry 重复: " + geometryId);
                    geo = Path.Combine(root, Guid.NewGuid().ToString("N") + ".geo.json");
                    var selected = Read(file);
                    selected["minecraft:geometry"] = new JArray(found.DeepClone());
                    Utils.WriteTextFile(geo, selected.ToString());
                }
                if (geo == null) throw new InvalidDataException("模型 geometry 资源缺失: " + geometryId);
                string material = (string)desc["materials"]?["default"];
                if (material != "entity_alphatest")
                    throw new InvalidDataException("当前导入不能自动转换自定义材质: " + identifier);
                var textureMap = desc["textures"] as JObject ?? throw new InvalidDataException("模型缺少 textures");
                var textures = new List<ModelTexture>();
                for (int i = 0; i < 64; i++)
                {
                    string alias = i == 0 ? "default" : "default" + i;
                    if (textureMap[alias] == null) break;
                    if (textureMap[alias].Type != JTokenType.String) throw new InvalidDataException("贴图必须是资源路径: " + alias);
                    string texture = WorkspaceFiles.ResolveInside(resourceRoot, (string)textureMap[alias] + ".png");
                    string name = (string)((item["_toolkit"]?["texture_names"] as JArray)?.ElementAtOrDefault(i));
                    textures.Add(new ModelTexture(name ?? alias, texture));
                }
                if (textures.Count == 0) throw new InvalidDataException("模型缺少 default 贴图");
                if (textureMap.Properties().Any(p => p.Name != "outline_mask" &&
                    !(p.Name == "default" || Enumerable.Range(1, textures.Count - 1).Any(i => p.Name == "default" + i))))
                    throw new InvalidDataException("当前导入支持连续 default 贴图变体，不能自动转换多层贴图: " + identifier);
                var controllers = desc["render_controllers"] as JArray ?? new JArray();
                var primary = controllers.Where(c => c.Type == JTokenType.String).Values<string>().ToList();
                var outlineNames = new[] { "controller.render.customnpc_outline", "controller.render.customnpc_outline_mask_through_wall" };
                if (primary.Count != 1 || controllers.Any(c => c.Type != JTokenType.String &&
                    (!(c is JObject conditions) || conditions.Properties().Any(p => !outlineNames.Contains(p.Name)))))
                    throw new InvalidDataException("当前导入不能自动转换多层渲染控制器: " + identifier);
                var definition = NpcCompatibility.RenderController(primary[0]);
                foreach (string file in JsonFiles(Path.Combine(resourceRoot, "render_controllers")))
                {
                    var local = Read(file)["render_controllers"]?[primary[0]] as JObject;
                    if (local != null) definition = local;
                }
                var array = definition?["arrays"]?["textures"]?["Array.skinid"] as JArray;
                if (array == null || array.Count != textures.Count || (string)definition["geometry"] != "Geometry.default")
                    throw new InvalidDataException("模型皮肤数组无法安全映射: " + identifier);
                var ordered = new List<ModelTexture>();
                var aliases = new HashSet<int>();
                foreach (string value in array.Values<string>())
                {
                    var textureAlias = Regex.Match(value ?? "", @"^Texture.default(\d*)$");
                    int index = textureAlias.Success && textureAlias.Groups[1].Value == "" ? 0 :
                        textureAlias.Success ? int.Parse(textureAlias.Groups[1].Value) : -1;
                    if (index < 0 || index >= textures.Count || !aliases.Add(index))
                        throw new InvalidDataException("模型皮肤数组包含不支持的贴图引用: " + value);
                    ordered.Add(textures[index]);
                }
                textures = ordered;
                var entity = Read(behavior)["minecraft:entity"];
                var collision = entity["component_groups"]?["collision_box"]?["minecraft:collision_box"] ?? entity["components"]?["minecraft:collision_box"];
                var animations = desc["animations"] as JObject ?? new JObject();
                var model = new ModelEntry
                {
                    DisplayName = (string)item["name"], CustomName = match.Groups[1].Value,
                    SourceLabel = (string)item["l"] ?? "原版", GeoPath = geo,
                    PreviewImagePath = WorkspaceFiles.ResolveInside(resourceRoot, (string)item["image_id"] + ".png"),
                    Textures = textures, AnimationFiles = animationFiles,
                    AnimationList = (item["animation_list"] as JArray)?.Values<string>().ToList() ?? new List<string>(),
                    CollisionWidth = (double?)collision?["width"] ?? 0.6,
                    CollisionHeight = (double?)collision?["height"] ?? 1.8,
                    IdleAnimation = (string)animations["idle"] ?? "", WalkAnimation = (string)animations["walk"] ?? "",
                    WalkaAnimation = (string)animations["walka"] ?? "", AttackAnimation = (string)animations["attack"] ?? "",
                    DeathAnimation = (string)animations["death"] ?? "", EnableAttachables = (bool?)desc["enable_attachables"] ?? true,
                    FromImport = true, OriginalIdentifier = identifier, ImportedBehaviorPath = behavior, ImportedClientEntityPath = client
                };
                foreach (JObject skin in item["skin_list"] as JArray ?? new JArray())
                    model.SkinList.Add(new ModelSkin((int)skin["skinid"], (string)skin["name"], (string)skin["by"]));
                foreach (string file in Directory.GetFiles(resourceRoot, "*", SearchOption.AllDirectories))
                {
                    string relative = file.Substring(resourceRoot.Length + 1).Replace('\\', '/');
                    if (relative == "manifest.json" || relative.StartsWith("modconfigs/") ||
                        relative.StartsWith("entity/") || relative.StartsWith("models/") || relative.StartsWith("animations/")) continue;
                    model.AdditionalResources.Add(new ModelResource { RelativePath = relative, Path = file });
                }
                result.Add(model);
            }
            WorkspaceFiles.ValidateModels(result);
            return result;
        }

        private static JObject Read(string path) => JObject.Parse(ExportText.Read(path));
        private static List<string> JsonFiles(string path) => Directory.Exists(path)
            ? Directory.GetFiles(path, "*.json", SearchOption.AllDirectories).ToList() : new List<string>();
        private static string FindEntity(IEnumerable<string> files, string type, string identifier)
        {
            var found = files.Where(f => (string)Read(f)[type]?["description"]?["identifier"] == identifier).ToList();
            if (found.Count != 1) throw new InvalidDataException("实体资源缺失或重复: " + identifier);
            return found[0];
        }
    }
}
