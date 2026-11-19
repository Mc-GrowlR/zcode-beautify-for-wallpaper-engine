/**
 * T34 TITLE FILE CITATIONS verification (标题文件引用): ZCode derives a
 * session title from the first user message and keeps the message's mention
 * markdown verbatim ("[穿戴引导表单.lua](./script/form/穿戴引导表单.lua) 增加…").
 * The message bubble re-parses that markdown into icon+label chips, but the
 * sidebar title (TaskTitleOverflowText) is plain text, so the raw markdown
 * leaks. applyChatLook now installs a DOM-level projection: the title's text
 * node is blanked in place (React keeps writing into it) and a sibling chip
 * layer renders the parsed parts with the bubble's own grammar.
 *   A  normalizeChatLook carries the flag (absent → 1, 0/false → 0);
 *   B  buildPayload passes it through into the chatLook payload;
 *   C  behavioral, real bootstrap inside jsdom:
 *      install sweep converts an existing title; the raw text node survives
 *      and is blanked; a React-style nodeValue write re-renders; a plain title
 *      is never touched; a newly mounted row converts through the childList
 *      branch; directories, inline skill/command tokens and web links render
 *      the right chips (or label-only); the marquee duplicate converts too;
 *      toggling OFF through the chat fast path restores the raw markdown;
 *      the reset script restores titles as well.
 *
 * Run: npx tsx test/t34-title-cites.ts   (also part of: npm test)
 */
import { JSDOM } from "jsdom";
import { normalizeChatLook, buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript, buildResetScript } from "../src/core/cdp.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base: BeautifyConfig = { ...DEFAULT_CONFIG, monet: false, wallpaperVisible: false };

// --- part A: normalize --------------------------------------------------------
{
  check("normalize absent → 1 (upgrades into chips)", normalizeChatLook().titleCites === 1);
  check("normalize 1 stays 1", normalizeChatLook({ titleCites: 1 }).titleCites === 1);
  check("normalize 0 → 0", normalizeChatLook({ titleCites: 0 }).titleCites === 0);
  check("normalize false → 0", normalizeChatLook({ titleCites: false as never }).titleCites === 0);
  check("normalize junk → 1", normalizeChatLook({ titleCites: "no" as never }).titleCites === 1);
}

// --- part B: payload passthrough ---------------------------------------------
{
  check("payload default carries 1", buildPayload(base).chatLook?.titleCites === 1);
  const off = buildPayload({ ...base, chatLook: { ...normalizeChatLook(), titleCites: 0 } });
  check("payload carries explicit 0", off.chatLook?.titleCites === 0);
  check("payload exposes the goal map endpoint", /\/api\/goal-sessions$/.test(buildPayload(base).goalApi ?? ""), buildPayload(base).goalApi);
  check("goal endpoint goes away with titleCites off", buildPayload({ ...base, chatLook: { ...normalizeChatLook(), titleCites: 0 } }).goalApi === "");
}

// --- part C: behavioral (real bootstrap in jsdom) -----------------------------
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
const { window } = dom;
const doc = window.document;
const boot = (titleCites: number) =>
  window.eval(buildBootstrapScript({
    css: buildPayload(base).css,
    chatLook: { chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0, hideElapsedDecimal: 0, dragResize: 0, sessionHover: 0, sessionHoverSide: 1, sessionHoverMax: 10, titleCites },
    wallpaperDataUri: "",
    videoSrc: "",
  }));

/** Build a sidebar task row the way ZCode's TaskListItem/TaskTitleOverflowText
 * render it: [data-task-title-marquee-track] > original + aria-hidden dup. */
function makeRow(title: string, withDuplicate = false): { row: HTMLElement; original: HTMLElement; dup: HTMLElement | null } {
  const row = doc.createElement("li");
  row.setAttribute("data-testid", "task-item-sess_" + Math.random().toString(36).slice(2));
  row.setAttribute("data-task-item-key", "ws:sess_x");
  row.className = "group/task-item flex cursor-pointer gap-2 rounded-lg pl-2.5 pr-1 py-1";
  const wrap = doc.createElement("div");
  const line = doc.createElement("div");
  line.className = "flex min-w-0 items-center gap-2";
  const p = doc.createElement("p");
  p.className = "min-w-0 flex-1 overflow-hidden whitespace-nowrap";
  const track = doc.createElement("span");
  track.setAttribute("data-task-title-marquee-track", "true");
  track.className = "task-title-marquee-track inline-flex w-max min-w-max items-center gap-6";
  const original = doc.createElement("span");
  original.setAttribute("data-task-title-copy", "original");
  original.className = "shrink-0";
  original.textContent = title;
  track.appendChild(original);
  let dup: HTMLElement | null = null;
  if (withDuplicate) {
    dup = doc.createElement("span");
    dup.setAttribute("aria-hidden", "true");
    dup.setAttribute("data-task-title-copy", "duplicate");
    dup.className = "shrink-0";
    dup.textContent = title;
    track.appendChild(dup);
  }
  p.appendChild(track);
  line.appendChild(p);
  wrap.appendChild(line);
  row.appendChild(wrap);
  return { row, original, dup };
}
const viewOf = (copy: HTMLElement) => copy.querySelector<HTMLElement>(":scope > .zb-tc-view");
const chipsOf = (copy: HTMLElement) => [...(viewOf(copy)?.querySelectorAll(".zb-tc") ?? [])] as HTMLElement[];
// ZCode renders title rows inside the sidebar <aside>; the childList branch
// deliberately skips chat-area subtrees, so mirror the real container.
const sidebar = doc.createElement("aside");
doc.body.appendChild(sidebar);

