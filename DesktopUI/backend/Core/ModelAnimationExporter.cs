using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    /// <summary>Build-time online-animation resources; no Python or live NPC is required.</summary>
    internal static class ModelAnimationExporter
    {
        private const string DriverDirectory = "animations/customnpc_online_dlc/";
        private const string PreviewDirectory = "entity/customnpc_online_preview/";
        private const string ControllerDirectory = "render_controllers/customnpc_online_dlc/";
        private static readonly Regex PropertyCall = new Regex(
            @"\b(?:query|q)\.(has_property|property)\s*\(\s*(['""])([^'""]+)\2\s*\)");

        private sealed class Geometry
        {
            internal JArray Bones;
            internal string Parent;
        }

        private sealed class Bone
        {
            internal string Parent;
            internal double[] Pivot, Rotation, LocalPivot;
        }

        private sealed class Skeleton
        {
            internal readonly List<string> Names = new List<string>();
            internal readonly Dictionary<string, Bone> Bones = new Dictionary<string, Bone>(StringComparer.Ordinal);
            internal readonly JObject Conflicts = new JObject();
        }

        public static void Export(string behaviorRoot, string resourceRoot, string owner,
                                  IEnumerable<string> identifiers, string configPath)
        {
            if (!Regex.IsMatch(owner, "^[a-z][a-z0-9_]*$"))
                throw new InvalidDataException("在线动画包名必须为小写资源标识符: " + owner);
            var geometries = ReadGeometries(resourceRoot);
            var clients = ReadDescriptions(Path.Combine(resourceRoot, "entity"), "minecraft:client_entity", resourceRoot);
            var behaviors = ReadDescriptions(Path.Combine(behaviorRoot, "entities"), "minecraft:entity", null);
            var controllers = new Dictionary<string, JObject>(StringComparer.Ordinal);
            foreach (string file in JsonFiles(Path.Combine(resourceRoot, "render_controllers")))
            {
                foreach (var property in Read(file)["render_controllers"] as JObject ?? new JObject())
                {
                    if (!(property.Value is JObject definition)) continue;
                    if (controllers.TryGetValue(property.Key, out var previous) && !JToken.DeepEquals(previous, definition))
                        throw new InvalidDataException("渲染控制器重复且定义不同: " + property.Key);
                    controllers[property.Key] = definition;
                }
            }
            var manifestModels = new JObject();
            var animationBank = new JObject();
            var previewBank = new JObject();
            var generated = new JArray();
            string driverPath = DriverDirectory + owner + ".animation.json";
            string controllerPath = ControllerDirectory + owner + ".render_controllers.json";
            foreach (string identifier in identifiers.Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal))
            {
                if (!clients.TryGetValue(identifier, out var description))
                    throw new InvalidDataException("在线动画缺少最终资源包实体: " + identifier);
                if (!behaviors.TryGetValue(identifier, out var behavior))
                    throw new InvalidDataException("在线动画缺少最终行为包实体: " + identifier);
                try
                {
                    var geometryMap = description["geometry"] as JObject;
                    if (geometryMap == null || geometryMap.Count == 0)
                        throw new InvalidDataException("模型没有 geometry 映射");
                    var geometryIds = new List<string>();
                    if (geometryMap["default"] != null) geometryIds.Add(ResourceString(geometryMap["default"], "default geometry"));
                    geometryIds.AddRange(geometryMap.Properties().Where(property => property.Name != "default")
                        .OrderBy(property => property.Name, StringComparer.Ordinal)
                        .Select(property => ResourceString(property.Value, "geometry " + property.Name)));
                    Skeleton skeleton = BuildSkeleton(geometryIds, geometries);
                    string digest = Digest(owner + "\0" + identifier + "\0" + string.Join("\n",
                        skeleton.Names.Select(name => name + "\0" + skeleton.Bones[name].Parent)));
                    string profileId = "dlc_" + owner + "_" + digest;
                    string prefix = "cnpc_dlc_" + owner + "_" + digest + "_";
                    string world = "animation.customnpc_dlc." + owner + "." + digest + ".world";
                    string ui = "animation.customnpc_dlc." + owner + "." + digest + ".ui";
                    string preview = "customnpc:online_dlc_" + owner + "_" + digest;
                    animationBank.Add(world, Carrier(skeleton, prefix, "query.mod."));
                    animationBank.Add(ui, Carrier(skeleton, prefix, "variable."));
                    var properties = behavior["properties"] as JObject ?? new JObject();
                    var isolated = Preview(description, properties, controllers, previewBank, owner, digest);
                    isolated["identifier"] = preview;
                    string previewPath = PreviewDirectory + owner + "_" + digest + ".entity.json";
                    Write(resourceRoot, previewPath, new JObject(new JProperty("format_version", "1.10.0"),
                        new JProperty("minecraft:client_entity", new JObject(new JProperty("description", isolated)))));
                    generated.Add(previewPath);
                    var info = new JObject();
                    foreach (string name in skeleton.Names)
                        info.Add(name, new JObject(new JProperty("rotation", new JArray(skeleton.Bones[name].Rotation))));
                    manifestModels.Add(identifier, new JObject(new JProperty("id", profileId),
                        new JProperty("bones", new JArray(skeleton.Names)), new JProperty("bone_info", info),
                        new JProperty("world_animation", world), new JProperty("ui_animation", ui),
                        new JProperty("prefix", prefix), new JProperty("channel_conflicts", skeleton.Conflicts),
                        new JProperty("preview_identifier", preview)));
                }
                catch (Exception error) when (error is InvalidDataException || error is ArgumentException)
                {
                    throw new InvalidDataException("无法为模型生成在线动画支持（" + identifier + "）: " + error.Message, error);
                }
            }
            Write(resourceRoot, driverPath, new JObject(new JProperty("format_version", "1.8.0"),
                new JProperty("animations", animationBank)));
            Write(resourceRoot, controllerPath, new JObject(new JProperty("format_version", "1.8.0"),
                new JProperty("render_controllers", previewBank)));
            generated.Add(driverPath);
            generated.Add(controllerPath);
            var manifest = new JObject(new JProperty("schema_version", 1), new JProperty("models", manifestModels));
            string scriptRoot = Path.Combine(behaviorRoot, owner + "_npcdlcmodels_Scripts");
            ExportText.Write(Path.Combine(scriptRoot, "animation_models.py"),
                "# -*- coding: utf-8 -*-\n# Generated static Python 2.7 data; ordinary UTF-8 str literals.\n" +
                "ANIMATION_MANIFEST = " + PythonLiteral(manifest, 0) + "\n");
            var config = Read(configPath);
            config["online_animation_support"] = new JObject(new JProperty("schema_version", 1),
                new JProperty("owner_id", owner), new JProperty("generated_resources", generated));
            ExportText.Write(configPath, config.ToString(Formatting.Indented));
            Logger.Info("[模型] 已生成在线动画支持: " + manifestModels.Count + " 个模型（无 Python 依赖）");
        }

        private static Dictionary<string, JObject> ReadDescriptions(string folder, string type, string resourceRoot)
        {
            var result = new Dictionary<string, JObject>(StringComparer.Ordinal);
            foreach (string file in JsonFiles(folder))
            {
                var description = Read(file)[type]?["description"] as JObject;
                string identifier = (string)description?["identifier"];
                if (string.IsNullOrEmpty(identifier)) continue;
                if (result.ContainsKey(identifier)) throw new InvalidDataException("实体资源标识符重复: " + identifier);
                result.Add(identifier, description);
            }
            return result;
        }

        private static Dictionary<string, Geometry> ReadGeometries(string resourceRoot)
        {
            var result = new Dictionary<string, Geometry>(StringComparer.Ordinal);
            foreach (string file in JsonFiles(Path.Combine(resourceRoot, "models")))
            {
                var document = Read(file);
                var modern = document["minecraft:geometry"];
                foreach (var item in modern is JObject single ? new[] { single } :
                    (modern as JArray)?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
                {
                    string identifier = (string)item["description"]?["identifier"];
                    if (!string.IsNullOrEmpty(identifier)) AddGeometry(result, identifier, item["bones"] as JArray, null);
                }
                foreach (var property in document.Properties().Where(property => property.Name.StartsWith("geometry.", StringComparison.Ordinal)))
                {
                    if (!(property.Value is JObject item)) continue;
                    int separator = property.Name.IndexOf(':');
                    string name = separator < 0 ? property.Name : property.Name.Substring(0, separator);
                    string parent = separator < 0 ? null : property.Name.Substring(separator + 1);
                    AddGeometry(result, name, item["bones"] as JArray, parent);
                }
            }
            return result;
        }

        private static void AddGeometry(Dictionary<string, Geometry> index, string id, JArray bones, string parent)
        {
            if (bones == null) throw new InvalidDataException("geometry 缺少 bones: " + id);
            if (index.TryGetValue(id, out var old) &&
                (old.Parent != parent || !JToken.DeepEquals(old.Bones, bones)))
                throw new InvalidDataException("geometry 重复且定义不同: " + id);
            index[id] = new Geometry { Bones = bones, Parent = parent };
        }

        private static List<JObject> ResolveGeometry(string id, Dictionary<string, Geometry> index, HashSet<string> visiting)
        {
            if (!index.TryGetValue(id, out var geometry)) throw new InvalidDataException("缺少 geometry: " + id);
            if (!visiting.Add(id)) throw new InvalidDataException("geometry 继承循环: " + id);
            var merged = new JObject();
            if (!string.IsNullOrEmpty(geometry.Parent))
                foreach (var bone in ResolveGeometry(geometry.Parent, index, visiting))
                    merged[(string)bone["name"]] = bone.DeepClone();
            foreach (var item in geometry.Bones)
            {
                if (!(item is JObject bone)) throw new InvalidDataException("geometry 骨骼不是对象: " + id);
                if (bone["name"] != null && bone["name"].Type != JTokenType.String)
                    throw new InvalidDataException("geometry 骨骼名称必须是字符串: " + id);
                string name = (string)bone["name"];
                if (string.IsNullOrEmpty(name)) continue;
                var record = merged[name] as JObject ?? new JObject();
                foreach (var property in bone.Properties()) record[property.Name] = property.Value.DeepClone();
                merged[name] = record;
            }
            visiting.Remove(id);
            if (merged.Count == 0) throw new InvalidDataException("geometry 没有可寻址骨骼: " + id);
            return merged.Properties().Select(property => (JObject)property.Value).ToList();
        }

        private static Skeleton BuildSkeleton(IEnumerable<string> geometryIds, Dictionary<string, Geometry> index)
        {
            var result = new Skeleton();
            var canonical = new Dictionary<string, string>(StringComparer.Ordinal);
            var aliases = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            var variants = new Dictionary<string, List<Bone>>(StringComparer.Ordinal);
            foreach (string id in geometryIds.Distinct(StringComparer.Ordinal))
            {
                var source = ResolveGeometry(id, index, new HashSet<string>(StringComparer.Ordinal));
                var local = source.ToDictionary(bone => (string)bone["name"], StringComparer.Ordinal);
                foreach (var item in source)
                {
                    string original = (string)item["name"], folded = original.ToLowerInvariant();
                    if (!canonical.TryGetValue(folded, out var name)) canonical[folded] = name = original;
                    if (!aliases.ContainsKey(name)) aliases[name] = new HashSet<string>(StringComparer.Ordinal);
                    aliases[name].Add(original);
                }
                foreach (var item in source)
                {
                    if (item["parent"] != null && item["parent"].Type != JTokenType.String)
                        throw new InvalidDataException("骨骼 parent 必须是字符串: " + (string)item["name"]);
                    string parent = (string)item["parent"] ?? "";
                    if (parent.Length != 0 && !local.ContainsKey(parent))
                    {
                        var matches = local.Keys.Where(name => name.ToLowerInvariant() == parent.ToLowerInvariant()).ToList();
                        if (matches.Count != 1) throw new InvalidDataException("骨骼父节点缺失或大小写不明确: " + parent + " (" + id + ")");
                        parent = matches[0];
                    }
                    double[] pivot = Vector(item["pivot"], "pivot"), rotation = Vector(item["rotation"], "rotation");
                    double[] parentPivot = parent.Length == 0 ? new double[3] : Vector(local[parent]["pivot"], "parent pivot");
                    string name = canonical[((string)item["name"]).ToLowerInvariant()];
                    var record = new Bone { Parent = parent.Length == 0 ? "" : canonical[parent.ToLowerInvariant()],
                        Pivot = pivot, Rotation = rotation,
                        LocalPivot = pivot.Zip(parentPivot, (value, anchor) => value - anchor).ToArray() };
                    if (!result.Bones.ContainsKey(name)) result.Bones.Add(name, record);
                    if (!variants.ContainsKey(name)) variants[name] = new List<Bone>();
                    variants[name].Add(record);
                }
            }
            var visiting = new HashSet<string>(StringComparer.Ordinal);
            var visited = new HashSet<string>(StringComparer.Ordinal);
            Action<string> visit = null;
            visit = name =>
            {
                if (visited.Contains(name)) return;
                if (!visiting.Add(name)) throw new InvalidDataException("骨骼层级循环: " + name);
                string parent = result.Bones[name].Parent;
                if (parent.Length != 0) visit(parent);
                visiting.Remove(name);
                visited.Add(name);
                result.Names.Add(name);
            };
            foreach (string name in result.Bones.Keys.OrderBy(name => name, StringComparer.Ordinal)) visit(name);
            if (result.Names.Count == 0) throw new InvalidDataException("没有可寻址的模型骨架");
            foreach (string name in result.Names)
            {
                var entries = variants[name];
                var first = entries[0];
                var conflicts = new JArray();
                if (entries.Skip(1).Any(item => item.Parent != first.Parent || !item.LocalPivot.SequenceEqual(first.LocalPivot))) conflicts.Add("position");
                if (entries.Skip(1).Any(item => !item.Rotation.SequenceEqual(first.Rotation))) conflicts.Add("rotation");
                if (aliases[name].Count > 1) conflicts = new JArray("position", "rotation", "scale");
                if (conflicts.Count != 0) result.Conflicts.Add(name, conflicts);
            }
            return result;
        }

        private static JObject Carrier(Skeleton skeleton, string profilePrefix, string domain)
        {
            string prefix = domain + profilePrefix, enabled = prefix + "enabled", weight = prefix + "weight", mode = prefix + "mode";
            var bones = new JObject();
            for (int slot = 0; slot < skeleton.Names.Count; slot++)
            {
                string bone = skeleton.Names[slot], parent = skeleton.Bones[bone].Parent;
                var channels = new JObject();
                foreach (var channel in new[] { new[] { "position", "p" }, new[] { "rotation", "r" }, new[] { "scale", "s" } })
                {
                    string head = prefix + slot + "_" + channel[1], gate = enabled + " && " + head + "_on";
                    var values = new JArray();
                    foreach (char axis in "xyz")
                    {
                        string value = head + axis, expression;
                        if (channel[0] == "scale")
                            expression = gate + " ? (" + mode + " ? (math.abs(this) > 0.000001 ? (1.0 + " + weight + " * (" + value + " / this - 1.0)) : 1.0) : (1.0 + " + weight + " * (" + value + " - 1.0))) : 1.0";
                        else if (channel[0] == "position")
                        {
                            string origin = "temp.cnpc_bind." + axis;
                            if (parent.Length != 0) origin = "(" + origin + " - temp.cnpc_parent_bind." + axis + ")";
                            string rest = axis == 'y' ? "-(" + origin + ")" : origin;
                            string setup = "temp.cnpc_bind = query.bone_origin('" + MolangEscape(bone.ToLowerInvariant()) + "'); ";
                            if (parent.Length != 0) setup += "temp.cnpc_parent_bind = query.bone_origin('" + MolangEscape(parent.ToLowerInvariant()) + "'); ";
                            expression = gate + " ? { " + setup + " return " + weight + " * (" + value + " - (" + mode + " ? (this - (" + rest + ")) : 0.0)); }; return 0.0;";
                        }
                        else expression = gate + " ? " + weight + " * (" + value + " - (" + mode + " ? (this - " + prefix + slot + "_r_rest" + axis + ") : 0.0)) : 0.0";
                        values.Add(expression);
                    }
                    channels.Add(channel[0], values);
                }
                bones.Add(bone, channels);
            }
            return new JObject(new JProperty("loop", true), new JProperty("bones", bones));
        }

        private static JObject Preview(JObject description, JObject properties,
            Dictionary<string, JObject> controllers, JObject output, string owner, string digest)
        {
            var copy = (JObject)description.DeepClone();
            var entries = copy["render_controllers"] as JArray;
            if (entries == null || entries.Count == 0) throw new InvalidDataException("预览缺少渲染控制器");
            var active = new JArray();
            var required = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in entries)
            {
                if (entry.Type == JTokenType.String)
                {
                    required.Add((string)entry);
                    active.Add(entry.DeepClone());
                }
                else if (entry is JObject conditions)
                {
                    var kept = new JObject();
                    foreach (var property in conditions.Properties())
                    {
                        var condition = Sanitize(property.Value, properties, new Dictionary<string, string>());
                        // Disabled defaults need no external main-pack outline controller in a UI actor.
                        if (IsAlwaysDisabled(condition)) continue;
                        required.Add(property.Name);
                        kept.Add(property.Name, condition);
                    }
                    if (kept.Count != 0) active.Add(kept);
                }
                else throw new InvalidDataException("渲染控制器入口必须是名称或条件对象");
            }
            copy["render_controllers"] = active;
            var sources = new Dictionary<string, JObject>(StringComparer.Ordinal);
            var queue = new Queue<string>(required.OrderBy(value => value, StringComparer.Ordinal));
            while (queue.Count != 0)
            {
                string name = queue.Dequeue();
                if (sources.ContainsKey(name)) continue;
                var source = controllers.TryGetValue(name, out var local) ? local : NpcCompatibility.RenderController(name);
                if (source == null) throw new InvalidDataException("预览找不到实际渲染控制器: " + name);
                sources.Add(name, source);
                foreach (string child in source.Descendants().OfType<JValue>().Where(value => value.Type == JTokenType.String)
                    .Select(value => (string)value).Where(value => value.StartsWith("controller.render.", StringComparison.Ordinal)))
                    if (!sources.ContainsKey(child)) queue.Enqueue(child);
            }
            var mapping = sources.Keys.ToDictionary(name => name,
                name => "controller.render.customnpc_dlc." + owner + "." + digest + "." + Digest(name), StringComparer.Ordinal);
            foreach (var source in sources)
                output.Add(mapping[source.Key], Sanitize(source.Value, properties, mapping));
            var generated = (JObject)Sanitize(copy, properties, mapping);
            var scripts = generated["scripts"] as JObject ?? new JObject();
            var initialize = new JArray("variable.gliding_speed_value = 1.0;", "variable.is_holding_left = 0.0;",
                "variable.is_holding_right = 0.0;", "variable.attack_time = 0.0;");
            if (scripts["initialize"] is JArray authored)
                foreach (var statement in authored) initialize.Add(statement.DeepClone());
            else if (scripts["initialize"] != null) throw new InvalidDataException("scripts.initialize 必须是数组");
            scripts["initialize"] = initialize;
            generated["scripts"] = scripts;
            return generated;
        }

        private static bool IsAlwaysDisabled(JToken condition)
        {
            if (condition.Type == JTokenType.Boolean) return !(bool)condition;
            if (condition.Type == JTokenType.Integer || condition.Type == JTokenType.Float) return (double)condition == 0.0;
            if (condition.Type != JTokenType.String) return false;
            var terms = ((string)condition).Split(new[] { "&&" }, StringSplitOptions.None);
            // Be deliberately conservative: a ternary/OR containing zero is not necessarily false.
            return terms.All(part => Regex.IsMatch(part.Trim(), @"^\(*\s*[01](?:\.0+)?\s*\)*$")) &&
                terms.Any(part => Regex.IsMatch(part.Trim(), @"^\(*\s*0(?:\.0+)?\s*\)*$"));
        }

        private static JToken Sanitize(JToken token, JObject properties, Dictionary<string, string> names)
        {
            if (token is JObject obj)
            {
                var result = new JObject();
                foreach (var property in obj.Properties())
                    result.Add(names.TryGetValue(property.Name, out var name) ? name : property.Name,
                               Sanitize(property.Value, properties, names));
                return result;
            }
            if (token is JArray array) return new JArray(array.Select(value => Sanitize(value, properties, names)));
            if (token.Type != JTokenType.String) return token.DeepClone();
            string text = (string)token;
            if (names.TryGetValue(text, out var mapped)) text = mapped;
            return new JValue(PropertyCall.Replace(text, match =>
            {
                string name = match.Groups[3].Value;
                var property = properties[name] as JObject;
                if (property == null || property["default"] == null || property["default"].Type == JTokenType.Null)
                    throw new InvalidDataException("预览引用了没有实际默认值的属性: " + name);
                return match.Groups[1].Value == "has_property" ? "(1.0)" : "(" + PropertyLiteral(property["default"]) + ")";
            }));
        }

        private static string PropertyLiteral(JToken value)
        {
            if (value.Type == JTokenType.Boolean) return (bool)value ? "1.0" : "0.0";
            if (value.Type == JTokenType.Integer || value.Type == JTokenType.Float)
            {
                double number = (double)value;
                if (double.IsNaN(number) || double.IsInfinity(number))
                    throw new InvalidDataException("行为包属性默认值不是有限数值");
                return number.ToString("R", CultureInfo.InvariantCulture);
            }
            if (value.Type == JTokenType.String) return "'" + MolangEscape((string)value) + "'";
            throw new InvalidDataException("行为包属性默认值不是 Molang 标量");
        }

        private static double[] Vector(JToken value, string label)
        {
            if (value == null) return new double[3];
            if (!(value is JArray array) || array.Count != 3 || array.Any(component =>
                component.Type != JTokenType.Integer && component.Type != JTokenType.Float))
                throw new InvalidDataException("骨骼 " + label + " 必须是三个有限数值");
            var result = array.Values<double>().ToArray();
            if (result.Any(number => double.IsNaN(number) || double.IsInfinity(number)))
                throw new InvalidDataException("骨骼 " + label + " 必须是三个有限数值");
            return result;
        }

        private static string ResourceString(JToken value, string label)
        {
            if (value.Type != JTokenType.String || string.IsNullOrWhiteSpace((string)value))
                throw new InvalidDataException(label + " 必须是实际资源名");
            return (string)value;
        }

        private static string PythonLiteral(JToken value, int depth)
        {
            if (value is JObject obj)
            {
                if (obj.Count == 0) return "{}";
                string pad = new string(' ', (depth + 1) * 4);
                return "{\n" + string.Join(",\n", obj.Properties().Select(property =>
                    pad + PythonString(property.Name) + ": " + PythonLiteral(property.Value, depth + 1))) +
                    "\n" + new string(' ', depth * 4) + "}";
            }
            if (value is JArray array) return "[" + string.Join(", ", array.Select(item => PythonLiteral(item, depth))) + "]";
            if (value.Type == JTokenType.String) return PythonString((string)value);
            if (value.Type == JTokenType.Boolean) return (bool)value ? "True" : "False";
            if (value.Type == JTokenType.Null) return "None";
            return value.ToString(Formatting.None);
        }

        private static string PythonString(string value)
        {
            var text = new StringBuilder("'");
            foreach (char character in value)
            {
                if (character == '\\' || character == '\'') text.Append('\\').Append(character);
                else if (character == '\n') text.Append("\\n");
                else if (character == '\r') text.Append("\\r");
                else if (character == '\t') text.Append("\\t");
                else if (character < 32 || character == 127) text.Append("\\x").Append(((int)character).ToString("x2"));
                else text.Append(character);
            }
            return text.Append('\'').ToString();
        }

        private static string MolangEscape(string value) => value.Replace("\\", "\\\\").Replace("'", "\\'");
        private static string Digest(string value)
        {
            using (var hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant().Substring(0, 12);
        }
        private static JObject Read(string path) => JObject.Parse(ExportText.Read(path));
        private static IEnumerable<string> JsonFiles(string root) => Directory.Exists(root)
            ? Directory.GetFiles(root, "*.json", SearchOption.AllDirectories).OrderBy(value => value, StringComparer.Ordinal)
            : Enumerable.Empty<string>();
        private static string Relative(string root, string file) => file.Substring(root.Length + 1).Replace('\\', '/');
        private static void Write(string root, string relative, JObject value) =>
            ExportText.Write(WorkspaceFiles.ResolveInside(root, relative), value.ToString(Formatting.Indented));
    }
}
