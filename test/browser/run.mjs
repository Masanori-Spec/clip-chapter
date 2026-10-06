import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const art = resolve("artifacts/browser");
await mkdir(art, { recursive: true });
const report = {
  status: "RUNNING",
  cases: [],
  pageErrors: [],
  networkRequests: [],
  screenshots: [],
};
const check = (name, details = {}) => {
  report.cases.push({ name, passed: true, ...details });
  console.log("PASS", name);
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw Error("Use a hosted sandboxed Chrome executable");
const browser = await chromium.launch({
  executablePath,
  headless: true,
  chromiumSandbox: true,
});
report.browserVersion = browser.version();
report.chromiumSandboxRequested = true;
const commands = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" })
  .split("\n")
  .filter(
    (line) =>
      line.includes("--remote-debugging-pipe") &&
      line.includes("--user-data-dir=") &&
      /chrome|chromium/.test(line),
  );
if (
  !commands.length ||
  commands.some(
    (line) =>
      line.includes("--no-sandbox") ||
      line.includes("--disable-setuid-sandbox"),
  )
)
  throw Error("Sandboxed Chrome was not established");
report.sandboxCommandVerified = true;
report.chromiumMainProcessCommands = commands;
report.sandboxPolicy =
  "chromiumSandbox:true; no --no-sandbox or --disable-setuid-sandbox";
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  acceptDownloads: true,
});
await context.setOffline(true);
const page = await context.newPage();
page.on("pageerror", (e) => report.pageErrors.push(e.message));
page.on("request", (r) => {
  if (/^https?:/.test(r.url())) report.networkRequests.push(r.url());
});
let downloads = 0;
page.on("download", () => downloads++);
const original = await readFile("artifacts/native/authored.mlt"),
  chapters = await readFile("artifacts/native/chapters.json");
