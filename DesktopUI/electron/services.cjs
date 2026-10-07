const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const defaults = {
  AppearanceMode: "System",
  UseSystemAccent: false,
  ThemeHue: 210,
  ThemeSat: 85,
  LastOutputDir: "",
  BgImagePath: "",
  BgImageOpacity: 0.06,
  BgImageBlur: 0,
  BgImageScale: 1,
  McPath: "",
  ModScriptPath: "",
  ModOutDir: "",
  ModName: "",
  ModHelp: false,
  ModHud: false,
  ModWorldData: false,
  ModSetting: false,
  ItemScriptPath: "",
  FeverGamePath: "",
  FeverPlayerId: "",
  FeverChannel: "正式端",
  SidebarCollapsed: false,
  ShowModDeveloperTools: false,
};
async function readJson(file) {
  return JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temp, file);
}
class Settings {
  constructor(directory) {
    this.file = path.join(directory, "settings.json");
    this.value = { ...defaults };
    this.queue = Promise.resolve();
  }
  async load() {
    if (await exists(this.file)) {
      const data = await readJson(this.file);
      for (const [key, value] of Object.entries(data))
        if (key in defaults && typeof value === typeof defaults[key])
          this.value[key] = value;
    }
    if (!["Light", "Dark", "System"].includes(this.value.AppearanceMode))
      this.value.AppearanceMode = "System";
    if (
      !Number.isFinite(this.value.BgImageOpacity) ||
      this.value.BgImageOpacity < 0 ||
      this.value.BgImageOpacity > 1
    )
      this.value.BgImageOpacity = defaults.BgImageOpacity;
    if (
      !Number.isFinite(this.value.BgImageBlur) ||
      this.value.BgImageBlur < 0 ||
      this.value.BgImageBlur > 30
    )
      this.value.BgImageBlur = defaults.BgImageBlur;
    if (
      !Number.isFinite(this.value.BgImageScale) ||
      this.value.BgImageScale < 1 ||
      this.value.BgImageScale > 2
    )
      this.value.BgImageScale = defaults.BgImageScale;
    return this.value;
  }
  update(patch) {
    const operation = this.queue.then(async () => {
      const next = { ...this.value };
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in defaults) || typeof value !== typeof defaults[key])
          throw new Error(`无效设置: ${key}`);
        if (typeof value === "string" && value.length > 4096)
          throw new Error("设置内容过长");
        next[key] = value;
      }
      if (!["Light", "Dark", "System"].includes(next.AppearanceMode))
        throw new Error("无效的界面模式");
      if (
        !Number.isFinite(next.BgImageOpacity) ||
        next.BgImageOpacity < 0 ||
        next.BgImageOpacity > 1
      )
        throw new Error("背景图片不透明度必须在 0–1 之间");
      if (
        !Number.isFinite(next.BgImageBlur) ||
        next.BgImageBlur < 0 ||
        next.BgImageBlur > 30
      )
        throw new Error("背景模糊度必须在 0–30 之间");
      if (
        !Number.isFinite(next.BgImageScale) ||
        next.BgImageScale < 1 ||
        next.BgImageScale > 2
      )
        throw new Error("背景缩放必须在 100%–200% 之间");
      await atomicJson(this.file, next);
      this.value = next;
      return next;
    });
    this.queue = operation.catch(() => {}); // A failed disk write must not block a later retry.
    return operation;
  }
}

