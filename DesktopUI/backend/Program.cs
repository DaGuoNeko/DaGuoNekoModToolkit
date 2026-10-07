using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    internal static class Program
    {
        private static readonly SkinManager Skins = new SkinManager();
        private static readonly ModelManager Models = new ModelManager();
        private static AssetPack Textures = AssetPack.Create("textures");
        private static AssetPack Sounds = AssetPack.Create("sounds");
        private static readonly string TempRoot = Path.Combine(Path.GetTempPath(), "mcnpc-desktop-" + Guid.NewGuid().ToString("N"));

        private static void Main()
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            Directory.CreateDirectory(TempRoot);
            try
            {
                ExtractTemplate("template.zip");
                ExtractTemplate("template_models.zip");
                string line;
                // One request at a time keeps edits and exports on the same authoritative snapshot.
                while ((line = Console.ReadLine()) != null)
                {
                    JToken id = null;
                    try
                    {
                        var request = JObject.Parse(line);
                        id = request["id"];
                        var result = Execute((string)request["method"], request["args"] as JObject ?? new JObject());
                        Console.WriteLine(JsonConvert.SerializeObject(new { id, ok = true, result }));
                    }
                    catch (Exception error)
                    {
                        // This is the IPC isolation boundary; a failed operation must not kill the session.
                        Logger.Error(error.ToString());
                        Console.WriteLine(JsonConvert.SerializeObject(new { id, ok = false, error = error.Message }));
                    }
                }
            }
            finally
            {
                // TempRoot is created by this process and never supplied by the renderer.
                try { Directory.Delete(TempRoot, true); }
                catch (IOException e) { Logger.Warning("临时文件清理失败: " + e.Message); }
                catch (UnauthorizedAccessException e) { Logger.Warning("临时文件清理失败: " + e.Message); }
            }
        }

        private static void ExtractTemplate(string name)
        {
            using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            using (var output = File.Create(Path.Combine(TempRoot, name)))
            {
                if (source == null) throw new InvalidOperationException("缺少打包模板: " + name);
                source.CopyTo(output);
            }
        }

        private static object State() => new
        {
            skins = Skins.GetAllSkins(), models = Models.GetAllModels(),
            textures = Textures.Entries, sounds = Sounds.Entries,
            texturePack = Textures, soundPack = Sounds
        };

        private static List<int> Indices(JObject args, int count)
        {
            var indices = args["indices"]?.ToObject<List<int>>() ?? new List<int>();
            if (indices.Count == 0 || indices.Any(i => i < 0 || i >= count))
                throw new ArgumentException("请选择有效的列表条目");
            return indices.Distinct().OrderByDescending(i => i).ToList();
        }

        private static object Execute(string method, JObject args)
        {
            if (method.StartsWith("textures.") || method.StartsWith("sounds."))
                return ExecuteAssets(method, args);
            switch (method)
            {
                case "state": return State();
                case "project.new":
                    string kind = (string)args["kind"];
                    switch (kind)
                    {
                        case "skins": Skins.ClearSkins(); break;
                        case "models": Models.Clear(); break;
                        case "textures":
                        case "sounds":
                            AssetPack fresh;
                            do { fresh = AssetPack.Create(kind); }
                            while (fresh.ProviderId == Textures.ProviderId || fresh.ProviderId == Sounds.ProviderId);
                            if (kind == "textures") Textures = fresh; else Sounds = fresh;
                            break;
                        default: throw new ArgumentException("不支持的项目类型");
                    }
                    return new { state = State() };
                case "skin.targets": return NpcCompatibility.SkinTargets;
                case "models.animations":
                    return ModelAnimationCatalog.Read(args["paths"]?.ToObject<List<string>>() ?? new List<string>());
                case "skins.add":
                    var items = args["items"] as JArray ?? throw new ArgumentException("缺少皮肤列表");
                    var added = 0;
                    var errors = new List<string>();
                    foreach (JObject item in items)
                    {
                        try
                        {
                            Skins.AddSkin((string)item["path"], (string)item["name"], (string)item["author"],
                                (string)item["targetIdentifier"], (string)item["textureSlot"]);
                            added++;
                        }
                        catch (Exception e) { errors.Add(Path.GetFileName((string)item["path"]) + ": " + e.Message); }
                    }
                    return new { state = State(), added, errors };
                case "skins.update":
                    var selected = Indices(args, Skins.GetSkinCount());
                    string name = ((string)args["name"] ?? "").Trim();
                    string author = ((string)args["author"] ?? "").Trim();
                    if (name.Length == 0 && author.Length == 0) throw new ArgumentException("请至少填写名称或作者");
                    foreach (int i in selected)
                    {
                        SkinData skin = Skins.GetSkin(i);
                        Skins.UpdateSkin(i, name.Length == 0 ? skin.Name : name, author.Length == 0 ? skin.Author : author,
                            (string)args["targetIdentifier"], (string)args["textureSlot"]);
                    }
                    return new { state = State() };
                case "skins.delete":
                    foreach (int i in Indices(args, Skins.GetSkinCount())) Skins.RemoveSkin(i);
                    return new { state = State() };
                case "skins.clear":
                    Skins.ClearSkins(); return new { state = State() };
                case "skins.import":
                    ImportSkins((string)args["path"]); return new { state = State() };
                case "skins.export":
                    return new { path = new PackageBuilder(Path.Combine(TempRoot, "template.zip")).BuildPackage(Skins.GetAllSkins(), (string)args["directory"]) };
                case "models.save":
                    var entry = args["entry"]?.ToObject<ModelEntry>() ?? throw new ArgumentException("缺少模型配置");
                    entry.AnimationFiles = entry.AnimationFiles ?? new List<string>();
                    entry.AnimationList = entry.AnimationList ?? new List<string>();
                    entry.SkinList = entry.SkinList ?? new List<ModelSkin>();
                    int index = (int?)args["index"] ?? -1;
                    if (index < 0)
                    {
                        if (Models.GetCount() >= 500) throw new ArgumentException("单次最多支持 500 个模型");
                        Models.AddModel(entry);
                    }
                    else Models.UpdateModel(index, entry);
                    return new { state = State() };
                case "models.delete":
                    foreach (int i in Indices(args, Models.GetCount())) Models.RemoveModel(i);
                    return new { state = State() };
                case "models.clear":
                    Models.Clear(); return new { state = State() };
                case "models.move":
                    int from = (int)args["index"];
                    if (from < 0 || from >= Models.GetCount()) throw new ArgumentException("模型索引无效");
                    if ((int)args["direction"] < 0) Models.MoveUp(from); else Models.MoveDown(from);
                    return new { state = State() };
                case "models.export":
                    return new { path = new ModelPackageBuilder(Path.Combine(TempRoot, "template_models.zip")).BuildPackage(Models.GetAllModels(), (string)args["directory"]) };
                case "models.import":
                    var importedModels = ModelPackageImport.Load((string)args["path"], TempRoot);
                    Models.Clear();
                    Models.GetAllModels().AddRange(importedModels);
                    return new { state = State() };
                case "project.save":
                    WorkspaceFiles.SaveProject((string)args["path"], Skins.GetAllSkins(), Models.GetAllModels(), Textures, Sounds);
                    return new { path = (string)args["path"] };
                case "project.open":
                    WorkspaceFiles.LoadProject((string)args["path"], TempRoot, out var projectSkins, out var projectModels,
                        out var projectTextures, out var projectSounds);
                    Skins.ClearSkins();
                    Models.Clear();
                    Skins.GetAllSkins().AddRange(projectSkins);
                    Models.GetAllModels().AddRange(projectModels);
                    Textures = projectTextures;
                    Sounds = projectSounds;
                    return new { state = State() };
                default: throw new ArgumentException("不支持的操作: " + method);
            }
        }

        private static object ExecuteAssets(string method, JObject args)
        {
            var parts = method.Split('.');
            string kind = parts[0];
            var current = kind == "textures" ? Textures : Sounds;
            // Validate a complete candidate before changing authoritative session data.
            var candidate = JObject.FromObject(current).ToObject<AssetPack>();
            switch (parts[1])
            {
                case "settings":
                    candidate.Name = ((string)args["name"] ?? candidate.Name).Trim();
                    candidate.Author = ((string)args["author"] ?? candidate.Author).Trim();
                    candidate.ProviderId = ((string)args["providerId"] ?? candidate.ProviderId).Trim();
                    candidate.Version = ((string)args["version"] ?? candidate.Version).Trim();
                    break;
                case "add":
                    var entries = args["items"]?.ToObject<List<AssetEntry>>() ?? throw new ArgumentException("缺少资源列表");
                    foreach (var item in entries)
                    {
                        if (string.IsNullOrWhiteSpace(item.Id)) item.Id = (kind == "textures" ? "tex_" : "snd_") + Guid.NewGuid().ToString("N").Substring(0, 8);
                        candidate.Entries.Add(item);
                    }
                    break;
                case "save":
                    int index = (int)args["index"];
                    if (index < 0 || index >= candidate.Entries.Count) throw new ArgumentException("资源索引无效");
                    var edited = args["entry"]?.ToObject<AssetEntry>() ?? throw new ArgumentException("缺少资源配置");
                    candidate.Entries[index] = edited;
                    break;
                case "delete":
                    foreach (int i in Indices(args, candidate.Entries.Count)) candidate.Entries.RemoveAt(i);
                    break;
                case "clear": candidate.Entries.Clear(); break;
                case "import": candidate = AssetPackageBuilder.Import((string)args["path"], kind, TempRoot); break;
                case "export": return new { path = AssetPackageBuilder.Build(current, kind, (string)args["directory"]) };
                default: throw new ArgumentException("不支持的资源操作: " + method);
            }
            candidate.Validate(kind);
            if (candidate.ProviderId == (kind == "textures" ? Sounds.ProviderId : Textures.ProviderId))
                throw new ArgumentException("贴图包与音效包不能使用相同包标识");
            if (kind == "textures") Textures = candidate; else Sounds = candidate;
            return new { state = State() };
        }

        private static void ImportSkins(string path)
        {
            // Validate the complete import before replacing the current list.
            var candidate = new SkinManager();
            string importDirectory = Path.Combine(TempRoot, "import-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(importDirectory);
            using (var archive = ZipFile.OpenRead(path))
            {
                var configs = new List<ZipArchiveEntry>();
                foreach (var entry in archive.Entries.Where(e => e.FullName.Replace('\\', '/').Contains("/modconfigs/") && e.FullName.EndsWith(".json", StringComparison.OrdinalIgnoreCase)))
                {
                    if (entry.Length > 8 * 1024 * 1024) continue;
                    using (var stream = entry.Open())
                    {
                        var value = JObject.Parse(ExportText.Read(stream, entry.FullName));
                        if (value["npcskinlist"] is JArray) configs.Add(entry);
                    }
                }
                if (configs.Count != 1) throw new InvalidDataException("ZIP 必须包含且仅包含一份 npcskinlist 皮肤配置");
                var config = configs[0];
                JObject data;
                using (var stream = config.Open()) data = JObject.Parse(ExportText.Read(stream, config.FullName));
                var list = (JArray)data["npcskinlist"];
                if (list.Any(item => !(item is JObject))) throw new InvalidDataException("皮肤配置条目必须是对象");
                candidate.ImportFromDict(data.ToObject<Dictionary<string, object>>());
                string normalizedConfig = config.FullName.Replace('\\', '/');
                string resourceRoot = normalizedConfig.Substring(0, normalizedConfig.IndexOf("/modconfigs/", StringComparison.Ordinal)) + "/";
                var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var skin in candidate.GetAllSkins())
                {
                    if (!ids.Add(skin.OriginalId)) throw new InvalidDataException("皮肤 ID 重复: " + skin.OriginalId);
                    string texture = skin.OriginalTexture.Replace('\\', '/').Trim();
                    if (!texture.StartsWith("textures/", StringComparison.OrdinalIgnoreCase) || texture.Split('/').Any(p => p == ".."))
                        throw new InvalidDataException("无效的贴图路径: " + texture);
                    string target = resourceRoot + texture + ".png";
                    var matches = archive.Entries.Where(e => e.FullName.Replace('\\', '/').Equals(target, StringComparison.OrdinalIgnoreCase)).ToList();
                    if (matches.Count != 1 || matches[0].Length > 64 * 1024 * 1024) throw new InvalidDataException("贴图缺失、重复或过大: " + texture);
                    skin.TexturePath = Path.Combine(importDirectory, Guid.NewGuid().ToString("N") + ".png");
                    matches[0].ExtractToFile(skin.TexturePath);
                    if (!SkinTargetPolicy.ValidateTexture(skin.TexturePath, skin.TargetIdentifier, out string error)) throw new InvalidDataException(error);
                }
            }
            Skins.ClearSkins();
            Skins.GetAllSkins().AddRange(candidate.GetAllSkins());
        }
    }
}
