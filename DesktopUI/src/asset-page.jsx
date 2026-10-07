import React, { useEffect, useState } from "react";
import {
  Button,
  Intro,
  HelpButton,
  Search,
  Empty,
  Modal,
  Field,
  ErrorBox,
  LocalImage,
  basename,
  useValidation,
} from "./ui.jsx";
import {
  required,
  identifier,
  numberRange,
  packVersion,
} from "./validation.mjs";

const api = (method, args) => window.toolkit.call(method, args);
const labels = { textures: "贴图", sounds: "音效" };

export function AssetEditor({ kind, paths, entry, entries, onClose, onSave }) {
  const editing = !!entry;
  const [items, setItems] = useState(
    entry
      ? [{ ...entry }]
      : paths.map((Path) => ({
          Path,
          Name: basename(Path).replace(/\.(png|ogg)$/i, ""),
          Id: "",
          CategoryId: kind === "textures" ? "icons" : "sounds",
          CategoryName: labels[kind],
          SearchTags: [],
          Volume: 1,
          Pitch: 1,
          Stream: false,
        })),
  );
  const [category, setCategory] = useState(items[0].CategoryName);
  const [categoryId, setCategoryId] = useState(items[0].CategoryId);
  const [tags, setTags] = useState(items[0].SearchTags.join(","));
  const [volume, setVolume] = useState(items[0].Volume);
  const [pitch, setPitch] = useState(items[0].Pitch);
  const [stream, setStream] = useState(items[0].Stream);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const others = entries.filter((item) => item.Id !== entry?.Id);
  const errors = {
    category:
      required(category) ||
      (others.some(
        (item) =>
          item.CategoryId === categoryId.trim() &&
          item.CategoryName !== category.trim(),
      )
        ? "同一分类 ID 必须使用相同的分类名称"
        : ""),
    categoryId: identifier(categoryId.trim()),
    ...(kind === "sounds"
      ? {
          volume: numberRange(volume, 0, 1),
          pitch: numberRange(pitch, 0, 256, true),
        }
      : {}),
  };
  items.forEach((item, i) => {
    errors[`name${i}`] = required(item.Name);
    errors[`id${i}`] =
      identifier(item.Id, !editing) ||
      (item.Id.trim() &&
      [...others, ...items.filter((_, j) => i !== j)].some(
        (other) => other.Id === item.Id,
      )
        ? "资源 ID 已存在"
        : "");
  });
  const validation = useValidation(errors);
  async function save(event) {
    event?.preventDefault();
    if (!validation.check()) return;
    setBusy(true);
    try {
      const values = items.map((item) => ({
        ...item,
        CategoryName: category.trim(),
        CategoryId: categoryId.trim(),
        SearchTags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        Volume: Number(volume),
        Pitch: Number(pitch),
        Stream: stream,
      }));
      await onSave(values);
      onClose();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${editing ? "编辑" : "添加"}${labels[kind]}`}
      busy={busy}
      onClose={onClose}
      description={
        editing
          ? "修改已发布的资源 ID 或分类 ID 会改变资源标识，请谨慎操作。"
          : `已选择 ${items.length} 个文件；ID 留空则自动生成并保持固定。`
      }
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button primary disabled={busy} onClick={save}>
            {editing ? "保存" : "添加"}
          </Button>
        </>
      }
    >
      <form onSubmit={save} noValidate>
        <ErrorBox>{error}</ErrorBox>
        {items.map((item, index) => (
          <div className="section" key={index}>
            <div className="asset-name">
              {kind === "textures" && (
                <LocalImage
                  path={item.Path}
                  thumbnail
                  className="skin-thumbnail"
                />
              )}
              <span className="muted">{basename(item.Path)}</span>
            </div>
            <Field
              label={`资源名称${items.length > 1 ? ` ${index + 1}` : ""}`}
              {...validation.field(`name${index}`)}
            >
              <input
                autoFocus={index === 0}
                value={item.Name}
                onChange={(e) =>
                  setItems(
                    items.map((x, i) =>
                      i === index ? { ...x, Name: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
            <Field
              label={`资源 ID${items.length > 1 ? ` ${index + 1}` : ""}`}
              {...validation.field(`id${index}`)}
              hint="小写字母开头，只含小写字母、数字、下划线。"
            >
              <input
                value={item.Id}
                placeholder={editing ? "填写资源 ID" : "留空自动生成"}
                onChange={(e) =>
                  setItems(
                    items.map((x, i) =>
                      i === index ? { ...x, Id: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
          </div>
        ))}
        <div className="form-grid">
          <Field label="分类名称" {...validation.field("category")}>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
          <Field label="分类 ID" {...validation.field("categoryId")}>
            <input
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            />
          </Field>
        </div>
        <Field label="搜索关键词" hint="使用逗号分隔。">
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {kind === "sounds" && (
          <>
            <div className="form-grid">
              <Field label="音量（0–1）" {...validation.field("volume")}>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={volume}
                  onChange={(e) => setVolume(e.target.value)}
                />
              </Field>
              <Field label="音调（大于0）" {...validation.field("pitch")}>
                <input
                  type="number"
                  min="0"
                  max="256"
                  step="any"
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                />
              </Field>
            </div>
            <label className="muted">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />{" "}
              流式播放（适合长音频）
            </label>
          </>
        )}
        <button hidden type="submit" />
      </form>
    </Modal>
  );
}

function PackEditor({ pack, otherProviderId, onClose, onSave }) {
  const [name, setName] = useState(pack.Name),
    [author, setAuthor] = useState(pack.Author),
    [providerId, setProviderId] = useState(pack.ProviderId);
  const [version, setVersion] = useState(pack.Version);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const validation = useValidation({
    name: required(name),
    version: packVersion(version.trim()),
    providerId:
      identifier(providerId.trim()) ||
      (providerId.trim() === otherProviderId
        ? "贴图包与音效包不能使用相同标识"
        : ""),
  });
  async function save() {
    if (!validation.check()) return;
    setBusy(true);
    try {
      await onSave({ name, author, providerId, version });
      onClose();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="拓展包设置"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button primary disabled={busy} onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
      <Field label="拓展包名称" {...validation.field("name")}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="作者">
        <input value={author} onChange={(e) => setAuthor(e.target.value)} />
      </Field>
      <Field
        label="包版本"
        {...validation.field("version")}
        hint="例如 1.0.0；发布更新时提高版本，行为包和资源包自动同步。"
      >
        <input value={version} onChange={(e) => setVersion(e.target.value)} />
      </Field>
      <Field
        label="包标识"
        {...validation.field("providerId")}
        hint="已自动生成唯一标识；发布后不建议更改，否则路径、音效名和简短 ID 都会改变。"
      >
        <input
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

function Preview({ kind, entry, onClose }) {
  const [source, setSource] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (kind !== "sounds") return;
    let active = true;
    api("audio.read", { path: entry.Path })
      .then((value) => {
        if (active) setSource(value);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [entry.Path, kind]);
  return (
    <Modal title={entry.Name} onClose={onClose}>
      <ErrorBox>{error}</ErrorBox>
      {kind === "textures" ? (
        <LocalImage path={entry.Path} className="asset-preview-image" />
      ) : source ? (
        <audio
          controls
          autoPlay
          src={source}
          onPlay={(e) => {
            e.currentTarget.volume = entry.Volume;
            e.currentTarget.playbackRate = Math.max(
              0.0625,
              Math.min(16, entry.Pitch),
            );
            e.currentTarget.preservesPitch = false;
          }}
          onError={() =>
            setError("浏览器无法解码此音效，请检查 OGG Vorbis 文件是否完整。")
          }
        />
      ) : (
        <p>正在读取音效…</p>
      )}
    </Modal>
  );
}

export function AssetPage({
  kind,
  state,
  run,
  report,
  toast,
  confirm,
  openProject,
  newProject,
  saveProject,
  exportPackage,
  importPackage,
}) {
  const label = labels[kind],
    entries = state[kind],
    pack = state[kind === "textures" ? "texturePack" : "soundPack"];
  const [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState([]);
  const [editor, setEditor] = useState(null),
    [settings, setSettings] = useState(false),
    [preview, setPreview] = useState(null);
  useEffect(() => {
    setSelected([]);
  }, [entries]);
  const visible = entries
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      `${item.Name} ${item.Id} ${item.CategoryName} ${item.SearchTags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const start = Math.min(
      offset,
      Math.max(0, Math.floor((visible.length - 1) / 50) * 50),
    ),
    paged = visible.slice(start, start + 50);
  const all =
    paged.length > 0 && paged.every(({ index }) => selected.includes(index));
  async function pick() {
    try {
      const paths = await api("files.pick", {
        kind: kind === "textures" ? "texture" : "sound",
        multiple: true,
      });
      if (paths.length) setEditor({ paths });
    } catch (error) {
      report(error);
    }
  }
  function remove(indices) {
    confirm({
      title: `删除 ${indices.length} 个${label}？`,
      detail: "只移除列表条目，不删除原文件。",
      action: () => run(`${kind}.delete`, { indices }),
    });
  }
  return (
    <>
      <Intro
        title={`${label}拓展`}
        subtitle="制作大果喵前置组件的资源拓展包，自动加入统一资源选择器。"
      >
        <HelpButton page={kind} report={report} />
        <Button icon="plus" onClick={newProject}>
          新建项目
        </Button>
        <Button onClick={openProject}>打开工程</Button>
        <Button onClick={saveProject}>保存工程</Button>
        <Button
          primary
          icon="export"
          disabled={!entries.length}
          onClick={exportPackage}
        >
          导出 ZIP
        </Button>
      </Intro>
      <div className="toolbar">
        <Button icon="plus" onClick={pick}>
          添加{label} / 批量添加
        </Button>
        <Button icon="import" onClick={importPackage}>
          导入 ZIP
        </Button>
        <Button icon="settings" onClick={() => setSettings(true)}>
          拓展包设置
        </Button>
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
          {pack.Name} · {visible.length} 项
        </span>
        <span className="muted code">{pack.ProviderId}</span>
        <div className="toolbar-spacer" />
        {entries.length > 0 && (
          <button
            className="text-button"
            onClick={() =>
              confirm({
                title: "清空当前列表？",
                detail: "不会删除源文件。",
                action: () => run(`${kind}.clear`),
              })
            }
          >
            清空列表
          </button>
        )}
      </div>
      {selected.length > 0 && (
        <div className="selection-bar">
          <span>已选择 {selected.length} 项</span>
          <Button danger icon="trash" onClick={() => remove(selected)}>
            删除
          </Button>
          <Button onClick={() => setSelected([])}>取消选择</Button>
        </div>
      )}
      {visible.length ? (
        <div className="table-wrap">
          <table className="asset-table">
            <thead>
              <tr>
                <th className="check-cell">
                  <input
                    type="checkbox"
                    aria-label="选择当前页全部条目"
                    checked={all}
                    onChange={() =>
                      setSelected(
                        all
                          ? selected.filter(
                              (index) => !paged.some((x) => x.index === index),
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
                <th>{label}名称</th>
                <th>简短 ID</th>
                <th>分类</th>
                <th className="actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(({ item, index }) => (
                <tr
                  key={index}
                  className={selected.includes(index) ? "selected" : ""}
                >
                  <td className="check-cell">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${item.Name}`}
                      checked={selected.includes(index)}
                      onChange={() =>
                        setSelected(
                          selected.includes(index)
                            ? selected.filter((x) => x !== index)
                            : [...selected, index],
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="asset-name">
                      {kind === "textures" && (
                        <LocalImage
                          path={item.Path}
                          thumbnail
                          className="skin-thumbnail"
                        />
                      )}
                      <div>
                        <strong>{item.Name}</strong>
                        <small>{basename(item.Path)}</small>
                      </div>
                    </div>
                  </td>
                  <td className="code">
                    <span>
                      {pack.ProviderId}:{item.Id}
                    </span>
                    <Button
                      icon="copy"
                      aria-label={`复制 ${item.Id}`}
                      onClick={async () => {
                        try {
                          await api("clipboard.write", {
                            text: `${pack.ProviderId}:${item.Id}`,
                          });
                          toast("资源 ID 已复制");
                        } catch (error) {
                          report(error);
                        }
                      }}
                    />
                  </td>
                  <td className="muted">{item.CategoryName}</td>
                  <td>
                    <div className="row-actions">
                      <Button
                        icon={kind === "textures" ? "image" : "sound"}
                        aria-label={`${kind === "textures" ? "预览" : "试听"} ${item.Name}`}
                        onClick={() => setPreview(item)}
                      />
                      <Button
                        icon="edit"
                        aria-label={`编辑 ${item.Name}`}
                        onClick={() => setEditor({ entry: item, index })}
                      />
                      <Button
                        icon="trash"
                        aria-label={`删除 ${item.Name}`}
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
          icon={kind === "textures" ? "image" : "sound"}
          title={search ? "没有匹配的结果" : `添加第一个${label}`}
          action={
            !search && (
              <Button primary onClick={pick}>
                选择{label}文件
              </Button>
            )
          }
        >
          {kind === "textures"
            ? "支持任意正常尺寸的 PNG 图标、横幅及装饰贴图。"
            : "支持 OGG Vorbis 文件；MP3、WAV、FSB、OGG Opus 请先转换。"}
        </Empty>
      )}
      {visible.length > 50 && (
        <div className="pagination">
          <span>
            {start + 1}–{Math.min(start + 50, visible.length)} /{" "}
            {visible.length}
          </span>
          <Button disabled={!start} onClick={() => setOffset(start - 50)}>
            上一页
          </Button>
          <Button
            disabled={start + 50 >= visible.length}
            onClick={() => setOffset(start + 50)}
          >
            下一页
          </Button>
        </div>
      )}
      <div className="workspace-footnote">
        可拖入{kind === "textures" ? " PNG" : " OGG"}、ZIP 拓展包或 .dgnproject
        工程。
        同时加载生成的行为包、资源包和大果喵前置组件。退出前请保存工程；已有包可导入继续编辑。
      </div>
      {editor && (
        <AssetEditor
          kind={kind}
          entries={entries}
          {...editor}
          onClose={() => setEditor(null)}
          onSave={async (items) => {
            await run(
              `${kind}.${editor.entry ? "save" : "add"}`,
              editor.entry
                ? { index: editor.index, entry: items[0] }
                : { items },
              "正在保存资源…",
            );
            toast(`${label}已保存`);
          }}
        />
      )}
      {settings && (
        <PackEditor
          pack={pack}
          otherProviderId={
            state[kind === "textures" ? "soundPack" : "texturePack"].ProviderId
          }
          onClose={() => setSettings(false)}
          onSave={(args) => run(`${kind}.settings`, args)}
        />
      )}
      {preview && (
        <Preview kind={kind} entry={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}
