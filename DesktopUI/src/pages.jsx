import React, { useEffect, useState } from "react";
import {
  Button,
  Field,
  Select,
  Intro,
  Section,
  Search,
  Empty,
  ErrorBox,
  PathField,
  Modal,
  Icon,
  LocalImage,
  useValidation,
} from "./ui.jsx";
import { toolErrors } from "./validation.mjs";

const api = (method, args) => window.toolkit.call(method, args);
export function SettingsPage({ settings, saveSettings, report }) {
  async function pickDirectory() {
    const value = await api("files.directory");
    if (value) await saveSettings({ LastOutputDir: value });
  }
  return (
    <>
      <Intro title="设置" subtitle="让工具箱符合你的工作习惯。" />
      <Section title="功能显示">
        <div className="setting-row">
          <div>
            <h3 id="developer-tools-label">显示模组开发者工具</h3>
            <p id="developer-tools-description">
              在侧栏显示 3D 文字、开发者工具箱、MCStudio 项目和存档全局配置。
            </p>
          </div>
          <button
            type="button"
            className="setting-switch"
            role="switch"
            aria-checked={settings.ShowModDeveloperTools}
            aria-labelledby="developer-tools-label"
            aria-describedby="developer-tools-description"
            onClick={() =>
              saveSettings({
                ShowModDeveloperTools: !settings.ShowModDeveloperTools,
              }).catch(report)
            }
          >
            <span />
          </button>
        </div>
      </Section>
      <Section title="外观" description="界面字体统一为 Microsoft YaHei UI。">
        <div className="appearance-options">
          {[
            ["System", "monitor", "跟随系统"],
            ["Light", "sun", "浅色"],
            ["Dark", "moon", "深色"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={`appearance ${settings.AppearanceMode === id ? "selected" : ""}`}
              onClick={() => saveSettings({ AppearanceMode: id }).catch(report)}
              aria-pressed={settings.AppearanceMode === id}
            >
              <div className={`theme-sample ${id.toLowerCase()}`}>
                <i />
                <div>
                  <b />
                  <b />
                  <b />
                </div>
              </div>
              <span>
                <Icon name={icon} size={16} />
                {label}
                {settings.AppearanceMode === id && (
                  <Icon name="check" size={16} />
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="setting-row">
          <div>
            <h3>强调色</h3>
            <p>用于焦点提示，工作区保持中性色。</p>
          </div>
          <div className="swatches">
            {[210, 270, 330, 30, 140, 180].map((h) => (
              <button
                key={h}
                style={{ "--swatch": `hsl(${h} 65% 50%)` }}
                aria-label={`强调色色相 ${h}`}
                aria-pressed={settings.ThemeHue === h}
                onClick={() => saveSettings({ ThemeHue: h }).catch(report)}
              >
                {settings.ThemeHue === h && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
        </div>
        <PathField
          label="背景图片"
          kind="background"
          value={settings.BgImagePath}
          onChange={(value) =>
            saveSettings({ BgImagePath: value }).catch(report)
          }
          hint="图片覆盖整个窗口并居中等比铺满，超出窗口的部分会裁切。"
        />
        <Field
          label="背景透明度"
          hint="0% 完全显示，100% 完全透明；仅影响背景图片。"
        >
          <div className="background-opacity-control">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={100 - Math.round(settings.BgImageOpacity * 100)}
              aria-valuetext={`${100 - Math.round(settings.BgImageOpacity * 100)}%`}
              onChange={(e) =>
                saveSettings({
                  BgImageOpacity: (100 - Number(e.target.value)) / 100,
                }).catch(report)
              }
            />
            <output>{100 - Math.round(settings.BgImageOpacity * 100)}%</output>
            <Button
              onClick={() =>
                saveSettings({ BgImageOpacity: 0.06 }).catch(report)
              }
            >
              恢复默认
            </Button>
          </div>
        </Field>
        {[
          [
            "BgImageBlur",
            "背景模糊度",
            0,
            30,
            1,
            "px",
            "数值越大越柔和，仅模糊背景，文字和控件保持清晰。",
            0,
          ],
          [
            "BgImageScale",
            "背景缩放",
            100,
            200,
            100,
            "%",
            "以图片中心缩放，100% 为适应窗口的铺满尺寸。",
            1,
          ],
        ].map(
          ([key, label, min, max, multiplier, unit, hint, defaultValue]) => (
            <Field key={key} label={label} hint={hint}>
              <div className="background-opacity-control">
                <input
                  type="range"
                  min={min}
                  max={max}
                  step="1"
                  value={Math.round(settings[key] * multiplier)}
                  aria-valuetext={`${Math.round(settings[key] * multiplier)}${unit}`}
                  onChange={(e) =>
                    saveSettings({
                      [key]: Number(e.target.value) / multiplier,
                    }).catch(report)
                  }
                />
                <output>
                  {Math.round(settings[key] * multiplier)}
                  {unit}
                </output>
                <Button
                  onClick={() =>
                    saveSettings({ [key]: defaultValue }).catch(report)
                  }
                >
                  恢复默认
                </Button>
              </div>
            </Field>
          ),
        )}
        {settings.BgImagePath && (
          <Button
            onClick={() => saveSettings({ BgImagePath: "" }).catch(report)}
          >
            移除背景图片
          </Button>
        )}
      </Section>
      <Section title="导出" description="导出前仍可选择其他目录。">
        <Field label="默认输出目录">
          <div className="path-field">
            <input
              readOnly
              value={settings.LastOutputDir}
              placeholder="每次导出时选择"
            />
            <Button icon="folder" onClick={() => pickDirectory().catch(report)}>
              选择目录
            </Button>
          </div>
        </Field>
      </Section>
      <Section title="当前会话">
        <p className="muted">
          皮肤、模型、贴图和音效列表在切换页面时保留，退出应用后清空。
          需要保留的内容请先保存工程，或导出 ZIP。
        </p>
      </Section>
    </>
  );
}

export function ToolsPage({
  settings,
  saveSettings,
  report,
  toast,
  drafts,
  setDrafts,
}) {
  const [busy, setBusy] = useState(""),
    [result, setResult] = useState(null);
  const mod = drafts.mod,
    item = drafts.item;
  const modValidation = useValidation(toolErrors("mod", mod));
  const itemValidation = useValidation(toolErrors("item", item));
  const change = (kind, key, value) =>
    setDrafts((old) => ({ ...old, [kind]: { ...old[kind], [key]: value } }));
  async function run(kind) {
    if (!(kind === "mod" ? modValidation : itemValidation).check()) return;
    setBusy(kind);
    try {
      const result = await api("tools.run", { kind, input: drafts[kind] });
      if (!result.canceled) {
        setResult(result);
        toast("生成完成");
      }
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
  }
  async function launch() {
    setBusy("game");
    try {
      await api("tools.launch");
      toast("已启动游戏程序");
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
  }
  const pathSetting = (label, field, kind) => (
    <PathField
      label={label}
      kind={kind}
      value={settings[field]}
      onChange={(value) => saveSettings({ [field]: value }).catch(report)}
    />
  );
  return (
    <>
      <Intro title="开发者工具箱" subtitle="把重复的准备工作，交给工具。" />
      <Section
        title="启动游戏"
        description="选择网易开发版互通 MC 的可执行文件。"
        action={
          <Button onClick={launch} disabled={!!busy} icon="external">
            {busy === "game" ? "启动中…" : "启动游戏"}
          </Button>
        }
      >
        {pathSetting("游戏程序", "McPath", "executable")}
      </Section>
      <Section
        title="生成 MOD 框架"
        description="使用你已有的 Python 生成脚本。"
      >
        {pathSetting("MOD 生成脚本", "ModScriptPath", "python")}
        <Field label="模组名称" {...modValidation.field("name")}>
          <input
            placeholder="例如：custom_example"
            value={mod.name}
            onChange={(e) => change("mod", "name", e.target.value)}
          />
        </Field>
        <div className="checks">
          {[
            ["help", "帮助页面"],
            ["hud", "HUD 按钮"],
            ["worldData", "跨存档数据"],
            ["setting", "设置页面"],
          ].map(([key, label]) => (
            <label key={key} className="check-row">
              <input
                type="checkbox"
                checked={mod[key]}
                onChange={(e) => change("mod", key, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
        <Button
          primary
          icon="plus"
          disabled={!!busy}
          onClick={() => run("mod")}
        >
          {busy === "mod" ? "正在生成…" : "生成 MOD 框架"}
        </Button>
      </Section>
      <Section title="批量生成物品" description="普通物品、武器与挖掘工具。">
        {pathSetting("物品生成脚本", "ItemScriptPath", "python")}
        <div className="form-grid">
          {[
            ["namespace", "命名空间"],
            ["prefix", "物品前缀"],
            ["name", "中文名称"],
            ["tab", "创造栏"],
          ].map(([key, label]) => (
            <Field label={label} key={key} {...itemValidation.field(key)}>
              <input
                value={item[key]}
                onChange={(e) => change("item", key, e.target.value)}
              />
            </Field>
          ))}
          {[
            ["start", "起始序号"],
            ["end", "结束序号"],
          ].map(([key, label]) => (
            <Field label={label} key={key} {...itemValidation.field(key)}>
              <input
                type="number"
                min="0"
                value={item[key]}
                onChange={(e) =>
                  change(
                    "item",
                    key,
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </Field>
          ))}
          <Field label="类型">
            <Select
              value={item.type}
              onChange={(value) => change("item", "type", value)}
              options={[
                { value: 1, label: "普通物品" },
                { value: 2, label: "武器" },
                { value: 4, label: "挖掘工具" },
              ]}
            />
          </Field>
          {(item.type === 1
            ? [["stackSize", "堆叠数量"]]
            : [
                ["durability", "耐久"],
                ["damage", "攻击伤害"],
                ...(item.type === 4 ? [["level", "挖掘等级"]] : []),
              ]
          ).map(([key, label]) => (
            <Field key={key} label={label} {...itemValidation.field(key)}>
              <input
                type="number"
                min="0"
                value={item[key]}
                onChange={(e) =>
                  change(
                    "item",
                    key,
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </Field>
          ))}
        </div>
        <div className="checks">
          <label className="check-row">
            <input
              type="checkbox"
              checked={item.appendIndex}
              onChange={(e) => change("item", "appendIndex", e.target.checked)}
            />
            中文名追加序号
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={item.custom}
              onChange={(e) => change("item", "custom", e.target.checked)}
            />
            自定义武器类别
          </label>
        </div>
        <Button
          primary
          icon="plus"
          disabled={!!busy}
          onClick={() => run("item")}
        >
          {busy === "item" ? "正在生成…" : "生成物品模板"}
        </Button>
      </Section>
      {result && (
        <Modal
          title="生成完成"
          onClose={() => setResult(null)}
          footer={
            <>
              <Button
                onClick={() =>
                  api("path.open", { path: result.directory }).catch(report)
                }
                icon="folder"
              >
                打开输出目录
              </Button>
              <Button primary onClick={() => setResult(null)}>
                完成
              </Button>
            </>
          }
        >
          <p className="break-all">{result.directory}</p>
          {result.output && <pre className="output-log">{result.output}</pre>}
          {result.warnings && (
            <pre className="output-log">{result.warnings}</pre>
          )}
        </Modal>
      )}
    </>
  );
}

export function StudioPage({ report, toast, onSaves }) {
  const [data, setData] = useState({
    accounts: [],
    entries: [],
    account: "",
    root: "",
    warnings: [],
  });
  const [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(account = data.account) {
    setBusy(true);
    setError("");
    try {
      setData(await api("studio.list", { account }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load("");
  }, []);
  async function change(id) {
    try {
      const item = await api("studio.path", { id });
      if (!item.canceled) {
        setData((old) => ({
          ...old,
          entries: old.entries.map((x) => (x.id === id ? item : x)),
        }));
        toast("项目工作目录已更新");
      }
    } catch (e) {
      report(e);
    }
  }
  const entries = data.entries.filter((x) =>
    `${x.name} ${x.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Intro
        title="MCStudio 项目"
        subtitle="浏览项目，管理源代码路径和测试存档。"
      >
        <Button icon="refresh" onClick={() => load()} disabled={busy}>
          刷新
        </Button>
      </Intro>
      <div className="toolbar">
        <Select
          aria-label="MCStudio 账号"
          value={data.account}
          onChange={(value) => load(value)}
          disabled={busy}
          options={[
            { value: "", label: "选择账号" },
            ...data.accounts.map((value) => ({ value, label: value })),
          ]}
        />
        <Search value={search} onChange={setSearch} placeholder="搜索项目…" />
        <span className="count">{entries.length} 个项目</span>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {data.root && (
        <p className="location-line" title={data.root}>
          <Icon name="folder" size={14} />
          {data.root}
        </p>
      )}
      {entries.length ? (
        <div className="project-list">
          {entries.map((item) => (
            <article key={item.id} className="project">
              <div className="project-icon">
                <Icon name="folder" />
              </div>
              <div className="project-detail">
                <h3>{item.name}</h3>
                <p title={item.workDirectory}>{item.workDirectory}</p>
              </div>
              <div className="row-actions">
                <Button
                  title="打开源代码目录"
                  icon="external"
                  aria-label={`打开 ${item.name}`}
                  onClick={() =>
                    api("studio.open", { id: item.id }).catch(report)
                  }
                />
                <Button onClick={() => change(item.id)}>更改路径</Button>
                <Button
                  onClick={() =>
                    api("studio.open", { id: item.id, config: true }).catch(
                      report,
                    )
                  }
                >
                  配置目录
                </Button>
                <Button onClick={() => onSaves(item)}>测试存档</Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title={busy ? "正在读取项目…" : "暂无项目"}>
          {error
            ? "配置就绪后可重新刷新。"
            : "选择 MCStudio 账号后，项目会显示在这里。"}
        </Empty>
      )}
      {!!data.warnings.length && (
        <details className="warnings">
          <summary>{data.warnings.length} 个配置未能读取</summary>
          {data.warnings.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </details>
      )}
    </>
  );
}

export function TestSavesPage({ project, onBack, report, toast }) {
  const [data, setData] = useState({ entries: [], warnings: [] }),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState(null),
    [version, setVersion] = useState("");
  async function load() {
    try {
      setData(await api("studio.saves", { id: project.id }));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [project.id]);
  async function save() {
    try {
      const next = await api("studio.version", { id: edit.id, version });
      setData((old) => ({
        ...old,
        entries: old.entries.map((x) => (x.id === next.id ? next : x)),
      }));
      setEdit(null);
      toast("存档版本号已更新");
    } catch (e) {
      report(e);
    }
  }
  const entries = data.entries.filter((x) =>
    `${x.name} ${x.version}`.includes(search),
  );
  return (
    <>
      <Button icon="arrow" onClick={onBack} className="back-link">
        返回项目
      </Button>
      <Intro title="测试存档" subtitle={project.name}>
        <Button icon="refresh" onClick={load}>
          刷新
        </Button>
      </Intro>
      <div className="toolbar">
        <Search value={search} onChange={setSearch} placeholder="搜索存档…" />
        <span className="count">{entries.length} 个存档</span>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {entries.length ? (
        <div className="project-list">
          {entries.map((item) => (
            <article className="project" key={item.id}>
              <Icon name="folder" />
              <div className="project-detail">
                <h3>{item.name}</h3>
                <p>{item.level}</p>
              </div>
              <span className="tag">{item.version}</span>
              <Button
                onClick={() => {
                  setEdit(item);
                  setVersion(item.version);
                }}
              >
                修改版本
              </Button>
              <Button
                icon="external"
                onClick={() =>
                  api("path.open", { path: item.directory }).catch(report)
                }
              >
                打开存档
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="暂无测试存档">运行项目的测试存档后，再刷新此列表。</Empty>
      )}
      {edit && (
        <Modal
          title="修改游戏版本"
          description={edit.name}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>取消</Button>
              <Button primary onClick={save}>
                保存
              </Button>
            </>
          }
        >
          <Field label="游戏版本号">
            <input
              autoFocus
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </Field>
          <p className="muted">
            修改 MC_GAME 配置中的版本号；原配置会保留备份。
          </p>
        </Modal>
      )}
    </>
  );
}

export function ConfigsPage({ settings, saveSettings, report }) {
  const [data, setData] = useState({
      root: "",
      players: [],
      player: "",
      entries: [],
    }),
    [channel, setChannel] = useState(settings.FeverChannel),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(
    nextChannel = channel,
    player = data.player || settings.FeverPlayerId,
  ) {
    setBusy(true);
    setError("");
    try {
      setData(await api("configs.list", { channel: nextChannel, player }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const entries = data.entries.filter((x) =>
    x.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Intro
        title="存档全局配置"
        subtitle="按玩家或 config 目录浏览网易互通版的全局配置文件。"
      >
        <Button icon="refresh" disabled={busy} onClick={() => load()}>
          刷新
        </Button>
      </Intro>
      <div className="toolbar">
        <Select
          aria-label="游戏端"
          value={channel}
          onChange={(c) => {
            setChannel(c);
            load(c, "");
            saveSettings({ FeverChannel: c }).catch(report);
          }}
          options={["正式端", "测试端"].map((value) => ({
            value,
            label: value,
          }))}
        />
        <Select
          aria-label="玩家"
          value={data.player}
          onChange={(value) => {
            load(channel, value);
            saveSettings({ FeverPlayerId: value }).catch(report);
          }}
          options={[
            { value: "", label: "选择玩家" },
            ...data.players.map((value) => ({
              value,
              label:
                value.toLowerCase() === "config"
                  ? `${value}（直接配置目录）`
                  : value,
            })),
          ]}
        />
        <Search
          value={search}
          onChange={setSearch}
          placeholder="搜索配置文件…"
        />
      </div>
      <ErrorBox>{error}</ErrorBox>
      <p className="location-line" title={data.root}>
        <Icon name="folder" size={14} />
        {data.root}
      </p>
      {entries.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>文件名</th>
                <th>修改时间</th>
                <th>大小</th>
                <th className="actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((item) => (
                <tr key={item.path}>
                  <td>{item.name}</td>
                  <td className="muted">
                    {new Date(item.modified).toLocaleString("zh-CN")}
                  </td>
                  <td className="muted">
                    {item.size < 1024
                      ? item.size + " B"
                      : (item.size / 1024).toFixed(1) + " KB"}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button
                        onClick={() =>
                          api("path.open", { path: item.path }).catch(report)
                        }
                      >
                        打开
                      </Button>
                      <Button
                        icon="folder"
                        aria-label={`定位 ${item.name}`}
                        onClick={() =>
                          api("path.open", {
                            path: item.path,
                            reveal: true,
                          }).catch(report)
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={busy ? "正在读取…" : "暂无配置文件"}>
          选择游戏端和玩家后，配置文件会显示在这里。
        </Empty>
      )}
    </>
  );
}

export function AboutPage({ version }) {
  const [error, setError] = useState("");
  return (
    <>
      <Intro title="关于工具箱" subtitle="为你的模组创作，留出更多时间。" />
      <div className="about-brand">
        <div className="brand-mark large">
          <Icon name="cube" size={32} />
        </div>
        <h2>大果喵模组工具箱</h2>
        <p>DaGuoNeko Mod Toolkit · {version}</p>
      </div>
      <Section title="从素材到拓展包">
        <div className="help-grid">
          <div>
            <span className="step">01</span>
            <h3>准备素材</h3>
            <p>准备 PNG 皮肤、模型与动画，或公共贴图和 OGG 音效。</p>
          </div>
          <div>
            <span className="step">02</span>
            <h3>整理与配置</h3>
            <p>编辑名称、分类、资源 ID，或皮肤变体与模型动画。</p>
          </div>
          <div>
            <span className="step">03</span>
            <h3>导出 ZIP</h3>
            <p>生成行为包与资源包，配合自定义NPC或大果喵前置组件使用。</p>
          </div>
        </div>
      </Section>
      <Section title="制作与技术">
        <p>作者：大果喵（DaGuoNeko）</p>
        <p className="muted">
          Electron + React 界面，复用 C# 打包核心。字体固定为 Microsoft YaHei
          UI。
        </p>
        <p className="about-repository">
          <a
            href="https://github.com/DaGuoNeko/DaGuoNekoModToolkit"
            onClick={async (event) => {
              event.preventDefault();
              setError("");
              try {
                await api("web.open", { kind: "repository" });
              } catch (error) {
                setError(`无法打开仓库链接：${error.message}`);
              }
            }}
          >
            GitHub 仓库：DaGuoNeko/DaGuoNekoModToolkit
            <Icon name="external" size={15} />
          </a>
        </p>
        <p className="muted">喜欢就点个⭐吧！</p>
        <ErrorBox>{error}</ErrorBox>
      </Section>
    </>
  );
}
export function TextPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Intro
        title="3D 文字"
        subtitle="在系统浏览器中创建 Minecraft 风格的立体文字。"
      />
      <ErrorBox>{error}</ErrorBox>
      <Empty
        icon="text"
        title="把文字变成立体作品"
        action={
          <Button
            primary
            icon="external"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("web.open", { kind: "3d" });
              } catch (error) {
                setError(`无法启动系统浏览器：${error.message}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在打开浏览器…" : "在浏览器中打开"}
          </Button>
        }
      >
        工具箱仅提供快捷入口。在线工具由系统默认浏览器打开，不会在软件内创建浏览窗口。
      </Empty>
    </>
  );
}