{
  const TITLE = "[穿戴引导表单.lua](./script/form/穿戴引导表单.lua) 增加一个自动穿戴设置";
  const { row, original } = makeRow(TITLE);
  sidebar.appendChild(row);
  boot(1);

  // install sweep: converted synchronously, original text node still there but empty
  const view = viewOf(original);
  check("install sweep renders a chip layer", !!view);
  check("raw text node blanked in place", original.firstChild?.nodeType === 3 && original.firstChild.nodeValue === "");
  check("raw title remembered on the span", original.__zbTc?.raw === TITLE, String(original.__zbTc?.raw));
  const chips = chipsOf(original);
  check("one file chip", chips.length === 1, String(chips.length));
  check("chip kind = file", chips[0]?.getAttribute("data-k") === "file");
  check("chip label = leaf filename", chips[0]?.querySelector(".zb-tc-t")?.textContent === "穿戴引导表单.lua");
  check("chip icon = material-icons/lua.svg", (chips[0]?.querySelector("img")?.getAttribute("src") || "").endsWith("/material-icons/lua.svg"));
  check("chip tooltip = destination", chips[0]?.title === "./script/form/穿戴引导表单.lua", String(chips[0]?.title));
  check("surrounding text preserved", (view.textContent || "").trim().endsWith("增加一个自动穿戴设置"), String(view.textContent));
  check("no markdown left in the visible title", !(view.textContent || "").includes("](") && !(view.textContent || "").includes("./script/"));

  // React's update path: setTextContent writes firstChild.nodeValue on the
  // SAME node — the observer must pick it up, re-blank and re-render.
  original.firstChild!.nodeValue = "[GameSettingBasic.lua](./GUILayout/GameSettingBasic.lua) 修 bug";
  await sleep(80);
  const chips2 = chipsOf(original);
  check("React nodeValue update re-renders", chips2.length === 1 && chips2[0].querySelector(".zb-tc-t")?.textContent === "GameSettingBasic.lua", (viewOf(original)?.textContent || ""));
  check("icon follows the new extension", (chips2[0]?.querySelector("img")?.getAttribute("src") || "").endsWith("/material-icons/lua.svg"));
  check("node re-blanked after the update", original.firstChild!.nodeValue === "");
  check("raw updated", original.__zbTc?.raw === "[GameSettingBasic.lua](./GUILayout/GameSettingBasic.lua) 修 bug");

  // Plain titles are never touched (no wrappers, no attr, text intact).
  const plain = makeRow("修复 system.lua 中的 bug");
  sidebar.appendChild(plain.row);
  await sleep(80);
  check("plain title untouched", !viewOf(plain.original) && !plain.original.hasAttribute("data-zb-tc") && plain.original.textContent === "修复 system.lua 中的 bug");

  // A row mounted AFTER the bootstrap converts through the childList branch.
  const later = makeRow("[TaskWindow.lua](./GUILayout/TaskWindow.lua)");
  sidebar.appendChild(later.row);
  await sleep(80);
  const laterChips = chipsOf(later.original);
  check("childList branch converts a late row", laterChips.length === 1 && laterChips[0].querySelector(".zb-tc-t")?.textContent === "TaskWindow.lua");

  // The marquee duplicate copy converts too (aria-hidden sibling).
  const dupRow = makeRow("[RoleGUI.lua](./MobileGUILayout/RoleGUI.lua) 修改背景", true);
  sidebar.appendChild(dupRow.row);
  await sleep(80);
  check("duplicate marquee copy converted", chipsOf(dupRow.original).length === 1 && dupRow.dup ? chipsOf(dupRow.dup).length === 1 : false);

  // Kinds: directory (trailing slash → folder icon), skills, commands, links.
  const kinds = makeRow("[资源目录](./assets/ui/) 用 $code-review 和 /goal 处理 [官网](https://example.com)");
  sidebar.appendChild(kinds.row);
  await sleep(80);
  const kchips = chipsOf(kinds.original);
  const byKind = (k: string) => kchips.filter((c) => c.getAttribute("data-k") === k);
  check("directory chip", byKind("dir").length === 1 && (byKind("dir")[0].querySelector("img")?.getAttribute("src") || "").endsWith("/material-icons/folder.svg"));
  check("skill chip (formatted label)", byKind("skill").length === 1 && byKind("skill")[0].querySelector(".zb-tc-t")?.textContent === "Code Review");
  check("command chip", byKind("command").length === 1 && byKind("command")[0].querySelector(".zb-tc-t")?.textContent === "goal");
  check("web link renders label only (no chip)", (viewOf(kinds.original)?.textContent || "").includes("官网") && !(viewOf(kinds.original)?.textContent || "").includes("https://"));
  check("web link left no file chip", byKind("file").length === 0);

  // Toggle OFF through the chat fast path: raw markdown comes back, layers go.
  boot(0);
  check("off: chip layer removed", !viewOf(original));
  check("off: attr removed", !original.hasAttribute("data-zb-tc"));
  check("off: raw markdown restored", original.textContent === "[GameSettingBasic.lua](./GUILayout/GameSettingBasic.lua) 修 bug", String(original.textContent));
  check("off: observer disconnected", (window as never as { __zcodeBeautify: { tcObs: unknown } }).__zcodeBeautify.tcObs === null);

  // Re-enable, then reset script must restore the raw title too.
  boot(1);
  await sleep(80);
  check("re-enabled: chips back", chipsOf(original).length === 1);
  window.eval(buildResetScript());
  check("reset removes chip layer", !viewOf(original));
  check("reset restores raw text", original.textContent === "[GameSettingBasic.lua](./GUILayout/GameSettingBasic.lua) 修 bug", String(original.textContent));
  check("reset disconnects observer", (window as never as { __zcodeBeautify: { tcObs: unknown } }).__zcodeBeautify.tcObs === null);

  // Toggle OFF in the same frame as a React title write: the newest text (still
  // unblanked) must win over the remembered older value.
  boot(1);
  await sleep(80);
  const tn = [...original.childNodes].find((n) => n.nodeType === 3) as Text;
  tn.nodeValue = "[Fresh.mjs](./src/Fresh.mjs) 新标题";
  boot(0);
  check("off keeps a just-landed React title", original.textContent === "[Fresh.mjs](./src/Fresh.mjs) 新标题", String(original.textContent));
}

