import React, { useEffect, useState } from "react";
import {
  removeTexture,
  nextSkinId,
  addTextures,
  fillSkinVariants,
  renameTexture,
  setDefaultTexture,
} from "./model-resources.mjs";
import { SkinTargetFields } from "./skin-preview.jsx";
import { required, skinTargetErrors, modelErrors } from "./validation.mjs";
import { mergeModelFiles } from "./drop-import.mjs";
import {
  ENTITY_ANIMATIONS,
  animationOptions,
} from "./model-animation-options.mjs";
import {
  Button,
  Field,
  Modal,
  ErrorBox,
  PathField,
  LocalImage,
  basename,
  useValidation,
  Select,
} from "./ui.jsx";

export function SkinEditor({ files, targets, onClose, onSave }) {
  const [items, setItems] = useState(
    files.map((path) => ({
      path,
      name: basename(path).replace(/\.png$/i, ""),
      author: "",
    })),
  );
  const [author, setAuthor] = useState("");
  const [targetIdentifier, setTarget] = useState(""),
    [textureSlot, setSlot] = useState("skin_4");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const validation = useValidation({
    ...skinTargetErrors(targetIdentifier, textureSlot),
    author: required(author),
    ...Object.fromEntries(
      items.map((item, i) => [`name${i}`, required(item.name)]),
    ),
  });
  async function submit(e) {
    e?.preventDefault();
    if (!validation.check()) return;
    setBusy(true);
    try {
      await onSave(
        items.map((i) => ({ ...i, author, targetIdentifier, textureSlot })),
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={files.length > 1 ? "批量添加皮肤" : "添加皮肤"}
      description={`已选择 ${files.length} 张 PNG 贴图`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button primary onClick={submit} disabled={busy}>
            {busy
              ? "正在添加…"
              : `添加${files.length > 1 ? ` ${files.length} 个皮肤` : ""}`}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <ErrorBox>{error}</ErrorBox>
        <SkinTargetFields
          validation={validation}
          targets={targets}
          value={targetIdentifier}
          slot={textureSlot}
          onChange={setTarget}
          onSlotChange={setSlot}
        />
        <div className="skin-inputs">
          {items.map((item, i) => (
            <div className="skin-input-row" key={item.path}>
              <LocalImage
                path={item.path}
                thumbnail
                className="skin-thumbnail"
              />
              <Field
                label={`人物名称${items.length > 1 ? ` ${i + 1}` : ""}`}
                {...validation.field(`name${i}`)}
                hint={basename(item.path)}
              >
                <input
                  autoFocus={i === 0}
                  value={item.name}
                  maxLength={120}
                  onChange={(e) =>
                    setItems(
                      items.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
            </div>
          ))}
        </div>
        <Field
          label={items.length > 1 ? "统一作者" : "作者"}
          {...validation.field("author")}
        >
          <input
            value={author}
            maxLength={120}
            placeholder="填写作者名称"
            onChange={(e) => setAuthor(e.target.value)}
          />
        </Field>
        <button hidden type="submit" />
      </form>
    </Modal>
  );
}

export function SkinEdit({ indices, skins, targets, onClose, onSave }) {
  const single = indices.length === 1;
  const [name, setName] = useState(single ? skins[indices[0]].Name : "");
  const [author, setAuthor] = useState(single ? skins[indices[0]].Author : "");
  const [targetIdentifier, setTarget] = useState(
    single ? skins[indices[0]].TargetIdentifier || "" : "",
  );
  const [textureSlot, setSlot] = useState(
    single ? skins[indices[0]].TextureSlot || "skin_4" : "skin_4",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const validation = useValidation(
    single
      ? {
          name: required(name),
          author: required(author),
          ...skinTargetErrors(targetIdentifier, textureSlot),
        }
      : {},
  );
  async function save() {
    if (!validation.check()) return;
    setBusy(true);
    try {
      await onSave({
        indices,
        name,
        author,
        ...(single ? { targetIdentifier, textureSlot } : {}),
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={single ? "编辑皮肤" : `编辑 ${indices.length} 个皮肤`}
      description={single ? "更新人物名称和作者信息" : "留空的字段保持原值"}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button primary disabled={busy} onClick={save}>
            保存修改
          </Button>
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
      {single && (
        <SkinTargetFields
          validation={validation}
          targets={targets}
          value={targetIdentifier}
          slot={textureSlot}
          onChange={setTarget}
          onSlotChange={setSlot}
        />
      )}
      <Field label="人物名称" {...validation.field("name")}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="作者" {...validation.field("author")}>
        <input value={author} onChange={(e) => setAuthor(e.target.value)} />
      </Field>
    </Modal>
  );
}

export const blankModel = () => ({
  DisplayName: "",
  CustomName: "",
  SourceLabel: "其他",
  GeoPath: "",
  PreviewImagePath: "",
  Textures: [],
  AnimationFiles: [],
  AnimationList: [],
  SkinList: [],
  CollisionWidth: 0.6,
  CollisionHeight: 1.8,
  IdleAnimation: "",
  WalkAnimation: "",
  WalkaAnimation: "",
  AttackAnimation: "",
  DeathAnimation: "",
  EnableAttachables: true,
});
export function ModelEditor({
  model,
  initialEntry,
  index,
  models,
  onClose,
  onSave,
}) {
  const [entry, setEntry] = useState(() =>
    structuredClone(model || initialEntry || blankModel()),
  );
  const [tab, setTab] = useState("basic"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  // Preserve existing subsets, ordering and NPC built-in references unless opted in.
  const [syncAnimationList, setSyncAnimationList] = useState(!model);
  const animationKey = JSON.stringify(entry.AnimationFiles);
  const [catalog, setCatalog] = useState({
    key: "",
    animations: [],
    loading: true,
    error: "",
  });
  useEffect(() => {
    let active = true;
    setCatalog({ key: animationKey, animations: [], loading: true, error: "" });
    window.toolkit
      .call("models.animations", { paths: JSON.parse(animationKey) })
      .then((result) => {
        if (!active) return;
        setCatalog({
          key: animationKey,
          animations: result.animations,
          loading: false,
          error: "",
        });
      })
      .catch((error) => {
        if (active)
          setCatalog({
            key: animationKey,
            animations: [],
            loading: false,
            error: error.message,
          });
      });
    return () => {
      active = false;
    };
  }, [animationKey]);
  const saveEntry = {
    ...entry,
    AnimationList: syncAnimationList
      ? catalog.animations.map((animation) => animation.id)
      : entry.AnimationList,
  };
  const errors = modelErrors(saveEntry, models, index);
  const validation = useValidation(errors);
  const update = (key, value) =>
    setEntry((previous) => ({ ...previous, [key]: value }));
  async function files(kind) {
    try {
      const chosen = await window.toolkit.call("files.pick", {
        kind,
        multiple: true,
      });
      if (kind === "texture")
        setEntry(
          addTextures(
            entry,
            chosen.map((Path) => ({
              Name: basename(Path).replace(/\.png$/i, ""),
              Path,
            })),
          ),
        );
      else
        update("AnimationFiles", [
          ...new Set([...entry.AnimationFiles, ...chosen]),
        ]);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    if (catalog.key !== animationKey || catalog.loading || catalog.error) {
      setTab("animations");
      setError(catalog.error || "动画文件正在读取，请稍候再保存");
      return;
    }
    if (!validation.check()) {
      const first = Object.keys(errors).find((key) => errors[key]);
      setTab(
        first.startsWith("SkinId")
          ? "textures"
          : first === "AnimationList"
            ? "animations"
            : "basic",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({ entry: saveEntry, index });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={model ? "编辑模型" : "添加模型"}
      onFiles={(paths) => {
        const next = mergeModelFiles(entry, paths);
        setEntry(next);
        setError("");
      }}
      dropReport={(error) => setError(error.message)}
      description={
        entry.CustomName
          ? `customnpc:${entry.CustomName}_dlcnpc`
          : "配置模型资源、外观与动画"
      }
      wide
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <span className="footer-note">带 * 的字段为必填项</span>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button primary onClick={save} disabled={busy}>
            {busy ? "正在校验…" : "保存模型"}
          </Button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {[
          ["basic", "基本信息"],
          ["textures", "贴图与皮肤"],
          ["animations", "动画"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox>{error}</ErrorBox>
      {tab === "basic" && (
        <div className="form-grid">
          <Field label="显示名称 *" {...validation.field("DisplayName")}>
            <input
              autoFocus
              placeholder="例如：森林守卫"
              value={entry.DisplayName}
              onChange={(e) => update("DisplayName", e.target.value)}
            />
          </Field>
          <Field
            label="自定义模型 ID *"
            {...validation.field("CustomName")}
            hint="填写模型 ID 的自定义部分，例如 forest_guard；无需填写 customnpc: 和 _dlcnpc 后缀。小写字母开头，仅含字母、数字和下划线。"
          >
            <input
              placeholder="例如：forest_guard"
              value={entry.CustomName}
              onChange={(e) => update("CustomName", e.target.value)}
            />
          </Field>
          <Field label="模型分类" hint="决定模型在 NPC 模型选择列表中的分类。">
            <Select
              value={entry.SourceLabel}
              options={[
                ...["原版", "其他", "功能性"].map((value) => ({
                  value,
                  label: value,
                })),
                ...(["原版", "其他", "功能性"].includes(entry.SourceLabel)
                  ? []
                  : [
                      {
                        value: entry.SourceLabel,
                        label: `${entry.SourceLabel || "未分类"}（已有分类）`,
                      },
                    ]),
              ]}
              onChange={(value) => update("SourceLabel", value)}
            />
          </Field>
          <div className="two-fields">
            <Field label="碰撞箱宽度" {...validation.field("CollisionWidth")}>
              <input
                type="number"
                min="0"
                step="any"
                value={entry.CollisionWidth}
                onChange={(e) =>
                  update(
                    "CollisionWidth",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </Field>
            <Field label="碰撞箱高度" {...validation.field("CollisionHeight")}>
              <input
                type="number"
                min="0"
                step="any"
                value={entry.CollisionHeight}
                onChange={(e) =>
                  update(
                    "CollisionHeight",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </Field>
          </div>
          <div className="full">
            <PathField
              label="模型文件 *"
              {...validation.field("GeoPath")}
              kind="geo"
              value={entry.GeoPath}
              onChange={(v) => update("GeoPath", v)}
              hint="选择包含 geometry 标识符的 .geo.json 文件"
            />
          </div>
          <div className="full">
            <PathField
              label="预览图"
              kind="texture"
              value={entry.PreviewImagePath}
              onChange={(v) => update("PreviewImagePath", v)}
              hint="可选；留空时使用第一张贴图"
            />
            {entry.PreviewImagePath && (
              <Button onClick={() => update("PreviewImagePath", "")}>
                清除预览图
              </Button>
            )}
          </div>
          <label className="check-row full">
            <input
              type="checkbox"
              checked={entry.EnableAttachables}
              onChange={(e) => update("EnableAttachables", e.target.checked)}
            />
            允许渲染装备和附件
          </label>
        </div>
      )}
      {tab === "textures" && (
        <>
          <div className="subheading">
            <div>
              <h3>模型贴图 *</h3>
              <p>按顺序对应 skinid 0、1、2…，最多 64 张。</p>
            </div>
            <Button icon="plus" onClick={() => files("texture")}>
              添加贴图
            </Button>
          </div>
          {entry.Textures.length === 0 && (
            <div className="inline-empty">至少添加一张 PNG 贴图。</div>
          )}
          {entry.Textures.length > 0 && (
            <Field
              label="默认贴图"
              hint="所选贴图会排到 skinid 0，皮肤变体编号同步调整。已有 NPC 的皮肤编号会沿用新顺序。"
            >
              <Select
                value={0}
                options={entry.Textures.map((texture, i) => ({
                  value: i,
                  label: `${i} · ${texture.Name || basename(texture.Path)}`,
                }))}
                onChange={(index) =>
                  setEntry((previous) => setDefaultTexture(previous, index))
                }
              />
            </Field>
          )}
          {entry.Textures.map((texture, i) => (
            <div className="resource-row" key={`${i}-${texture.Path}`}>
              <span className="index-badge">{i}</span>
              <LocalImage
                path={texture.Path}
                thumbnail
                className="resource-thumbnail"
              />
              <input
                aria-label={`贴图 ${i} 名称`}
                value={texture.Name}
                placeholder="名称"
                onChange={(e) =>
                  setEntry((previous) =>
                    renameTexture(previous, i, e.target.value),
                  )
                }
              />
              <span className="file-label" title={texture.Path}>
                {basename(texture.Path)}
              </span>
              <Button
                icon="trash"
                aria-label={`移除贴图 ${i}`}
                onClick={() =>
                  setEntry((previous) => removeTexture(previous, i))
                }
              />
            </div>
          ))}
          <div className="subheading separated">
            <div>
              <h3>皮肤变体</h3>
              <p>
                指定出现在 NPC
                皮肤列表中的贴图编号、名称与作者；删除贴图时会同步调整变体编号。
              </p>
            </div>
            <Button
              icon="plus"
              disabled={nextSkinId(entry) < 0}
              onClick={() =>
                update("SkinList", [
                  ...entry.SkinList,
                  { SkinId: nextSkinId(entry), Name: "", By: "Minecraft" },
                ])
              }
            >
              添加变体
            </Button>
            <Button
              disabled={nextSkinId(entry) < 0}
              onClick={() => setEntry((previous) => fillSkinVariants(previous))}
            >
              补齐贴图变体
            </Button>
          </div>
          {entry.SkinList.map((skin, i) => (
            <div className="variant-row" key={i}>
              <Field label="skinid" {...validation.field(`SkinId${i}`)}>
                <input
                  type="number"
                  min="0"
                  value={skin.SkinId}
                  onChange={(e) =>
                    update(
                      "SkinList",
                      entry.SkinList.map((x, j) =>
                        i === j
                          ? {
                              ...x,
                              SkinId:
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </Field>
              {["Name", "By"].map((k) => (
                <Field key={k} label={k === "Name" ? "名称" : "作者"}>
                  <input
                    value={skin[k]}
                    onChange={(e) =>
                      update(
                        "SkinList",
                        entry.SkinList.map((x, j) =>
                          i === j ? { ...x, [k]: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
              <Button
                icon="trash"
                aria-label={`移除变体 ${i}`}
                onClick={() =>
                  update(
                    "SkinList",
                    entry.SkinList.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
        </>
      )}
      {tab === "animations" && (
        <>
          <div className="subheading">
            <div>
              <h3>动画资源文件</h3>
              <p>
                选中的动画 JSON 会随拓展包一并导出；拖入时请使用 .animation.json
                或 .animations.json 后缀。
              </p>
            </div>
            <Button icon="plus" onClick={() => files("animation")}>
              添加文件
            </Button>
          </div>
          {entry.AnimationFiles.map((file, i) => (
            <div className="resource-row" key={file}>
              <span className="file-label" title={file}>
                {basename(file)}
              </span>
              <Button
                icon="trash"
                aria-label={`移除动画 ${i}`}
                onClick={() =>
                  update(
                    "AnimationFiles",
                    entry.AnimationFiles.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
          <h3 className="separated">实体动画</h3>
          <ErrorBox>{catalog.error}</ErrorBox>
          {catalog.loading && <p className="muted">正在读取动画文件…</p>}
          <div className="form-grid">
            {ENTITY_ANIMATIONS.map(([key, label, hint]) => (
              <Field key={key} label={label} hint={hint}>
                <Select
                  value={entry[key]}
                  disabled={catalog.loading || !!catalog.error}
                  options={animationOptions(
                    catalog.animations,
                    entry[key],
                    hint,
                  )}
                  onChange={(value) => update(key, value)}
                />
              </Field>
            ))}
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={syncAnimationList}
              onChange={(event) => {
                update("AnimationList", saveEntry.AnimationList);
                setSyncAnimationList(event.target.checked);
              }}
            />
            跟随动画文件更新可选列表
          </label>
          {!syncAnimationList && (
            <Field
              label="当前保留的可选动画列表"
              hint="保留原列表的顺序、手工筛选和内置动画引用。勾选上方开关后，保存时将使用文件中的全部动画 ID。"
            >
              <p className="code">
                {entry.AnimationList.join("、") || "（空列表）"}
              </p>
            </Field>
          )}
          <Field
            label="可选动画列表"
            {...validation.field("AnimationList")}
            hint={
              syncAnimationList
                ? "自动汇总已导入动画文件中的动画 ID，导出为 NPC 可选动画列表。"
                : "以下是文件中的全部动画，供实体动画下拉框选择；保存时保留上方的原列表。"
            }
          >
            <div
              className="model-animation-catalog"
              role="list"
              aria-label="动画文件中的动画列表"
            >
              {!catalog.loading && !catalog.animations.length && (
                <p className="muted">
                  尚未导入动画文件；实体动画可使用默认或 pass。
                </p>
              )}
              {catalog.animations.map((animation) => (
                <div role="listitem" key={animation.id}>
                  <span className="code">{animation.id}</span>
                  <small className="muted">{basename(animation.file)}</small>
                </div>
              ))}
            </div>
          </Field>
        </>
      )}
    </Modal>
  );
}
