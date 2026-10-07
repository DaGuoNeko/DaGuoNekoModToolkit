using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    internal static class ModelAnimationCatalog
    {
        // Read without changing the editing session; callers may receive replies out of date.
        public static JObject Read(IEnumerable<string> paths)
        {
            var definitions = new Dictionary<string, JToken>(StringComparer.Ordinal);
            var entries = new JArray();
            var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string path in paths)
            {
                if (string.IsNullOrWhiteSpace(path) || !path.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("请选择动画 JSON 文件: " + path);
                if (!files.Add(Path.GetFullPath(path))) continue;
                var json = JObject.Parse(ExportText.Read(path));
                var animations = json["animations"] as JObject;
                if (animations == null) throw new InvalidDataException("动画 JSON 缺少 animations 对象: " + path);
                foreach (var animation in animations.Properties())
                {
                    if (!(animation.Value is JObject) || string.IsNullOrWhiteSpace(animation.Name))
                        throw new InvalidDataException("动画定义无效: " + path + " / " + animation.Name);
                    if (definitions.TryGetValue(animation.Name, out JToken previous))
                    {
                        if (!JToken.DeepEquals(previous, animation.Value))
                            throw new InvalidDataException("动画 ID 存在不同定义: " + animation.Name + " / " + path);
                        continue;
                    }
                    definitions.Add(animation.Name, animation.Value);
                    entries.Add(new JObject(new JProperty("id", animation.Name), new JProperty("file", path)));
                }
            }
            return new JObject(new JProperty("animations", entries));
        }
    }
}
