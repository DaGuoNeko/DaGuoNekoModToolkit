# 大果喵模组工具箱

英文名：**DaGuoNeko Mod Toolkit**。

用于网易 Minecraft customNPC 模组的皮肤 / 模型拓展，以及大果喵前置组件的贴图 / 音效拓展制作工具。

项目使用 **Electron + React 网页 UI** 和 **C# / .NET Framework 4.8** 打包后端。源码、模板和图标均已内置，可以独立构建；不再依赖旁边的旧 NpcSkinMaker 工程。

## 运行新版

完整保留 `DesktopUI/release/DaGuoNeko-Mod-Toolkit-win32-x64/` 目录，运行其中的 `DaGuoNeko-Mod-Toolkit.exe`。

- 运行时无需安装 Node.js、npm 或 WebView2；Electron 运行环境随程序分发。
- C# 后端需要 Windows 的 .NET Framework 4.8。
- 开发者工具箱的 MOD / 物品生成仍需用户提供原有 Python 脚本，并安装可从 `python` 命令启动的 Python 环境。
- Electron 版为目录分发，不能只复制 EXE。当前构建是本地未签名版本，尚未发布到 GitHub Releases。

## 功能

侧栏中的 3D 文字、开发者工具箱、MCStudio 项目和存档全局配置默认隐藏。可在“设置 → 功能显示”开启“显示模组开发者工具”；开关立即生效并在重启后保留，关闭不会清除已有工具配置。

- **皮肤拓展**：单个 / 批量添加 PNG、拖拽导入、编辑与批量编辑、显示和复制实际 ID、按 ID 搜索、删除、ZIP 导入与导出。支持通用人型皮肤、选择 NPC 现有模型 ID，以及手工填写自定义模型 ID / 贴图槽位。导入前完整校验，失败保留当前列表。
- **3D 皮肤预览**：标准人型皮肤支持旋转、缩放和 Steve / Alex 手臂切换，也可查看原始贴图；使用本地打包的 skinview3d，运行时不请求外部网址。非人型贴图需要对应 geometry，当前展示原始贴图。
- **模型拓展**：模型 JSON、贴图、动画资源、皮肤变体、碰撞箱、附件和实体动画配置，排序、编辑、删除与 ZIP 导入/导出。适配 NPC 5.0.5 的颜色、透明度和描边；新模型名称禁止与内置模型冲突。
- **贴图拓展 / 音效拓展**：独立列表、批量添加、资源名称 / ID / 分类 / 搜索关键词编辑、搜索、删除、PNG 预览和 OGG 试听、ZIP 导入 / 导出。生成完整行为包与资源包，监听 `AssetSelectorRegisterRequest` 并调用前置 `API_RegisterAssetProvider`，无需手工编写游戏注册代码。
- **工程保存**：通过“保存工程 / 打开工程”保存和恢复皮肤、模型、贴图、音效及全部关联资源，文件格式为 `.dgnproject`；打开失败保留当前工作区。
- **导出编码**：游戏 ZIP 中的 JSON、Python、材质、语言文件、shader 等文本统一为 UTF-8 无 BOM。可识别 UTF-8 / UTF-16 / UTF-32 BOM；未知编码、非法字节或损坏的 Unicode 会报出文件名并拒绝导出，避免静默乱码。PNG / OGG 等二进制资源和工程存档中的原素材保持原字节。
- **开发者工具箱**：启动网易开发版 MC、调用外部 Python 脚本生成 MOD 框架和物品模板。
- **MCStudio 项目**：账号与项目列表、源代码路径管理、配置目录、测试存档与游戏版本修改。修改前保留 `.mcnpc.bak` 备份。
- **存档全局配置**：正式端 / 测试端切换、玩家选择、文件搜索、按时间排序、打开及资源管理器定位。
- **3D 文字**：仅保留快捷入口，使用系统默认浏览器打开在线工具，不在应用内创建浏览窗口。
- **外观**：中性色侧栏和列表工作区；浅色 / 深色 / 跟随系统；强调色预设；自定义背景；可收起侧栏；弹窗遮罩覆盖标题栏按钮。下拉框统一使用随主题切换的浮层菜单，支持键盘选择和长列表滚动。界面字体固定为 **Microsoft YaHei UI**，不支持字体自定义。

皮肤和模型列表保存在当前会话，切换页面不会清空，退出前请保存工程或导出拓展包。新皮肤 ID 使用 `skin_` 加 UUID 前 5 位的大写十六进制字符（例如 `skin_A3F9C`），在添加时固定并检查重名；5 位截断不能保证跨包唯一；重复导出保持不变，导入包和已保存工程继续保留原 ID。模型 ZIP 导入支持本工具生成的包，以及单个 default geometry、连续 default 贴图变体的拓展包；无法安全转换的自定义材质或多层模型会明确拒绝，避免丢失原资源。为兼容旧版本，设置继续使用 `%LocalAppData%/NPC_SkinMaker/settings.json`，兼容旧版路径与外观偏好，忽略旧自定义字体字段。

发布目录固定为 `DesktopUI/release/`。正在运行的旧版目录被锁定时，可将新版打包到其独立子目录，避免覆盖正在使用的程序。

