import { DOMParser } from "@xmldom/xmldom";

export const LIMITS = Object.freeze({
  mltBytes: 8 * 1024 * 1024,
  chapterBytes: 4 * 1024 * 1024,
  chapters: 10000,
  elements: 50000,
  depth: 96,
  frames: 1000000000,
});
export class ChapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ChapterError";
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new ChapterError(code, message);
};
const elements = (node) =>
  Array.from(node.childNodes || []).filter((child) => child.nodeType === 1);
function props(node) {
  validateServiceAttributes(node);
  const map = new Map();
  for (const child of elements(node).filter(
    (el) => el.tagName === "property",
  )) {
    const name = child.getAttribute("name");
    if (
      child.hasAttribute("value") ||
      elements(child).length ||
      Array.from(child.childNodes).some((n) => ![3, 4].includes(n.nodeType))
    )
      fail("UNSUPPORTED_PROPERTY", "Use unambiguous text-only property values");
    if (!name || map.has(name))
      fail(
        "AMBIGUOUS_PROPERTY",
        `Duplicate or unnamed property in ${node.tagName}`,
      );
    map.set(name, child.textContent);
  }
  return map;
}
const SERVICE_ATTRIBUTES = {
  chain: new Set(["id", "in", "out"]),
  producer: new Set(["id", "in", "out"]),
  playlist: new Set(["id", "in", "out"]),
  tractor: new Set(["id", "in", "out", "shotcut", "title"]),
  transition: new Set(["id", "in", "out"]),
  filter: new Set(["id", "in", "out"]),
  link: new Set(["id", "in", "out"]),
  entry: new Set(["producer", "in", "out"]),
  track: new Set(["producer", "hide", "in", "out"]),
  blank: new Set(["length"]),
};
function validateServiceAttributes(node) {
  const allowed = SERVICE_ATTRIBUTES[node.tagName];
  if (allowed)
    for (const a of Array.from(node.attributes))
      if (!allowed.has(a.name))
        fail(
          "UNSUPPORTED_SERVICE_FORM",
          `Unsupported service attribute ${a.name} on ${node.tagName}`,
        );
}
function timingOn(node) {
  const values = props(node);
  if (
    [...values.keys()].some((k) => /warp_speed|warp_resource|timeremap/.test(k))
  )
    return true;
  for (const child of elements(node).filter((n) =>
    ["filter", "link"].includes(n.tagName),
  )) {
    const p = props(child);
    if (
      /timewarp|timeremap|reverse|speed/i.test(p.get("mlt_service") || "") ||
      [...p.keys()].some((k) => ["map", "speed_map", "time_map"].includes(k))
    )
      return true;
  }
  return false;
}
const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
};
function rational(n, d = 1n) {
  if (d <= 0n) fail("INVALID_TIME", "Time denominator must be positive");
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
function add(a, b) {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}
function sub(a, b) {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}
function mul(a, b) {
  return rational(a.n * b.n, a.d * b.d);
}
function compare(a, b) {
  const n = a.n * b.d - b.n * a.d;
  return n < 0n ? -1 : n > 0n ? 1 : 0;
}
function round(a) {
  if (a.n < 0n) return -round(rational(-a.n, a.d));
  return (2n * a.n + a.d) / (2n * a.d);
}
function integer(value, label = "integer") {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    fail("INVALID_TIME", `${label} must be an exact integer`);
  const s = String(value);
  if (s.length > 18 || !/^(0|[1-9]\d*)$/.test(s))
    fail("INVALID_TIME", `${label} must be a nonnegative integer`);
  return BigInt(s);
}
function decimal(value) {
  const s = String(value);
  if (s.length > 22 || !/^\d{1,12}(\.\d{1,9})?$/.test(s))
    fail(
      "INVALID_TIME",
      "Use nonnegative decimal seconds with at most 9 fractional digits",
    );
  const [whole, fraction = ""] = s.split(".");
  return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}
function numberFrame(n) {
  if (n < 0n || n > BigInt(LIMITS.frames))
    fail("FRAME_LIMIT", "Frame index exceeds supported range");
  return Number(n);
}
function frameTime(value, fps) {
  if (value === null || value === "")
    fail("MISSING_TIME", "Explicit clip timing is required");
  if (/^\d+$/.test(value)) return numberFrame(integer(value));
  const m = value.match(/^(\d+):([0-5]\d):([0-5]\d)(\.\d{1,9})?$/);
  if (!m || m[1].length > 9)
    fail("UNSUPPORTED_TIME", `Unsupported MLT time ${value}`);
  const seconds = add(
    rational(BigInt(m[1]) * 3600n + BigInt(m[2]) * 60n),
    decimal(m[3] + (m[4] || "")),
  );
  return numberFrame(round(mul(seconds, fps)));
}
function clock(frame, fps) {
  const ms = round(rational(BigInt(frame) * fps.d * 1000n, fps.n));
  const hours = ms / 3600000n,
    minutes = (ms / 60000n) % 60n,
    seconds = (ms / 1000n) % 60n,
    millis = ms % 1000n;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
function safeText(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 500 ||
    /[\x00-\x1f\ud800-\udfff\ufffe\uffff]/u.test(value)
  )
    fail(
      "INVALID_TITLE",
      "Chapter titles must be 1–500 valid Unicode characters",
    );
  return value;
}
function escapeXML(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function localResource(value) {
  if (
    !value ||
    value !== value.trim() ||
    /[\x00-\x1f]/.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//")
  )
    return false;
  if (/^[a-z]:[\\/]/i.test(value)) return true;
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      return (
        url.protocol === "file:" &&
        (!url.hostname || url.hostname === "localhost") &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}
function xmlDocument(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > LIMITS.mltBytes)
    fail("INPUT_LIMIT", "MLT must be a byte array up to 8 MiB");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    fail("XML_ENCODING", "MLT must be UTF-8");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    fail("XML_DOCTYPE", "DTD and entities are unsupported");
  for (const c of text) {
    const n = c.codePointAt(0);
    if (
      !(
        n === 9 ||
        n === 10 ||
        n === 13 ||
        (n >= 32 && n <= 0xd7ff) ||
        (n >= 0xe000 && n <= 0xfffd) ||
        (n >= 0x10000 && n <= 0x10ffff)
      )
    )
      fail("INVALID_XML", "Forbidden XML character");
  }
  for (const m of text.matchAll(/&#(x[0-9a-f]+|\d+);/gi)) {
    const n =
      m[1][0].toLowerCase() === "x"
        ? parseInt(m[1].slice(1), 16)
        : Number(m[1]);
    if (
      !(
        n === 9 ||
        n === 10 ||
        n === 13 ||
        (n >= 32 && n <= 0xd7ff) ||
        (n >= 0xe000 && n <= 0xfffd) ||
        (n >= 0x10000 && n <= 0x10ffff)
      )
    )
      fail("INVALID_XML", "Forbidden numeric XML character");
  }
  const declaration = text.match(
    /^\uFEFF?\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)/i,
  );
  if (declaration && !/^utf-8$/i.test(declaration[1]))
    fail("XML_ENCODING", "Only UTF-8 is supported");
  const tokens = [
    ...text.matchAll(
      /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:"[^"]*"|'[^']*'|[^'">])*>/g,
    ),
  ];
  const stack = [],
    spans = [];
  for (const match of tokens) {
    const token = match[0],
      start = match.index;
    if (token.startsWith("<?")) {
      if (!/^<\?xml\s/.test(token))
        fail("UNSUPPORTED_XML", "Processing instructions are unsupported");
      continue;
    }
    if (token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const opened = stack.pop();
      if (!opened) fail("INVALID_XML", "Unbalanced XML");
      opened.closeStart = start;
      opened.end = start + token.length;
      continue;
    }
    const span = {
      start,
      openEnd: start + token.length,
      selfClosing: token.endsWith("/>"),
    };
    spans.push(span);
    if (span.selfClosing) {
      span.closeStart = start;
      span.end = span.openEnd;
    } else stack.push(span);
    if (stack.length > LIMITS.depth || spans.length > LIMITS.elements)
      fail("XML_LIMIT", "XML depth/element limit exceeded");
  }
  let document;
  try {
    document = new DOMParser({
      onError: (level, message) => {
        throw Error(`${level}: ${message}`);
      },
    }).parseFromString(text.replace(/^\uFEFF/, ""), "application/xml");
  } catch (e) {
    fail("INVALID_XML", e.message);
  }
  if (document.documentElement?.tagName !== "mlt" || stack.length)
    fail("INVALID_XML", "A complete MLT document is required");
  const all = Array.from(document.getElementsByTagName("*"));
  if (all.length !== spans.length)
    fail("INVALID_XML", "Ambiguous XML token structure");
  const ranges = new Map();
  all.forEach((node, index) => {
    if (
      node.namespaceURI ||
      node.tagName.includes(":") ||
      Array.from(node.attributes).some(
        (a) => a.name.includes(":") || a.name === "xmlns",
      )
    )
      fail("UNSUPPORTED_XML", "XML namespaces are unsupported");
    ranges.set(node, spans[index]);
  });
  return { document, text, ranges, elementCount: all.length };
}
export function inspectProject(bytes) {
  const parsed = xmlDocument(bytes),
    root = parsed.document.documentElement,
    children = elements(root);
  const profiles = children.filter((n) => n.tagName === "profile");
  if (profiles.length !== 1)
    fail("PROFILE", "One explicit project profile is required");
  const fps = rational(
    integer(profiles[0].getAttribute("frame_rate_num"), "frame_rate_num"),
    integer(profiles[0].getAttribute("frame_rate_den"), "frame_rate_den"),
  );
  if (compare(fps, rational(1n)) < 0 || compare(fps, rational(240n)) > 0)
    fail("PROFILE", "Unsupported project frame rate");
  const ids = new Map();
  for (const node of children) {
    const id = node.getAttribute("id");
    if (id) {
      if (ids.has(id)) fail("DUPLICATE_ID", `Duplicate MLT id ${id}`);
      ids.set(id, node);
    }
  }
  const timelines = children.filter(
    (n) => n.tagName === "tractor" && props(n).get("shotcut") === "1",
  );
  if (timelines.length !== 1)
    fail("TIMELINE", "One Shotcut timeline tractor is required");
  const timeline = timelines[0];
  if (
    timeline.hasAttribute("in") &&
    frameTime(timeline.getAttribute("in"), fps) !== 0
  )
    fail("TIMELINE_ORIGIN", "Nonzero timeline origin is unsupported");
  const markerContainers = elements(timeline).filter(
    (n) =>
      n.tagName === "properties" &&
      n.getAttribute("name") === "shotcut:markers",
  );
  if (markerContainers.length > 1)
    fail("MARKERS", "Duplicate marker containers");
  const markerContainer = markerContainers[0] || null;
  const existing = [],
    keys = new Set();
  if (markerContainer)
    for (const node of elements(markerContainer)) {
      const key = node.getAttribute("name");
      if (
        node.tagName !== "properties" ||
        !/^\d+$/.test(key) ||
        String(Number(key)) !== key ||
        Number(key) > 2147483646 ||
        keys.has(key)
      )
        fail("MARKERS", "Unsupported marker key/structure");
      keys.add(key);
      const values = props(node);
      if (
        values.size !== 4 ||
        !["text", "start", "end", "color"].every((name) => values.has(name))
      )
        fail("MARKERS", "Unsupported existing marker fields");
      const start = frameTime(values.get("start"), fps),
        end = frameTime(values.get("end"), fps);
      if (end < start) fail("MARKERS", "Existing marker has reversed range");
      existing.push({
        key,
        text: values.get("text"),
        start,
        end,
        color: values.get("color"),
      });
    }
  const occurrences = [];
  const tracks = elements(timeline).filter((n) => n.tagName === "track");
  tracks.forEach((track, trackIndex) => {
    validateServiceAttributes(track);
    const playlist = ids.get(track.getAttribute("producer"));
    if (!playlist || playlist.tagName !== "playlist") return;
    validateServiceAttributes(playlist);
    let position = 0,
      entryIndex = 0;
    for (const item of elements(playlist)) {
      if (item.tagName === "property" || item.tagName === "properties")
        continue;
      if (
        item.tagName === "filter" &&
        props(item).get("mlt_service") === "audiolevel"
      )
        continue;
      if (item.tagName === "blank") {
        validateServiceAttributes(item);
        position += frameTime(item.getAttribute("length"), fps);
        continue;
      }
      if (item.tagName !== "entry")
        fail("UNSUPPORTED_TRACK", "Only flat entry/blank tracks are supported");
      validateServiceAttributes(item);
      const sourceIn = frameTime(item.getAttribute("in"), fps),
        sourceOut = frameTime(item.getAttribute("out"), fps);
      if (sourceOut < sourceIn) fail("INVALID_TRIM", "Reversed clip range");
      const duration = sourceOut - sourceIn + 1;
      const producer = ids.get(item.getAttribute("producer"));
      const values = producer ? props(producer) : new Map();
      const service = values.get("mlt_service") || "";
      const resource = values.get("resource") || "";
      let reason = null;
      if (
        !producer ||
        !["chain", "producer"].includes(producer.tagName) ||
        !["avformat", "avformat-novalidate"].includes(service)
      )
        reason = "Only a flat normal-speed media producer is supported";
      else if ([producer, item, playlist, track, timeline].some(timingOn))
        reason = "Timing changes on selected clip ancestry are unsupported";
      else if (
        (playlist.hasAttribute("in") &&
          frameTime(playlist.getAttribute("in"), fps) !== 0) ||
        playlist.hasAttribute("out")
      )
        reason = "Playlist origin/cropping is unsupported";
      else if (
        (track.hasAttribute("in") &&
          frameTime(track.getAttribute("in"), fps) !== 0) ||
        track.hasAttribute("out")
      )
        reason = "Track trimming is unsupported";
      else if (
        [...values].some(([k, v]) =>
          /(?:warp_speed|warp_resource|timeremap|shotcut:proxy|shotcut:resource|shotcut:originalIn|shotcut:originalOut|shotcut:originalResource)/i.test(
            k,
          ),
        )
      )
        reason = "Retime/proxy producers are unsupported";
      else if (
        elements(producer).some(
          (n) =>
            ["filter", "link"].includes(n.tagName) &&
            (/timewarp|timeremap|reverse|speed/i.test(
              props(n).get("mlt_service") || "",
            ) ||
              [...props(n).keys()].some((k) =>
                ["map", "speed_map", "time_map"].includes(k),
              )),
        )
      )
        reason = "Timing filters are unsupported";
      else if (!localResource(resource))
        reason = "Empty or non-local media resources are unsupported";
      else if (
        [...values].some(
          ([k, v]) =>
            /start_time$/.test(k) &&
            v &&
            compare(decimal(v), rational(0n)) !== 0,
        )
      )
        reason = "Nonzero source time origin is unsupported";
      for (const transition of elements(timeline).filter(
        (n) => n.tagName === "transition",
      )) {
        const tp = props(transition),
          svc = tp.get("mlt_service") || "";
        if (
          ["mix", "frei0r.cairoblend", "qtblend", "movit.overlay"].includes(
            svc,
          ) &&
          (tp.get("always_active") === "1" || tp.get("disable") === "1")
        )
          continue;
        const tin = transition.hasAttribute("in")
          ? frameTime(transition.getAttribute("in"), fps)
          : 0;
        const tout = transition.hasAttribute("out")
          ? frameTime(transition.getAttribute("out"), fps)
          : LIMITS.frames;
        if (tin < position + duration && tout >= position)
          reason = "Selected range overlaps an unsupported transition";
      }
      if (position + duration > LIMITS.frames)
        fail("FRAME_LIMIT", "Timeline exceeds supported length");
      occurrences.push({
        id: `${trackIndex}:${entryIndex}`,
        trackIndex,
        playlistId: playlist.getAttribute("id"),
        producerId: item.getAttribute("producer"),
        resource,
        sourceIn,
        sourceOut,
        timelineStart: position,
        duration,
        supported: !reason,
        reason,
      });
      position += duration;
      entryIndex++;
    }
  });
  return {
    ...parsed,
    fps,
    profile: { num: String(fps.n), den: String(fps.d) },
    timeline,
    markerContainer,
    existing,
    occurrences,
  };
}
function normalizeChapters(chapters, origin, evidence) {
  if (compare(origin, rational(0n)) !== 0)
    fail("SOURCE_ORIGIN", "Nonzero source time origin is unsupported");
  if (!chapters.length || chapters.length > LIMITS.chapters)
    fail("CHAPTER_LIMIT", "Use 1–10000 chapters");
  return { chapters, originEvidence: evidence };
}
export function parseFFprobe(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > LIMITS.chapterBytes
  )
    fail("CHAPTER_LIMIT", "Chapter JSON exceeds 4 MiB");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("INVALID_JSON", "Invalid ffprobe JSON");
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.chapters))
    fail("INVALID_JSON", "An ffprobe chapters array is required");
  if (!data.format || data.format.start_time === undefined)
    fail(
      "SOURCE_ORIGIN",
      "ffprobe format.start_time is required to establish zero origin",
    );
  if (!Array.isArray(data.streams) || !data.streams.length)
    fail(
      "SOURCE_ORIGIN",
      "ffprobe streams with explicit zero start_time are required",
    );
  for (const stream of data.streams)
    if (
      stream.start_time === undefined ||
      compare(decimal(stream.start_time), rational(0n)) !== 0
    )
      fail("SOURCE_ORIGIN", "Nonzero stream start time is unsupported");
  if (!data.chapters.length || data.chapters.length > LIMITS.chapters)
    fail("CHAPTER_LIMIT", "Use 1–10000 chapters");
  const chapters = data.chapters.map((chapter, index) => {
    if (!chapter || typeof chapter !== "object")
      fail("INVALID_JSON", "Invalid chapter object");
    const tb = String(chapter.time_base || "").match(/^(\d+)\/(\d+)$/);
    if (!tb) fail("INVALID_TIME", "Chapter time_base is required");
    const numerator = integer(tb[1]),
      denominator = integer(tb[2]);
    if (!numerator) fail("INVALID_TIME", "Positive time_base required");
    return {
      index,
      title: safeText(chapter.tags?.title ?? `Chapter ${index + 1}`),
      seconds: mul(
        rational(integer(chapter.start), 1n),
        rational(numerator, denominator),
      ),
    };
  });
  return {
    ...normalizeChapters(
      chapters,
      decimal(data.format.start_time),
      "ffprobe format and stream start_time",
    ),
    sourceFilename: data.format.filename || null,
  };
}
export function parseCSV(text, { sourceOriginSeconds } = {}) {
  if (sourceOriginSeconds === undefined)
    fail(
      "SOURCE_ORIGIN",
      "Explicit source-origin declaration is required for CSV",
    );
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > LIMITS.chapterBytes
  )
    fail("CHAPTER_LIMIT", "Chapter CSV exceeds 4 MiB");
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closedQuote = true;
      } else field += c;
    } else if (c === '"') {
      if (field) fail("INVALID_CSV", "Unexpected quote");
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      closedQuote = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v !== "")) {
        rows.push(row);
        if (rows.length > LIMITS.chapters + 1)
          fail("CHAPTER_LIMIT", "Too many CSV rows");
      }
      row = [];
      field = "";
      closedQuote = false;
    } else {
      if (closedQuote) fail("INVALID_CSV", "Characters after a quoted field");
      field += c;
    }
  }
  if (quoted) fail("INVALID_CSV", "Unclosed quoted field");
  row.push(field);
  if (row.some((v) => v !== "")) {
    rows.push(row);
    if (rows.length > LIMITS.chapters + 1)
      fail("CHAPTER_LIMIT", "Too many CSV rows");
  }
  if (rows.shift()?.join(",") !== "source_seconds,title")
    fail("INVALID_CSV", "CSV header must be source_seconds,title");
  const chapters = rows.map((r, index) => {
    if (r.length !== 2) fail("INVALID_CSV", "Exactly two columns are required");
    return { index, title: safeText(r[1]), seconds: decimal(r[0]) };
  });
  return normalizeChapters(
    chapters,
    decimal(sourceOriginSeconds),
    "explicit CSV zero-origin declaration",
  );
}
export function addChapterMarkers(bytes, input, occurrenceId) {
  const project = inspectProject(bytes),
    occurrence = project.occurrences.find((o) => o.id === occurrenceId);
  if (!occurrence) fail("OCCURRENCE", "Select one explicit clip occurrence");
  if (!occurrence.supported) fail("UNSUPPORTED_CLIP", occurrence.reason);
  if (!input?.chapters || !input.originEvidence)
    fail("CHAPTER_INPUT", "Use a validated chapter input");
  if (
    input.sourceFilename &&
    input.sourceFilename.split(/[\\/]/).at(-1) !==
      occurrence.resource.split(/[\\/]/).at(-1)
  )
    fail(
      "SOURCE_MISMATCH",
      "ffprobe filename does not match the selected media resource",
    );
  const pointKeys = new Set(
    project.existing
      .filter((m) => m.start === m.end)
      .map((m) => `${m.start}\0${m.text}`),
  );
  const included = [],
    excluded = [],
    existingKeys = new Set(project.existing.map((m) => Number(m.key)));
  let nextKey = existingKeys.size ? Math.max(...existingKeys) + 1 : 0;
  for (const chapter of input.chapters) {
    const sourceFrames = mul(chapter.seconds, project.fps);
    const sourceSeconds = `${chapter.seconds.n}/${chapter.seconds.d}`,
      sourceFrame = `${sourceFrames.n}/${sourceFrames.d}`;
    if (
      compare(sourceFrames, rational(BigInt(occurrence.sourceIn))) < 0 ||
      compare(sourceFrames, rational(BigInt(occurrence.sourceOut + 1))) >= 0
    ) {
      excluded.push({
        index: chapter.index,
        title: chapter.title,
        sourceSeconds,
        sourceFrame,
        reason: "outside selected source trim",
      });
      continue;
    }
    const exact = add(
        sub(sourceFrames, rational(BigInt(occurrence.sourceIn))),
        rational(BigInt(occurrence.timelineStart)),
      ),
      frame = numberFrame(round(exact));
    if (frame >= occurrence.timelineStart + occurrence.duration) {
      excluded.push({
        index: chapter.index,
        title: chapter.title,
        sourceSeconds,
        sourceFrame,
        reason: "quantization would leave selected clip",
      });
      continue;
    }
    if (pointKeys.has(`${frame}\0${chapter.title}`)) {
      excluded.push({
        index: chapter.index,
        title: chapter.title,
        sourceSeconds,
        sourceFrame,
        reason: "identical point marker already exists",
      });
      continue;
    }
    pointKeys.add(`${frame}\0${chapter.title}`);
    if (nextKey > 2147483646)
      fail("MARKERS", "No supported marker key remains");
    const delta = sub(rational(BigInt(frame)), exact);
    included.push({
      key: String(nextKey++),
      index: chapter.index,
      title: chapter.title,
      sourceSeconds,
      sourceFrame,
      frame,
      start: clock(frame, project.fps),
      end: clock(frame, project.fps),
      color: "#70B7DA",
      exactTimelineFrame: `${exact.n}/${exact.d}`,
      quantizationFrames: `${delta.n}/${delta.d}`,
    });
  }
  if (!included.length)
    fail("NO_MARKERS", "No new chapters fall within the selected clip");
  if (
    project.elementCount +
      included.length * 5 +
      (project.markerContainer ? 0 : 1) >
    LIMITS.elements
  )
    fail("OUTPUT_LIMIT", "Added markers would exceed the XML element limit");
  const target = project.markerContainer || project.timeline,
    range = project.ranges.get(target);
  const newline = project.text.includes("\r\n") ? "\r\n" : "\n";
  const lineStart = project.text.lastIndexOf("\n", range.start - 1) + 1;
  const indent = project.text
    .slice(lineStart, range.start)
    .match(/^\s*/)[0]
    .replace(/[\r\n]/g, "");
  const outer = project.markerContainer ? indent : indent + "  ",
    child = outer + "  ",
    field = child + "  ";
  const blocks = included
    .map(
      (marker) =>
        `${child}<properties name="${marker.key}">${newline}${field}<property name="text">${escapeXML(marker.title)}</property>${newline}${field}<property name="start">${marker.start}</property>${newline}${field}<property name="end">${marker.end}</property>${newline}${field}<property name="color">${marker.color}</property>${newline}${child}</properties>`,
    )
    .join(newline);
  let start, end, replacement;
  if (project.markerContainer) {
    if (range.selfClosing) {
      start = range.start;
      end = range.end;
      replacement =
        project.text.slice(start, range.openEnd).replace(/\/>$/, ">") +
        newline +
        blocks +
        newline +
        outer +
        "</properties>";
    } else {
      start = range.closeStart;
      end = start;
      replacement = newline + blocks + newline + outer;
    }
  } else {
    start = range.openEnd;
    end = start;
    replacement =
      '<properties name="shotcut:markers">' +
      newline +
      blocks +
      newline +
      outer +
      "</properties>";
  }
  const output = new TextEncoder().encode(
    project.text.slice(0, start) + replacement + project.text.slice(end),
  );
  if (output.byteLength > LIMITS.mltBytes)
    fail("OUTPUT_LIMIT", "Added markers would exceed the 8 MiB MLT limit");
  return {
    output,
    receipt: {
      tool: "ClipChapter",
      version: "0.1.0",
      profile: project.profile,
      occurrence,
      originEvidence: input.originEvidence,
      chapterSourceFilename: input.sourceFilename ?? null,
      sourceIdentity:
        "Explicit occurrence selection; filename match when supplied, not a content fingerprint",
      included,
      excluded,
      existingMarkers: project.existing,
      policy:
        "Point markers only; nearest-frame, half-up quantization; no clip/media edits",
      patch: {
        startUTF16: start,
        endUTF16: end,
        insertedCharacters: replacement.length,
        markerOnly: true,
      },
    },
  };
}
