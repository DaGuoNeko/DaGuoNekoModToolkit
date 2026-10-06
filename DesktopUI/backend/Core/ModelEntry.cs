using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    /// <summary>
    /// 模型数据条目 - 1:1 移植自 Python ModelEntry
    /// 每个条目对应 npcmodelslist 里的一项
    /// </summary>
    public class ModelEntry
    {
        public string DisplayName { get; set; }
        public string CustomName { get; set; }
        public string SourceLabel { get; set; }
        public string GeoPath { get; set; }
        public string PreviewImagePath { get; set; }
        public List<ModelTexture> Textures { get; set; }
        public List<string> AnimationFiles { get; set; }
        public List<string> AnimationList { get; set; }
        public List<ModelSkin> SkinList { get; set; }
        public double CollisionWidth { get; set; }
        public double CollisionHeight { get; set; }
        public string IdleAnimation { get; set; }
        public string WalkAnimation { get; set; }
        public string WalkaAnimation { get; set; }
        public string AttackAnimation { get; set; }
        public string DeathAnimation { get; set; }
        public bool EnableAttachables { get; set; }

        public ModelEntry()
        {
            DisplayName = "";
            CustomName = "";
            SourceLabel = "原版";
            GeoPath = "";
            PreviewImagePath = "";
            Textures = new List<ModelTexture>();
            AnimationFiles = new List<string>();
            AnimationList = new List<string>();
            SkinList = new List<ModelSkin>();
            CollisionWidth = 0.6;
            CollisionHeight = 1.8;
            IdleAnimation = "";
            WalkAnimation = "";
            WalkaAnimation = "";
            AttackAnimation = "";
            DeathAnimation = "";
            EnableAttachables = true;
        }

        /// <summary>自动拼接实体标识符 customnpc:{custom_name}_dlcnpc</summary>
        public string Identifier
        {
            get
            {
                string name = (CustomName ?? "").Trim();
                return string.IsNullOrEmpty(name) ? "" : "customnpc:" + name + "_dlcnpc";
            }
        }

        /// <summary>获取实体 ID 部分，如 my_wolf_dlcnpc</summary>
        public string GetEntityId()
        {
            string name = (CustomName ?? "").Trim();
            return string.IsNullOrEmpty(name) ? "unknown_dlcnpc" : name + "_dlcnpc";
        }

        /// <summary>转换为 npcmodelslist 的一项</summary>
        public Dictionary<string, object> ToConfigItem()
        {
            var item = new Dictionary<string, object>();
            item["name"] = DisplayName ?? "";
            item["image_id"] = "textures/ui/dlcnpc_models/" + GetEntityId();
            item["identifier"] = Identifier;
            item["l"] = SourceLabel ?? "原版";
            item["animation_list"] = new List<string>(AnimationList);
            if (SkinList != null && SkinList.Count > 0)
            {
                var skins = new List<Dictionary<string, object>>();
                foreach (var s in SkinList)
                {
                    var sk = new Dictionary<string, object>();
                    sk["skinid"] = s.SkinId;
                    sk["name"] = s.Name ?? "";
                    sk["by"] = s.By ?? "";
                    skins.Add(sk);
                }
                item["skin_list"] = skins;
            }
            return item;
        }

        /// <summary>验证必填项，返回 (bool, error_msg)</summary>
        public bool Validate(out string error)
        {
            if (string.IsNullOrWhiteSpace(DisplayName))
            {
                error = "显示名称不能为空";
                return false;
            }
            if (string.IsNullOrWhiteSpace(CustomName))
            {
                error = "自定义名称不能为空";
                return false;
            }
            if (!Regex.IsMatch(CustomName, @"^[a-z][a-z0-9_]*$"))
            {
                error = "自定义名称必须以小写字母开头，只能包含小写字母、数字和下划线";
                return false;
            }
            if (CustomName.EndsWith("_dlcnpc", StringComparison.Ordinal))
            {
                error = "自定义名称无需包含 _dlcnpc 后缀";
                return false;
            }
            if (string.IsNullOrEmpty(GeoPath) || !File.Exists(GeoPath))
            {
                error = "模型 .geo.json 文件必须选择且文件存在";
                return false;
            }
            try
            {
                string geoJson = File.ReadAllText(GeoPath, System.Text.Encoding.UTF8);
                JObject.Parse(geoJson);
                if (!Regex.IsMatch(geoJson, @"""identifier""\s*:\s*""geometry\.[^""]+"""))
                {
                    error = "模型 JSON 中未找到 geometry.xxx 标识符";
                    return false;
                }
            }
            catch (Exception e)
            {
                error = "模型 JSON 无效: " + e.Message;
                return false;
            }
            if (Textures == null || Textures.Count == 0)
            {
                error = "至少需要提供一张贴图";
                return false;
            }
            if (Textures.Count > 64)
            {
                error = "单个模型最多支持 64 张贴图";
                return false;
            }
            for (int i = 0; i < Textures.Count; i++)
            {
                var t = Textures[i];
                if (t == null || string.IsNullOrEmpty(t.Path) || !File.Exists(t.Path))
                {
                    error = "贴图 " + i + " 文件不存在: " + (t != null ? t.Path : "");
                    return false;
                }
                string pngError;
                if (!Utils.ValidatePngFile(t.Path, out pngError))
                {
                    error = "贴图 " + i + " 无效: " + pngError;
                    return false;
                }
            }
            var animationFileNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (AnimationFiles != null)
            {
                for (int i = 0; i < AnimationFiles.Count; i++)
                {
                    string animationFile = AnimationFiles[i];
                    if (string.IsNullOrWhiteSpace(animationFile) || !File.Exists(animationFile))
                    {
                        error = "动画文件 " + i + " 不存在: " + (animationFile ?? "");
                        return false;
                    }
                    if (!animationFile.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                    {
                        error = "动画文件必须是 JSON 格式: " + animationFile;
                        return false;
                    }
                    try
                    {
                        var animationJson = JObject.Parse(File.ReadAllText(animationFile, System.Text.Encoding.UTF8));
                        if (!(animationJson["animations"] is JObject))
                        {
                            error = "动画 JSON 缺少 animations 对象: " + animationFile;
                            return false;
                        }
                    }
                    catch (Exception e)
                    {
                        error = "动画 JSON 无效: " + Path.GetFileName(animationFile) + " - " + e.Message;
                        return false;
                    }
                    if (!animationFileNames.Add(Path.GetFileName(animationFile)))
                    {
                        error = "动画文件名重复: " + Path.GetFileName(animationFile);
                        return false;
                    }
                }
            }
            var animationNames = new HashSet<string>(StringComparer.Ordinal);
            if (AnimationList != null)
            {
                foreach (string animationName in AnimationList)
                {
                    if (!animationNames.Add(animationName))
                    {
                        error = "动画 ID 重复: " + animationName;
                        return false;
                    }
                }
            }
            var skinIds = new HashSet<int>();
            if (SkinList != null)
            {
                foreach (var skin in SkinList)
                {
                    if (skin.SkinId < 0 || skin.SkinId >= Textures.Count)
                    {
                        error = "皮肤 skinid 必须在 0 到 " + (Textures.Count - 1) + " 之间";
                        return false;
                    }
                    if (!skinIds.Add(skin.SkinId))
                    {
                        error = "皮肤 skinid 重复: " + skin.SkinId;
                        return false;
                    }
                }
            }
            if (double.IsNaN(CollisionWidth) || double.IsInfinity(CollisionWidth) || CollisionWidth <= 0 ||
                double.IsNaN(CollisionHeight) || double.IsInfinity(CollisionHeight) || CollisionHeight <= 0)
            {
                error = "碰撞箱宽度和高度必须是大于 0 的有效数字";
                return false;
            }
            if (!string.IsNullOrEmpty(PreviewImagePath) && !File.Exists(PreviewImagePath))
            {
                error = "UI 预览图文件不存在";
                return false;
            }
            if (!string.IsNullOrEmpty(PreviewImagePath))
            {
                string previewError;
                if (!Utils.ValidatePngFile(PreviewImagePath, out previewError))
                {
                    error = "UI 预览图无效: " + previewError;
                    return false;
                }
            }
            error = "";
            return true;
        }
    }

    /// <summary>模型贴图项</summary>
    public class ModelTexture
    {
        public string Name { get; set; }
        public string Path { get; set; }

        public ModelTexture()
        {
            Name = "";
            Path = "";
        }

        public ModelTexture(string name, string path)
        {
            Name = name ?? "";
            Path = path ?? "";
        }
    }

    /// <summary>模型皮肤变体项</summary>
    public class ModelSkin
    {
        public int SkinId { get; set; }
        public string Name { get; set; }
        public string By { get; set; }

        public ModelSkin()
        {
            Name = "";
            By = "Minecraft";
        }

        public ModelSkin(int skinId, string name, string by)
        {
            SkinId = skinId;
            Name = name ?? "";
            By = by ?? "";
        }
    }
}
