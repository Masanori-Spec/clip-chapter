import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inspectProject,
  parseFFprobe,
  parseCSV,
  addChapterMarkers,
  ChapterError,
} from "../src/core.mjs";
const enc = (text) => new TextEncoder().encode(text);
function fixture(extra = "") {
  return `<?xml version="1.0" encoding="utf-8"?>\n<mlt><profile frame_rate_num="30" frame_rate_den="1"/><chain id="source"><property name="mlt_service">avformat</property><property name="shotcut:producer">avformat</property><property name="resource">source.mkv</property>${extra}</chain><playlist id="v1"><entry producer="source" in="0" out="299"/><entry producer="source" in="90" out="269"/></playlist><tractor id="timeline" in="0" out="479"><property name="shotcut">1</property><properties name="shotcut:markers"><properties name="0"><property name="text">Baseline</property><property name="start">00:00:01.000</property><property name="end">00:00:01.000</property><property name="color">#00FF00</property></properties></properties><track producer="v1"/></tractor></mlt>`;
}
const data = () =>
  parseFFprobe(
    JSON.stringify({
      format: { start_time: "0.000000", filename: "source.mkv" },
      streams: [{ start_time: "0.000000" }],
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
    }),
  );
const code = (wanted) => (error) =>
  error instanceof ChapterError && error.code === wanted;
function stripMarkers(text) {
  return text.replace(
    /<properties name="shotcut:markers">[\s\S]*?<\/properties>\s*<\/properties>/,
    "MARKERS",
  );
}

test("exact selected occurrence mapping and trim exclusions", () => {
  const bytes = enc(fixture());
  const project = inspectProject(bytes);
  assert.deepEqual(
    project.occurrences.map((o) => [o.sourceIn, o.sourceOut, o.timelineStart]),
    [
      [0, 299, 0],
      [90, 269, 300],
    ],
  );
  const result = addChapterMarkers(bytes, data(), "0:1");
  assert.deepEqual(
    result.receipt.included.map((m) => m.frame),
    [300, 366, 450, 479],
  );
  assert.deepEqual(
    result.receipt.excluded.map((m) => m.title),
    ["Before trim", "After trim"],
  );
  assert.equal(result.receipt.existingMarkers[0].start, 30);
  assert.equal(
    stripMarkers(new TextDecoder().decode(result.output)),
    stripMarkers(fixture()),
  );
});
test("first occurrence is distinct and must be explicitly selected", () => {
  assert.throws(
    () => addChapterMarkers(enc(fixture()), data(), "source"),
    code("OCCURRENCE"),
  );
  const result = addChapterMarkers(enc(fixture()), data(), "0:0");
  assert.deepEqual(
    result.receipt.included.map((m) => m.frame),
    [30, 90, 156, 240, 269, 270],
  );
});
test("native clock MLT timing, BOM and CRLF outside marker bytes are preserved", () => {
  const source =
    "\ufeff" +
    fixture()
      .replaceAll("\n", "\r\n")
      .replace('in="90" out="269"', 'in="00:00:03.000" out="00:00:08.967"');
  const out = addChapterMarkers(enc(source), data(), "0:1");
  assert.equal(out.output[0], 0xef);
  assert.deepEqual(
    out.receipt.included.map((m) => m.frame),
    [300, 366, 450, 479],
  );
  assert.equal(
    stripMarkers(
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(out.output),
    ),
    stripMarkers(source),
  );
});
test("chapter label XML escaping never rewrites media references", () => {
  const input = parseCSV('source_seconds,title\n3,"A & <B>"', {
    sourceOriginSeconds: "0",
  });
  const out = addChapterMarkers(enc(fixture()), input, "0:1");
  const text = new TextDecoder().decode(out.output);
  assert.ok(text.includes("A &amp; &lt;B&gt;"));
  assert.ok(text.includes('<property name="resource">source.mkv</property>'));
});
test("fractional chapters report exact quantization; upper rounding cannot leave clip", () => {
  const input = parseCSV(
    "source_seconds,title\n3.01,Round down\n3.02,Round up\n8.999,Outside after rounding",
    { sourceOriginSeconds: "0" },
  );
  const out = addChapterMarkers(enc(fixture()), input, "0:1");
  assert.deepEqual(
    out.receipt.included.map((m) => m.frame),
    [300, 301],
  );
  assert.deepEqual(
    out.receipt.included.map((m) => m.quantizationFrames),
    ["-3/10", "2/5"],
  );
  assert.equal(
    out.receipt.excluded[0].reason,
    "quantization would leave selected clip",
  );
});
test("repeat import skips identical existing point markers", () => {
  const first = addChapterMarkers(enc(fixture()), data(), "0:1");
  assert.throws(
    () => addChapterMarkers(first.output, data(), "0:1"),
    code("NO_MARKERS"),
  );
});
for (const property of [
  "warp_speed",
  "shotcut:proxy",
  "shotcut:resource",
  "shotcut:originalIn",
])
  test(`reject timing/provenance property ${property}`, () => {
    assert.throws(
      () =>
        addChapterMarkers(
          enc(fixture(`<property name="${property}">1</property>`)),
          data(),
          "0:1",
        ),
      code("UNSUPPORTED_CLIP"),
    );
  });
