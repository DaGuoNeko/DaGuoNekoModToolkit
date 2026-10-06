using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace NpcSkinMaker
{
    internal static class ExportText
    {
        private static readonly Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly HashSet<string> Extensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".json", ".jsonc", ".py", ".material", ".lang", ".txt", ".md",
            ".fragment", ".vertex", ".glsl", ".frag", ".vert", ".fsh", ".vsh", ".hlsl",
            ".js", ".ts", ".html", ".css", ".xml", ".yaml", ".yml", ".csv",
            ".ini", ".cfg", ".conf", ".properties", ".mcfunction", ".mcmeta", ".bbmodel", ".molang"
        };

        public static string Read(string path) => Decode(File.ReadAllBytes(path), path);

        public static string Read(Stream source, string label)
        {
            using (var buffer = new MemoryStream())
            {
                source.CopyTo(buffer);
                return Decode(buffer.ToArray(), label);
            }
        }

        private static bool StartsWith(byte[] data, params byte[] prefix)
        {
            if (data.Length < prefix.Length) return false;
            for (int i = 0; i < prefix.Length; i++) if (data[i] != prefix[i]) return false;
            return true;
        }

        private static string Decode(byte[] data, string label)
        {
            Encoding encoding = Utf8;
            int offset = 0;
            if (StartsWith(data, 0x2b, 0x2f, 0x76) && data.Length >= 4 &&
                (data[3] == 0x38 || data[3] == 0x39 || data[3] == 0x2b || data[3] == 0x2f))
                throw new InvalidDataException("不支持 UTF-7 BOM，请将原文件转换为 UTF-8: " + label);
            // UTF-32 LE shares UTF-16 LE's prefix; detect the longest BOM first.
            if (StartsWith(data, 0xff, 0xfe, 0x00, 0x00)) { encoding = new UTF32Encoding(false, false, true); offset = 4; }
            else if (StartsWith(data, 0x00, 0x00, 0xfe, 0xff)) { encoding = new UTF32Encoding(true, false, true); offset = 4; }
            else if (StartsWith(data, 0xef, 0xbb, 0xbf)) offset = 3;
            else if (StartsWith(data, 0xff, 0xfe)) { encoding = new UnicodeEncoding(false, false, true); offset = 2; }
            else if (StartsWith(data, 0xfe, 0xff)) { encoding = new UnicodeEncoding(true, false, true); offset = 2; }
            string text;
            try { text = encoding.GetString(data, offset, data.Length - offset); }
            catch (DecoderFallbackException error)
            {
                throw new InvalidDataException("文本编码无法可靠识别或内容损坏: " + label +
                    "。请将原文件转换为 UTF-8 后重试；未自动替换乱码字符。", error);
            }
            if (text.IndexOf('\0') >= 0)
                throw new InvalidDataException("文本含 NUL 字符，可能是无 BOM 的 UTF-16/UTF-32 或损坏文件: " + label);
            return text.TrimStart('\ufeff');
        }

        public static bool IsText(string path)
        {
            string name = Path.GetFileName(path);
            return Extensions.Contains(Path.GetExtension(path)) ||
                name.Equals("LICENSE", StringComparison.OrdinalIgnoreCase) ||
                name.Equals("README", StringComparison.OrdinalIgnoreCase);
        }

        public static void Write(string path, string content)
        {
            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            if (Path.GetExtension(path).Equals(".py", StringComparison.OrdinalIgnoreCase))
                content = NormalizePythonEncoding(content);
            File.WriteAllText(path, content, Utf8);
        }

        private static string NormalizePythonEncoding(string content)
        {
            // Keep Python 2's source declaration consistent with the exported bytes.
            string[] lines = content.Split(new[] { '\n' }, 3);
            var declaration = new Regex(@"^([ \t\f]*#.*?coding[=:][ \t]*)([-_.a-zA-Z0-9]+)");
            for (int i = 0; i < Math.Min(2, lines.Length); i++)
            {
                var match = declaration.Match(lines[i]);
                if (!match.Success) continue;
                lines[i] = lines[i].Substring(0, match.Groups[2].Index) + "utf-8" +
                    lines[i].Substring(match.Groups[2].Index + match.Groups[2].Length);
                return string.Join("\n", lines);
            }
            foreach (char value in content)
                if (value > 127)
                {
                    if (content.StartsWith("#!") && content.IndexOf('\n') >= 0)
                    {
                        int firstLine = content.IndexOf('\n') + 1;
                        return content.Substring(0, firstLine) + "# -*- coding: utf-8 -*-\n" + content.Substring(firstLine);
                    }
                    return "# -*- coding: utf-8 -*-\n" + content;
                }
            return content;
        }

        public static void NormalizeDirectory(string root)
        {
            foreach (string path in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
                if (IsText(path)) Write(path, Read(path));
        }
    }
}
