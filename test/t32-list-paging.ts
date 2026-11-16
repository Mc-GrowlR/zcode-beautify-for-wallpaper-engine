/**
 * T32 会话列表分页 (sidebar list paging) verification:
 *   A  normalizeListPaging: off default, clamping, collapse/showTotal
 *      default-on, step ignored while off;
 *   B  buildPayload: ZCode carries the normalized config, WorkBuddy is forced
 *      to stock even when a copied config enables it;
 *   C  behavioral (real bootstrap, fresh jsdom per scenario): rows beyond
 *      `initial` hide inline, the toolbar clones the native button look,
 *      显示更多 render-aheads by CLICKING the native button, 收起 snaps back
 *      and MORE keeps working after the native button is exhausted, the
 *      worktree-creating rows are never paged, config off cleans everything,
 *      collapse=false ships no 收起, and a second eval with new counts takes
 *      over through the listKey fast path;
 *   D  the reset script cleans the paging artifacts;
 *   E  panel ships the block and posts listPaging;
 *   F  serve wiring: sanitize + publicConfig + both bootstrap assembly points.
 *
 * Run: npx tsx test/t32-list-paging.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeListPaging, buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript, buildResetScript, LIST_PAGING_VER } from "../src/core/cdp.js";
import { buildPanelScript } from "../src/panel/panelScript.js";
import { baseConfig } from "../src/core/session.js";
import { setTarget } from "../src/core/target.js";
import { themeFromSourceColor, argbFromRgb } from "@material/material-color-utilities";
import type { WallpaperAssets } from "../src/core/monet.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

process.env.ZCODE_BEAUTIFY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t32-"));

const theme = themeFromSourceColor(argbFromRgb(42, 96, 153));
const assets: WallpaperAssets = {
  dataUri: "data:image/jpeg;base64,AAAA",
  sourceArgb: argbFromRgb(42, 96, 153),
  theme,
  focus: { fit: "cover", x: 0.5, y: 0.5 },
};
const base: BeautifyConfig = { ...DEFAULT_CONFIG, monet: true, wallpaperVisible: true };

// --- part A: normalization ---------------------------------------------------
{
  const off = normalizeListPaging(undefined);
  check("default is off (stock 5/+5, no collapse)", off.initial === 0 && off.step === 0 && off.collapse === 0 && off.showTotal === 0);
  const on = normalizeListPaging({ initial: 8, step: 3, collapse: 0 });
  check("counts pass through, explicit collapse=false sticks", on.initial === 8 && on.step === 3 && on.collapse === 0);
  check("collapse defaults to ON when omitted", normalizeListPaging({ initial: 5 }).collapse === 1);
  check("showTotal defaults to ON when omitted", normalizeListPaging({ initial: 5 }).showTotal === 1);
  check("explicit showTotal off sticks", normalizeListPaging({ initial: 5, showTotal: 0 }).showTotal === 0 && normalizeListPaging({ initial: 5, showTotal: false }).showTotal === 0);
  check("collapseAll defaults to ON when omitted (one-shot 收起)", normalizeListPaging({ initial: 5 }).collapseAll === 1);
  check("explicit collapseAll=false sticks (step-wise 收起)", normalizeListPaging({ initial: 5, collapseAll: 0 }).collapseAll === 0 && normalizeListPaging({ initial: 5, collapseAll: false }).collapseAll === 0);
  check("step defaults to 5 when omitted", normalizeListPaging({ initial: 5 }).step === 5);
  check("initial clamps to 100", normalizeListPaging({ initial: 500, step: 5 }).initial === 100);
  check("step clamps to 1-100", normalizeListPaging({ initial: 5, step: 0 }).step === 1 && normalizeListPaging({ initial: 5, step: 999 }).step === 100);
  const offIgn = normalizeListPaging({ initial: 0, step: 50, collapse: 1, showTotal: 1, collapseAll: 1 });
  check("initial 0 forces everything off", offIgn.initial === 0 && offIgn.step === 0 && offIgn.collapse === 0 && offIgn.showTotal === 0 && offIgn.collapseAll === 0);
  check("garbage initial falls back to off", normalizeListPaging({ initial: NaN }).initial === 0);
}

// --- part B: payload ----------------------------------------------------------
{
  setTarget("zcode");
  const payload = buildPayload({ ...base, listPaging: { initial: 6, step: 10, collapse: false } }, assets);
  check("zcode payload carries the normalized paging", payload.listPaging?.initial === 6 && payload.listPaging?.step === 10 && payload.listPaging?.collapse === 0 && payload.listPaging?.showTotal === 1 && payload.listPaging?.collapseAll === 1);
  setTarget("workbuddy");
  const wb = buildPayload({ ...base, listPaging: { initial: 6, step: 10, collapse: true } }, assets);
  check("workbuddy is forced to stock paging", wb.listPaging?.initial === 0 && wb.listPaging?.step === 0 && wb.listPaging?.showTotal === 0 && wb.listPaging?.collapseAll === 0);
  setTarget("zcode");
}

// --- part C: behavioral --------------------------------------------------------
{
  const { JSDOM } = await import("jsdom");
  const makeWindow = () => new JSDOM("<!doctype html><html lang='zh-CN'><body></body></html>", {
    url: "http://127.0.0.1/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  }).window;

  // A faithful mini-ZCode: 12 sessions, React "limit" semantics — the native
  // button mounts +3 rows per click (pageSize) and unmounts once every row is
  // mounted, exactly like ProjectTaskRows' hasMore slice. `extraWrap` models
  // the CollapsibleContent animation wrapper that appears after a
  // collapse/expand cycle: host > div(anim) > div.pl-2 > list — one layer
  // deeper than the fresh-mount structure.
  function mountSidebar(w: any, opts: { total: number; nativeStep?: number; extraWrap?: boolean } = { total: 12 }) {
    const doc = w.document;
    const host = doc.createElement("div");
    host.setAttribute("data-testid", "virtual-project-tasks");
    let wrap = doc.createElement("div");
    if (opts.extraWrap) {
      const anim = doc.createElement("div");
      anim.setAttribute("data-state", "open");
      host.appendChild(anim);
      wrap.className = "pl-2 pt-1";
      anim.appendChild(wrap);
    } else {
      wrap.className = "pl-2 pt-1";
      host.appendChild(wrap);
    }
    const list = doc.createElement("div"); // ProjectTaskRows root (project kind)
    // ManagedWorktreeCreatingRows renders py-px rows as SIBLINGS of the list
    // (fragment → direct children of the pl-2 wrapper); they must never be
    // paged, and their presence must not qualify the wrapper as a container.
    const creating = doc.createElement("div");
    creating.className = "py-px";
    const cbtn = doc.createElement("button");
    cbtn.setAttribute("data-testid", "worktree-creating-row");
    creating.appendChild(cbtn);
    wrap.appendChild(creating);
    const total = opts.total;
    const step = opts.nativeStep ?? 5;
    let mounted = 0;
    const addRows = (n: number) => {
      for (let i = 0; i < n && mounted < total; i++) {
        const row = doc.createElement("div");
        row.className = "py-px";
        row.textContent = "row-" + mounted++;
        list.insertBefore(row, list.querySelector("button[data-task-list-show-more]"));
      }
      if (mounted >= total) btn.remove();
    };
    const btn = doc.createElement("button");
    btn.setAttribute("data-task-list-show-more", "true");
    btn.className = "ml-8.5 h-auto p-0 text-ui-base";
    btn.textContent = "显示更多";
    btn.addEventListener("click", () => addRows(step));
    list.appendChild(btn);
    addRows(5); // stock first page
    wrap.appendChild(list);
    doc.body.appendChild(host);
    return { host, wrap, list, btn };
  }

  const visibleRows = (list: any) =>
    Array.from(list.querySelectorAll(":scope > div.py-px")).filter((r: any) => r.style.display !== "none").length;
  const hiddenRows = (list: any) =>
    Array.from(list.querySelectorAll(":scope > div.py-px")).filter((r: any) => r.style.display === "none").length;

  // C1: initial=4, step=3, collapse on — the full paging lifecycle.
  {
    const w = makeWindow();
    const { list, btn } = mountSidebar(w);
    w.eval(buildBootstrapScript({ css: "", listPaging: { initial: 4, step: 3, collapse: 1, collapseAll: 1 } }));
    check("C1 style element mounted", !!w.document.getElementById("zcode-beautify-list-style"));
    // Stock first page mounts 5 rows; init=4 hides exactly one.
    check("C1 initial=4 rows visible (one hidden of the stock 5)", visibleRows(list) === 4 && hiddenRows(list) === 1, `v=${visibleRows(list)} h=${hiddenRows(list)}`);
    check("C1 container marked data-zb-paging", list.getAttribute("data-zb-paging") === "on");
    check("C1 native button hidden by our rule", w.document.getElementById("zcode-beautify-list-style")?.textContent?.includes("[data-zb-paging] > button[data-task-list-show-more]{display:none!important}") === true);
    const bar = list.querySelector(":scope > div[data-zb-list-bar]");
    check("C1 toolbar mounted inside the list", !!bar);
    const more = bar?.querySelector("[data-zb-list-more]") as any;
    const less = bar?.querySelector("[data-zb-list-less]") as any;
    check("C1 MORE cloned from the native look", more && more.className.includes("ml-8.5") && more.textContent === "显示更多");
    check("C1 MORE lost the native paging attr", more && !more.hasAttribute("data-task-list-show-more"));
    check("C1 收起 hidden at the baseline (nothing to collapse)", less && less.style.display === "none");
    check("C1 toolbar is the list's last child", list.lastElementChild === bar);
    check("C1 native still in the DOM (render-ahead clicks it)", list.contains(btn));

    more.click();
    check("C1 MORE click reveals +3 (render-ahead clicked native)", visibleRows(list) === 7 && hiddenRows(list) === 3, `v=${visibleRows(list)} h=${hiddenRows(list)}`);
    check("C1 收起 appears once expanded past the baseline", less.style.display !== "none");
    more.click();
    more.click();
    check("C1 exhausting: all 12 visible", visibleRows(list) === 12 && hiddenRows(list) === 0, `v=${visibleRows(list)}`);
    check("C1 native button unmounted at total", !list.querySelector(":scope > button[data-task-list-show-more]"));
    check("C1 MORE hidden once nothing remains", more.style.display === "none");
    check("C1 collapse still offered", less.style.display !== "none");

    less.click();
    check("C1 收起 snaps back to initial=4", visibleRows(list) === 4 && hiddenRows(list) === 8, `v=${visibleRows(list)}`);
    check("C1 MORE comes back after 收起 (native gone but rows hidden)", more.style.display !== "none");
    more.click();
    check("C1 MORE still expands after native exhausted", visibleRows(list) === 7, `v=${visibleRows(list)}`);

    check("C1 creating row never paged", !w.document.querySelector(".py-px > [data-testid='worktree-creating-row']").closest("[data-zb-paging]"));
    check("C1 observer registered", !!(w as any).__zcodeBeautify?.listObs);
    check("C1 slots published", (w as any).__zcodeBeautify?.listInit === 4 && (w as any).__zcodeBeautify?.listStep === 3 && (w as any).__zcodeBeautify?.listCollapse === true && (w as any).__zcodeBeautify?.listShowTotal === false && (w as any).__zcodeBeautify?.listCollapseAll === true);
  }

  // C2: second eval with different counts rides the listKey fast path and
  // takes over WITHOUT re-running the wallpaper work (chatKey stays equal).
  {
    const w = makeWindow();
    const { list } = mountSidebar(w);
    const boot = (lp: any) => buildBootstrapScript({ css: "", listPaging: lp });
    w.eval(boot({ initial: 4, step: 3, collapse: 0 }));
    w.eval(boot({ initial: 9, step: 2, collapse: 0 }));
    check("C2 re-eval re-baselines to the new initial", visibleRows(list) === 9 && hiddenRows(list) === 1, `v=${visibleRows(list)} h=${hiddenRows(list)}`);
    check("C2 slots updated (stale-closure guard)", (w as any).__zcodeBeautify?.listInit === 9);
    const bar = list.querySelector(":scope > div[data-zb-list-bar]");
    check("C2 collapse=0 keeps 收起 hidden", bar && bar.querySelector("[data-zb-list-less]").style.display === "none");
    check("C2 single observer (not re-registered)", !!(w as any).__zcodeBeautify?.listObs);
  }

  // C6: showTotal — the 共 N 条 indicator reads the settled row count, which
  // only exists once EVERY row is mounted (React's hasMore gate). With the
  // knob on, the first scan render-aheads to the end of the list (native
  // retires) instead of stopping at `visible`; extras stay hidden. Without
  // it, the stock render-ahead keeps the native button alive.
  {
    const w = makeWindow();
    const { list, btn } = mountSidebar(w);
    const boot = (lp: any) => buildBootstrapScript({ css: "", listPaging: lp });
    w.eval(boot({ initial: 4, step: 3, collapse: 1, showTotal: 1, collapseAll: 1 }));
    check("C6 showTotal mounts the whole list on first scan", visibleRows(list) === 4 && hiddenRows(list) === 8, `v=${visibleRows(list)} h=${hiddenRows(list)}`);
    check("C6 native button retired by the full render-ahead", !list.querySelector(":scope > button[data-task-list-show-more]") && !list.contains(btn));
    const bar = list.querySelector(":scope > div[data-zb-list-bar]");
    const totalEl = bar?.querySelector("[data-zb-list-total]") as any;
    // Remaining-count semantics: the indicator reads the still-hidden rows.
    check("C6 indicator shows the hidden count (12 mounted, 4 visible)", totalEl && totalEl.style.display !== "none" && totalEl.textContent === "还有 8 条", `t=${totalEl && totalEl.textContent}`);
    check("C6 indicator sits right after MORE, before 收起", bar?.querySelector("[data-zb-list-total]").nextSibling?.getAttribute?.("data-zb-list-less") === "1");
    check("C6 count styled auxiliary (12px, nowrap)", totalEl.style.fontSize === "12px" && totalEl.style.whiteSpace === "nowrap");
    check("C6 MORE still offered (rows hidden)", (bar?.querySelector("[data-zb-list-more]") as any).style.display !== "none");
    check("C6 收起 hidden at the baseline", (bar?.querySelector("[data-zb-list-less]") as any).style.display === "none");
    const moreC6 = bar?.querySelector("[data-zb-list-more]") as any;
    const lessC6 = bar?.querySelector("[data-zb-list-less]") as any;
    moreC6.click();
    check("C6 MORE reveals +3, count shrinks", visibleRows(list) === 7 && totalEl.textContent === "还有 5 条", `v=${visibleRows(list)} t=${totalEl.textContent}`);
    check("C6 收起 appears once expanded", lessC6.style.display !== "none");
    lessC6.click();
    check("C6 收起 snaps back, count back to the baseline hidden count", visibleRows(list) === 4 && totalEl.textContent === "还有 8 条");
    // A new session arrives (React appends a row): the observer rescans and
    // the count follows.
    const row13 = w.document.createElement("div");
    row13.className = "py-px";
    row13.textContent = "row-12";
    list.insertBefore(row13, bar);
    await sleep(150);
    check("C6 count follows a newly arrived row", visibleRows(list) === 4 && totalEl.textContent === "还有 9 条" && moreC6.style.display !== "none", `t=${totalEl.textContent}`);
    // Reveal everything: the indicator disappears at zero (nothing hidden).
    for (let i = 7; i < 13; i++) moreC6.click();
    check("C6 full reveal hides the indicator (nothing left)", visibleRows(list) === 13 && totalEl.textContent === "" && totalEl.style.display === "none" && moreC6.style.display === "none" && lessC6.style.display !== "none");
    lessC6.click();
    check("C6 收起 brings the indicator back", visibleRows(list) === 4 && totalEl.textContent === "还有 9 条" && totalEl.style.display !== "none");
    // showTotal=0 keeps the stock render-ahead: native survives, no indicator.
    const w2 = makeWindow();
    const { list: list2 } = mountSidebar(w2);
    w2.eval(boot({ initial: 4, step: 3, collapse: 1, showTotal: 0 }));
    const bar2 = list2.querySelector(":scope > div[data-zb-list-bar]");
    const totalEl2 = bar2?.querySelector("[data-zb-list-total]") as any;
    check("C6 showTotal=off: native kept, no indicator text",
      !!list2.querySelector("button[data-task-list-show-more]") && (!totalEl2 || totalEl2.style.display === "none") && visibleRows(list2) === 4);
    // A bar built by an OLDER generation (pre-6.3.1) has no total span — the
    // new code must graft one in (live bug: real lists kept their old bar and
    // never grew the indicator).
    const w3 = makeWindow();
    const { list: list3 } = mountSidebar(w3);
    const oldBar = w3.document.createElement("div");
    oldBar.setAttribute("data-zb-list-bar", "1");
    const oldMore = w3.document.createElement("button");
    oldMore.setAttribute("data-zb-list-more", "1");
    oldMore.textContent = "显示更多";
    const oldLess = w3.document.createElement("button");
    oldLess.setAttribute("data-zb-list-less", "1");
    oldLess.textContent = "收起";
    oldBar.appendChild(oldMore);
    oldBar.appendChild(oldLess);
    list3.appendChild(oldBar);
    // Old generation already exhausted the native button: rows pre-mounted.
    while (list3.querySelectorAll(":scope > div.py-px").length < 12) {
      const row = w3.document.createElement("div");
      row.className = "py-px";
      row.textContent = "row-old-" + row;
      list3.insertBefore(row, oldBar);
    }
    list3.querySelector("button[data-task-list-show-more]")?.remove();
    w3.eval(boot({ initial: 4, step: 3, collapse: 1, showTotal: 1 }));
    const bar3 = list3.querySelector(":scope > div[data-zb-list-bar]");
    const tot3 = bar3?.querySelector("[data-zb-list-total]") as any;
    check("C6 legacy bar gains the grafted span with the count",
      !!tot3 && tot3.textContent === "还有 8 条" && tot3.previousSibling === oldMore && tot3.nextSibling === oldLess,
      `t=${tot3 && tot3.textContent}`);
    check("C6 grafted span restyled to the current values", tot3.style.fontSize === "12px" && tot3.style.whiteSpace === "nowrap" && tot3.style.opacity === "0.65");
  }

  // C7: collapseAll=0 — 收起 steps back by `step` per click instead of one
  // shot, floor at the initial count; the button hides once it gets there.
  {
    const w = makeWindow();
    const { list } = mountSidebar(w);
    const boot = (lp: any) => buildBootstrapScript({ css: "", listPaging: lp });
    w.eval(boot({ initial: 4, step: 3, collapse: 1, collapseAll: 0 }));
    check("C7 slot published (step-wise)", (w as any).__zcodeBeautify?.listCollapseAll === false);
    const bar = list.querySelector(":scope > div[data-zb-list-bar]");
    const moreC7 = bar?.querySelector("[data-zb-list-more]") as any;
    const lessC7 = bar?.querySelector("[data-zb-list-less]") as any;
    moreC7.click();
    moreC7.click();
    check("C7 expanded to 10 (4+3+3)", visibleRows(list) === 10, `v=${visibleRows(list)}`);
    lessC7.click();
    check("C7 first 收起 steps back one page (10→7)", visibleRows(list) === 7, `v=${visibleRows(list)}`);
    lessC7.click();
    check("C7 second 收起 reaches the initial (7→4)", visibleRows(list) === 4, `v=${visibleRows(list)}`);
    check("C7 收起 hides once nothing remains to collapse", lessC7.style.display === "none");
    moreC7.click();
    check("C7 MORE re-expands normally afterwards", visibleRows(list) === 7, `v=${visibleRows(list)}`);
    check("C7 收起 returns while expanded", lessC7.style.display !== "none");
  }

  // C3: initial=0 cleans everything up (also from the fast path).
  {
    const w = makeWindow();
    const { list } = mountSidebar(w);
    const boot = (lp: any) => buildBootstrapScript({ css: "", listPaging: lp });
    w.eval(boot({ initial: 4, step: 3, collapse: 1 }));
    w.eval(boot({ initial: 0, step: 0, collapse: 0 }));
    check("C3 teardown removes style + toolbar + attrs + hides",
      !w.document.getElementById("zcode-beautify-list-style")
      && !list.querySelector("[data-zb-list-bar]")
      && list.getAttribute("data-zb-paging") !== "on"
      && hiddenRows(list) === 0
      && !(w as any).__zcodeBeautify?.listObs);
  }

  // C4: depth-proof discovery — CollapsibleContent grows an extra animation
  // wrapper after a collapse/expand cycle (host > anim > pl-2 > list), moving
  // the list one layer below the old depth-3 discovery. The pl-2 wrapper (its
  // children = creating py-px rows + the non-py-px container) must never
  // qualify, and a stale wrong marking from an older generation must be undone.
  {
    const w = makeWindow();
    const { wrap, list } = mountSidebar(w, { total: 12, extraWrap: true });
    // Pre-fix generations marked the pl-2 wrapper and hid its container child.
    wrap.setAttribute("data-zb-paging", "on");
    (list as any).style.display = "none";
    const boot = (lp: any) => buildBootstrapScript({ css: "", listPaging: lp });
    w.eval(boot({ initial: 4, step: 3, collapse: 1 }));
    check("C4 depth-4 container is found and marked", list.getAttribute("data-zb-paging") === "on");
    check("C4 pl-2 wrapper never qualifies (stale marking undone)",
      wrap.getAttribute("data-zb-paging") !== "on" && (list as any).style.display === "");
    check("C4 depth-4 rows page exactly like depth-3", visibleRows(list) === 4 && hiddenRows(list) === 1, `v=${visibleRows(list)} h=${hiddenRows(list)}`);
    check("C4 creating rows untouched", !w.document.querySelector(".py-px > [data-testid='worktree-creating-row']").closest("[data-zb-paging]"));
    const bar = list.querySelector(":scope > div[data-zb-list-bar]");
    check("C4 toolbar lands in the depth-4 container", bar && list.lastElementChild === bar);
    w.eval(boot({ initial: 7, step: 2, collapse: 0 }));
    check("C4 config change re-baselines the depth-4 list", visibleRows(list) === 7, `v=${visibleRows(list)}`);
  }
  // C5: generation handoff — a serve restart ships fixed code while the page
  // still carries an older generation's state (identical css/chat/list keys).
  // The baked LIST_PAGING_VER stamp must force a re-apply then, and same-build
  // re-evals must keep the early-return (fast paths stay intact).
  {
    const w = makeWindow();
    const { list, wrap } = mountSidebar(w);
    const boot = (lp: any) => buildBootstrapScript({ css: "", listPaging: lp });
    w.eval(boot({ initial: 4, step: 3, collapse: 1 }));
    const obs1 = (w as any).__zcodeBeautify.listObs;
    // Sentinel: a same-build re-eval must early-return on the identity check
    // (no scan → the bogus marking survives untouched).
    wrap.setAttribute("data-zb-paging", "on");
    w.eval(boot({ initial: 4, step: 3, collapse: 1 }));
    await sleep(60);
    check("C5 same-build re-eval early-returns (scan did not run)",
      wrap.getAttribute("data-zb-paging") === "on");
    check("C5 observer identity stable across same-config pushes", (w as any).__zcodeBeautify.listObs === obs1);
    check("C5 stamp recorded", (w as any).__zcodeBeautify.listStamp === LIST_PAGING_VER);
    wrap.removeAttribute("data-zb-paging");
    // Simulate an OLDER generation that paged the wrong element and left its
    // stamps behind: everything else matches, only the build stamps are stale
    // (a real old-generation observer carries the old build's ObsStamp too).
    wrap.setAttribute("data-zb-paging", "on");
    (w as any).__zcodeBeautify.listStamp = LIST_PAGING_VER - 1;
    (w as any).__zcodeBeautify.listObsStamp = LIST_PAGING_VER - 1;
    w.eval(boot({ initial: 4, step: 3, collapse: 1 }));
    await sleep(80);
    check("C5 stale stamp forces the new generation's scan (wrong marking undone)",
      wrap.getAttribute("data-zb-paging") !== "on" && list.getAttribute("data-zb-paging") === "on");
    check("C5 observer evicted to the new generation", (w as any).__zcodeBeautify.listObs !== obs1 && (w as any).__zcodeBeautify.listObsStamp === LIST_PAGING_VER);
    check("C5 stamp refreshed after the forced apply", (w as any).__zcodeBeautify.listStamp === LIST_PAGING_VER);
  }
}

// --- part D: reset -------------------------------------------------------------
{
  const reset = buildResetScript();
  check("reset removes -list-style, bars, paging attrs and clears listKey/observer",
    reset.includes("'-list-style'") && reset.includes("[data-zb-list-bar]") && reset.includes("[data-zb-paging]") && reset.includes("listKey = null") && reset.includes("listStamp = null") && reset.includes("listObs"));
}

// --- part E: panel --------------------------------------------------------------
{
  const panel = buildPanelScript(9223, "tok", true, { appName: "ZCode", chatUi: true, hasUpdater: false });
  check("panel ships the 会话列表分页 block", panel.includes("会话列表分页"));
  check("panel carries the on/init/step/collapse/total/collapseall controls",
    panel.includes('id="zb-list-on"') && panel.includes('id="zb-list-init"') && panel.includes('id="zb-list-step"') && panel.includes('id="zb-list-collapse"') && panel.includes('id="zb-list-total"') && panel.includes('id="zb-list-collapseall"'));
  check("panel posts the full listPaging object", panel.includes("listPaging: {") && panel.includes("initial: on ?") && panel.includes("showTotal: $('zb-list-total')") && panel.includes("collapseAll: $('zb-list-collapseall')"));
  const wbPanel = buildPanelScript(9223, "tok", true, { appName: "WorkBuddy", chatUi: false, hasUpdater: false });
  // Non-ZCode clients lose the whole chat TAB at runtime (t28's source-string
  // approach — the pane is unreachable without its tab button).
  check("workbuddy panel removes the chat tab at runtime", wbPanel.includes('querySelector(\'.zb-tab[data-tab="chat"]\')'));
}

// --- part F: serve wiring --------------------------------------------------------
{
  const serveSrc = read(path.join(root, "src/core/server.ts"));
  check("sanitize accepts listPaging", serveSrc.includes("out.listPaging = normalizeListPaging(body.listPaging)"));
  check("publicConfig exposes listPaging", serveSrc.includes("listPaging: normalizeListPaging(config.listPaging)"));
  check("BOTH bootstrap assembly points carry listPaging", (serveSrc.match(/listPaging: payload.listPaging/g) ?? []).length === 2);
  const sessionSrc = read(path.join(root, "src/core/session.ts"));
  check("baseConfig merges listPaging partials", sessionSrc.includes("opts.listPaging ? { ...stored.listPaging, ...opts.listPaging } : stored.listPaging"));
  const mcpSrc = read(path.join(root, "src/mcp/server.ts"));
  check("apply_options exposes the list knobs incl. the total toggle", mcpSrc.includes("list_initial") && mcpSrc.includes("list_step") && mcpSrc.includes("list_collapse") && mcpSrc.includes("list_show_total") && mcpSrc.includes("list_collapse_all") && mcpSrc.includes("showTotal: list_show_total ? 1 : 0") && mcpSrc.includes("collapseAll: list_collapse_all ? 1 : 0"));
  const injectSrc = read(path.join(root, "src/core/inject.ts"));
  check("payload normalizes per-target like the other chat extras", injectSrc.includes("chatUi ? normalizeListPaging(config.listPaging) : normalizeListPaging(undefined)"));
}

// --- G: merge semantics via baseConfig -------------------------------------------
{
  const stored: any = { port: 9222, blur: 0, dim: 25, monet: true, wallpaperVisible: true, fit: "cover", listPaging: { initial: 8, step: 5, collapse: 1 } };
  const merged = baseConfig({ listPaging: { step: 10 } }, stored);
  check("one-field tweak keeps the other fields", merged.listPaging?.initial === 8 && merged.listPaging?.step === 10 && merged.listPaging?.collapse === 1);
  const turnedOff = baseConfig({ listPaging: { initial: 0 } }, stored);
  check("initial 0 turns the feature off", turnedOff.listPaging?.initial === 0);
  const fresh = baseConfig({ listPaging: { initial: 3 } }, { port: 9222, blur: 0, dim: 25, monet: true, wallpaperVisible: true, fit: "cover" });
  check("no stored look: normalize fills the rest", fresh.listPaging?.initial === 3 && fresh.listPaging?.step === 5 && fresh.listPaging?.collapse === 1);
  // showTotal: stored configs from before 6.3.1 lack the key — normalize
  // treats it as ON (the shipped default), and an explicit off is kept.
  check("legacy stored config normalizes showTotal ON", baseConfig({}, stored).listPaging?.showTotal === 1);
  check("legacy stored config normalizes collapseAll ON", baseConfig({}, stored).listPaging?.collapseAll === 1);
  const stepwise = baseConfig({ listPaging: { collapseAll: 0 } }, stored);
  check("collapseAll off persists a one-field merge", stepwise.listPaging?.collapse === 1 && stepwise.listPaging?.collapseAll === 0);
  const noTotal = baseConfig({ listPaging: { showTotal: 0 } }, stored);
  check("showTotal off persists a one-field merge", noTotal.listPaging?.initial === 8 && noTotal.listPaging?.showTotal === 0);
}

console.log(failed === 0 ? "\nT32: all checks passed" : `\nT32: ${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
