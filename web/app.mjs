import {
  inspectProject,
  parseFFprobe,
  parseCSV,
  addChapterMarkers,
  LIMITS,
} from "../src/core.mjs";
import { SAMPLE_MLT, SAMPLE_CHAPTERS, THIRD_PARTY } from "../src/sample.mjs";
const $ = (id) => document.getElementById(id);
const initialHTML = "<!doctype html>\n" + document.documentElement.outerHTML;
const ja = Object.fromEntries(
  [...document.querySelectorAll("[data-i18n]")].map((el) => [
    el.dataset.i18n,
    el.textContent,
  ]),
);
ja.title = "章の位置を、\nこのクリップへ。";
const en = {
  skip: "Skip to workspace",
  title: "Chapter points.\nPlaced in this clip.",
  intro:
    "Turn source chapters into point markers for one selected Shotcut clip occurrence. Review the trim and timeline offset, then move only the points that belong.",
  offline: "LOCAL PROCESSING · OFFLINE",
  scope:
    "For normal-speed, flat clips. Reads project XML and chapter data. No video upload, decoding or editing.",
  tested: "Native-tested in Shotcut 26.9.27",
  workspace: "CHAPTER WORKSPACE",
  sample: "Try the sample",
  clear: "Clear",
  inputs: "Bring the two inputs",
  projectLabel: "Shotcut project",
  notChosen: "No file selected",
  mltHelp: "UTF-8 XML · up to 8 MiB. Your original project is never modified.",
  chapterLabel: "Source video chapters",
  chapterHelp:
    "ffprobe JSON with chapters, format and streams, or an explicit CSV. Up to 4 MiB.",
  formatLabel: "Chapter format",
  csvOrigin:
    "These CSV times are relative to the source video starting at zero",
  formatGuide: "Input formats and limits",
  probeHelp:
    "Save ffprobe output using -show_chapters -show_format -show_streams -of json. The format and every stream must have start_time equal to zero.",
  csvHelp:
    "CSV header: source_seconds,title. Times are decimal seconds; each title is one line, up to 500 characters. Maximum 10,000 chapters.",
  limitsHelp:
    "Blocks retiming, reverse, proxies, nesting, unsupported transitions over the selected range, and nonzero source time origins. XML external entities and scripts are never executed.",
  choose: "Choose one occurrence",
  occurrenceHelp:
    "The same video can appear more than once. Each timeline placement has its own offset.",
  occurrenceLabel: "Target clip occurrence",
  choosePlaceholder: "Select a clip occurrence",
  sourceIn: "SOURCE IN",
  sourceOut: "SOURCE OUT · inclusive",
  timelineStart: "TIMELINE START",
  identity:
    "This chapter data belongs to the source media referenced by this occurrence",
  identityHelp:
    "A matching filename is not proof that two files contain the same video.",
  initial: "Choose both files, then confirm the target occurrence.",
  review: "Review the points",
  added: "points to add",
  excluded: "chapters excluded",
  existing: "markers preserved",
  rounding:
    "Timeline position = source position − IN + timeline start. Rounds to the nearest frame, with exact halves rounded forward. Points beyond the selected OUT are excluded.",
  tableCaption: "Point markers to append",
  name: "Name",
  sourceFrame: "Source frame",
  timelineFrame: "Timeline frame",
  quantization: "Rounding Δ · frames",
  exclusions: "Exclusions and existing markers",
  exportTitle: "A copy with only marker additions",
  exportHelp:
    "Save beside the original MLT to keep relative media references intact. ClipChapter preserves every non-marker byte in its exported copy.",
  nativeCaveat:
    "A later save in Shotcut may normalize some metadata as part of Shotcut’s own save process.",
  export: "Save MLT copy",
  receipt: "Verification receipt · JSON",
  print: "Print this review",
  pointOnly: "Chapters become editable points.",
  pointOnlyBody:
    "Creates point markers, not marker ranges or subtitles. Existing markers and other clip occurrences are preserved.",
  receiptTitle: "Keep the reasoning with the result.",
  receiptBody:
    "The receipt records the selected occurrence, source times, rounding, exclusions, and SHA-256 hashes of the input and output. It becomes available after the MLT download.",
  footer: "A small editing companion. A verifiable result.",
  saveOffline: "Save this tool offline",
  thirdParty: "Third-party notice",
};
let language = "ja",
  epoch = 0,
  revision = 0,
  busy = false,
  lastReceipt = null;
