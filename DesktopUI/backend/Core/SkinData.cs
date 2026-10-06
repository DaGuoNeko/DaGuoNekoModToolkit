using System.Collections.Generic;

namespace NpcSkinMaker
{
    /// <summary>
    /// 皮肤数据模型 — 对应 Python skin_manager 中的 skin dict
    /// </summary>
    public class SkinData
    {
        /// <summary>皮肤唯一 ID（如 skin_abc123）</summary>
        public string Id { get; set; }

        /// <summary>本地贴图文件路径</summary>
        public string TexturePath { get; set; }

        /// <summary>人物名称</summary>
        public string Name { get; set; }

        /// <summary>作者名称</summary>
        public string Author { get; set; }

        // ===== 导入相关字段 =====

        /// <summary>原始 ID（导入时保留）</summary>
        public string OriginalId { get; set; }

        /// <summary>原始 texture 路径（导入时保留，不含 .png）</summary>
        public string OriginalTexture { get; set; }

        /// <summary>是否来自导入</summary>
        public bool FromImport { get; set; }

        /// <summary>缩略图路径（UI 用，不序列化）</summary>
        public string ThumbnailPath
        {
            get { return TexturePath; }
        }

        public SkinData()
        {
            Id = "";
            TexturePath = "";
            Name = "";
            Author = "";
            OriginalId = "";
            OriginalTexture = "";
            FromImport = false;
        }
    }
}
