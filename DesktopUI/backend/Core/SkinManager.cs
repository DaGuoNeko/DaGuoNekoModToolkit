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
        public SkinData AddSkin(string texturePath, string name, string author, string targetIdentifier = "", string textureSlot = null)
        {
            targetIdentifier = SkinTargetPolicy.NormalizeIdentifier(targetIdentifier);
            textureSlot = SkinTargetPolicy.NormalizeSlot(targetIdentifier, textureSlot);
            // 验证 PNG 文件
            string msg;
            if (!SkinTargetPolicy.ValidateTexture(texturePath, targetIdentifier, out msg))
                throw new Exception("皮肤验证失败: " + msg);

            if (string.IsNullOrWhiteSpace(name))
                throw new Exception("人物名称不能为空");
            if (string.IsNullOrWhiteSpace(author))
                throw new Exception("作者名称不能为空");

            if (_skins.Count >= MaxSkins)
                throw new Exception("单次最多支持 " + MaxSkins + " 个皮肤");

            var existingIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var existingSkin in _skins)
            {
                existingIds.Add(existingSkin.Id);
                if (existingSkin.FromImport) existingIds.Add(existingSkin.OriginalId);
            }
            string skinId = Utils.GenerateUniqueSkinId(existingIds);

            var skin = new SkinData
            {
                Id = skinId,
                TexturePath = texturePath,
                Name = name.Trim(),
                Author = author.Trim(), TargetIdentifier = targetIdentifier, TextureSlot = textureSlot
            };

            _skins.Add(skin);
            return skin;
        }

        /// <summary>更新皮肤信息</summary>
        public void UpdateSkin(int index, string name, string author, string targetIdentifier = null, string textureSlot = null)
        {
            if (index < 0 || index >= _skins.Count)
                throw new Exception("皮肤索引无效");

            if (string.IsNullOrWhiteSpace(name))
                throw new Exception("人物名称不能为空");
            if (string.IsNullOrWhiteSpace(author))
                throw new Exception("作者名称不能为空");

            bool targetChanged = targetIdentifier != null;
            targetIdentifier = SkinTargetPolicy.NormalizeIdentifier(targetIdentifier ?? _skins[index].TargetIdentifier);
            textureSlot = SkinTargetPolicy.NormalizeSlot(targetIdentifier, textureSlot ?? (targetChanged ? null : _skins[index].TextureSlot));
            if (!SkinTargetPolicy.ValidateTexture(_skins[index].TexturePath, targetIdentifier, out string error))
                throw new ArgumentException(error);
            _skins[index].TargetIdentifier = targetIdentifier;
            _skins[index].TextureSlot = textureSlot;
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
            foreach (var skin in _skins)
            {
                var item = new Dictionary<string, object>();
                item["ID"] = skin.FromImport ? skin.OriginalId : skin.Id;
                item["name"] = skin.Name;
                item["by"] = skin.Author;
                item["texture"] = "textures/entity/npc_dlcskin/" + skin.Id;
                if (!string.IsNullOrEmpty(skin.TargetIdentifier))
                {
                    item["target_identifier"] = skin.TargetIdentifier;
                    item["texture_slot"] = skin.TextureSlot;
                }
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
            foreach (string key in new[] { "ID", "name", "texture" })
                if (item[key]?.Type != Newtonsoft.Json.Linq.JTokenType.String ||
                    string.IsNullOrWhiteSpace((string)item[key]))
                    throw new Exception("皮肤字段必须是非空字符串: " + key);
            if (item["by"] != null && item["by"].Type != Newtonsoft.Json.Linq.JTokenType.Null &&
                item["by"].Type != Newtonsoft.Json.Linq.JTokenType.String)
                throw new Exception("皮肤作者必须是字符串");

            string texturePath = item["texture"].ToString();
            string textureFilename = texturePath.Contains("/")
                ? texturePath.Substring(texturePath.LastIndexOf('/') + 1)
                : texturePath;

            if (textureFilename.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                textureFilename = textureFilename.Substring(0, textureFilename.Length - 4);

            string originalTexture = item["texture"].ToString();
            if (originalTexture.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                originalTexture = originalTexture.Substring(0, originalTexture.Length - 4);

            var skin = new SkinData
            {
                Id = (string)item["ID"],
                OriginalId = item["ID"].ToString(),
                OriginalTexture = originalTexture,
                TexturePath = "",
                Name = item["name"].ToString(),
                Author = string.IsNullOrWhiteSpace((string)item["by"]) ? "NPC皮肤拓展" : (string)item["by"],
                FromImport = true
            };
            if (item["target_identifier"] != null && item["target_identifier"].Type != Newtonsoft.Json.Linq.JTokenType.String)
                throw new Exception("目标模型 ID 必须是字符串");
            if (item["texture_slot"] != null && item["texture_slot"].Type != Newtonsoft.Json.Linq.JTokenType.String)
                throw new Exception("贴图槽位必须是字符串");
            skin.TargetIdentifier = SkinTargetPolicy.NormalizeIdentifier((string)item["target_identifier"]);
            skin.TextureSlot = SkinTargetPolicy.NormalizeSlot(skin.TargetIdentifier, (string)item["texture_slot"]);
            _skins.Add(skin);
        }
    }
}