// --- part C2: goal sessions keep a marker after the title lost /goal ---------
{
  const dom2 = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const w2 = dom2.window;
  const d2 = w2.document;
  const GOAL_API = "http://127.0.0.1:9223/api/goal-sessions?t=T";
  const goals = {
    sess_goal1: { status: "active", title: "测试目标" },
    sess_goal2: { status: "paused", title: "旧 goal" },
  };
  (w2 as never as { fetch: unknown }).fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, sessions: goals }),
  });
  const boot2 = (on: number) =>
    w2.eval(buildBootstrapScript({
      css: "",
      chatLook: normalizeChatLook({ titleCites: on }),
      goalApi: on ? GOAL_API : "",
      wallpaperDataUri: "",
      videoSrc: "",
    }));
  function row2(sid: string, title: string) {
    const li = d2.createElement("li");
    li.setAttribute("data-testid", "task-item-" + sid);
    const span = d2.createElement("span");
    span.setAttribute("data-task-title-copy", "original");
    span.textContent = title;
    li.appendChild(span);
    const sidebar2 = d2.querySelector("aside")!;
    sidebar2.appendChild(li);
    return span;
  }
  d2.body.appendChild(d2.createElement("aside"));
  const goalPlain = row2("sess_goal1", "测试目标");
  const goalVerbatim = row2("sess_goal2", "/goal 旧目标");
  const normal = row2("sess_normal", "普通会话");

  boot2(1);
  await sleep(160);
  const gpChips = chipsOf(goalPlain);
  check("goal session gets a marker chip", gpChips.length === 1 && gpChips[0].getAttribute("data-k") === "command" && gpChips[0].querySelector(".zb-tc-t")?.textContent === "goal");
  check("goal marker precedes the title", (viewOf(goalPlain)?.firstElementChild?.querySelector(".zb-tc-t")?.textContent ?? "") === "goal");
  check("goal marker separated from the title text", /^goal\s+\S/.test(viewOf(goalPlain)?.textContent ?? ""), String(viewOf(goalPlain)?.textContent));
  check("goal title text preserved", (viewOf(goalPlain)?.textContent ?? "").endsWith("测试目标"));
  check("goal marker tooltip carries status", (gpChips[0].getAttribute("title") ?? "").includes("active"), String(gpChips[0].getAttribute("title")));
  check("verbatim /goal title is not double-marked", chipsOf(goalVerbatim).length === 1);
  check("normal plain title stays untouched", !viewOf(normal) && !normal.hasAttribute("data-zb-tc") && normal.textContent === "普通会话");

  // Turning the feature off restores the plain title (goal marker included).
  boot2(0);
  check("off: goal marker removed", !viewOf(goalPlain));
  check("off: goal title restored", goalPlain.textContent === "测试目标", String(goalPlain.textContent));

  // Fresh goal session added after boot: the row's unknown id triggers a map
  // refresh and the marker appears without a reload.
  (w2 as never as { fetch: unknown }).fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, sessions: { ...goals, sess_goal3: { status: "active", title: "新目标" } } }),
  });
  boot2(1);
  const lateGoal = row2("sess_goal3", "新目标");
  await sleep(2600); // initial sweep + the 2s unknown-row retry
  check("late goal session gets its marker", chipsOf(lateGoal).length === 1 && chipsOf(lateGoal)[0].querySelector(".zb-tc-t")?.textContent === "goal");
  check("late goal title preserved", (viewOf(lateGoal)?.textContent ?? "").endsWith("新目标"));
}