async function listDirectories(root) {
  if (!(await exists(root))) return [];
  return (await fs.readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}
function child(root, name) {
  if (
    typeof name !== "string" ||
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/:]/.test(name)
  )
    throw new Error("无效的目录名称");
  return path.join(root, name);
}
class Studio {
  constructor(localData, roamingData) {
    this.localData = localData;
    this.roamingData = roamingData;
    this.projects = new Map();
    this.saves = new Map();
  }
  async root() {
    const config = path.join(
      this.localData,
      "Netease",
      "MCStudio",
      "config",
      "app",
      "app.conf",
    );
    if (!(await exists(config)))
      throw new Error("未找到 MCStudio 配置，请先安装并启动 MCStudio");
    const data = await readJson(config);
    const index = (data.X64EditorPath || "")
      .toLowerCase()
      .indexOf("\\mcx64editor");
    if (index < 0) throw new Error("MCStudio 配置中没有有效的 X64EditorPath");
    return data.X64EditorPath.slice(0, index);
  }
  async list(account) {
    const root = await this.root();
    const accounts = [];
    for (const name of await listDirectories(path.join(root, "work"))) {
      if (
        !name.startsWith(".") &&
        name.toLowerCase() !== "temp" &&
        (await exists(path.join(root, "work", name, "Cpp", "AddOn")))
      )
        accounts.push(name);
    }
    const selected = accounts.includes(account) ? account : accounts[0];
    const entries = [],
      warnings = [];
    this.projects.clear();
    if (selected) {
      const directory = path.join(root, "work", selected, "Cpp", "AddOn");
      for (const name of await listDirectories(directory)) {
        const folder = path.join(directory, name),
          config = path.join(folder, "work.mcscfg");
        if (!(await exists(config))) continue;
        try {
          const data = await readJson(config);
          const item = {
            id: name,
            name: data.Name || name,
            directory: folder,
            config,
            workDirectory: data.CustomWorkDir || folder,
            account: selected,
            uid: data.UID,
          };
          this.projects.set(name, item);
          entries.push(item);
        } catch (error) {
          warnings.push(`${name}: ${error.message}`);
        }
      }
    }
    return { root, accounts, account: selected || "", entries, warnings };
  }
  project(id) {
    const project = this.projects.get(id);
    if (!project) throw new Error("项目已变化，请刷新列表");
    return project;
  }
  async changePath(id, directory) {
    const item = this.project(id);
    const data = await readJson(item.config);
    // Preserve the original configuration before the first edit in this session.
    if (!(await exists(item.config + ".mcnpc.bak")))
      await fs.copyFile(item.config, item.config + ".mcnpc.bak");
    await atomicJson(item.config, { ...data, CustomWorkDir: directory });
    item.workDirectory = directory;
    return item;
  }
  async testSaves(id) {
    const item = this.project(id),
      root = await this.root();
    const project = await readJson(item.config);
    if (!project.UID) throw new Error("项目配置缺少 UID");
    const configRoot = path.join(
      root,
      "game",
      "config",
      item.account,
      "Cpp",
      "MC_GAME",
    );
    this.saves.clear();
    const entries = [],
      warnings = [];
    const visit = async (directory) => {
      if (!(await exists(directory))) return;
      for (const file of await fs.readdir(directory, { withFileTypes: true })) {
        const location = path.join(directory, file.name);
        if (file.isDirectory()) {
          await visit(location);
          continue;
        }
        if (!file.isFile()) continue;
        try {
          const data = await readJson(location);
          if (String(data.MainComponentId) !== String(project.UID)) continue;
          const level = data.world_info?.level_id;
          const folder = child(
            path.join(
              this.roamingData,
              "MinecraftPE_Netease",
              "minecraftWorlds",
            ),
            level,
          );
          const nameFile = path.join(folder, "levelname.txt");
          const entry = {
            id: location,
            name: (await exists(nameFile))
              ? (await fs.readFile(nameFile, "utf8")).trim()
              : level,
            version: data.version || "",
            directory: folder,
            level,
          };
          entries.push(entry);
          this.saves.set(location, entry);
        } catch (error) {
          warnings.push(`${file.name}: ${error.message}`);
        }
      }
    };
    await visit(configRoot);
    return { project: item.name, entries, warnings };
  }
  async changeVersion(id, version) {
    if (!this.saves.has(id)) throw new Error("存档已变化，请刷新列表");
    if (typeof version !== "string" || !version.trim() || version.length > 80)
      throw new Error("请输入有效版本号");
    const data = await readJson(id);
    if (!(await exists(id + ".mcnpc.bak")))
      await fs.copyFile(id, id + ".mcnpc.bak");
    await atomicJson(id, { ...data, version: version.trim() });
    this.saves.get(id).version = version.trim();
    return this.saves.get(id);
  }
}

async function globalConfigs(roaming, channel, player) {
  const folder =
    channel === "测试端" ? "MinecraftPE_Netease" : "MinecraftPC_Netease_PB";
  const root = path.join(roaming, folder, "storge", "stream", "users");
  const directories = new Map();
  let directConfig;
  for (const name of await listDirectories(root)) {
    if (name.toLowerCase() === "config") {
      directConfig = { name, directory: path.join(root, name) };
    } else if (await exists(path.join(root, name, "config"))) {
      directories.set(name, path.join(root, name, "config"));
    }
  }
  // Keep the existing player default; users/config stores files directly.
  if (directConfig) directories.set(directConfig.name, directConfig.directory);
  const players = [...directories.keys()];
  const selected = players.includes(player) ? player : players[0];
  const entries = [];
  if (selected) {
    const directory = directories.get(selected);
    for (const file of await fs.readdir(directory, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const location = path.join(directory, file.name),
        stat = await fs.stat(location);
      entries.push({
        name: file.name,
        path: location,
        modified: stat.mtime.toISOString(),
        size: stat.size,
      });
    }
    entries.sort((a, b) => b.modified.localeCompare(a.modified));
  }
  return { root, players, player: selected || "", entries };
}

const runningTools = new Set();
function cancelRunningTools() {
  for (const child of runningTools) child.kill();
}
function runPython(script, directory, lines) {
  return new Promise((resolve, reject) => {
    const process = spawn(
      "python",
      [script, "--no-interactive", "--output", directory],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...global.process.env, PYTHONIOENCODING: "utf-8" },
      },
    );
    runningTools.add(process);
    let output = "",
      errors = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.kill();
    }, 120000);
    process.stdout.on("data", (data) => {
      output = (output + data.toString("utf8")).slice(-200000);
    });
    process.stderr.on("data", (data) => {
      errors = (errors + data.toString("utf8")).slice(-200000);
    });
    process.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.on("close", (code) => {
      runningTools.delete(process);
      clearTimeout(timer);
      if (timedOut)
        reject(new Error("脚本运行超过 2 分钟，已停止。请检查脚本和输出目录"));
      else if (code !== 0 || errors.includes("Traceback"))
        reject(new Error(errors || output || `脚本退出码: ${code}`));
      else resolve({ output, warnings: errors, directory });
    });
    process.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    process.stdin.end(lines.join("\n") + "\n", "utf8");
  });
}
module.exports = {
  Settings,
  Studio,
  globalConfigs,
  runPython,
  cancelRunningTools,
  readJson,
  atomicJson,
  exists,
  defaults,
};