const url = pathToFileURL(resolve("dist/clip-chapter.html")).href;
async function shot(name) {
  await page.screenshot({ path: resolve(art, name), fullPage: true });
  report.screenshots.push(name);
}
async function input(id, name, buffer) {
  await page
    .locator(id)
    .setInputFiles({ name, mimeType: "application/octet-stream", buffer });
}
async function loadProject(bytes = original) {
  await input("#mlt-input", "authored.mlt", bytes);
  await expect(page.locator("#occurrence")).toBeEnabled();
}
async function loadChapters(bytes = chapters, name = "chapters.json") {
  await input("#chapters-input", name, bytes);
  await expect(page.locator("#status")).not.toContainText(/Reading|読み込んで/);
}
async function select(id = "1:1") {
  await page.locator("#occurrence").selectOption(id);
  await expect(page.locator("#identity")).toBeEnabled();
  await page.locator("#identity").check();
}
async function ready() {
  await expect(page.locator("#export")).toBeEnabled();
  await expect(page.locator("#included-count")).toHaveText("4");
}
async function save(id, name, keyboard = false) {
  const wait = page.waitForEvent("download");
  if (keyboard) {
    await page.locator(id).focus();
    await page.keyboard.press("Enter");
  } else await page.locator(id).click();
  const d = await wait;
  await d.saveAs(resolve(art, name));
  return readFile(resolve(art, name));
}
function verifyReceipt(receipt, bytes) {
  expect(receipt.output.sha256).toBe(sha(bytes));
  expect(receipt.output.bytes).toBe(bytes.length);
  expect(receipt.input.sha256).toBe(sha(original));
  expect(receipt.input.bytes).toBe(original.length);
  expect(receipt.chapters.sha256).toBe(sha(chapters));
  expect(receipt.confirmedSourceIdentity).toBe(true);
  expect(receipt.occurrence.id).toBe("1:1");
  expect([
    receipt.occurrence.sourceIn,
    receipt.occurrence.sourceOut,
    receipt.occurrence.timelineStart,
  ]).toEqual([90, 269, 300]);
  expect(receipt.included.map((m) => [m.title, m.frame])).toEqual([
    ["Chapter A", 300],
    ["Chapter B", 366],
    ["Chapter C", 450],
    ["Last included", 479],
  ]);
  expect(receipt.excluded.map((m) => m.title)).toEqual([
    "Before trim",
    "After trim",
  ]);
  expect(
    receipt.existingMarkers.map((m) => [
      m.key,
      m.text,
      m.start,
      m.end,
      m.color,
    ]),
  ).toEqual([["0", "Baseline", 30, 30, "#008000"]]);
  expect(receipt.patch.markerOnly).toBe(true);
}
try {
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator("#export")).toBeDisabled();
  await shot("01-ja-empty-desktop.png");
  check("Self-contained HTML opens offline in Japanese with export blocked");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace")).toBeFocused();
  check("Keyboard skip link focuses workspace");
  const chooserWait = page.waitForEvent("filechooser");
  await page.locator("#mlt-input").focus();
  await page.keyboard.press("Enter");
  const chooser = await chooserWait;
  await chooser.setFiles(resolve("artifacts/native/authored.mlt"));
  await expect(page.locator("#occurrence")).toBeEnabled();
  await loadChapters();
  await expect(page.locator("#occurrence")).toHaveValue("");
  await expect(page.locator("#export")).toBeDisabled();
  check(
    "Keyboard MLT picker and real chapter file require explicit occurrence selection",
  );
  await page.locator("#occurrence").selectOption("1:1");
  await expect(page.locator("#export")).toBeDisabled();
  await page.locator("#identity").check();
  await ready();
  await expect(page.locator("#excluded-count")).toHaveText("2");
  await expect(page.locator("#existing-count")).toHaveText("1");
  await expect(page.locator("#point-rows tr")).toHaveCount(4);
  await shot("02-ja-reviewed-desktop.png");
  check("Explicit source identity enables literal four-marker review");
  const exported = await save("#export", "browser-export.mlt", true),
    receipt = JSON.parse(
      (await save("#receipt", "browser-receipt.json")).toString(),
    );
  verifyReceipt(receipt, exported);
  await copyFile(
    resolve(art, "browser-export.mlt"),
    "artifacts/native/patched.mlt",
  );
  await copyFile(
    resolve(art, "browser-receipt.json"),
    "artifacts/native/receipt.json",
  );
  report.nativeInput = {
    source: "actual sandboxed browser download",
    sha256: sha(exported),
    bytes: exported.length,
  };
  check(
    "Actual keyboard download and receipt match independent literals and input/output hashes",
    report.nativeInput,
  );
  await page.locator("#lang-en").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await ready();
  await expect(page.locator("#occurrence")).toHaveValue("1:1");
  await expect(page.locator("#receipt")).toBeEnabled();
  await shot("03-en-reviewed-desktop.png");
  check("Language switch preserves explicit selection and valid receipt");
  for (const language of ["ja", "en"]) {
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.locator(`#lang-${language}`).click();
    await page.locator("#excluded-details").evaluate((el) => (el.open = true));
    await page.pdf({
      path: resolve(art, `review-${language}.pdf`),
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    const printed = execFileSync(
      "pdftotext",
      [resolve(art, `review-${language}.pdf`), "-"],
      { encoding: "utf8" },
    );
    for (const text of [
      "Chapter A",
      "Chapter B",
      "Chapter C",
      "Last included",
      "Before trim",
      "After trim",
      "300",
      "366",
      "450",
      "479",
    ])
      expect(printed).toContain(text);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const b = await page.evaluate(() => ({
        view: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(b.scroll).toBeLessThanOrEqual(b.view + 1);
      await page
        .locator(".table-scroll")
        .evaluate((node) => (node.scrollLeft = 0));
      await shot(`04-${language}-mobile-${width}.png`);
      const scroll = await page.locator(".table-scroll").evaluate((node) => {
        node.scrollLeft = node.scrollWidth;
        const box = node.getBoundingClientRect(),
          last = node.querySelector("th:last-child").getBoundingClientRect();
        return {
          view: node.clientWidth,
          total: node.scrollWidth,
          position: node.scrollLeft,
          left: box.left,
          right: box.right,
          lastLeft: last.left,
          lastRight: last.right,
        };
      });
      expect(scroll.lastRight).toBeLessThanOrEqual(scroll.right + 1);
      expect(scroll.lastLeft).toBeGreaterThanOrEqual(scroll.left - 1);
      if (scroll.total > scroll.view)
        expect(scroll.position).toBeGreaterThan(0);
      await shot(`04-${language}-mobile-${width}-rounding-column.png`);
      check(
        `Native horizontal review scroll reaches the complete rounding column: ${language} ${width}px`,
        scroll,
      );
    }
  }
  check(
    "JA/EN PDFs contain every point/exclusion; 390/320px layouts have no page overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.locator("#lang-en").click();
  const mltLabel = await page.locator("#mlt-summary").textContent();
  await page.locator("#mlt-input").evaluate((el) => {
    el.value = "";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#mlt-summary")).toHaveText(mltLabel);
  await ready();
  check("Dispatched empty file change preserves the valid review");
  await page.locator("#occurrence").selectOption("1:0");
  await expect(page.locator("#identity")).not.toBeChecked();
  await expect(page.locator("#export")).toBeDisabled();
  await expect(page.locator("#receipt")).toBeDisabled();
  await page.locator("#identity").check();
  await expect(page.locator("#point-rows tr")).toHaveCount(6);
  expect(
    await page.locator("#point-rows tr td:nth-child(3)").allTextContents(),
  ).toEqual(["30", "90", "156", "240", "269", "270"]);
  check(
    "Other occurrence changes mapping and requires renewed source confirmation",
  );
  await page.locator("#occurrence").selectOption("0:0");
  await expect(page.locator("#status")).toContainText("UNSUPPORTED_CLIP");
  await expect(page.locator("#export")).toBeDisabled();
  check("Unsupported native background occurrence blocks export");
  for (const [label, text, code] of [
    [
      "retimed",
      original.toString().replaceAll("avformat-novalidate", "timewarp"),
      "UNSUPPORTED_CLIP",
    ],
    [
      "proxy",
      original
        .toString()
        .replace(
          '<property name="resource">source.mkv</property>',
          '<property name="resource">source.mkv</property><property name="shotcut:proxy">1</property>',
        ),
      "UNSUPPORTED_CLIP",
    ],
    [
      "DTD",
      '<!DOCTYPE mlt [<!ENTITY x SYSTEM "https://invalid.example/leak">]>' +
        original.toString(),
      "XML_DOCTYPE",
    ],
    ["malformed", "<mlt><bad></mlt>", "INVALID_XML"],
  ]) {
    await input("#mlt-input", `${label}.mlt`, Buffer.from(text));
    await expect(page.locator("#status")).not.toContainText("Reading");
    if (label === "retimed" || label === "proxy") {
      await page
        .locator("#occurrence")
        .selectOption(label === "proxy" ? "1:0" : "1:1");
    }
    await expect(page.locator("#status")).toContainText(code);
    await expect(page.locator("#export")).toBeDisabled();
    await expect(page.locator("#receipt")).toBeDisabled();
    check(`${label} input fails closed`);
  }
  await shot("05-en-blocked.png");
  await loadProject();
  await loadChapters(Buffer.from("{bad json}"));
  await expect(page.locator("#status")).toContainText("INVALID_JSON");
  await expect(page.locator("#export")).toBeDisabled();
  check("Malformed ffprobe data invalidates stale output");
  const origin = JSON.parse(chapters);
  origin.format.start_time = "1";
  await loadChapters(Buffer.from(JSON.stringify(origin)));
  await expect(page.locator("#status")).toContainText("SOURCE_ORIGIN");
  check("Nonzero ffprobe source origin is rejected");
  const mismatched = JSON.parse(chapters);
  mismatched.format.filename = "different-source.mkv";
  await loadChapters(Buffer.from(JSON.stringify(mismatched)));
  await select();
  await expect(page.locator("#status")).toContainText("SOURCE_MISMATCH");
  await expect(page.locator("#export")).toBeDisabled();
  check("Explicit filename mismatch blocks the selected occurrence");
  await loadChapters(
    Buffer.from("source_seconds,title\n3,CSV start\n5.21,Quantized\n9,Outside"),
    "points.csv",
  );
  await expect(page.locator("#csv-origin-wrap")).toBeVisible();
  await expect(page.locator("#export")).toBeDisabled();
  await page.locator("#csv-origin").check();
  await select();
  await expect(page.locator("#included-count")).toHaveText("2");
  await expect(page.locator("#point-rows")).toContainText("-3/10");
  await expect(page.locator("#excluded-count")).toHaveText("1");
  check(
    "Explicit CSV zero-origin confirmation, fractional rounding and trim exclusion",
  );
  await loadChapters(
    Buffer.from('source_seconds,title\n3,"<img src=x onerror=alert(1)>"'),
    "inert.csv",
  );
  await page.locator("#csv-origin").check();
  await select();
  await expect(page.locator("#point-rows")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  expect(await page.locator("#point-rows img").count()).toBe(0);
  check("Chapter labels render as inert text");
  await input("#mlt-input", "large.mlt", Buffer.alloc(8 * 1024 * 1024 + 1, 32));
  await expect(page.locator("#status")).toContainText("FILE_LIMIT");
  await expect(page.locator("#export")).toBeDisabled();
  check("Oversized project rejected before parsing");
  await page.evaluate(() => {
    window.__read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return window.__read.call(this);
    };
  });
  await input("#mlt-input", "late.mlt", original);
  await expect(page.locator("#status")).toContainText("Reading");
  await page.locator("#sample").click();
  await page.waitForTimeout(950);
  await expect(page.locator("#mlt-summary")).toHaveText("sample-shotcut.mlt");
  check("Late file read cannot overwrite a newer sample");
  await input("#mlt-input", "late.mlt", original);
  await page.locator("#reset").click();
  await page.waitForTimeout(950);
  await expect(page.locator("#results")).toBeHidden();
  await expect(page.locator("#export")).toBeDisabled();
  await expect(page.locator("#mlt-summary")).toHaveText("No file selected");
  check("Clear cancels pending file reads");
  await page.evaluate(() => (File.prototype.arrayBuffer = window.__read));
  await loadProject();
  await loadChapters();
  await select();
  await ready();
  await page.evaluate(() => {
    window.__digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return window.__digest(...args);
    };
  });
  const before = downloads;
  await page.locator("#export").click();
  await expect(page.locator("#export")).toBeDisabled();
  await page.locator("#occurrence").selectOption("1:0");
  await page.waitForTimeout(950);
  expect(downloads).toBe(before);
  await expect(page.locator("#receipt")).toBeDisabled();
  check("New occurrence cancels a pending hash/export without stale download");
  await page.evaluate(() => (crypto.subtle.digest = window.__digest));
  await select();
  await ready();
  const repeated1 = await save("#export", "repeated-1.mlt"),
    repeated2 = await save("#export", "repeated-2.mlt");
  expect(repeated1).toEqual(repeated2);
  expect(repeated1).toEqual(exported);
  check("Repeated explicit export is byte deterministic");
  const offline = await save("#offline", "saved-offline.html");
  expect(offline.toString()).not.toContain("authored.mlt ·");
  const fresh = await context.newPage();
  fresh.on("pageerror", (e) => report.pageErrors.push(e.message));
  fresh.on("request", (r) => {
    if (/^https?:/.test(r.url())) report.networkRequests.push(r.url());
  });
  await fresh.goto(pathToFileURL(resolve(art, "saved-offline.html")).href);
  await expect(fresh.locator("#mlt-summary")).toHaveText("未選択");
  await expect(fresh.locator("#export")).toBeDisabled();
  await fresh.locator("#sample").click();
  await expect(fresh.locator("#occurrence")).toBeEnabled();
  await expect(fresh.locator("#occurrence")).toHaveValue("");
  await fresh.close();
  check(
    "Downloaded offline tool starts clean and still requires explicit occurrence",
  );
  expect(report.pageErrors).toEqual([]);
  expect(report.networkRequests).toEqual([]);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.reason = error.message;
  report.stack = error.stack;
  try {
    report.layoutOverflows = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .map((node) => ({
          tag: node.tagName,
          id: node.id,
          cls: node.className,
          left: node.getBoundingClientRect().left,
          right: node.getBoundingClientRect().right,
        }))
        .filter((rect) => rect.right > innerWidth + 1 || rect.left < -1),
    );
    await shot("99-failure.png");
  } catch {}
  throw error;
} finally {
  await writeFile(
    resolve(art, "browser-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await context.close();
  await browser.close();
}
console.log(
  "PASS browser download is ready for unchanged official native verification",
);
