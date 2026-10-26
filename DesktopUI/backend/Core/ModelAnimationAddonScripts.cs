using System.IO;

namespace NpcSkinMaker
{
    /// <summary>模型目录与在线骨架在同一次加载生命周期注册，旧主包仍保留模型目录。</summary>
    internal static class ModelAnimationAddonScripts
    {
        public static void Write(string scriptDirectory, string moduleName, string ownerId, string configFileName)
        {
            Utils.WriteTextFile(Path.Combine(scriptDirectory, "init_modnpcmodelsClientSystem.py"),
                CreateScript(true, moduleName, ownerId, configFileName));
            Utils.WriteTextFile(Path.Combine(scriptDirectory, "init_modnpcmodelsServerSystem.py"),
                CreateScript(false, moduleName, ownerId, configFileName));
        }

        private static string CreateScript(bool client, string moduleName, string ownerId, string configFileName)
        {
            string apiModule = client ? "client" : "server";
            string apiName = client ? "clientApi" : "serverApi";
            string side = client ? "Client" : "Server";
            string className = "init_modnpcmodels" + side + "System";
            string readyEvent = "Load" + side + "AddonScriptsAfter";
            string catalog = client ?
                "        main.NpcDlcModelsConfigNameList.add('" + configFileName + "')\n" : "";
            return @"# -*- coding: utf-8 -*-
import mod." + apiModule + ".extra" + side + "Api as " + apiName + @"
from " + moduleName + @".animation_models import ANIMATION_MANIFEST

OWNER_ID = '" + ownerId + @"'
System = " + apiName + ".Get" + side + @"SystemCls()


class " + className + @"(System):
    def __init__(self, namespace, systemName):
        System.__init__(self, namespace, systemName)
        self.CustomNpcClass = None
        self._animation_unregister = None
        self.ListenForEvent(" + apiName + ".GetEngineNamespace(), " + apiName + @".GetEngineSystemName(),
                            '" + readyEvent + @"', self, self.OnScriptsReady, 10)

    def OnScriptsReady(self, args):
        main = " + apiName + ".GetSystem('customNPC', 'customNPC" + side + @"System')
        if main is None:
            print '[NPC模型拓展] 未加载自定义NPC主包：', OWNER_ID
            return
        self.CustomNpcClass = main
" + catalog + @"        # 这是与可选旧主包的兼容边界，目录注册不依赖动画接口。
        register = getattr(main, 'API_RegisterAnimationModels', None)
        unregister = getattr(main, 'API_UnregisterAnimationModels', None)
        if register is None or unregister is None:
            print '[NPC模型拓展] 在线动画需要支持模型注册的新版自定义NPC主包：', OWNER_ID
            return
        ok, message = register(OWNER_ID, ANIMATION_MANIFEST)
        if not ok:
            print '[NPC模型拓展] 动画骨架注册失败：', OWNER_ID, message
            return
        self._animation_unregister = unregister

    def Destroy(self):
        self.UnListenForEvent(" + apiName + ".GetEngineNamespace(), " + apiName + @".GetEngineSystemName(),
                              '" + readyEvent + @"', self, self.OnScriptsReady)
        if self._animation_unregister is not None:
            self._animation_unregister(OWNER_ID)
            self._animation_unregister = None
";
        }
    }
}
