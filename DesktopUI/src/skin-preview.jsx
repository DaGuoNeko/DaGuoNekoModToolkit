import React, { useEffect, useRef, useState } from "react";
import { SkinViewer } from "skinview3d";
import { Button, ErrorBox, Field, LocalImage, Modal, Select } from "./ui.jsx";

export const skinId = (skin) => (skin.FromImport ? skin.OriginalId : skin.Id);

export function SkinTargetFields({
  targets,
  value,
  slot,
  onChange,
  onSlotChange,
  validation,
}) {
  const [custom, setCustom] = useState(
    !!value && !targets.some((t) => t.identifier === value),
  );
  const options = [
    { value: "", label: "通用人型皮肤（Steve / Alex）" },
    ...targets.map((t) => ({
      value: t.identifier,
      label: `${t.name} · ${t.identifier}`,
    })),
    { value: "__custom", label: "填写自定义模型 ID…" },
  ];
  return (
    <>
      <Field label="目标模型" hint="目标模型需已安装；NPC皮肤拓展包不会创建模型。">
        <Select
          value={custom ? "__custom" : value}
          options={options}
          onChange={(choice) => {
            setCustom(choice === "__custom");
            onChange(choice === "__custom" ? "customnpc:" : choice);
            onSlotChange(
              choice === "__custom"
                ? "default"
                : targets.find((t) => t.identifier === choice)?.texture_slot ||
                    "skin_4",
            );
          }}
        />
      </Field>
      {custom && (
        <Field
          label="自定义模型 ID"
          hint="例如 customnpc:forest_guard_dlcnpc"
          {...validation.field("target")}
        >
          <input
            value={value}
            maxLength={160}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      )}
      {!!value && (
        <Field
          label="贴图槽位"
          {...validation.field("slot")}
          hint="默认为模型主贴图槽位；多贴图模型可填写实际槽位，例如 default、wea。"
        >
          <input
            value={slot}
            maxLength={80}
            onChange={(e) => onSlotChange(e.target.value)}
          />
        </Field>
      )}
    </>
  );
}

function HumanPreview({ skin }) {
  const canvas = useRef(null),
    host = useRef(null);
  const [model, setModel] = useState("auto-detect"),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true,
      viewer,
      observer;
    setReady(false);
    setError("");
    async function load() {
      try {
        const source = await window.toolkit.call("image.read", {
          path: skin.TexturePath,
        });
        if (!alive) return;
        viewer = new SkinViewer({
          canvas: canvas.current,
          width: 400,
          height: 380,
          preserveDrawingBuffer: true,
          pixelRatio: Math.min(devicePixelRatio, 2),
        });
        viewer.autoRotate = true;
        viewer.playerObject.rotation.y = Math.PI / 6;
        observer = new ResizeObserver(() => {
          if (alive && host.current) {
            viewer.setSize(host.current.clientWidth, 380);
            viewer.render();
          }
        });
        observer.observe(host.current);
        await viewer.loadSkin(source, { model });
        if (alive) {
          viewer.render();
          setReady(true);
        }
      } catch (e) {
        if (alive)
          setError(`3D 预览加载失败：${e.message}。可以切换到原始贴图查看。`);
      }
    }
    load();
    return () => {
      alive = false;
      observer?.disconnect();
      viewer?.dispose();
    };
  }, [skin.TexturePath, model]);
  return (
    <>
      <Field label="预览手臂模型">
        <Select
          value={model}
          onChange={setModel}
          options={[
            { value: "auto-detect", label: "自动识别" },
            { value: "default", label: "Steve（宽手臂）" },
            { value: "slim", label: "Alex（细手臂）" },
          ]}
        />
      </Field>
      <ErrorBox>{error}</ErrorBox>
      <div ref={host} className="skin-3d-host" data-ready={ready}>
        <canvas ref={canvas} aria-label="皮肤 3D 预览" />
        {!ready && !error && (
          <span className="preview-loading">正在加载 3D 皮肤…</span>
        )}
      </div>
      <p className="muted">
        拖动可旋转，滚轮可缩放。预览展示标准人型外观，游戏中的模型与动作以实际加载资源为准。
      </p>
    </>
  );
}

export function SkinPreview({ skin, targets, onClose }) {
  const human =
    !skin.TargetIdentifier ||
    targets.some((t) => t.identifier === skin.TargetIdentifier && t.human);
  const [mode, setMode] = useState(human ? "3d" : "texture");
  return (
    <Modal
      title={skin.Name}
      description={`作者：${skin.Author} · ID：${skinId(skin)}`}
      onClose={onClose}
      footer={
        <Button primary onClick={onClose}>
          关闭
        </Button>
      }
    >
      {human && (
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "3d"}
            onClick={() => setMode("3d")}
          >
            3D 预览
          </button>
          <button
            role="tab"
            aria-selected={mode === "texture"}
            onClick={() => setMode("texture")}
          >
            原始贴图
          </button>
        </div>
      )}
      {mode === "3d" ? (
        <HumanPreview skin={skin} />
      ) : (
        <div className="skin-preview">
          <LocalImage path={skin.TexturePath} alt={skin.Name} />
        </div>
      )}
      {!human && (
        <p className="muted">
          目标模型：{skin.TargetIdentifier}，贴图槽位：{skin.TextureSlot}
          。这类贴图需要对应 geometry，当前展示原始贴图。
        </p>
      )}
    </Modal>
  );
}