test("ordinary shotcut:producer and disableProxy metadata remain valid", () => {
  const p = inspectProject(
    enc(fixture('<property name="shotcut:disableProxy">1</property>')),
  );
  assert.ok(p.occurrences.every((o) => o.supported));
});
test("retime links and reverse filters are rejected", () => {
  for (const tag of ["link", "filter"])
    assert.throws(
      () =>
        addChapterMarkers(
          enc(
            fixture(
              `<${tag}><property name="mlt_service">timeremap</property><property name="map">0=0</property></${tag}>`,
            ),
          ),
          data(),
          "0:1",
        ),
      code("UNSUPPORTED_CLIP"),
    );
});
test("missing source origin and nonzero format/stream origins fail", () => {
  assert.throws(
    () => parseCSV("source_seconds,title\n3,A"),
    code("SOURCE_ORIGIN"),
  );
  assert.throws(() => parseFFprobe('{"chapters":[]}'), code("SOURCE_ORIGIN"));
  assert.throws(
    () =>
      parseFFprobe(
        JSON.stringify({
          format: { start_time: "1" },
          chapters: [{ start: 0, time_base: "1/30", tags: { title: "A" } }],
        }),
      ),
    code("SOURCE_ORIGIN"),
  );
});
test("unsafe XML is rejected before writing", () => {
  for (const text of [
    "<!DOCTYPE mlt><mlt/>",
    "<mlt>\0</mlt>",
    "<mlt>&#0;</mlt>",
    "<mlt><broken></mlt>",
  ])
    assert.throws(() => inspectProject(enc(text)), ChapterError);
});
test("nested clip producer and reversed range are unsupported", () => {
  const nested = fixture()
    .replace('<chain id="source">', '<tractor id="source">')
    .replace("</chain>", "</tractor>");
  assert.throws(
    () => addChapterMarkers(enc(nested), data(), "0:1"),
    code("UNSUPPORTED_CLIP"),
  );
  assert.throws(
    () =>
      inspectProject(
        enc(fixture().replace('in="90" out="269"', 'in="269" out="90"')),
      ),
    code("INVALID_TRIM"),
  );
});
test("source resource and every non-marker byte are unchanged deterministically", () => {
  const a = addChapterMarkers(enc(fixture()), data(), "0:1"),
    b = addChapterMarkers(enc(fixture()), data(), "0:1");
  assert.deepEqual(a.output, b.output);
  assert.equal(
    stripMarkers(new TextDecoder().decode(a.output)),
    stripMarkers(fixture()),
  );
});

