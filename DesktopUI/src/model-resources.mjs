export function addTextures(entry, textures) {
  if (entry.Textures.length + textures.length > 64)
    throw new Error("单个模型最多支持 64 张贴图");
  return {
    ...entry,
    Textures: [...entry.Textures, ...textures],
    SkinList: [
      ...entry.SkinList,
      ...textures.map((texture, index) => ({
        SkinId: entry.Textures.length + index,
        Name: texture.Name,
        By: "",
      })),
    ],
  };
}

export function fillSkinVariants(entry) {
  const used = new Set(entry.SkinList.map((skin) => skin.SkinId));
  return {
    ...entry,
    SkinList: [
      ...entry.SkinList,
      ...entry.Textures.flatMap((texture, index) =>
        used.has(index)
          ? []
          : [
              {
                SkinId: index,
                Name: texture.Name,
                By: "",
              },
            ],
      ),
    ],
  };
}

export function renameTexture(entry, index, name) {
  const previousName = entry.Textures[index].Name;
  return {
    ...entry,
    Textures: entry.Textures.map((texture, i) =>
      i === index ? { ...texture, Name: name } : texture,
    ),
    SkinList: entry.SkinList.map((skin) =>
      skin.SkinId === index && skin.Name === previousName
        ? { ...skin, Name: name }
        : skin,
    ),
  };
}

export function setDefaultTexture(entry, index) {
  if (!Number.isInteger(index) || index < 0 || index >= entry.Textures.length)
    throw new Error("默认贴图编号无效");
  if (index === 0) return entry;
  // NPC spawn initializes skin_id to 0; reorder resources and their variant references together.
  return {
    ...entry,
    Textures: [
      entry.Textures[index],
      ...entry.Textures.filter((_, i) => i !== index),
    ],
    SkinList: entry.SkinList.map((skin) => {
      if (
        !Number.isInteger(skin.SkinId) ||
        skin.SkinId < 0 ||
        skin.SkinId >= entry.Textures.length
      )
        return skin;
      return {
        ...skin,
        SkinId:
          skin.SkinId === index
            ? 0
            : skin.SkinId < index
              ? skin.SkinId + 1
              : skin.SkinId,
      };
    }),
  };
}

export function removeTexture(entry, index) {
  return {
    ...entry,
    Textures: entry.Textures.filter((_, i) => i !== index),
    SkinList: entry.SkinList.filter((skin) => skin.SkinId !== index).map(
      (skin) => ({
        ...skin,
        SkinId: skin.SkinId > index ? skin.SkinId - 1 : skin.SkinId,
      }),
    ),
  };
}

export function nextSkinId(entry) {
  const used = new Set(entry.SkinList.map((skin) => skin.SkinId));
  return entry.Textures.findIndex((_, i) => !used.has(i));
}
