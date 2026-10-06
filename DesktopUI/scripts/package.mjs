import { packager } from "@electron/packager";
import { existsSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
const outputRoot = path.resolve("release");
const electronZipDir = existsSync(
  "node_modules/.cache/electron-v44.5.1-win32-x64.zip",
)
  ? "node_modules/.cache"
  : undefined;
const outputs = await packager({
  dir: ".",
  name: "DaGuoNeko-Mod-Toolkit",
  platform: "win32",
  arch: "x64",
  out: outputRoot,
  overwrite: true,
  asar: true,
  electronZipDir,
  icon: "assets/icon.ico",
  executableName: "DaGuoNeko-Mod-Toolkit",
  win32metadata: {
    ProductName: "大果喵模组工具箱",
    FileDescription: "DaGuoNeko Mod Toolkit",
    CompanyName: "DaGuoNeko",
  },
  ignore: [
    /^\/backend/,
    /^\/assets/,
    /^\/src/,
    /^\/scripts/,
    /^\/tests/,
    /^\/release/,
    /^\/test-results/,
    /^\/node_modules/,
    /\.map$/,
  ],
  extraResource: ["backend/bin/Release/net48"],
});
for (const output of outputs) {
  const directory = path.resolve(output);
  const relative = path.relative(outputRoot, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Refusing to trim outside the package output directory");
  // Preserve Chromium's English fallback and the application's Simplified Chinese locale.
  const locales = path.join(directory, "locales");
  for (const entry of await readdir(locales, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name.endsWith(".pak") &&
      !["zh-CN.pak", "en-US.pak"].includes(entry.name)
    )
      await unlink(path.join(locales, entry.name));
  }
  const pdb = path.join(directory, "resources/net48/NpcSkinMaker.Backend.pdb");
  if (existsSync(pdb)) await unlink(pdb);
  console.log(directory);
}
