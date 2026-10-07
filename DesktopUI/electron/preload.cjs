const { contextBridge, ipcRenderer, webUtils } = require("electron");
const methods = new Set([
  "window.state",
  "window.control",
  "window.confirm-close",
  "bootstrap",
  "state",
  "clipboard.write",
  "skins.add",
  "skins.update",
  "skins.delete",
  "skins.clear",
  "skins.import",
  "models.save",
  "models.animations",
  "models.delete",
  "models.clear",
  "models.move",
  "models.import",
  ...["textures", "sounds"].flatMap((kind) =>
    ["add", "save", "settings", "delete", "clear", "import"].map(
      (action) => `${kind}.${action}`,
    ),
  ),
  "project.open",
  "project.new",
  "project.save",
  "files.pick",
  "files.directory",
  "image.read",
  "audio.read",
  "export",
  "settings.update",
  "studio.list",
  "studio.path",
  "studio.saves",
  "studio.version",
  "studio.open",
  "configs.list",
  "path.open",
  "tools.run",
  "tools.launch",
  "web.open",
]);
contextBridge.exposeInMainWorld("toolkit", {
  async call(method, args = {}) {
    if (!methods.has(method)) throw new Error("不支持的操作");
    const response = await ipcRenderer.invoke("request", method, args);
    if (!response.ok) throw new Error(response.error);
    return response.result;
  },
  droppedFiles: (files) =>
    ipcRenderer.invoke(
      "dropped-files",
      Array.from(files, (file) => webUtils.getPathForFile(file)).filter(
        Boolean,
      ),
    ),
  onTheme: (listener) => {
    const handler = (_, value) => listener(value);
    ipcRenderer.on("theme", handler);
    return () => ipcRenderer.removeListener("theme", handler);
  },
  onWindowState: (listener) => {
    const handler = (_, value) => listener(value);
    ipcRenderer.on("window-state", handler);
    return () => ipcRenderer.removeListener("window-state", handler);
  },
  onCloseRequested: (listener) => {
    const handler = (_, value) => listener(value);
    ipcRenderer.on("close-requested", handler);
    return () => ipcRenderer.removeListener("close-requested", handler);
  },
});