test("inserting the first marker container preserves every outside byte", () => {
  const source = fixture().replace(
    /<properties name="shotcut:markers">[\s\S]*?<\/properties><\/properties>/,
    "",
  );
  const out = addChapterMarkers(enc(source), data(), "0:1");
  const text = new TextDecoder().decode(out.output);
  assert.equal(stripMarkers(text).replace("MARKERS", ""), source);
});
test("self-closing marker container is expanded without changing surrounding bytes", () => {
  const source = fixture().replace(
    /<properties name="shotcut:markers">[\s\S]*?<\/properties><\/properties>/,
    '<properties name="shotcut:markers"/>',
  );
  const out = addChapterMarkers(enc(source), data(), "0:1");
  assert.equal(
    stripMarkers(new TextDecoder().decode(out.output)),
    source.replace('<properties name="shotcut:markers"/>', "MARKERS"),
  );
});
test("duplicate input chapter points are not silently doubled", () => {
  const input = parseCSV("source_seconds,title\n3,A\n3,A", {
    sourceOriginSeconds: "0",
  });
  const out = addChapterMarkers(enc(fixture()), input, "0:1");
  assert.equal(out.receipt.included.length, 1);
  assert.equal(out.receipt.excluded.length, 1);
});
test("CSV grammar and invalid XML title characters are rejected", () => {
  assert.throws(
    () =>
      parseCSV('source_seconds,title\n3,"A"junk', { sourceOriginSeconds: "0" }),
    code("INVALID_CSV"),
  );
  assert.throws(
    () =>
      parseCSV("source_seconds,title\n3,\ufffe", { sourceOriginSeconds: "0" }),
    code("INVALID_TITLE"),
  );
});
test("mismatched ffprobe media filename cannot target an unrelated occurrence", () => {
  const input = data();
  input.sourceFilename = "different.mkv";
  assert.throws(
    () => addChapterMarkers(enc(fixture()), input, "0:1"),
    code("SOURCE_MISMATCH"),
  );
});

test("oversized numerical fields and chapter counts reject before expensive arithmetic", () => {
  assert.throws(
    () =>
      parseCSV("source_seconds,title\n" + "9".repeat(1000) + ",A", {
        sourceOriginSeconds: "0",
      }),
    code("INVALID_TIME"),
  );
  const body = {
    format: { start_time: "0" },
    streams: [{ start_time: "0" }],
    chapters: Array(10001).fill({ start: 0, time_base: "1/30" }),
  };
  assert.throws(
    () => parseFFprobe(JSON.stringify(body)),
    code("CHAPTER_LIMIT"),
  );
});
test("ordinary global compositing is distinct from selected-range transitions", () => {
  const unsafe = fixture().replace(
    "</tractor>",
    '<transition in="300" out="350"><property name="mlt_service">luma</property></transition></tractor>',
  );
  assert.throws(
    () => addChapterMarkers(enc(unsafe), data(), "0:1"),
    code("UNSUPPORTED_CLIP"),
  );
  const safe = fixture().replace(
    "</tractor>",
    '<transition><property name="mlt_service">mix</property><property name="always_active">1</property></transition></tractor>',
  );
  assert.equal(
    addChapterMarkers(enc(safe), data(), "0:1").receipt.included.length,
    4,
  );
});

test("legacy reverse provenance and attribute-valued property guard bypasses reject", () => {
  assert.throws(
    () =>
      addChapterMarkers(
        enc(
          fixture(
            '<property name="shotcut:originalResource">original.mkv</property>',
          ),
        ),
        data(),
        "0:1",
      ),
    code("UNSUPPORTED_CLIP"),
  );
  assert.throws(
    () =>
      inspectProject(enc(fixture('<property name="warp_speed" value="2"/>'))),
    code("UNSUPPORTED_PROPERTY"),
  );
  assert.throws(
    () =>
      inspectProject(
        enc(fixture('<property name="warp_speed"><value>2</value></property>')),
      ),
    code("UNSUPPORTED_PROPERTY"),
  );
});
for (const resource of [
  "",
  "udp:source.mkv",
  "concat:part1|part2",
  "https:source.mkv",
  "file://server/source.mkv",
])
  test(`reject nonlocal or empty resource ${resource}`, () => {
    assert.throws(
      () =>
        addChapterMarkers(
          enc(
            fixture().replace(
              ">source.mkv</property>",
              `>${resource}</property>`,
            ),
          ),
          data(),
          "0:1",
        ),
      code("UNSUPPORTED_CLIP"),
    );
  });

