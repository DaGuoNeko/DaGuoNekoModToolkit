using System;
using System.Collections.Generic;

namespace NpcSkinMaker
{
    /// <summary>
    /// 模型列表管理器 - 1:1 移植自 Python ModelManager
    /// </summary>
    public class ModelManager
    {
        private readonly List<ModelEntry> _models = new List<ModelEntry>();

        public ModelEntry AddModel(ModelEntry entry)
        {
            string err;
            if (!entry.Validate(out err))
                throw new Exception(err);
            EnsureUniqueCustomName(entry, -1);
            _models.Add(entry);
            return entry;
        }

        public void UpdateModel(int index, ModelEntry entry)
        {
            if (index < 0 || index >= _models.Count)
                throw new Exception("模型索引无效");
            string err;
            if (!entry.Validate(out err))
                throw new Exception(err);
            EnsureUniqueCustomName(entry, index);
            _models[index] = entry;
        }

        public void RemoveModel(int index)
        {
            if (index < 0 || index >= _models.Count)
                throw new Exception("模型索引无效");
            _models.RemoveAt(index);
        }

        public ModelEntry GetModel(int index)
        {
            if (index < 0 || index >= _models.Count)
                throw new Exception("模型索引无效");
            return _models[index];
        }

        public List<ModelEntry> GetAllModels() { return _models; }
        public int GetCount() { return _models.Count; }
        public void Clear() { _models.Clear(); }

        public void MoveUp(int index)
        {
            if (index > 0)
            {
                var tmp = _models[index];
                _models[index] = _models[index - 1];
                _models[index - 1] = tmp;
            }
        }

        public void MoveDown(int index)
        {
            if (index < _models.Count - 1)
            {
                var tmp = _models[index];
                _models[index] = _models[index + 1];
                _models[index + 1] = tmp;
            }
        }

        /// <summary>确保同一拓展包内的模型标识符唯一，避免文件覆盖和配置冲突。</summary>
        private void EnsureUniqueCustomName(ModelEntry entry, int ignoreIndex)
        {
            for (int i = 0; i < _models.Count; i++)
            {
                if (i == ignoreIndex) continue;
                if (string.Equals(_models[i].CustomName, entry.CustomName, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("自定义名称重复: " + entry.CustomName);
            }
        }
    }
}
