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