// --- part C3: goal map reader (real sqlite via node:sqlite) ------------------
{
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { readGoalSessions } = await import("../src/core/sessionStore.js");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zb-goal-"));
  try {
    const dbDir = path.join(home, ".zcode", "cli", "db");
    fs.mkdirSync(dbDir, { recursive: true });
    type SqliteMod = { DatabaseSync: new (p: string) => { exec(s: string): void; prepare(s: string): { run(...a: unknown[]): void }; close(): void } };
    let sqlite: SqliteMod | null = null;
    try { sqlite = (await import("node:sqlite")) as unknown as SqliteMod; } catch { sqlite = null; }
    if (!sqlite) {
      console.log("skip goal map reader checks (node:sqlite unavailable)");
    } else {
      const db = new sqlite.DatabaseSync(path.join(dbDir, "db.sqlite"));
      db.exec("CREATE TABLE session_target (session_id TEXT, status TEXT, summary_title TEXT)");
      const ins = db.prepare("INSERT INTO session_target VALUES (?,?,?)");
      ins.run("sess_goal1", "active", "测试");
      ins.run("sess_goal2", "complete", "");
      ins.run("bad id!", "active", "x");
      db.close();
      const res = await readGoalSessions(home);
      check("goal map reader ok", res.ok === true);
      if (res.ok) {
        check("goal map has the target sessions", !!res.sessions.sess_goal1 && !!res.sessions.sess_goal2, JSON.stringify(res.sessions));
        check("goal map carries status + title", res.sessions.sess_goal1?.status === "active" && res.sessions.sess_goal1?.title === "测试");
        check("goal map filters invalid ids", !("bad id!" in res.sessions));
      }
    }
    check("goal map degrades when the db is missing", (await readGoalSessions(path.join(home, "nope"))).ok === false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// --- part D: panel + MCP wiring ----------------------------------------------
{
  const { readFileSync } = await import("node:fs");
  const panelSrc = readFileSync(new URL("../src/panel/panelScript.ts", import.meta.url), "utf8");
  check("panel has the toggle", panelSrc.includes('id="zb-chat-title-cites"'));
  check("panel reflects titleCites (?? 1)", panelSrc.includes("cl.titleCites ?? 1"));
  check("panel pushes titleCites", panelSrc.includes("titleCites: $('zb-chat-title-cites')"));
  const mcpSrc = readFileSync(new URL("../src/mcp/server.ts", import.meta.url), "utf8");
  check("MCP exposes chat_title_cites", mcpSrc.includes("chat_title_cites"));
  const injectSrc = readFileSync(new URL("../src/core/inject.ts", import.meta.url), "utf8");
  check("normalize defaults titleCites to 1", injectSrc.includes("titleCites === 0 || titleCites === false ? 0 : 1"));
  check("payload wires the goal endpoint to titleCites", injectSrc.includes("goalApi: chatUi && chatLook.titleCites === 1"));
  const serverSrc = readFileSync(new URL("../src/core/server.ts", import.meta.url), "utf8");
  check("serve exposes /api/goal-sessions", serverSrc.includes('"/api/goal-sessions"') && serverSrc.includes("readGoalSessions"));
}

console.log(failed === 0 ? "\nT34 all green" : `\nT34 FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
