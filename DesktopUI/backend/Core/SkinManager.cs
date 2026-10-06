using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace NpcSkinMaker
{
    /// <summary>
    /// 皮肤管理器 — 移植自 Python core/skin_manager.py
    /// 增删改查逻辑 1:1 等价移植
    /// </summary>
    public class SkinManager
    {
        private readonly List<SkinData> _skins = new List<SkinData>();
        private const int MaxSkins = 1000;

        /// <summary>添加皮肤</summary>
        public SkinData AddSkin(string texturePath, string name, string author)
        {
            // 验证 PNG 文件
            string msg;
            if (!Utils.ValidateSkinPngFile(texturePath, out msg))
                throw new Exception("皮肤验证失败: " + msg);

            if (string.IsNullOrWhiteSpace(name))
                throw new Exception("人物名称不能为空");
            if (string.IsNullOrWhiteSpace(author))
                throw new Exception("作者名称不能为空");

            if (_skins.Count >= MaxSkins)
                throw new Exception("单次最多支持 " + MaxSkins + " 个皮肤");

            var existingIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var existingSkin in _skins)
                existingIds.Add(existingSkin.Id);
            string skinId = Utils.GenerateUniqueShortUid(existingIds, "s", Utils.MaxGeneratedNameLength);

            var skin = new SkinData
            {
                Id = skinId,
                TexturePath = texturePath,
                Name = name.Trim(),
                Author = author.Trim()
            };

            _skins.Add(skin);
            return skin;
        }

        /// <summary>更新皮肤信息</summary>
        public void UpdateSkin(int index, string name, string author)
        {
            if (index < 0 || index >= _skins.Count)
                throw new Exception("皮肤索引无效");

            if (string.IsNullOrWhiteSpace(name))
                throw new Exception("人物名称不能为空");
            if (string.IsNullOrWhiteSpace(author))
                throw new Exception("作者名称不能为空");

            _skins[index].Name = name.Trim();
            _skins[index].Author = author.Trim();
        }

        /// <summary>删除皮肤</summary>
        public void RemoveSkin(int index)
        {
            if (index < 0 || index >= _skins.Count)
                throw new Exception("皮肤索引无效");
            _skins.RemoveAt(index);
        }

        public SkinData GetSkin(int index)
        {
            if (index < 0 || index >= _skins.Count)
                throw new Exception("皮肤索引无效");
            return _skins[index];
        }

        public List<SkinData> GetAllSkins() { return _skins; }

        public void ClearSkins() { _skins.Clear(); }

        public int GetSkinCount() { return _skins.Count; }

        /// <summary>导出为字典格式（用于 JSON 序列化）</summary>
        public Dictionary<string, object> ExportToDict(string packageName)
        {
            var npcskinlist = new List<Dictionary<string, object>>();
            var generatedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var skin in _skins)
            {
                var item = new Dictionary<string, object>();
                item["ID"] = Utils.GenerateUniqueShortUid(generatedIds, "s", Utils.MaxGeneratedNameLength);
                item["name"] = skin.Name;
                item["by"] = skin.Author;
                item["texture"] = "textures/entity/npc_dlcskin/" + skin.Id;
                npcskinlist.Add(item);
            }
            var result = new Dictionary<string, object>();
            result["npcskinlist"] = npcskinlist;
            return result;
        }

        /// <summary>从字典导入皮肤列表（用于 JSON 反序列化）</summary>
        public void ImportFromDict(Dictionary<string, object> data)
        {
            if (data == null || !data.ContainsKey("npcskinlist"))
                throw new Exception("无效的皮肤数据格式");

            var npcskinlist = data["npcskinlist"];
            // Newtonsoft.Json 反序列化出来的是 JArray，不是 List<object>
            var jArray = npcskinlist as Newtonsoft.Json.Linq.JArray;
            if (jArray == null)
            {
                var list = npcskinlist as System.Collections.IList;
                if (list == null || list.Count == 0)
                    throw new Exception("皮肤列表格式无效");
                if (list.Count > MaxSkins)
                    throw new Exception("皮肤数量超过限制（最多 " + MaxSkins + " 个）");

                _skins.Clear();
                foreach (var itemObj in list)
                {
                    var jObj = itemObj as Newtonsoft.Json.Linq.JObject;
                    if (jObj == null) throw new Exception("皮肤数据格式无效");
                    ImportSkinItem(jObj);
                }
            }
            else
            {
                if (jArray.Count > MaxSkins)
                    throw new Exception("皮肤数量超过限制（最多 " + MaxSkins + " 个）");

                _skins.Clear();
                foreach (var token in jArray)
                {
                    var jObj = token as Newtonsoft.Json.Linq.JObject;
                    if (jObj == null) continue;
                    ImportSkinItem(jObj);
                }
            }
        }

        private void ImportSkinItem(Newtonsoft.Json.Linq.JObject item)
        {
            if (!item.ContainsKey("ID") || !item.ContainsKey("name") ||
                !item.ContainsKey("by") || !item.ContainsKey("texture"))
                throw new Exception("皮肤数据缺少必要字段");

            string texturePath = item["texture"].ToString();
            string textureFilename = texturePath.Contains("/")
                ? texturePath.Substring(texturePath.LastIndexOf('/') + 1)
                : texturePath;

            if (textureFilename.EndsWith(".png"))
                textureFilename = textureFilename.Substring(0, textureFilename.Length - 4);

            string originalTexture = item["texture"].ToString();
            if (originalTexture.EndsWith(".png"))
                originalTexture = originalTexture.Substring(0, originalTexture.Length - 4);

            var skin = new SkinData
            {
                Id = textureFilename,
                OriginalId = item["ID"].ToString(),
                OriginalTexture = originalTexture,
                TexturePath = "",
                Name = item["name"].ToString(),
                Author = item["by"].ToString(),
                FromImport = true
            };
            _skins.Add(skin);
        }
    }
}
