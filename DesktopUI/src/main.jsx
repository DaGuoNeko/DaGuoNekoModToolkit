import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WindowControls } from "./window-controls.jsx";
import {
  Icon,
  Button,
  Intro,
  Search,
  Empty,
  Modal,
  ErrorBox,
  LocalImage,
} from "./ui.jsx";
import { SkinEditor, SkinEdit, ModelEditor } from "./editors.jsx";
import { SkinPreview, skinId } from "./skin-preview.jsx";
import { AssetPage } from "./asset-page.jsx";
import {
  SettingsPage,
  ToolsPage,
  StudioPage,
  TestSavesPage,
  ConfigsPage,
  AboutPage,
  TextPage,
} from "./pages.jsx";
import "./styles.css";

const nav = [
  { id: "skins", label: "皮肤拓展", icon: "skin", group: "创作" },
  { id: "models", label: "模型拓展", icon: "cube" },
  { id: "textures", label: "贴图拓展", icon: "image" },
  { id: "sounds", label: "音效拓展", icon: "sound" },
  { id: "text", label: "3D 文字", icon: "text", group: "工具" },
  { id: "tools", label: "开发者工具箱", icon: "tools" },
  { id: "studio", label: "MCStudio 项目", icon: "folder" },
  { id: "configs", label: "存档全局配置", icon: "settings" },
];
const api = (method, args) => window.toolkit.call(method, args);
const developerPages = ["text", "tools", "studio", "configs", "tests"];
function App() {
  const [loaded, setLoaded] = useState(false),
    [fatal, setFatal] = useState("");
  const [state, setState] = useState({
      skins: [],
      models: [],
      textures: [],
      sounds: [],
    }),
    [settings, setSettings] = useState(null),
    [version, setVersion] = useState("");
  const [skinTargets, setSkinTargets] = useState([]);
  const [page, setPage] = useState("skins"),
    [busy, setBusy] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState([]),
    [offset, setOffset] = useState(0);
  const [files, setFiles] = useState(null),
    [editSkins, setEditSkins] = useState(null),
    [editModel, setEditModel] = useState(null),
    [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState(null),
    [notice, setNotice] = useState(""),
    [toastMessage, setToastMessage] = useState(""),
    [project, setProject] = useState(null),
    [exported, setExported] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const report = (error) => setNotice(error.message || String(error));
  const toast = (message) => setToastMessage(message);
  async function bootstrap() {
    setFatal("");
    try {
      const data = await api("bootstrap");
      setState(data.state);
      setSettings(data.settings);
      setVersion(data.version);
      setSkinTargets(data.skinTargets);
      document.documentElement.dataset.theme = data.dark ? "dark" : "light";
      setDrafts({
        mod: {
          name: data.settings.ModName,
          help: data.settings.ModHelp,
          hud: data.settings.ModHud,
          worldData: data.settings.ModWorldData,
          setting: data.settings.ModSetting,
        },
        item: {
          namespace: "",
          prefix: "",
          name: "",
          tab: "Items",
          start: 0,
          end: 10,
          type: 1,
          stackSize: 64,
          durability: 100,
          damage: 5,
          level: 2,
          appendIndex: true,
          custom: false,
        },
      });
      setLoaded(true);
    } catch (e) {
      setFatal(e.message);
    }
  }
  useEffect(() => {
    bootstrap();
    return window.toolkit.onTheme(({ dark }) => {
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    });
  }, []);
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(""), 4500);
    return () => clearTimeout(timer);
  }, [toastMessage]);
  useEffect(() => {
    setSearch("");
    setSelected([]);
    setOffset(0);
  }, [page]);
  async function saveSettings(patch) {
    const value = await api("settings.update", patch);
    setSettings(value);
    if (!value.ShowModDeveloperTools && developerPages.includes(page))
      setPage("skins");
    return value;
  }
  async function run(method, args, label = "正在处理…") {
    setBusy(label);
    try {
      const result = await api(method, args);
      if (result.state) {
        setState(result.state);
        setSelected([]);
      }
      return result;
    } finally {
      setBusy("");
    }
  }
  async function chooseSkins(multiple) {
    try {
      const chosen = await api("files.pick", { kind: "skin", multiple });
      if (chosen.length) setFiles(chosen);
    } catch (e) {
      report(e);
    }
  }
  async function addSkins(items) {
    const result = await run("skins.add", { items }, "正在添加皮肤…");
    if (!result.added) throw new Error(result.errors.join("\n"));
    toast(`已添加 ${result.added} 个皮肤`);
    if (result.errors.length)
      report(new Error(`部分文件未能添加：\n${result.errors.join("\n")}`));
  }
  async function importSkins() {
    try {
      const paths = await api("files.pick", { kind: "zip" });
      if (!paths.length) return;
      const action = async () => {
        await run("skins.import", { path: paths[0] }, "正在导入拓展包…");
        toast("皮肤拓展包已导入");
      };
      if (state.skins.length)
        setConfirmation({
          title: "导入皮肤拓展包？",
          detail: "导入成功后将替换当前皮肤列表。需要保留的内容请先导出。",
          action,
        });
      else await action();
    } catch (e) {
      report(e);
    }
  }
  async function importModels() {
    try {
      const paths = await api("files.pick", { kind: "zip" });
      if (!paths.length) return;
      const action = async () => {
        await run("models.import", { path: paths[0] }, "正在导入模型拓展包…");
        toast("模型拓展包已导入");
      };
      if (state.models.length)
        setConfirmation({
          title: "导入模型拓展包？",
          detail: "导入成功后将替换当前模型列表。需要保留的编辑请先保存工程。",
          action,
        });
      else await action();
    } catch (e) {
      report(e);
    }
  }
  async function saveProject() {
    try {
      const result = await run("project.save", {}, "正在保存工程…");
      if (!result.canceled) toast("工程已保存，列表和资源可在下次打开时恢复");
    } catch (e) {
      report(e);
    }
  }
  function openProject() {
    const action = async () => {
      const result = await run("project.open", {}, "正在打开工程…");
      if (!result.canceled) toast("工程已恢复");
    };
    if (
      state.skins.length ||
      state.models.length ||
      state.textures.length ||
      state.sounds.length
    )
      setConfirmation({
        title: "打开工程？",
        detail:
          "打开成功后将替换皮肤、模型、贴图和音效列表。请先保存需要保留的编辑。",
        action,
      });
    else action().catch(report);
  }
  async function exportPackage() {
    try {
      const result = await run("export", { kind: page }, "正在生成拓展包…");
      if (!result.canceled) {
        setExported(result.path);
        toast("拓展包已导出");
      }
    } catch (e) {
      report(e);
    }
  }
  function remove(indices) {
    setConfirmation({
      title: `删除 ${indices.length} 个${page === "skins" ? "皮肤" : "模型"}？`,
      detail: "只移除当前列表中的条目，不删除源文件。",
      action: () => run(page + ".delete", { indices }),
    });
  }
  function clear() {
    setConfirmation({
      title: "清空当前列表？",
      detail: "源文件会保留，尚未导出的列表内容将被清空。",
      action: () => run(page + ".clear"),
    });
  }
  async function drop(e) {
    e.preventDefault();
    if (page !== "skins" || busy || files || editSkins || editModel) return;
    try {
      const chosen = await window.toolkit.droppedFiles(e.dataTransfer.files);
      if (chosen.length) setFiles(chosen);
      else toast("请拖入 PNG 皮肤文件");
    } catch (error) {
      report(error);
    }
  }
  if (!loaded)
    return (
      <div className="boot">
        <div className="brand-mark large">
          <Icon name="cube" size={32} />
        </div>
        <h1>大果喵模组工具箱</h1>
        {fatal ? (
          <>
            <ErrorBox>{fatal}</ErrorBox>
            <Button onClick={bootstrap}>重新连接</Button>
            <p className="muted">若后端已退出，请关闭后重新启动应用。</p>
          </>
        ) : (
          <p>正在准备工作区…</p>
        )}
      </div>
    );
  const collapsed = settings.SidebarCollapsed;
  const current =
    nav.find((x) => x.id === page)?.label ||
    { settings: "设置", about: "关于工具箱", tests: "测试存档" }[page];
  const isSkins = page === "skins",
    isModels = page === "models",
    entries = isSkins ? state.skins : state.models;
  const visible = entries
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      (isSkins
        ? `${item.Name} ${item.Author} ${skinId(item)} ${item.TargetIdentifier || ""}`
        : `${item.DisplayName} ${item.Identifier} ${item.SourceLabel}`
      )
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const pageOffset = Math.min(
    offset,
    Math.max(0, Math.floor((visible.length - 1) / 50) * 50),
  );
  const paged = visible.slice(pageOffset, pageOffset + 50);
  const allSelected =
    paged.length > 0 && paged.every(({ index }) => selected.includes(index));
  function toggle(index) {
    setSelected((old) =>
      old.includes(index) ? old.filter((i) => i !== index) : [...old, index],
    );
  }
  return (
    <div
      className={`app ${collapsed ? "collapsed" : ""}`}
      style={{ "--accent-hue": settings.ThemeHue || 210 }}
    >
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand-mark">
            <Icon name="cube" size={21} />
          </div>
          {!collapsed && <span className="brand-name">大果喵模组工具箱</span>}
          <Button
            icon="panel"
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-label="切换侧栏"
            onClick={() =>
              saveSettings({ SidebarCollapsed: !collapsed }).catch(report)
            }
          />
        </div>
        <nav aria-label="主要导航">
          {nav
            .filter(
              (item) =>
                settings.ShowModDeveloperTools ||
                !developerPages.includes(item.id),
            )
            .map((item) => (
              <React.Fragment key={item.id}>
                {item.group && !collapsed && (
                  <div className="nav-label">{item.group}</div>
                )}
                <button
                  className={`nav-item ${page === item.id || (page === "tests" && item.id === "studio") ? "active" : ""}`}
                  aria-current={page === item.id ? "page" : undefined}
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => setPage(item.id)}
                >
                  <Icon name={item.icon} />
                  {!collapsed && (
                    <>
                      <span>{item.label}</span>
                      {["skins", "models", "textures", "sounds"].includes(
                        item.id,
                      ) &&
                        state[item.id].length > 0 && (
                          <span className="nav-count">
                            {state[item.id].length}
                          </span>
                        )}
                    </>
                  )}
                </button>
              </React.Fragment>
            ))}
        </nav>
        <div className="sidebar-bottom">
          {[
            ["settings", "settings", "设置"],
            ["about", "info", "关于"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              title={label}
              onClick={() => setPage(id)}
            >
              <Icon name={icon} />
              {!collapsed && <span>{label}</span>}
            </button>
          ))}
          {!collapsed && (
            <div className="session-note">
              <span className="status-dot" />
              本地工作区
            </div>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-bar">
          <span className="breadcrumb">
            工具箱<span>/</span>
            <strong>{current}</strong>
          </span>
        </header>
        <main
          onDragOver={(e) => {
            if (isSkins) e.preventDefault();
          }}
          onDrop={drop}
        >
          {settings.BgImagePath && (
            <LocalImage
              path={settings.BgImagePath}
              className="workspace-background"
            />
          )}
          <div className="page-container">
            <fieldset disabled={!!busy} className="workspace-fieldset">
              {(isSkins || isModels) && (
                <>
                  <Intro
                    title={isSkins ? "皮肤拓展" : "模型拓展"}
                    subtitle={
                      isSkins
                        ? "整理人物皮肤，制作属于你的 NPC 拓展包。"
                        : "组合模型、贴图与动画，让你的角色进入世界。"
                    }
                  >
                    <Button onClick={openProject}>打开工程</Button>
                    <Button onClick={saveProject}>保存工程</Button>
                    <Button
                      icon="export"
                      primary
                      disabled={!entries.length}
                      onClick={exportPackage}
                    >
                      导出 ZIP
                    </Button>
                  </Intro>
                  <div className="toolbar">
                    <Button
                      icon="plus"
                      onClick={() =>
                        isSkins
                          ? chooseSkins(false)
                          : setEditModel({ index: -1 })
                      }
                    >
                      添加{isSkins ? "皮肤" : "模型"}
                    </Button>
                    {isSkins && (
                      <>
                        <Button onClick={() => chooseSkins(true)}>
                          批量添加
                        </Button>
                        <Button icon="import" onClick={importSkins}>
                          导入 ZIP
                        </Button>
                      </>
                    )}
                    {isModels && (
                      <Button icon="import" onClick={importModels}>
                        导入 ZIP
                      </Button>
                    )}
                    <div className="toolbar-spacer" />
                    <Search
                      value={search}
                      onChange={(value) => {
                        setSearch(value);
                        setOffset(0);
                      }}
                    />
                  </div>
                  <div className="list-meta">
                    <span>
                      {visible.length} 个{isSkins ? "皮肤" : "模型"}
                      {search && ` / 共 ${entries.length} 个`}
                    </span>
                    {isSkins && (
                      <span className="muted">支持拖拽 PNG 文件导入</span>
                    )}
                    <div className="toolbar-spacer" />
                    {entries.length > 0 && (
                      <button className="text-button" onClick={clear}>
                        清空列表
                      </button>
                    )}
                  </div>
                  {selected.length > 0 && (
                    <div className="selection-bar">
                      <span>已选择 {selected.length} 项</span>
                      {isSkins && (
                        <Button
                          icon="edit"
                          onClick={() => setEditSkins(selected)}
                        >
                          批量编辑
                        </Button>
                      )}
                      {isModels && selected.length === 1 && (
                        <>
                          <Button
                            icon="up"
                            disabled={selected[0] === 0}
                            onClick={() =>
                              run("models.move", {
                                index: selected[0],
                                direction: -1,
                              }).catch(report)
                            }
                          >
                            上移
                          </Button>
                          <Button
                            icon="down"
                            disabled={selected[0] === entries.length - 1}
                            onClick={() =>
                              run("models.move", {
                                index: selected[0],
                                direction: 1,
                              }).catch(report)
                            }
                          >
                            下移
                          </Button>
                        </>
                      )}
                      <Button
                        danger
                        icon="trash"
                        onClick={() => remove(selected)}
                      >
                        删除
                      </Button>
                      <div className="toolbar-spacer" />
                      <Button
                        icon="close"
                        aria-label="取消选择"
                        onClick={() => setSelected([])}
                      />
                    </div>
                  )}
                  {visible.length > 0 ? (
                    <div className="table-wrap">
                      <table className="asset-table">
                        <thead>
                          <tr>
                            <th className="check-cell">
                              <input
                                type="checkbox"
                                aria-label="选择当前页全部条目"
                                checked={allSelected}
                                onChange={() =>
                                  setSelected(
                                    allSelected
                                      ? selected.filter(
                                          (i) =>
                                            !paged.some((x) => x.index === i),
                                        )
                                      : [
                                          ...new Set([
                                            ...selected,
                                            ...paged.map((x) => x.index),
                                          ]),
                                        ],
                                  )
                                }
                              />
                            </th>
                            <th>{isSkins ? "皮肤" : "模型名称"}</th>
                            {isSkins && <th>皮肤 ID</th>}
                            <th>{isSkins ? "作者" : "标识符"}</th>
                            {isModels && <th>资源</th>}
                            <th className="actions-heading">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paged.map(({ item, index }) => (
                            <tr
                              key={index}
                              className={
                                selected.includes(index) ? "selected" : ""
                              }
                            >
                              <td className="check-cell">
                                <input
                                  type="checkbox"
                                  aria-label={`选择 ${isSkins ? item.Name : item.DisplayName}`}
                                  checked={selected.includes(index)}
                                  onChange={() => toggle(index)}
                                />
                              </td>
                              <td>
                                <div className="asset-name">
                                  {isSkins ? (
                                    <button
                                      className="thumbnail-button"
                                      aria-label={`预览 ${item.Name}`}
                                      onClick={() => setPreview(item)}
                                    >
                                      <LocalImage
                                        path={item.TexturePath}
                                        thumbnail
                                        className="skin-thumbnail"
                                      />
                                    </button>
                                  ) : (
                                    <span className="model-glyph">
                                      <Icon name="cube" />
                                    </span>
                                  )}
                                  <div>
                                    <strong>
                                      {isSkins ? item.Name : item.DisplayName}
                                    </strong>
                                    <small>
                                      {isSkins
                                        ? item.TargetIdentifier ||
                                          (item.FromImport
                                            ? "已导入"
                                            : "PNG 皮肤")
                                        : item.SourceLabel}
                                    </small>
                                  </div>
                                </div>
                              </td>
                              {isSkins && (
                                <td className="code skin-id-cell">
                                  <span>{skinId(item)}</span>
                                  <Button
                                    icon="copy"
                                    title="复制实际皮肤 ID"
                                    aria-label={`复制 ${skinId(item)}`}
                                    onClick={async () => {
                                      try {
                                        await api("clipboard.write", {
                                          text: skinId(item),
                                        });
                                        toast("皮肤 ID 已复制");
                                      } catch (e) {
                                        report(e);
                                      }
                                    }}
                                  />
                                </td>
                              )}
                              <td className={isModels ? "code muted" : "muted"}>
                                {isSkins ? item.Author : item.Identifier}
                              </td>
                              {isModels && (
                                <td className="muted">
                                  {item.Textures.length} 贴图 ·{" "}
                                  {item.AnimationFiles.length} 动画文件
                                </td>
                              )}
                              <td>
                                <div className="row-actions">
                                  <Button
                                    icon="edit"
                                    aria-label={`编辑 ${isSkins ? item.Name : item.DisplayName}`}
                                    title="编辑"
                                    onClick={() =>
                                      isSkins
                                        ? setEditSkins([index])
                                        : setEditModel({ model: item, index })
                                    }
                                  />
                                  <Button
                                    icon="trash"
                                    aria-label={`删除 ${isSkins ? item.Name : item.DisplayName}`}
                                    title="删除"
                                    onClick={() => remove([index])}
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon={isSkins ? "skin" : "cube"}
                      title={
                        search
                          ? "没有匹配的结果"
                          : `添加第一个${isSkins ? "皮肤" : "模型"}`
                      }
                      action={
                        !search && (
                          <Button
                            primary
                            icon="plus"
                            onClick={() =>
                              isSkins
                                ? chooseSkins(false)
                                : setEditModel({ index: -1 })
                            }
                          >
                            选择{isSkins ? "皮肤文件" : "模型资源"}
                          </Button>
                        )
                      }
                    >
                      {search
                        ? "尝试其他名称或清除搜索条件。"
                        : isSkins
                          ? "选择 PNG 文件，或直接拖入此窗口。"
                          : "准备 .geo.json、PNG 贴图与可选的动画文件。"}
                    </Empty>
                  )}
                  {visible.length > 50 && (
                    <div className="pagination">
                      <span>
                        {pageOffset + 1}–
                        {Math.min(pageOffset + 50, visible.length)} /{" "}
                        {visible.length}
                      </span>
                      <Button
                        icon="arrow"
                        aria-label="上一页"
                        disabled={pageOffset === 0}
                        onClick={() => setOffset(Math.max(0, pageOffset - 50))}
                      />
                      <Button
                        disabled={pageOffset + 50 >= visible.length}
                        onClick={() => setOffset(pageOffset + 50)}
                      >
                        下一页
                      </Button>
                    </div>
                  )}
                  <div className="workspace-footnote">
                    <Icon name="info" size={14} />
                    列表保存在当前会话中；退出前请保存工程，或导出需要保留的拓展包。
                  </div>
                </>
              )}
              {page === "settings" && (
                <SettingsPage
                  settings={settings}
                  saveSettings={saveSettings}
                  report={report}
                />
              )}
              {["textures", "sounds"].includes(page) && (
                <AssetPage
                  key={page}
                  kind={page}
                  state={state}
                  run={run}
                  report={report}
                  toast={toast}
                  confirm={setConfirmation}
                  openProject={openProject}
                  saveProject={saveProject}
                  exportPackage={exportPackage}
                />
              )}
              {page === "tools" && (
                <ToolsPage
                  settings={settings}
                  saveSettings={saveSettings}
                  report={report}
                  toast={toast}
                  drafts={drafts}
                  setDrafts={setDrafts}
                />
              )}
              {page === "studio" && (
                <StudioPage
                  report={report}
                  toast={toast}
                  onSaves={(item) => {
                    setProject(item);
                    setPage("tests");
                  }}
                />
              )}
              {page === "tests" && project && (
                <TestSavesPage
                  project={project}
                  onBack={() => setPage("studio")}
                  report={report}
                  toast={toast}
                />
              )}
              {page === "configs" && (
                <ConfigsPage
                  settings={settings}
                  saveSettings={saveSettings}
                  report={report}
                />
              )}
              {page === "about" && <AboutPage version={version} />}
              {page === "text" && <TextPage />}
            </fieldset>
          </div>
        </main>
        {busy && (
          <div className="progress-bar" role="status">
            <span className="spinner" />
            {busy}
          </div>
        )}
      </div>
      {toastMessage && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          {toastMessage}
        </div>
      )}
      {files && (
        <SkinEditor
          targets={skinTargets}
          files={files}
          onClose={() => setFiles(null)}
          onSave={addSkins}
        />
      )}
      {editSkins && (
        <SkinEdit
          targets={skinTargets}
          indices={editSkins}
          skins={state.skins}
          onClose={() => setEditSkins(null)}
          onSave={(args) => run("skins.update", args)}
        />
      )}
      {editModel && (
        <ModelEditor
          {...editModel}
          onClose={() => setEditModel(null)}
          onSave={(args) => run("models.save", args, "正在校验模型…")}
        />
      )}
      {preview && (
        <SkinPreview
          skin={preview}
          targets={skinTargets}
          onClose={() => setPreview(null)}
        />
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => !busy && setConfirmation(null)}
          busy={!!busy}
          footer={
            <>
              <Button disabled={!!busy} onClick={() => setConfirmation(null)}>
                取消
              </Button>
              <Button
                primary
                disabled={!!busy}
                onClick={async () => {
                  try {
                    await confirmation.action();
                    setConfirmation(null);
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                确认
              </Button>
            </>
          }
        >
          <p>{confirmation.detail}</p>
        </Modal>
      )}
      {exported && (
        <Modal
          title="拓展包已导出"
          onClose={() => setExported(null)}
          footer={
            <>
              <Button
                icon="folder"
                onClick={() =>
                  api("path.open", { path: exported, reveal: true }).catch(
                    report,
                  )
                }
              >
                在文件夹中显示
              </Button>
              <Button primary onClick={() => setExported(null)}>
                完成
              </Button>
            </>
          }
        >
          <div className="success-icon">
            <Icon name="check" size={24} />
          </div>
          <p className="break-all">{exported}</p>
        </Modal>
      )}
      {notice && (
        <Modal
          title="操作提示"
          onClose={() => setNotice("")}
          footer={
            <Button primary onClick={() => setNotice("")}>
              知道了
            </Button>
          }
        >
          <div className="notice-text">{notice}</div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  <>
    <App />
    <WindowControls />
  </>,
);
