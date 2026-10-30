/**
 * T22 ELAPSED DECIMAL verification (耗时秒数去小数): the 0.4.9 toggle that
 * strips the fractional part from ZCode's live working-row elapsed time
 * ("1 时 17 分 53.4 秒" → "1 时 17 分 53 秒"). The decimal comes from a
 * hardcoded toFixed(1) inside the renderer bundle, baked into ONE
 * aria-hidden text span under [data-zcode-chat-loading-animate] — CSS
 * cannot reach mid-string text, so applyChatLook installs a
 * MutationObserver that rewrites it.
 *   A  normalizeChatLook carries/clamps the flag (1/true → 1, else 0);
 *   B  buildPayload passes it through into the chatLook payload;
 *   C  behavioral, real bootstrap inside jsdom:
 *      install-time sweep strips an existing row; a React-style
 *      firstChild.nodeValue update gets re-stripped; a freshly mounted
 *      row gets swept through the childList branch; the en-locale format
 *      ("1h 17m 53.4s") strips too; unrelated decimal text is untouched;
 *      toggling OFF through the chat fast path disconnects the observer.
 *
 * Run: npx tsx test/t22-elapsed-decimal.ts   (also part of: npm test)
 */
import { JSDOM } from "jsdom";
import { normalizeChatLook, buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript } from "../src/core/cdp.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base: BeautifyConfig = { ...DEFAULT_CONFIG, monet: false, wallpaperVisible: false };

// --- part A: normalize --------------------------------------------------------
{
  const n = normalizeChatLook({ hideElapsedDecimal: 1 });
  check("normalize keeps 1", n.hideElapsedDecimal === 1);
  check("normalize maps true → 1", normalizeChatLook({ hideElapsedDecimal: true }).hideElapsedDecimal === 1);
  check("absent → 0 (old configs stay stock)", normalizeChatLook().hideElapsedDecimal === 0);
  check("junk → 0", normalizeChatLook({ hideElapsedDecimal: "yes" as never }).hideElapsedDecimal === 0);
}

// --- part B: payload passthrough ---------------------------------------------
{
  const p = buildPayload({ ...base, chatLook: { hideElapsedDecimal: 1 } });
  check("payload.chatLook carries the flag", p.chatLook?.hideElapsedDecimal === 1);
  const off = buildPayload(base);
  check("absent flag normalizes to 0", off.chatLook?.hideElapsedDecimal === 0);
}

// --- part C: behavioral (real bootstrap in jsdom) -----------------------------
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
const { window } = dom;
const boot = (on: boolean) =>
  window.eval(buildBootstrapScript({
    css: buildPayload(base).css,
    chatLook: { chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0, hideElapsedDecimal: on ? 1 : 0 },
    wallpaperDataUri: "",
    videoSrc: "",
  }));

/** Build the working row exactly like ZCode's bundle renders it: pixel-grid
 * icon span (also aria-hidden, but textless) + label + mono duration span. */
function makeRow(id: string, text: string): HTMLElement {
  const row = window.document.createElement("div");
  row.setAttribute("role", "status");
  row.setAttribute("data-zcode-chat-loading-animate", "true");
  row.className = "inline-flex w-fit items-center gap-2.5";
  const icon = window.document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.className = "grid shrink-0 size-[13px]";
  const label = window.document.createElement("span");
  label.className = "zcode-loading-label text-ui-base font-medium";
  label.textContent = "工作中";
  const dur = window.document.createElement("span");
  dur.setAttribute("aria-hidden", "true");
  dur.className = "font-mono text-ui-caption tabular-nums text-foreground-subtle";
  dur.textContent = text;
  row.append(icon, label, dur);
  return row;
}

{
  // Row exists BEFORE the bootstrap runs → the install-time sweep strips it.
  const row = makeRow("a", "1 时 17 分 53.4 秒");
  window.document.body.appendChild(row);
  boot(true);
  const dur = row.querySelectorAll('span[aria-hidden="true"]')[1];
  check("install sweep strips the decimal", dur.textContent === "1 时 17 分 53 秒", String(dur.textContent));

  // React's update path: setTextContent fast-path writes firstChild.nodeValue
  // on OUR text node — the observer must re-strip in the same shape.
  dur.firstChild!.nodeValue = "1 时 17 分 54.7 秒";
  await sleep(20);
  check("React-style nodeValue update re-stripped", dur.textContent === "1 时 17 分 54 秒", String(dur.textContent));

  // Fresh mount (route change re-creates the row) → childList branch.
  const fresh = makeRow("b", "12.3 秒");
  window.document.body.appendChild(fresh);
  await sleep(20);
  const freshDur = fresh.querySelectorAll('span[aria-hidden="true"]')[1];
  check("newly mounted row swept", freshDur.textContent === "12 秒", String(freshDur.textContent));

  // en-locale format (no spaces between value and unit).
  const en = makeRow("c", "1h 17m 53.4s");
  window.document.body.appendChild(en);
  await sleep(20);
  check("en format stripped too", en.querySelectorAll('span[aria-hidden="true"]')[1].textContent === "1h 17m 53s");

  // Unrelated decimal text must never be touched.
  const other = window.document.createElement("span");
  other.textContent = "version v1.2.3";
  window.document.body.appendChild(other);
  await sleep(20);
  check("unrelated decimal text untouched", other.textContent === "version v1.2.3");

  // Toggle OFF through the chat fast path (same css otherwise): the observer
  // disconnects and later React ticks keep the stock decimal text.
  boot(false);
  check("observer disconnected when toggled off", (window as never as { __zcodeBeautify: { elapsedObs: unknown } }).__zcodeBeautify.elapsedObs === null);
  dur.firstChild!.nodeValue = "1 时 17 分 55.9 秒";
  await sleep(20);
  check("off → stock decimal text stays", dur.textContent === "1 时 17 分 55.9 秒", String(dur.textContent));
}

console.log(failed === 0 ? "\nT22 all green" : `\nT22 FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
