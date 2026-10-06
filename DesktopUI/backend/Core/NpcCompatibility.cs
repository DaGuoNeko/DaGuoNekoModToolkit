using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    // Snapshot of the supported NPC resource contract; the toolkit remains standalone.
    internal static class NpcCompatibility
    {
        private static readonly JObject Catalog = ReadCatalog();
        private static readonly HashSet<string> Entities = new HashSet<string>(
            Catalog["entity_identifiers"].Values<string>(), StringComparer.Ordinal);
        private static readonly HashSet<string> Animations = new HashSet<string>(
            Catalog["animation_ids"].Values<string>(), StringComparer.Ordinal);

        private static JObject ReadCatalog()
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("npc_compatibility.json"))
            return JObject.Parse(ExportText.Read(stream, "npc_compatibility.json"));
        }

        public static bool IsReserved(string identifier) => Entities.Contains(identifier);
        public static JObject Properties => (JObject)Catalog["properties"].DeepClone();
        public static JObject RenderController(string name) => Catalog["render_controllers"]?[name] as JObject;
        public static JArray SkinTargets => (JArray)Catalog["skin_targets"].DeepClone();

        public static void ValidateAnimations(IEnumerable<ModelEntry> models)
        {
            var definitions = new Dictionary<string, JToken>(StringComparer.Ordinal);
            var required = new HashSet<string>(StringComparer.Ordinal);
            foreach (var model in models)
            {
                foreach (var file in model.AnimationFiles ?? new List<string>())
                {
                    var json = JObject.Parse(ExportText.Read(file));
                    var animations = json["animations"] as JObject;
                    if (animations == null) throw new InvalidDataException("动画文件缺少 animations: " + file);
                    foreach (var definition in animations.Properties())
                    {
                        if (definitions.TryGetValue(definition.Name, out var previous) &&
                            !JToken.DeepEquals(previous, definition.Value))
                            throw new InvalidDataException("动画 ID 存在不同定义: " + definition.Name);
                        definitions[definition.Name] = definition.Value;
                    }
                }
                foreach (var name in new[] { model.IdleAnimation, model.WalkAnimation,
                    model.WalkaAnimation, model.AttackAnimation, model.DeathAnimation }
                    .Concat(model.AnimationList ?? new List<string>()))
                    if (!string.IsNullOrWhiteSpace(name)) required.Add(name);
            }
            foreach (var name in required)
                if (!definitions.ContainsKey(name) && !Animations.Contains(name))
                    throw new InvalidDataException("动画 ID 未找到对应资源: " + name);
        }
    }
}
