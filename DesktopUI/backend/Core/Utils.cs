using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace NpcSkinMaker
{
    /// <summary>
    /// 工具函数 — 移植自 Python core/utils.py
    /// </summary>
    public static class Utils
    {
        public const int MaxGeneratedNameLength = 10;
        private static readonly Random _random = new Random();
        private const string Chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        private const string Letters = "abcdefghijklmnopqrstuvwxyz";

        /// <summary>生成标准 UUID</summary>
        public static string GenerateUuid()
        {
            return Guid.NewGuid().ToString();
        }

        /// <summary>生成短 UID，包含前缀时也保证总长度不超过 10 个字符。</summary>
        public static string GenerateShortUid(string prefix = "", int length = 6)
        {
            prefix = (prefix ?? "").Trim();
            int prefixLength = string.IsNullOrEmpty(prefix) ? 0 : prefix.Length + 1;
            int maxRandomLength = MaxGeneratedNameLength - prefixLength;
            if (maxRandomLength < 1)
                throw new ArgumentException("随机 ID 前缀过长，总长度不能超过 " + MaxGeneratedNameLength + " 个字符", "prefix");
            if (length < 1)
                throw new ArgumentOutOfRangeException("length", "随机字符数量必须大于 0");

            int actualLength = Math.Min(length, maxRandomLength);
            string randomPart = GenerateRandomToken(actualLength, false);
            return string.IsNullOrEmpty(prefix) ? randomPart : prefix + "_" + randomPart;
        }

        /// <summary>生成不超过 10 个字符的唯一包名。</summary>
        public static string GeneratePackageName(string prefix = "s")
        {
            return GenerateShortUid(prefix, MaxGeneratedNameLength);
        }

        /// <summary>生成包含 .json 后缀在内不超过 10 个字符的配置文件名。</summary>
        public static string GenerateConfigFileName()
        {
            const string extension = ".json";
            int stemLength = MaxGeneratedNameLength - extension.Length;
            return GenerateRandomToken(stemLength, true) + extension;
        }

        /// <summary>生成与已有集合不重复的短 UID，并将结果写入集合。</summary>
        public static string GenerateUniqueShortUid(ISet<string> existingIds, string prefix = "", int length = 6)
        {
            if (existingIds == null)
                throw new ArgumentNullException("existingIds");

            for (int i = 0; i < 100; i++)
            {
                string id = GenerateShortUid(prefix, length);
                if (existingIds.Add(id))
                    return id;
            }
            throw new InvalidOperationException("无法生成唯一的短 ID，请重试");
        }

        /// <summary>生成指定长度的小写字母和数字随机串。</summary>
        private static string GenerateRandomToken(int length, bool startsWithLetter)
        {
            char[] buffer = new char[length];
            for (int i = 0; i < length; i++)
            {
                string source = startsWithLetter && i == 0 ? Letters : Chars;
                buffer[i] = source[_random.Next(source.Length)];
            }
            return new string(buffer);
        }

        /// <summary>递归复制目录（包括空目录）</summary>
        public static void CopyDirectory(string src, string dst)
        {
            if (Directory.Exists(dst))
                Directory.Delete(dst, true);
            Directory.CreateDirectory(dst);

            foreach (string file in Directory.GetFiles(src, "*", SearchOption.TopDirectoryOnly))
            {
                string fileName = Path.GetFileName(file);
                File.Copy(file, Path.Combine(dst, fileName), true);
            }

            foreach (string dir in Directory.GetDirectories(src, "*", SearchOption.TopDirectoryOnly))
            {
                string dirName = Path.GetFileName(dir);
                CopyDirectory(dir, Path.Combine(dst, dirName));
            }
        }

        /// <summary>复制文件，自动创建目录</summary>
        public static void CopyFile(string src, string dst)
        {
            string dir = Path.GetDirectoryName(dst);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            File.Copy(src, dst, true);
        }

        /// <summary>读取 JSON 文件</summary>
        public static string ReadTextFile(string path)
        {
            try
            {
                return File.ReadAllText(path, System.Text.Encoding.UTF8);
            }
            catch (Exception e)
            {
                throw new Exception("读取文件失败: " + path + "\n错误: " + e.Message);
            }
        }

        /// <summary>以 UTF-8 无 BOM 写入文本文件</summary>
        public static void WriteTextFile(string path, string content)
        {
            try
            {
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);
                File.WriteAllText(path, content, new System.Text.UTF8Encoding(false));
            }
            catch (Exception e)
            {
                throw new Exception("写入文件失败: " + path + "\n错误: " + e.Message);
            }
        }

        /// <summary>替换文件内容，并以 UTF-8 无 BOM 写回</summary>
        public static void ReplaceInFile(string path, string oldText, string newText)
        {
            try
            {
                string content = File.ReadAllText(path, System.Text.Encoding.UTF8);
                content = content.Replace(oldText, newText);
                WriteTextFile(path, content);
            }
            catch (Exception e)
            {
                throw new Exception("替换文件内容失败: " + path + "\n错误: " + e.Message);
            }
        }

        /// <summary>重命名目录</summary>
        public static string RenameDirectory(string oldPath, string newName)
        {
            string parentDir = Path.GetDirectoryName(oldPath);
            string newPath = Path.Combine(parentDir, newName);

            if (Directory.Exists(newPath))
                Directory.Delete(newPath, true);

            try
            {
                Directory.Move(oldPath, newPath);
            }
            catch (UnauthorizedAccessException)
            {
                CopyDirectory(oldPath, newPath);
                Directory.Delete(oldPath, true);
            }

            return newPath;
        }

        /// <summary>验证 PNG 文件</summary>
        public static bool ValidatePngFile(string filePath, out string message)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(filePath) || !filePath.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                {
                    message = "文件必须是 PNG 格式";
                    return false;
                }

                if (!File.Exists(filePath))
                {
                    message = "文件不存在";
                    return false;
                }

                byte[] header = new byte[24];
                using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read))
                {
                    if (fs.Read(header, 0, header.Length) < header.Length)
                    {
                        message = "无效的 PNG 文件";
                        return false;
                    }
                }

                byte[] pngHeader = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
                for (int i = 0; i < 8; i++)
                {
                    if (header[i] != pngHeader[i])
                    {
                        message = "无效的 PNG 文件";
                        return false;
                    }
                }
                if (header[12] != (byte)'I' || header[13] != (byte)'H' ||
                    header[14] != (byte)'D' || header[15] != (byte)'R')
                {
                    message = "无效的 PNG IHDR 数据块";
                    return false;
                }

                message = "验证成功";
                return true;
            }
            catch (Exception e)
            {
                message = "验证失败: " + e.Message;
                return false;
            }
        }

        /// <summary>验证 Minecraft 人物皮肤 PNG 的完整性和尺寸比例。</summary>
        public static bool ValidateSkinPngFile(string filePath, out string message)
        {
            if (!ValidatePngFile(filePath, out message))
                return false;

            try
            {
                int width;
                int height;
                ReadPngDimensions(filePath, out width, out height);
                bool squareSkin = width == height && width >= 64 && IsPowerOfTwo(width);
                bool legacySkin = width == height * 2 && height >= 32 && IsPowerOfTwo(height);
                if ((!squareSkin && !legacySkin) || width > 4096 || height > 4096)
                {
                    message = "皮肤尺寸必须是 64x64 及其倍率，或 64x32 及其倍率（最大 4096）";
                    return false;
                }

                message = "验证成功（" + width + "x" + height + "）";
                return true;
            }
            catch (Exception e)
            {
                message = "无法读取 PNG 尺寸: " + e.Message;
                return false;
            }
        }

        /// <summary>从 PNG IHDR 数据块读取宽度和高度。</summary>
        private static void ReadPngDimensions(string filePath, out int width, out int height)
        {
            byte[] header = new byte[24];
            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read))
            {
                if (fs.Read(header, 0, header.Length) < header.Length)
                    throw new InvalidDataException("PNG 头部不完整");
            }

            width = ReadBigEndianInt32(header, 16);
            height = ReadBigEndianInt32(header, 20);
            if (width <= 0 || height <= 0)
                throw new InvalidDataException("PNG 尺寸无效");
        }

        /// <summary>读取四字节大端整数。</summary>
        private static int ReadBigEndianInt32(byte[] bytes, int offset)
        {
            return (bytes[offset] << 24) |
                   (bytes[offset + 1] << 16) |
                   (bytes[offset + 2] << 8) |
                   bytes[offset + 3];
        }

        /// <summary>判断正整数是否为 2 的幂。</summary>
        private static bool IsPowerOfTwo(int value)
        {
            return value > 0 && (value & (value - 1)) == 0;
        }

        /// <summary>清理文件名，移除中文和特殊符号</summary>
        public static string SanitizeFilename(string filename)
        {
            string name = Path.GetFileNameWithoutExtension(filename);
            string ext = Path.GetExtension(filename);

            name = Regex.Replace(name, @"[^a-zA-Z0-9_-]", "_");
            name = Regex.Replace(name, @"_+", "_");
            name = name.Trim('_', '-');

            if (string.IsNullOrEmpty(name) || name.Length < 2)
            {
                int maxStemLength = Math.Max(1, MaxGeneratedNameLength - ext.Length);
                name = GenerateShortUid("", maxStemLength);
            }

            return name + ext;
        }

        /// <summary>获取资源文件路径（支持打包后的资源）</summary>
        public static string GetResourcePath(string relativePath)
        {
            string baseDir = Path.GetDirectoryName(
                System.Reflection.Assembly.GetExecutingAssembly().Location);
            return Path.Combine(baseDir, relativePath);
        }

        /// <summary>获取嵌入资源流</summary>
        public static System.IO.Stream GetEmbeddedResource(string resourceName)
        {
            var assembly = System.Reflection.Assembly.GetExecutingAssembly();
            string full = "NpcSkinMaker.Resources." + resourceName;
            return assembly.GetManifestResourceStream(full);
        }
    }
}