test("alternate service attributes and cropped playlist origins are rejected", () => {
  assert.throws(
    () => inspectProject(enc(fixture('<filter mlt_service="timeremap"/>'))),
    code("UNSUPPORTED_SERVICE_FORM"),
  );
  for (const attrs of ['in="30"', 'out="299"'])
    assert.throws(
      () =>
        addChapterMarkers(
          enc(
            fixture().replace(
              '<playlist id="v1">',
              `<playlist id="v1" ${attrs}>`,
            ),
          ),
          data(),
          "0:1",
        ),
      code("UNSUPPORTED_CLIP"),
    );
});
test("timing transformations on selected ancestry are rejected", () => {
  for (const tag of ["filter", "link"]) {
    const project = fixture().replace(
      '<track producer="v1"/>',
      `<track producer="v1"/><${tag}><property name="mlt_service">timeremap</property><property name="map">0=1</property></${tag}>`,
    );
    assert.throws(
      () => addChapterMarkers(enc(project), data(), "0:1"),
      code("UNSUPPORTED_CLIP"),
    );
  }
});

test("output element cap rejects a ten-thousand-point overflow", () => {
  const input = parseCSV(
    "source_seconds,title\n" +
      Array.from({ length: 10000 }, (_, i) => `3,Point ${i}`).join("\n"),
    { sourceOriginSeconds: "0" },
  );
  assert.throws(
    () => addChapterMarkers(enc(fixture()), input, "0:1"),
    code("OUTPUT_LIMIT"),
  );
});
test("output byte cap counts escaped marker text", () => {
  const input = parseCSV(
    "source_seconds,title\n" +
      Array.from({ length: 4000 }, (_, i) => `3,${"&".repeat(490)}${i}`).join(
        "\n",
      ),
    { sourceOriginSeconds: "0" },
  );
  assert.throws(
    () => addChapterMarkers(enc(fixture()), input, "0:1"),
    code("OUTPUT_LIMIT"),
  );
});

// Exact official GUI save from run37442625256, without rewriting its XML.
const nativeBytes = readFileSync(
  new URL("./fixtures/shotcut-26.9.27-authored.mlt", import.meta.url),
);
test("official Shotcut26.9.27 authored project maps the second occurrence", () => {
  const project = inspectProject(nativeBytes);
  const media = project.occurrences.filter((o) => o.resource === "source.mkv");
  assert.deepEqual(
    media.map((o) => [o.sourceIn, o.sourceOut, o.timelineStart, o.supported]),
    [
      [0, 299, 0, true],
      [90, 269, 300, true],
    ],
  );
  const result = addChapterMarkers(nativeBytes, data(), media[1].id);
  assert.deepEqual(
    result.receipt.included.map((m) => m.frame),
    [300, 366, 450, 479],
  );
  assert.equal(
    stripMarkers(new TextDecoder().decode(result.output)),
    stripMarkers(nativeBytes.toString()),
  );
});
test("disabled native compositor metadata is accepted, active overlap is rejected", () => {
  const enabled = nativeBytes
    .toString()
    .replace(
      '<property name="disable">1</property>',
      '<property name="disable">0</property>',
    );
  assert.throws(
    () => addChapterMarkers(enc(enabled), data(), "1:1"),
    code("UNSUPPORTED_CLIP"),
  );
});
test("alternate transition service attributes cannot bypass the native allowlist", () => {
  const changed = nativeBytes
    .toString()
    .replace(
      '<transition id="transition0">',
      '<transition id="transition0" mlt_service="timeremap">',
    );
  assert.throws(
    () => inspectProject(enc(changed)),
    code("UNSUPPORTED_SERVICE_FORM"),
  );
});
test("unknown disabled transitions remain unsupported", () => {
  const changed = nativeBytes
    .toString()
    .replace(
      '<property name="mlt_service">qtblend</property>',
      '<property name="mlt_service">unknown-timing-service</property>',
    );
  assert.throws(
    () => addChapterMarkers(enc(changed), data(), "1:1"),
    code("UNSUPPORTED_CLIP"),
  );
});
test("native playlist audio meter is allowed but a timing filter is not", () => {
  const changed = nativeBytes
    .toString()
    .replace(
      '<property name="mlt_service">audiolevel</property>',
      '<property name="mlt_service">timeremap</property>',
    );
  assert.throws(() => inspectProject(enc(changed)), code("UNSUPPORTED_TRACK"));
  const warped = nativeBytes
    .toString()
    .replace(
      '<property name="iec_scale">1</property>',
      '<property name="iec_scale">1</property><property name="map">0=1</property>',
    );
  assert.throws(
    () => addChapterMarkers(enc(warped), data(), "1:1"),
    code("UNSUPPORTED_CLIP"),
  );
});