const reads = { mlt: 0, chapters: 0 };
let state = empty();
function empty() {
  return {
    mlt: null,
    mltName: "",
    chapters: null,
    chaptersName: "",
    project: null,
    parsed: null,
    result: null,
    pending: { mlt: false, chapters: false },
    errors: { mlt: null, chapters: null },
    occurrence: "",
  };
}
const t = (key) => (language === "en" ? en : ja)[key] ?? key;
const msg = (jp, english) => (language === "ja" ? jp : english);
function setStatus(text, kind = "") {
  $("status").textContent = text;
  $("status").className = "status " + kind;
}
function invalidate() {
  revision++;
  busy = false;
  lastReceipt = null;
  state.result = null;
  $("export").disabled = true;
  $("receipt").disabled = true;
  $("export-status").textContent = "";
}
function errorText(error) {
  return `${msg("入力を確認してください", "Please check the input")} · ${error.code ?? "INPUT_ERROR"}\n${error.message}`;
}
function el(tag, text) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
}
function frameText(raw) {
  const [n, d = "1"] = String(raw).split("/");
  return d === "1" ? n : `${Number(n) / Number(d)} (${raw})`;
}
function exclusionText(reason) {
  const labels = {
    "outside selected source trim": [
      "選択したトリムの範囲外",
      "outside the selected trim",
    ],
    "quantization would leave selected clip": [
      "丸めると配置の範囲外になる",
      "rounding would leave the clip",
    ],
    "identical point marker already exists": [
      "同じ名前・位置の点が既にある",
      "identical name and point already exists",
    ],
  };
  return (labels[reason] ?? [reason, reason])[language === "ja" ? 0 : 1];
}
function renderInputs() {
  $("mlt-summary").textContent = state.mltName || t("notChosen");
  $("chapter-summary").textContent = state.chaptersName || t("notChosen");
  $("csv-origin-wrap").hidden = $("format").value !== "csv";
  const select = $("occurrence"),
    selected = state.occurrence;
  select.replaceChildren(new Option(t("choosePlaceholder"), ""));
  for (const o of state.project?.occurrences ?? []) {
    const label = `${msg("トラック", "Track")} ${o.trackIndex} · ${msg("配置", "entry")} ${o.id} · ${o.resource || "—"} · IN ${o.sourceIn} / OUT ${o.sourceOut} → ${o.timelineStart}${o.supported ? "" : ` · ${msg("未対応", "unsupported")}`}`;
    select.add(new Option(label, o.id));
  }
  select.disabled = !state.project || state.pending.mlt;
  select.value = selected;
  const o = state.project?.occurrences.find((o) => o.id === selected);
  $("clip-card").hidden = !o;
  if (o) {
    $("clip-resource").textContent = o.resource;
    $("source-in").textContent = o.sourceIn;
    $("source-out").textContent = o.sourceOut;
    $("timeline-start").textContent = o.timelineStart;
    $("fps").textContent =
      `${state.project.profile.num}/${state.project.profile.den} fps · ${o.duration} ${msg("フレーム", "frames")}`;
  }
  $("identity").disabled =
    !o ||
    !o.supported ||
    !state.parsed ||
    state.pending.mlt ||
    state.pending.chapters;
}
function renderResult() {
  const result = state.result;
  $("results").hidden = !result;
  if (!result) return;
  const r = result.receipt;
  $("review-fps").textContent = `${r.profile.num}/${r.profile.den} fps`;
  $("included-count").textContent = r.included.length;
  $("excluded-count").textContent = r.excluded.length;
  $("existing-count").textContent = r.existingMarkers.length;
  $("point-rows").replaceChildren(
    ...r.included.map((point) => {
      const row = el("tr");
      for (const v of [
        point.title,
        frameText(point.sourceFrame),
        point.frame,
        point.quantizationFrames,
      ])
        row.append(el("td", v));
      return row;
    }),
  );
  $("excluded-list").replaceChildren(
    ...(r.excluded.length
      ? r.excluded.map((point) =>
          el(
            "li",
            `${point.title} · ${frameText(point.sourceFrame)} → ${exclusionText(point.reason)}`,
          ),
        )
      : [el("li", msg("なし", "None"))]),
  );
  $("existing-list").replaceChildren(
    ...(r.existingMarkers.length
      ? r.existingMarkers.map((point) =>
          el(
            "li",
            `${point.text} · ${point.start}${point.end === point.start ? "" : `–${point.end}`} · ${point.color}`,
          ),
        )
      : [el("li", msg("なし", "None"))]),
  );
}
function refresh() {
  state.project = null;
  state.parsed = null;
  state.result = null;
  try {
    if (state.mlt) state.project = inspectProject(state.mlt);
  } catch (error) {
    state.errors.mlt = error;
  }
  try {
    if (
      state.chapters &&
      ($("format").value !== "csv" || $("csv-origin").checked)
    )
      state.parsed =
        $("format").value === "csv"
          ? parseCSV(state.chapters.text, { sourceOriginSeconds: "0" })
          : parseFFprobe(state.chapters.text);
  } catch (error) {
    state.errors.chapters = error;
  }
  renderInputs();
  if (state.pending.mlt || state.pending.chapters)
    setStatus(msg("ファイルを読み込んでいます…", "Reading the files…"));
  else if (state.errors.mlt || state.errors.chapters)
    setStatus(errorText(state.errors.mlt ?? state.errors.chapters), "error");
  else if (!state.mlt || !state.chapters) setStatus(t("initial"));
  else if ($("format").value === "csv" && !$("csv-origin").checked)
    setStatus(
      msg(
        "CSV の時刻原点を確認してください。",
        "Confirm the CSV source-time origin.",
      ),
    );
  else if (!state.occurrence)
    setStatus(
      msg(
        "対象のクリップ配置を、明示的に選択してください。",
        "Explicitly choose the target clip occurrence.",
      ),
    );
  else {
    const o = state.project?.occurrences.find((o) => o.id === state.occurrence);
    if (!o?.supported)
      setStatus(
        `${msg("この配置は未対応です", "This occurrence is unsupported")} · UNSUPPORTED_CLIP\n${o?.reason ?? ""}`,
        "error",
      );
    else if (!$("identity").checked)
      setStatus(
        msg(
          "チャプターが選んだ元動画のものであることを確認してください。",
          "Confirm that these chapters belong to the selected source media.",
        ),
      );
    else
      try {
        state.result = addChapterMarkers(
          state.mlt,
          state.parsed,
          state.occurrence,
        );
        setStatus(
          msg(
            "書き出し前に、追加する点と除外理由を確認してください。",
            "Review the points and exclusions before exporting.",
          ),
          "ready",
        );
      } catch (error) {
        setStatus(errorText(error), "error");
      }
  }
  renderResult();
  $("export").disabled = !state.result || busy;
  $("receipt").disabled = !lastReceipt || busy;
}
function resetSemantic() {
  invalidate();
  state.errors = { mlt: null, chapters: null };
}
async function importFile(slot, input) {
  const file = input.files?.[0];
  if (!file) return;
  const token = ++reads[slot],
    generation = epoch;
  resetSemantic();
  state[slot] = null;
  state.pending[slot] = true;
  state[slot === "mlt" ? "mltName" : "chaptersName"] = file.name;
  if (slot === "mlt") state.occurrence = "";
  else
    $("format").value = file.name.toLowerCase().endsWith(".csv")
      ? "csv"
      : "json";
  $("identity").checked = false;
  $("csv-origin").checked = false;
  refresh();
  try {
    const limit = slot === "mlt" ? LIMITS.mltBytes : LIMITS.chapterBytes;
    if (file.size > limit)
      throw Object.assign(new Error(`Maximum ${limit} bytes`), {
        code: "FILE_LIMIT",
      });
    if (slot === "mlt" && !file.name.toLowerCase().endsWith(".mlt"))
      throw Object.assign(new Error("Choose a .mlt project"), {
        code: "FILE_TYPE",
      });
    if (slot === "chapters" && !/\.(json|csv)$/i.test(file.name))
      throw Object.assign(new Error("Choose chapter JSON or CSV"), {
        code: "FILE_TYPE",
      });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (generation !== epoch || token !== reads[slot]) return;
    state[slot] =
      slot === "mlt"
        ? bytes
        : {
            bytes,
            text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          };
  } catch (error) {
    if (generation !== epoch || token !== reads[slot]) return;
    state.errors[slot] = error;
  }
  if (generation !== epoch || token !== reads[slot]) return;
  state.pending[slot] = false;
  refresh();
}
function languageTo(value) {
  language = value;
  document.documentElement.lang = value;
  for (const node of document.querySelectorAll("[data-i18n]"))
    node.textContent = t(node.dataset.i18n);
  $("lang-ja").setAttribute("aria-pressed", String(value === "ja"));
  $("lang-en").setAttribute("aria-pressed", String(value === "en"));
  const previous = state.result;
  refresh();
  if (previous) {
    state.result = previous;
    renderResult();
  }
}
function download(bytes, type, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const hash = async (bytes) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
$("mlt-input").addEventListener("change", (event) =>
  importFile("mlt", event.currentTarget),
);
$("chapters-input").addEventListener("change", (event) =>
  importFile("chapters", event.currentTarget),
);
$("occurrence").addEventListener("change", () => {
  resetSemantic();
  state.occurrence = $("occurrence").value;
  $("identity").checked = false;
  refresh();
});
for (const id of ["format", "csv-origin", "identity"])
  $(id).addEventListener("change", () => {
    resetSemantic();
    if (id !== "identity") $("identity").checked = false;
    refresh();
  });
$("lang-ja").addEventListener("click", () => languageTo("ja"));
$("lang-en").addEventListener("click", () => languageTo("en"));
$("sample").addEventListener("click", () => {
  epoch++;
  resetSemantic();
  state = empty();
  state.mlt = new TextEncoder().encode(SAMPLE_MLT);
  state.mltName = "sample-shotcut.mlt";
  const bytes = new TextEncoder().encode(JSON.stringify(SAMPLE_CHAPTERS));
  state.chapters = { bytes, text: new TextDecoder().decode(bytes) };
  state.chaptersName = "sample-chapters.json";
  $("format").value = "json";
  $("identity").checked = false;
  $("csv-origin").checked = false;
  $("mlt-input").value = "";
  $("chapters-input").value = "";
  refresh();
});
$("reset").addEventListener("click", () => {
  epoch++;
  invalidate();
  state = empty();
  for (const id of ["mlt-input", "chapters-input"]) $(id).value = "";
  for (const id of ["identity", "csv-origin"]) $(id).checked = false;
  $("format").value = "json";
  refresh();
  setStatus(msg("入力と結果をクリアしました。", "Inputs and results cleared."));
});
$("export").addEventListener("click", async () => {
  if (!state.result || busy) return;
  busy = true;
  const token = revision,
    result = state.result,
    input = state.mlt,
    chapter = state.chapters.bytes,
    inputName = state.mltName,
    chapterName = state.chaptersName,
    format = $("format").value;
  $("export").disabled = true;
  $("receipt").disabled = true;
  $("export-status").textContent = msg(
    "ハッシュを計算しています…",
    "Calculating hashes…",
  );
  try {
    const [inputHash, outputHash, chapterHash] = await Promise.all([
      hash(input),
      hash(result.output),
      hash(chapter),
    ]);
    if (token !== revision || state.result !== result) return;
    const filename = inputName.replace(/\.mlt$/i, "") + ".chapters.mlt";
    lastReceipt = {
      ...result.receipt,
      input: { name: inputName, bytes: input.length, sha256: inputHash },
      chapters: {
        name: chapterName,
        format,
        bytes: chapter.length,
        sha256: chapterHash,
      },
      output: {
        name: filename,
        bytes: result.output.length,
        sha256: outputHash,
      },
      confirmedSourceIdentity: true,
      csvZeroOriginConfirmed: format === "csv",
      nativeSaveCaveat:
        "Only the ClipChapter patch preserves non-marker bytes. Later Shotcut saves may normalize metadata.",
    };
    download(result.output, "application/xml", filename);
    $("export-status").textContent =
      `${msg("コピーを保存しました", "Copy downloaded")} · ${result.output.length.toLocaleString()} bytes · SHA-256 ${outputHash}`;
  } catch (error) {
    if (token === revision) {
      lastReceipt = null;
      $("export-status").textContent = errorText(error);
    }
  } finally {
    if (token === revision) {
      busy = false;
      $("export").disabled = !state.result;
      $("receipt").disabled = !lastReceipt;
    }
  }
});
$("receipt").addEventListener("click", () => {
  if (lastReceipt && !busy)
    download(
      JSON.stringify(lastReceipt, null, 2) + "\n",
      "application/json",
      lastReceipt.output.name.replace(/\.mlt$/, ".receipt.json"),
    );
});
$("offline").addEventListener("click", () =>
  download(initialHTML, "text/html", "clip-chapter.html"),
);
$("print").addEventListener("click", () => {
  const wasOpen = $("excluded-details").open;
  $("excluded-details").open = true;
  window.print();
  if (!wasOpen) $("excluded-details").open = false;
});
let printWasOpen = false;
window.addEventListener("beforeprint", () => {
  printWasOpen = $("excluded-details").open;
  $("excluded-details").open = true;
});
window.addEventListener("afterprint", () => {
  $("excluded-details").open = printWasOpen;
});
$("third-party").textContent = THIRD_PARTY;
languageTo("ja");
