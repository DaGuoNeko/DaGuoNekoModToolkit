import React, { useState } from "react";
import { removeTexture, nextSkinId } from "./model-resources.mjs";
import { SkinTargetFields } from "./skin-preview.jsx";
import {
  Button,
  Field,
  Modal,
  ErrorBox,
  PathField,
  LocalImage,
  basename,
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
  async function submit(e) {
    e?.preventDefault();
    if (!author.trim() || items.some((i) => !i.name.trim())) {
      setError("请填写人物名称和作者");
      return;
    }
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
        <Field label={items.length > 1 ? "统一作者" : "作者"}>
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
  async function save() {
    if (single && (!name.trim() || !author.trim())) {
      setError("名称和作者不能为空");
      return;
    }
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
          targets={targets}
          value={targetIdentifier}
          slot={textureSlot}
          onChange={setTarget}
          onSlotChange={setSlot}
        />
      )}
      <Field label="人物名称">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="作者">
        <input value={author} onChange={(e) => setAuthor(e.target.value)} />
      </Field>
    </Modal>
  );
}

export const blankModel = () => ({
  DisplayName: "",
  CustomName: "",
  SourceLabel: "原版",
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
export function ModelEditor({ model, index, onClose, onSave }) {
  const [entry, setEntry] = useState(() =>
    structuredClone(model || blankModel()),
  );
  const [tab, setTab] = useState("basic"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const update = (key, value) =>
    setEntry((previous) => ({ ...previous, [key]: value }));
  async function files(kind) {
    try {
      const chosen = await window.toolkit.call("files.pick", {
        kind,
        multiple: true,
      });
      if (kind === "texture")
        update("Textures", [
          ...entry.Textures,
          ...chosen.map((Path) => ({
            Name: basename(Path).replace(/\.png$/i, ""),
            Path,
          })),
        ]);
      else
        update("AnimationFiles", [
          ...new Set([...entry.AnimationFiles, ...chosen]),
        ]);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave({ entry, index });
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
          <Field label="显示名称 *">
            <input
              autoFocus
              placeholder="例如：森林守卫"
              value={entry.DisplayName}
              onChange={(e) => update("DisplayName", e.target.value)}
            />
          </Field>
          <Field
            label="自定义名称 *"
            hint="小写字母开头，仅限字母、数字和下划线；新模型不能与 NPC 内置模型重名"
          >
            <input
              placeholder="例如：forest_guard"
              value={entry.CustomName}
              onChange={(e) => update("CustomName", e.target.value)}
            />
          </Field>
          <Field label="来源标注">
            <input
              value={entry.SourceLabel}
              onChange={(e) => update("SourceLabel", e.target.value)}
            />
          </Field>
          <div className="two-fields">
            <Field label="碰撞箱宽度">
              <input
                type="number"
                min="0.01"
                step="0.1"
                value={entry.CollisionWidth}
                onChange={(e) =>
                  update(
                    "CollisionWidth",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </Field>
            <Field label="碰撞箱高度">
              <input
                type="number"
                min="0.01"
                step="0.1"
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
                  update(
                    "Textures",
                    entry.Textures.map((t, j) =>
                      j === i ? { ...t, Name: e.target.value } : t,
                    ),
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
          </div>
          {entry.SkinList.map((skin, i) => (
            <div className="variant-row" key={i}>
              <Field label="skinid">
                <input
                  type="number"
                  min="0"
                  value={skin.SkinId}
                  onChange={(e) =>
                    update(
                      "SkinList",
                      entry.SkinList.map((x, j) =>
                        i === j ? { ...x, SkinId: Number(e.target.value) } : x,
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
              <p>选中的动画 JSON 会随拓展包一并导出。</p>
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
          <div className="form-grid">
            {[
              ["IdleAnimation", "idle", "默认 pass"],
              ["WalkAnimation", "walk", "默认同 idle"],
              ["WalkaAnimation", "walka", "默认同 walk"],
              ["AttackAnimation", "attack", "默认 pass"],
              ["DeathAnimation", "death", "默认死亡动画"],
            ].map(([key, label, hint]) => (
              <Field key={key} label={label}>
                <input
                  value={entry[key]}
                  placeholder={hint}
                  onChange={(e) => update(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <Field
            label="可选动画列表"
            hint="每行填写一个动画 ID，用于 NPC 动画选择列表"
          >
            <textarea
              rows="4"
              value={entry.AnimationList.join("\n")}
              onChange={(e) =>
                update("AnimationList", e.target.value.split("\n"))
              }
              onBlur={() =>
                update(
                  "AnimationList",
                  entry.AnimationList.map((x) => x.trim()).filter(Boolean),
                )
              }
            />
          </Field>
        </>
      )}
    </Modal>
  );
}
