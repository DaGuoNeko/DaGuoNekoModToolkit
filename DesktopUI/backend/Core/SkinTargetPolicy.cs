using System;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    internal static class SkinTargetPolicy
    {
        public static string NormalizeIdentifier(string target)
        {
            target = (target ?? "").Trim();
            if (target.Length > 160 || (target.Length > 0 && !Regex.IsMatch(target, @"^[a-z0-9_.-]+:[a-z0-9_./-]+$")))
                throw new ArgumentException("目标模型 ID 必须是 namespace:identifier 格式");
            return target;
        }

        public static string DefaultSlot(string target)
        {
            if (string.IsNullOrEmpty(target)) return "skin_4";
            var entry = NpcCompatibility.SkinTargets.OfType<JObject>().FirstOrDefault(t => (string)t["identifier"] == target);
            return (string)entry?["texture_slot"] ?? "default";
        }

        public static string NormalizeSlot(string target, string slot)
        {
            slot = string.IsNullOrWhiteSpace(slot) ? DefaultSlot(target) : slot.Trim();
            if (slot.Length > 80 || !Regex.IsMatch(slot, @"^[a-zA-Z0-9_.-]+$"))
                throw new ArgumentException("贴图槽位只能包含字母、数字、下划线、点和短横线");
            return slot;
        }

        public static bool ValidateTexture(string path, string target, out string error)
        {
            bool human = string.IsNullOrEmpty(target) || NpcCompatibility.SkinTargets.OfType<JObject>()
                .Any(t => (string)t["identifier"] == target && (bool)t["human"]);
            return human ? Utils.ValidateSkinPngFile(path, out error) : Utils.ValidatePngFile(path, out error);
        }
    }
}
