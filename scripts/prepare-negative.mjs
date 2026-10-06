// Fault injection into the actual downloaded MLT, without replacing its content.
import { readFile, writeFile } from "node:fs/promises";
const text = await readFile("artifacts/native/patched.mlt", "utf8");
const needle = '<property name="text">Chapter B</property>',
  at = text.indexOf(needle);
if (at < 0 || text.indexOf(needle, at + 1) >= 0)
  throw Error("Missing or ambiguous negative target");
const end = text.indexOf("</properties>", at),
  original = text.slice(at, end);
const part = original.replaceAll("00:00:12.200", "00:00:12.233");
if (part === original) throw Error("One-frame negative fault was not applied");
await writeFile(
  "artifacts/native/shifted.mlt",
  text.slice(0, at) + part + text.slice(end),
);
