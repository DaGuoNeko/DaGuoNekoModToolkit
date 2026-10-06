using System;
using System.IO;
using System.Runtime.InteropServices;

namespace NpcSkinMaker
{
    /// <summary>
    /// 日志管理器 — 移植自 Python core/logger.py
    /// </summary>
    public static class Logger
    {
        private static string _logDir;
        private static string _logFile;

        static Logger()
        {
            _logDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Temp", "NPC_SkinMaker");
            if (!Directory.Exists(_logDir))
                Directory.CreateDirectory(_logDir);

            string timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
            _logFile = Path.Combine(_logDir, "npc_skin_maker_" + timestamp + ".log");

            WriteLog("=== 大果喵模组工具箱 日志 ===");
            WriteLog("启动时间: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            WriteLog("日志文件: " + _logFile);
            WriteLog("");
        }

        public static string GetLogFile() { return _logFile; }
        public static string GetLogDir() { return _logDir; }

        private static void WriteLog(string message)
        {
            try
            {
                using (var sw = new StreamWriter(_logFile, true, System.Text.Encoding.UTF8))
                {
                    sw.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message);
                }
            }
            catch { }
        }

        public static void Info(string message)
        {
            WriteLog("[INFO] " + message);
        }

        public static void Warning(string message)
        {
            WriteLog("[WARNING] " + message);
        }

        public static void Error(string message)
        {
            WriteLog("[ERROR] " + message);
        }

        public static void Debug(string message)
        {
            WriteLog("[DEBUG] " + message);
        }
    }
}
