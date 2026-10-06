import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
const sourcemap = process.argv.includes("--sourcemap");
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  outfile: "dist/app.js",
  platform: "browser",
  target: "chrome142",
  jsx: "automatic",
  sourcemap,
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!sourcemap) {
  // Remove only these generated maps, including leftovers from a debug build.
  await rm("dist/app.js.map", { force: true });
  await rm("dist/app.css.map", { force: true });
}
await copyFile("src/index.html", "dist/index.html");
await copyFile("assets/icon.ico", "dist/icon.ico");
