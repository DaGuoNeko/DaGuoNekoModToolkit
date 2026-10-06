const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  nativeImage,
  protocol,
  net,
  session,
  clipboard,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { Backend } = require("./backend.cjs");
const WEB_TOOL_URL = "https://3dtext.easecation.net/";
const {
  Settings,
  Studio,
  globalConfigs,
  runPython,
  cancelRunningTools,
  exists,
} = require("./services.cjs");

app.setName("大果喵模组工具箱");
app.setAppUserModelId("com.daguoneko.modtoolkit");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const dataDirectory =
  process.env.MCNPC_DATA_DIR ||
  path.join(process.env.LOCALAPPDATA, "NPC_SkinMaker");
app.setPath("userData", path.join(dataDirectory, "Electron"));
const settings = new Settings(dataDirectory);
const studio = new Studio(
  process.env.MCNPC_LOCAL_DATA || process.env.LOCALAPPDATA,
  process.env.MCNPC_ROAMING_DATA || process.env.APPDATA,
);
const allowedImages = new Set();
const allowedAudio = new Set();
const allowedOpen = new Set();
let win,
  backend,
  closing = false,
  hasEntries = false,
  busy = 0;

const key = (value) => path.resolve(value).toLowerCase();
function approveImage(value) {
  if (value) allowedImages.add(key(value));
}
function approveOpen(value) {
  if (value) allowedOpen.add(key(value));
}
function rememberState(state) {
  if (!state) return;
  hasEntries =
    state.skins.length +
      state.models.length +
      state.textures.length +
      state.sounds.length >
    0;
  for (const entry of state.textures) approveImage(entry.Path);
  for (const entry of state.sounds) allowedAudio.add(key(entry.Path));
  for (const skin of state.skins) approveImage(skin.TexturePath);
  for (const model of state.models) {
    approveImage(model.PreviewImagePath);
    for (const t of model.Textures) approveImage(t.Path);
  }
}
function emitTheme() {
  const theme = { dark: nativeTheme.shouldUseDarkColors };
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(theme.dark ? "#191919" : "#ffffff");
    win.webContents.send("theme", theme);
  }
}
function applySettings() {
  const mode = { System: "system", Light: "light", Dark: "dark" }[
    settings.value.AppearanceMode
  ];
  if (nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode;
  approveImage(settings.value.BgImagePath);
  approveOpen(settings.value.LastOutputDir);
  emitTheme();
}
const filters = {
  skin: [{ name: "PNG 皮肤", extensions: ["png"] }],
  texture: [{ name: "PNG 贴图", extensions: ["png"] }],
  sound: [{ name: "OGG Vorbis 音效", extensions: ["ogg"] }],
  geo: [{ name: "模型 JSON", extensions: ["json"] }],
  animation: [{ name: "动画 JSON", extensions: ["json"] }],
  zip: [{ name: "ZIP 拓展包", extensions: ["zip"] }],
  project: [{ name: "工具箱工程", extensions: ["dgnproject"] }],
  python: [{ name: "Python 脚本", extensions: ["py"] }],
  executable: [{ name: "程序", extensions: ["exe"] }],
  background: [
    {
      name: "背景图片",
      extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"],
    },
  ],
};
async function pick(kind, multiple = false) {
  if (!filters[kind]) throw new Error("无效的文件选择类型");
  const result = await dialog.showOpenDialog(win, {
    title: "选择文件",
    filters: filters[kind],
    properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
  });
  for (const file of result.filePaths) {
    approveImage(file);
    if (kind === "sound") allowedAudio.add(key(file));
  }
  return result.canceled ? [] : result.filePaths;
}
async function directory(defaultPath = "") {
  const result = await dialog.showOpenDialog(win, {
    title: "选择输出目录",
    defaultPath: defaultPath || undefined,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled) return null;
  approveOpen(result.filePaths[0]);
  return result.filePaths[0];
}
function oneLine(value, label) {
  if (
    typeof value !== "string" ||
    /[\r\n\0]/.test(value) ||
    value.length > 4096
  )
    throw new Error(`${label}格式无效`);
  return value.trim();
}
function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${label}必须是大于等于 ${minimum} 的整数`);
  return value;
}
async function toolsRun(args) {
  const output = await directory(settings.value.ModOutDir);
  if (!output) return { canceled: true };
  const input = args.input || {};
  let script, lines;
  if (args.kind === "mod") {
    const name = oneLine(input.name, "模组名称");
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || name === "custom_warehouse")
      throw new Error("模组名必须以字母开头，且不能为 custom_warehouse");
    script = settings.value.ModScriptPath;
    lines = [
      name,
      ...["help", "hud", "worldData", "setting"].map((k) =>
        input[k] ? "y" : "n",
      ),
    ];
    await settings.update({
      ModName: name,
      ModHelp: !!input.help,
      ModHud: !!input.hud,
      ModWorldData: !!input.worldData,
      ModSetting: !!input.setting,
      ModOutDir: output,
    });
  } else if (args.kind === "item") {
    script = settings.value.ItemScriptPath;
    const ns = oneLine(input.namespace, "命名空间"),
      prefix = oneLine(input.prefix, "物品前缀");
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(ns) ||
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(prefix)
    )
      throw new Error("命名空间和前缀只能包含字母、数字、下划线，并以字母开头");
    const start = integer(input.start, "起始序号"),
      end = integer(input.end, "结束序号");
    if (end < start || end - start > 10000)
      throw new Error("结束序号不得小于起始序号，单次最多生成 10001 项");
    if (![1, 2, 4].includes(input.type)) throw new Error("无效的物品类型");
    lines = [
      ns,
      prefix,
      oneLine(input.name, "中文名称"),
      input.appendIndex ? "true" : "false",
      oneLine(input.tab || "Items", "创造栏"),
      "true",
      input.custom ? "true" : "false",
    ];
    if (input.custom) lines.push("weapon");
    lines.push(start, end, input.type);
    if (input.type === 1) lines.push(integer(input.stackSize, "堆叠数量", 1));
    else {
      if (input.type === 4) lines.push(integer(input.level, "挖掘等级"));
      lines.push(
        integer(input.durability, "耐久", 1),
        integer(input.damage, "伤害"),
      );
    }
  } else throw new Error("不支持的生成类型");
  if (
    !script ||
    path.extname(script).toLowerCase() !== ".py" ||
    !(await exists(script))
  )
    throw new Error("请先选择有效的 Python 生成脚本");
  return runPython(script, output, lines);
}
const coreMethods = new Set([
  "state",
  "skins.add",
  "skins.update",
  "skins.delete",
  "skins.clear",
  "skins.import",
  "models.save",
  "models.delete",
  "models.clear",
  "models.move",
  "models.import",
  ...["textures", "sounds"].flatMap((kind) =>
    ["add", "save", "settings", "delete", "clear", "import"].map(
      (action) => `${kind}.${action}`,
    ),
  ),
]);
async function dispatch(method, args) {
  if (coreMethods.has(method)) {
    busy++;
    try {
      const result = await backend.call(method, args);
      rememberState(method === "state" ? result : result.state);
      return result;
    } finally {
      busy--;
    }
  }
  switch (method) {
    case "window.state":
      return { maximized: win.isMaximized() };
    case "window.control": {
      switch (args.action) {
        case "minimize":
          win.minimize();
          break;
        case "maximize":
          if (win.isMaximized()) win.unmaximize();
          else win.maximize();
          break;
        case "close":
          win.close();
          break;
        default:
          throw new Error("不支持的窗口操作");
      }
      return true;
    }
    case "bootstrap": {
      const state = await backend.call("state");
      rememberState(state);
      return {
        state,
        settings: settings.value,
        dark: nativeTheme.shouldUseDarkColors,
        version: app.getVersion(),
        skinTargets: await backend.call("skin.targets"),
      };
    }
    case "files.pick":
      return pick(args.kind, !!args.multiple);
    case "clipboard.write": {
      clipboard.writeText(oneLine(args.text, "资源 ID"));
      return true;
    }
    case "files.directory":
      return directory(settings.value.LastOutputDir);
    case "project.open": {
      const paths = await pick("project");
      if (!paths.length) return { canceled: true };
      busy++;
      try {
        const result = await backend.call("project.open", { path: paths[0] });
        rememberState(result.state);
        return result;
      } finally {
        busy--;
      }
    }
    case "project.save": {
      const selected = await dialog.showSaveDialog(win, {
        title: "保存工程",
        defaultPath: "模组拓展工程.dgnproject",
        filters: filters.project,
      });
      if (selected.canceled || !selected.filePath) return { canceled: true };
      busy++;
      try {
        return await backend.call("project.save", { path: selected.filePath });
      } finally {
        busy--;
      }
    }
    case "audio.read": {
      if (
        typeof args.path !== "string" ||
        !allowedAudio.has(key(args.path)) ||
        !/\.ogg$/i.test(args.path)
      )
        throw new Error("音效未由用户选择或格式不支持");
      const stat = await fs.stat(args.path);
      if (stat.size > 64 * 1024 * 1024) throw new Error("音效过大");
      return (
        "data:audio/ogg;base64," +
        (await fs.readFile(args.path)).toString("base64")
      );
    }
    case "image.read": {
      if (typeof args.path !== "string" || !allowedImages.has(key(args.path)))
        throw new Error("图片未由用户选择");
      if (!/\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(args.path))
        throw new Error("不支持的图片格式");
      const stat = await fs.stat(args.path);
      if (stat.size > 64 * 1024 * 1024) throw new Error("图片过大");
      let image = nativeImage.createFromPath(args.path);
      if (image.isEmpty()) throw new Error("无法读取图片");
      if (args.thumbnail) image = image.resize({ width: 96, quality: "good" });
      return image.toDataURL();
    }
    case "export": {
      if (!["skins", "models", "textures", "sounds"].includes(args.kind))
        throw new Error("无效的导出类型");
      const output = await directory(settings.value.LastOutputDir);
      if (!output) return { canceled: true };
      busy++;
      try {
        const result = await backend.call(args.kind + ".export", {
          directory: output,
        });
        approveOpen(result.path);
        await settings.update({ LastOutputDir: output });
        return result;
      } finally {
        busy--;
      }
    }
    case "settings.update": {
      const result = await settings.update(args);
      applySettings();
      return result;
    }
    case "studio.list":
      return studio.list(args.account);
    case "studio.path": {
      const chosen = await directory(studio.project(args.id).workDirectory);
      return chosen ? studio.changePath(args.id, chosen) : { canceled: true };
    }
    case "studio.saves": {
      const result = await studio.testSaves(args.id);
      for (const item of result.entries) approveOpen(item.directory);
      return result;
    }
    case "studio.version":
      return studio.changeVersion(args.id, args.version);
    case "studio.open": {
      const item = studio.project(args.id);
      const location = args.config ? item.directory : item.workDirectory;
      const error = await shell.openPath(location);
      if (error) throw new Error(error);
      return true;
    }
    case "configs.list": {
      const result = await globalConfigs(
        process.env.MCNPC_ROAMING_DATA || process.env.APPDATA,
        args.channel,
        args.player,
      );
      for (const item of result.entries) approveOpen(item.path);
      return result;
    }
    case "path.open": {
      if (typeof args.path !== "string" || !allowedOpen.has(key(args.path)))
        throw new Error("此路径不属于当前操作");
      if (args.reveal) shell.showItemInFolder(args.path);
      else {
        const error = await shell.openPath(args.path);
        if (error) throw new Error(error);
      }
      return true;
    }
    case "tools.run": {
      busy++;
      try {
        return await toolsRun(args);
      } finally {
        busy--;
      }
    }
    case "tools.launch": {
      const executable = settings.value.McPath;
      if (
        !executable ||
        !executable.toLowerCase().endsWith(".exe") ||
        !(await exists(executable))
      )
        throw new Error("请先选择有效的游戏程序");
      await new Promise((resolve, reject) => {
        const process = spawn(executable, [], {
          cwd: path.dirname(executable),
          detached: true,
          stdio: "ignore",
        });
        process.once("spawn", () => {
          process.unref();
          resolve();
        });
        process.once("error", reject);
      });
      return true;
    }
    case "web.open": {
      if (args.kind === "3d") {
        await shell.openExternal(WEB_TOOL_URL);
      } else throw new Error("不支持的链接");
      return true;
    }
    default:
      throw new Error("不支持的界面操作");
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      await settings.load();
      applySettings();
      backend = new Backend(
        app.isPackaged
          ? path.join(
              process.resourcesPath,
              "net48",
              "NpcSkinMaker.Backend.exe",
            )
          : path.join(
              __dirname,
              "../backend/bin/Release/net48/NpcSkinMaker.Backend.exe",
            ),
      );
      protocol.handle("app", (request) => {
        const url = new URL(request.url),
          name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (
          url.host !== "mcnpc" ||
          !["index.html", "app.js", "app.css"].includes(name)
        )
          return new Response("Not found", { status: 404 });
        return net.fetch(
          pathToFileURL(path.join(__dirname, "../dist", name)).toString(),
        );
      });
      session.defaultSession.setPermissionRequestHandler((_, __, callback) =>
        callback(false),
      );
      ipcMain.handle("request", async (event, method, args = {}) => {
        if (
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame ||
          !event.senderFrame.url.startsWith("app://mcnpc/")
        )
          throw new Error("非法调用来源");
        try {
          return { ok: true, result: await dispatch(method, args) };
        } catch (error) {
          console.error(method, error);
          return { ok: false, error: error.message };
        }
      });
      ipcMain.handle("dropped-files", async (event, paths) => {
        if (
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame
        )
          throw new Error("非法调用来源");
        const files = paths.filter(
          (p) => typeof p === "string" && /\.png$/i.test(p),
        );
        for (const file of files) approveImage(file);
        return files;
      });
      win = new BrowserWindow({
        title: "大果喵模组工具箱",
        width: 1240,
        height: 820,
        minWidth: 880,
        minHeight: 620,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: nativeTheme.shouldUseDarkColors
          ? "#191919"
          : "#ffffff",
        frame: false,
        icon: path.join(__dirname, "../dist/icon.ico"),
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      const emitWindowState = () => {
        win.webContents.send("window-state", { maximized: win.isMaximized() });
      };
      win.on("maximize", emitWindowState);
      win.on("unmaximize", emitWindowState);
      win.once("ready-to-show", () => {
        if (!process.env.MCNPC_HEADLESS) win.show();
      });
      win.on("close", (event) => {
        if (
          closing ||
          (!hasEntries && busy === 0) ||
          process.env.MCNPC_HEADLESS
        )
          return;
        event.preventDefault();
        dialog
          .showMessageBox(win, {
            type: "question",
            title: "关闭工具箱",
            message: busy
              ? "任务仍在运行，确定退出？"
              : "列表保存在当前会话中，关闭后将清空。",
            detail:
              "请先保存工程，或导出需要保留的拓展包。工程会同时保存列表和资源文件。",
            buttons: ["继续编辑", "退出"],
            defaultId: 0,
            cancelId: 0,
          })
          .then(({ response }) => {
            if (response === 1) {
              closing = true;
              win.close();
            }
          });
      });
      nativeTheme.on("updated", emitTheme);
      await win.loadURL("app://mcnpc/index.html");
    })
    .catch((error) => {
      dialog.showErrorBox("启动失败", error.message);
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    if (backend) backend.close();
    cancelRunningTools();
  });
}
