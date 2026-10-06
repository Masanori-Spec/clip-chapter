import { readFile, writeFile } from "node:fs/promises";
import {
  inspectProject,
  parseFFprobe,
  addChapterMarkers,
} from "../src/core.mjs";
const bytes = new Uint8Array(await readFile("artifacts/native/authored.mlt"));
const project = inspectProject(bytes);
const expected = JSON.parse(await readFile("test/expected-gui.json", "utf8"));
if (project.profile.num !== "30" || project.profile.den !== "1")
  throw Error("Official authored fixture must be30fps");
const media = project.occurrences.filter((o) =>
  o.resource.endsWith("source.mkv"),
);
if (media.length !== 2)
  throw Error(
    "Official authored fixture must have exactly two media occurrences",
  );
for (const [i, e] of expected.occurrences.entries())
  for (const key of ["sourceIn", "sourceOut", "timelineStart"])
    if (media[i][key] !== e[key])
      throw Error(
        `Official authored occurrence ${i} ${key} mismatch: ${media[i][key]}`,
      );
const target = media.find(
  (o) => o.sourceIn === 90 && o.sourceOut === 269 && o.timelineStart === 300,
);
const result = addChapterMarkers(
  bytes,
  parseFFprobe(await readFile("artifacts/native/chapters.json", "utf8")),
  target.id,
);
await writeFile("artifacts/native/patched.mlt", result.output);
await writeFile(
  "artifacts/native/receipt.json",
  JSON.stringify(result.receipt, null, 2) + "\n",
);
const text = new TextDecoder().decode(result.output);
const needle = '<property name="text">Chapter B</property>';
const at = text.indexOf(needle);
if (at < 0) throw Error("Missing negative-control target");
const end = text.indexOf("</properties>", at);
const part = text.slice(at, end).replaceAll("00:00:12.200", "00:00:12.233");
if (part === text.slice(at, end))
  throw Error("Negative-control shift was not applied");
await writeFile(
  "artifacts/native/shifted.mlt",
  text.slice(0, at) + part + text.slice(end),
);
console.log(
  "Mapped selected occurrence into marker-only patched copy and one-frame-shifted negative control",
);
