export const required = (value) =>
  String(value ?? "").trim() ? "" : "此项不能为空";

export function identifier(value, optional = false, maxLength = 80) {
  if (optional && !String(value ?? "").trim()) return "";
  return typeof value === "string" &&
    value.length <= maxLength &&
    value.match(/^[a-z][a-z0-9_]*/)?.[0] === value
    ? ""
    : `以小写字母开头，仅含小写字母、数字、下划线${Number.isFinite(maxLength) ? `，最多 ${maxLength} 字符` : ""}`;
}

export function numberRange(
  value,
  min,
  max = Infinity,
  exclusiveMin = false,
  integer = false,
) {
  const number = Number(value);
  if (required(value) || !Number.isFinite(number)) return "请输入有效数字";
  if (integer && !Number.isSafeInteger(number)) return "请输入整数";
  if (exclusiveMin ? number <= min : number < min)
    return `必须${exclusiveMin ? "大于" : "大于或等于"} ${min}`;
  return number > max ? `不能超过 ${max}` : "";
}

export function packVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(value) &&
    !/[\r\n]/.test(value) &&
    value.split(".").every((part) => Number(part) <= 2147483647)
    ? ""
    : "请填写三个非负整数，例如 1.0.0，每段不超过 2147483647";
}

export function skinTargetErrors(target, slot) {
  const id = target.trim(),
    textureSlot = slot.trim();
  return {
    target:
      !id || (id.length <= 160 && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id))
        ? ""
        : "请填写 namespace:identifier 格式的模型 ID",
    slot:
      !textureSlot ||
      (textureSlot.length <= 80 && /^[a-zA-Z0-9_.-]+$/.test(textureSlot))
        ? ""
        : "仅含字母、数字、下划线、点和短横线，最多 80 字符",
  };
}

export function modelErrors(entry, models = [], index) {
  const nameError =
    required(entry.CustomName) ||
    identifier(entry.CustomName, false, Infinity) ||
    (entry.CustomName.endsWith("_dlcnpc") ? "无需填写 _dlcnpc 后缀" : "") ||
    (models.some(
      (item, i) =>
        i !== index &&
        item.CustomName.toLowerCase() === entry.CustomName.toLowerCase(),
    )
      ? "自定义模型 ID 已存在"
      : "");
  const errors = {
    DisplayName: required(entry.DisplayName),
    CustomName: nameError,
    CollisionWidth: numberRange(entry.CollisionWidth, 0, Infinity, true),
    CollisionHeight: numberRange(entry.CollisionHeight, 0, Infinity, true),
    GeoPath: required(entry.GeoPath) ? "请选择模型文件" : "",
  };
  entry.SkinList.forEach((skin, i) => {
    errors[`SkinId${i}`] =
      numberRange(skin.SkinId, 0, entry.Textures.length - 1, false, true) ||
      (entry.SkinList.some(
        (other, j) => i !== j && Number(other.SkinId) === Number(skin.SkinId),
      )
        ? "贴图编号不能重复"
        : "");
  });
  const animationIds = entry.AnimationList.map((value) => value.trim()).filter(
    Boolean,
  );
  errors.AnimationList =
    new Set(animationIds).size !== animationIds.length
      ? "动画 ID 不能重复"
      : "";
  return errors;
}

export function toolErrors(kind, input) {
  const line = (value) =>
    /[\r\n\0]/.test(value) || value.length > 4096
      ? "请输入单行文本，最多 4096 字符"
      : "";
  const name = (value) =>
    line(value) ||
    (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value.trim())
      ? ""
      : "以字母开头，仅含字母、数字和下划线");
  if (kind === "mod")
    return {
      name:
        name(input.name) ||
        (input.name.trim() === "custom_warehouse" ? "请使用其他模组名称" : ""),
    };
  return {
    namespace: name(input.namespace),
    prefix: name(input.prefix),
    name: line(input.name),
    tab: input.tab ? line(input.tab) : "",
    start: numberRange(input.start, 0, Number.MAX_SAFE_INTEGER, false, true),
    end:
      numberRange(input.end, 0, Number.MAX_SAFE_INTEGER, false, true) ||
      (Number(input.end) < Number(input.start)
        ? "结束序号不能小于起始序号"
        : "") ||
      (Number(input.end) - Number(input.start) > 10000
        ? "单次最多生成 10001 项"
        : ""),
    ...(input.type === 1
      ? {
          stackSize: numberRange(
            input.stackSize,
            1,
            Number.MAX_SAFE_INTEGER,
            false,
            true,
          ),
        }
      : {
          durability: numberRange(
            input.durability,
            1,
            Number.MAX_SAFE_INTEGER,
            false,
            true,
          ),
          damage: numberRange(
            input.damage,
            0,
            Number.MAX_SAFE_INTEGER,
            false,
            true,
          ),
          ...(input.type === 4
            ? {
                level: numberRange(
                  input.level,
                  0,
                  Number.MAX_SAFE_INTEGER,
                  false,
                  true,
                ),
              }
            : {}),
        }),
  };
}
