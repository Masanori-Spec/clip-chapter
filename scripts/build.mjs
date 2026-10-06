import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const mlt = await readFile(
  "test/fixtures/shotcut-26.9.27-authored.mlt",
  "utf8",
);
const chapters = {
  format: { start_time: "0", filename: "source.mkv" },
  streams: [{ start_time: "0" }],
  chapters: [30, 90, 156, 240, 269, 270].map((start, i) => ({
    start,
    time_base: "1/30",
    tags: {
      title: [
        "Before trim",
        "Chapter A",
        "Chapter B",
        "Chapter C",
        "Last included",
        "After trim",
      ][i],
    },
  })),
};
const license = await readFile("node_modules/@xmldom/xmldom/LICENSE", "utf8");
const notice =
  "The offline HTML includes @xmldom/xmldom 0.9.12. This notice applies only to that dependency, not original ClipChapter code or fixtures.\n\n" +
  license;
await writeFile("THIRD_PARTY_NOTICES.txt", notice);
await writeFile(
  "src/sample.mjs",
  "// Original synthetic example, with exact official GUI-authored MLT. No license grant.\nexport const SAMPLE_MLT=" +
    JSON.stringify(mlt) +
    ";\nexport const SAMPLE_CHAPTERS=" +
    JSON.stringify(chapters) +
    ";\nexport const THIRD_PARTY=" +
    JSON.stringify(notice) +
    ";\n",
);
const bundle = await build({
  entryPoints: ["web/app.mjs"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome110", "firefox115", "safari16"],
  write: false,
  minify: false,
  legalComments: "inline",
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"),
  css = await readFile("web/styles.css", "utf8");
let html = await readFile("web/index.html", "utf8");
html = html
  .replace(
    /<link rel="stylesheet" href="styles\.css"\s*\/?\s*>/,
    () => "<style>" + css + "</style>",
  )
  .replace(
    '<script src="app.js"></script>',
    () => "<script>" + js + "</script>",
  );
if (/href="styles\.css"|src="app\.js"/.test(html)) throw Error("Offline template was not fully bundled");
await mkdir("dist", { recursive: true });
await writeFile("dist/clip-chapter.html", html);
console.log(`Built offline HTML: ${Buffer.byteLength(html)} bytes`);