指定模型皮肤需要加载配套更新的 customNPC 脚本；旧版加载器不会识别目标模型字段。目标模型本身必须已安装并被 NPC 系统识别，PNG 需符合该模型的 UV 布局。多贴图模型每个皮肤条目覆盖所选槽位，不会替换其他槽位。导出配置保留旧 `npcskinlist`，并为指定模型条目增加 `target_identifier` 和 `texture_slot`：

```json
{"ID":"skin_A3F9C","name":"森林守卫","by":"作者","texture":"textures/entity/npc_dlcskin/skin_A3F9C","target_identifier":"customnpc:forest_guard_dlcnpc","texture_slot":"default"}
```

## 开发与打包

开发环境：Windows、Node.js 22.12+、npm、可构建 net48 的 .NET SDK。当前锁文件固定了依赖版本。

```powershell
cd DesktopUI
npm ci
npm start
```

```powershell
npm run build       # C# 后端与网页资源
npm test            # 后端真实打包及设置 / 配置服务测试，需 Python
npm run test:ui     # Playwright 驱动真实 Electron 与后端
npm run test:assets # 贴图 / 音效页面的真实 Electron 操作与导出验证
npm run test:web    # 检查默认浏览器入口、失败提示和固定网址限制
npm run package    # 生成 Windows x64 可运行目录
node scripts/package.mjs --output=release/skin-preview-update # 构建后打包到独立目录
```

Electron 首次运行需要下载官方运行时。如已准备经官方校验值验证的 `electron-v44.5.1-win32-x64.zip`，可放入 `DesktopUI/node_modules/.cache/` 供打包复用。

## 发布包精简

发布包只保留 `zh-CN` 和 `en-US` 语言资源，排除前端 Source Map 与后端 PDB。保留 Electron 核心、通用图形渲染依赖、许可证、网页资源及 C# 打包后端。未引用的旧工程资源不会进入发布包。

默认网页构建不生成 Source Map；需要本地调试时可运行 `node scripts/build.mjs --sourcemap`。即使开发目录存在映射文件，发布打包也会排除它们。

## 结构

```text
DesktopUI/
  electron/          # 主进程、受限 IPC、文件对话框、设置与工具服务
  src/               # React 页面、编辑器与样式
  backend/           # JSON 行协议后端
    Core/            # 拓展包、资源校验及工程存档业务源码
    Resources/       # 皮肤 / 模型模板 ZIP
  assets/            # 软件图标
  scripts/           # 构建与打包
  tests/             # 后端 / 配置服务 / Electron 界面测试
```

渲染进程启用 sandbox 与 context isolation，不开放 Node.js。界面仅通过白名单 IPC 操作本地后端；在线 3D 工具交由系统默认浏览器处理。

## 前置贴图 / 音效拓展包

1. 进入“贴图拓展”或“音效拓展”，在“拓展包设置”中填写包名、作者、版本。包标识自动生成；不同拓展包使用不同标识。
2. 批量选择 PNG 或 **OGG Vorbis**，填写名称、资源 ID、分类名称 / ID 和可选的搜索关键词。不限于人物皮肤尺寸；MP3、WAV、FSB、OGG Opus 需先转换为 OGG Vorbis，不能只修改文件扩展名。音量和音调用于前置选择器试听，长音频可开启流式播放；工具内试听倍率受浏览器范围限制。
3. 导出 ZIP，在地图同时加载生成的行为包、资源包和支持资源注册 API 的大果喵前置组件。资源出现在“包名 → 分类”的统一资源选择器中；无需 NPC 模组，也不会自动应用到某个业务配置。
4. 保存 `.dgnproject` 工程可保存四种列表和所有素材，搬到其他电脑后无需原素材目录。仍支持打开旧版皮肤 / 模型工程；旧版软件不能打开新版工程。工程解压后的总大小（含配置文件，素材按内容去重）最多 512 MiB，ZIP 条目最多 20,000 个；保存超限时会提示减少资源，并保留已有工程。
5. 已导出的资源包可通过对应页面“导入 ZIP”继续编辑。重复导出保留包标识、资源 ID 和 manifest UUID；发布更新前提高“包版本”，两份 manifest 自动同步。不要同时安装同一包的新旧两份。修改包标识、资源 ID 或分类 ID 可能使已有业务引用失效。

贴图完整路径为 `textures/ui/<包标识>/<资源ID>`，音效事件名为 `<包标识>.<资源ID>`，简短选择器 ID 为 `<包标识>:<资源ID>`。游戏脚本直接使用 UTF-8 Python 2.7 字符串字面量，初始化时发布资源并缓存于前置客户端；打开选择界面不重新扫描磁盘，不设置逐帧注册计时器。批量添加、ZIP 和工程打开先验证再替换，失败保留原列表。

当前 ZIP 导入针对本工具生成的资源拓展格式，不支持任意第三方资源包或自动音频转码。软件构建、生成包检查及 Python 2.7 注册契约测试不等同于网易平台审核或真实游戏联动验证。

作者：大果喵（DaGuoNeko）。

## 仓库

本目录是独立的新 Git 仓库，远程仓库为 [DaGuoNeko/DaGuoNekoModToolkit](https://github.com/DaGuoNeko/DaGuoNekoModToolkit)。旧仓库及其历史保存在旁边的 `NpcSkinMaker` 目录中。内部 C# 程序集和用户设置目录保留历史命名，以兼容现有设置。
