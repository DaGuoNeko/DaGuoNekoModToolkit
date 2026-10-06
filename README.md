# 大果喵模组工具箱

英文名：**DaGuoNeko Mod Toolkit**。

用于网易 Minecraft customNPC 模组的皮肤 / 模型拓展制作工具。

项目使用 **Electron + React 网页 UI** 和 **C# / .NET Framework 4.8** 打包后端。源码、模板和图标均已内置，可以独立构建；不再依赖旁边的旧 NpcSkinMaker 工程。

## 运行新版

完整保留 `DesktopUI/release/DaGuoNeko-Mod-Toolkit-win32-x64/` 目录，运行其中的 `DaGuoNeko-Mod-Toolkit.exe`。

- 运行时无需安装 Node.js、npm 或 WebView2；Electron 运行环境随程序分发。
- C# 后端需要 Windows 的 .NET Framework 4.8。
- 开发者工具箱的 MOD / 物品生成仍需用户提供原有 Python 脚本，并安装可从 `python` 命令启动的 Python 环境。
- Electron 版为目录分发，不能只复制 EXE。当前构建是本地未签名版本，尚未发布到 GitHub Releases。

## 功能

- **皮肤拓展**：单个 / 批量添加 PNG、拖拽导入、编辑与批量编辑、预览、搜索和选择、删除、ZIP 导入与导出。导入前完整校验，失败保留当前列表。
- **模型拓展**：模型 JSON、贴图、动画资源、皮肤变体、碰撞箱、附件和实体动画配置，排序、编辑、删除与 ZIP 导出。
- **开发者工具箱**：启动网易开发版 MC、调用外部 Python 脚本生成 MOD 框架和物品模板。
- **MCStudio 项目**：账号与项目列表、源代码路径管理、配置目录、测试存档与游戏版本修改。修改前保留 `.mcnpc.bak` 备份。
- **存档全局配置**：正式端 / 测试端切换、玩家选择、文件搜索、按时间排序、打开及资源管理器定位。
- **3D 文字**：仅保留快捷入口，使用系统默认浏览器打开在线工具，不在应用内创建浏览窗口。
- **外观**：中性色侧栏和列表工作区；浅色 / 深色 / 跟随系统；强调色预设；自定义背景；可收起侧栏；弹窗遮罩覆盖标题栏按钮。下拉框统一使用随主题切换的浮层菜单，支持键盘选择和长列表滚动。界面字体固定为 **Microsoft YaHei UI**，不支持字体自定义。

皮肤和模型列表保存在当前会话，切换页面不会清空，退出前应导出需要保留的拓展包。为兼容旧版本，设置继续使用 `%LocalAppData%/NPC_SkinMaker/settings.json`，兼容旧版路径与外观偏好，忽略旧自定义字体字段。

发布目录固定为 `DesktopUI/release/`，仅保留当前可运行目录和 `DaGuoNeko-Mod-Toolkit-win-x64.zip`。

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
npm run test:web    # 检查默认浏览器入口、失败提示和固定网址限制
npm run package    # 生成 Windows x64 可运行目录
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
    Core/            # 8 个 C# 业务源码文件
    Resources/       # 皮肤 / 模型模板 ZIP
  assets/            # 软件图标
  scripts/           # 构建与打包
  tests/             # 后端 / 配置服务 / Electron 界面测试
```

渲染进程启用 sandbox 与 context isolation，不开放 Node.js。界面仅通过白名单 IPC 操作本地后端；在线 3D 工具交由系统默认浏览器处理。

作者：大果喵（DaGuoNeko）。

## 仓库

本目录是独立的新 Git 仓库，尚未配置远程地址。旧仓库及其历史保存在旁边的 `NpcSkinMaker` 目录中。内部 C# 程序集和用户设置目录保留历史命名，以兼容现有设置。
