import { addTextures } from "./model-resources.mjs";

const extension = (file) =>
  file.split(/[\\/]/).pop().split(".").pop().toLowerCase();

export function planDrop(files, page) {
  if (!files.length) throw new Error("请拖入本地文件");
  const archive = files.find((file) =>
    ["zip", "dgnproject"].includes(extension(file)),
  );
  if (archive) {
    if (files.length !== 1)
      throw new Error("每次只能拖入一个 ZIP 或工程文件，请勿与其他素材混放");
    return {
      type: extension(archive) === "zip" ? "archive" : "project",
      path: archive,
    };
  }
  const allowed = {
    skins: ["png"],
    textures: ["png"],
    sounds: ["ogg"],
    models: ["png", "json"],
  }[page];
  if (!allowed || files.some((file) => !allowed.includes(extension(file))))
    throw new Error(
      page === "sounds"
        ? "音效页面支持 OGG Vorbis、ZIP 和工程文件"
        : page === "models"
          ? "模型页面支持模型 JSON、动画 JSON、PNG、ZIP 和工程文件"
          : "此页面支持 PNG、ZIP 和工程文件",
    );
  return { type: "resources", paths: files };
}

export function mergeModelFiles(entry, files) {
  const plan = planDrop(files, "models");
  if (plan.type !== "resources")
    throw new Error("请先关闭模型编辑窗口，再拖入 ZIP 或工程");
  const animations = files.filter((file) => /\.animations?\.json$/i.test(file));
  const geometry = files.filter(
    (file) => /\.json$/i.test(file) && !animations.includes(file),
  );
  if (geometry.length > 1)
    throw new Error(
      "一次只能添加一个模型 JSON；动画文件请使用 .animation.json 或 .animations.json 后缀",
    );
  const textures = files.filter((file) => /\.png$/i.test(file));
  const existing = new Set(
    entry.Textures.map((item) => item.Path.toLowerCase()),
  );
  const additions = textures
    .filter((file) => !existing.has(file.toLowerCase()))
    .map((Path) => ({
      Path,
      Name: Path.split(/[\\/]/)
        .pop()
        .replace(/\.png$/i, ""),
    }));
  const next = {
    ...addTextures(entry, additions),
    AnimationFiles: [...new Set([...entry.AnimationFiles, ...animations])],
  };
  if (geometry.length) {
    next.GeoPath = geometry[0];
    const name = geometry[0]
      .split(/[\\/]/)
      .pop()
      .replace(/(?:\.geo)?\.json$/i, "");
    if (!next.DisplayName) next.DisplayName = name;
    if (
      !next.CustomName &&
      /^[a-z][a-z0-9_]*$/.test(name) &&
      !name.endsWith("_dlcnpc")
    )
      next.CustomName = name;
  }
  return next;
}
