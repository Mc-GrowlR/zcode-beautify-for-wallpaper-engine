/**
 * Read-only reader for ZCode's local session store (~/.zcode/cli/db/db.sqlite).
 * Powers the sidebar 会话概览 hover card: given a session id straight off the
 * DOM (data-testid="task-item-<id>"), it returns the session title and the
 * REAL user prompts in chronological order — runtime noise (environment
 * snapshots, token reminders, skill listings…) is filtered out, matching how
 * ZCode's own renderer picks `origin === "realUser"` turns.
 *
 * Connections are opened per call, read-only, and closed again: the db is
 * live-owned by ZCode (WAL mode), and a hover is rare enough that connect
 * cost is irrelevant. node:sqlite ships with Node ≥ 22.5; on older runtimes
 * (or a missing db) the result degrades to "unavailable" and the hover card
 * falls back to the DOM title instead of erroring.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SessionPreviewPrompt {
  /** When the user sent it (ms epoch, 0 when unknown). */
  at: number;
  /** The prompt text, trimmed and clamped (MAX_PROMPT_CHARS). */
  text: string;
  /**
   * Source user-message id (db message.id, `msg_…`). ZCode's turn-navigator
   * ticks carry the SAME id on data-turn-id, so the hover card can jump
   * straight to the clicked prompt's turn (native tick click scrolls there).
   * Empty when the id doesn't look like a message id (defensive).
   */
  mid: string;
}

export interface SessionPreviewData {
  id: string;
  title: string;
  /** ms epoch of the last activity in the session. */
  updatedAt: number;
  /** Real user prompts, oldest → newest. */
  prompts: SessionPreviewPrompt[];
  /** How many OLDER prompts were cut by the cap (0 = complete). */
  omitted: number;
}

export type SessionPreviewResult =
  | { ok: true; data: SessionPreviewData }
  | { ok: false; reason: "bad-id" | "not-found" | "unavailable" };

/** Sidebar testids are `task-item-<sessionId>`; ids are `sess_<uuid>` today
 *  but older builds wrote `session_<hex>` — accept any tight token. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{6,96}$/;

/**
 * Upper bound on prompts returned to the hover card. The card renders every
 * returned prompt in its scrollable list (sessionHoverMax only sets the
 * visible window height), so this must not double as a UI truncation: a
 * 60-row cap made long sessions silently lose their older questions. 1000
 * keeps the localhost payload/DOM bounded while covering real long sessions;
 * beyond it `omitted` tells the card how many older prompts were not loaded.
 */
export const MAX_PROMPTS = 1000;
export const MAX_PROMPT_CHARS = 240;

/** One goal target (a session started with /goal) as stored by ZCode. */
export interface GoalSessionEntry {
  /** Goal lifecycle status: active / paused / complete / … (raw db value). */
  status: string;
  /** Goal summary title (empty when generation failed early). */
  title: string;
}

export type GoalSessionsResult =
  | { ok: true; sessions: Record<string, GoalSessionEntry> }
  | { ok: false; reason: "unavailable" };

/** Upper bound on the returned map — a runaway table must not bloat the
 *  token-bearing payload the renderer fetches. */
const MAX_GOAL_SESSIONS = 4000;

/** Where ZCode keeps its sessions db (same root the desktop app writes). */
export function sessionDbPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".zcode", "cli", "db", "db.sqlite");
}

/** Module handle for node:sqlite, loaded once (undefined = unsupported). */
let sqliteMod: unknown | null | undefined;

async function loadSqlite(): Promise<{ DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => SqliteDb } | undefined> {
  if (sqliteMod !== undefined) return sqliteMod as { DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => SqliteDb } | undefined;
  try {
    sqliteMod = await import("node:sqlite");
  } catch {
    sqliteMod = null;
  }
  return sqliteMod as { DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => SqliteDb } | undefined;
}

/** The slice of the DatabaseSync surface this reader uses. */
interface SqliteDb {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
  exec(sql: string): void;
  close(): void;
}

/**
 * Authoritative real-user discriminator, verified against a 613-row live
 * session (613 user-labeled rows → 8 real prompts): every runtime message
 * carries `synthetic:true` on the part or a `runtimeMessage`/model-only
 * `visibility` marker on the part OR the message; real prompts carry none of
 * those (their metadata is inputIntent/queue bookkeeping at most).
 */
function isRealUserPrompt(md: any, pd: any): boolean {
  if (md?.role !== "user") return false;
  if (pd?.type !== "text") return false;
  if (pd.synthetic === true) return false;
  const pm = pd.metadata;
  if (pm && (pm.runtimeMessage || pm.visibility === "model-only" || pm.source === "model")) return false;
  const mm = md.metadata;
  if (mm && (mm.runtimeMessage || mm.visibility === "model-only")) return false;
  return typeof pd.text === "string" && pd.text.trim().length > 0;
}

/**
 * Reads one session's preview. `homeDir` is injectable for tests.
 */
export async function readSessionPreview(sessionId: string, homeDir: string = os.homedir()): Promise<SessionPreviewResult> {
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) return { ok: false, reason: "bad-id" };
  const dbPath = sessionDbPath(homeDir);
  if (!fs.existsSync(dbPath)) return { ok: false, reason: "unavailable" };
  const sqlite = await loadSqlite();
  if (!sqlite) return { ok: false, reason: "unavailable" };

  let db: SqliteDb | undefined;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    // ZCode owns this db and writes constantly; a write lock must fail fast
    // instead of throwing SQLITE_BUSY into the hover card.
    try { db.exec("PRAGMA busy_timeout = 400"); } catch { /* older builds: option-only */ }

    const sess = db.prepare(
      "SELECT title, time_updated FROM session WHERE id = ?"
    ).get(sessionId) as { title?: unknown; time_updated?: unknown } | undefined;
    if (!sess) return { ok: false, reason: "not-found" };

    // Cheap SQL pre-filter before the JSON parses: user messages only, text
    // parts only, no synthetic/runtime markers. (The JSON minifier writes
    // `"role":"user"` with no spaces.) isRealUserPrompt below is the truth;
    // this only keeps the parse volume down on 10k-message sessions.
    const rows = db.prepare(
      `SELECT m.data AS mdata, p.data AS pdata, m.time_created AS at, m.id AS mid
       FROM message m JOIN part p ON p.message_id = m.id
       WHERE m.session_id = ?
         AND m.data LIKE '%"role":"user"%'
         AND p.data LIKE '%"type":"text"%'
         AND p.data NOT LIKE '%"synthetic":true%'
         AND p.data NOT LIKE '%"runtimeMessage"%'
         AND p.data NOT LIKE '%"visibility":"model-only"%'
       ORDER BY m.sequence`
    ).all(sessionId) as Array<{ mdata: string; pdata: string; at?: unknown; mid?: unknown }>;

    const prompts: SessionPreviewPrompt[] = [];
    for (const row of rows) {
      let md: any, pd: any;
      try {
        md = JSON.parse(row.mdata);
        pd = JSON.parse(row.pdata);
      } catch {
        continue;
      }
      if (!isRealUserPrompt(md, pd)) continue;
      prompts.push({
        at: Number(pd?.time?.start ?? md?.time?.created ?? row.at ?? 0) || 0,
        text: String(pd.text).trim().slice(0, MAX_PROMPT_CHARS),
        mid: typeof row.mid === "string" && /^msg_[A-Za-z0-9_-]{1,120}$/.test(row.mid) ? row.mid : "",
      });
    }
    const omitted = Math.max(0, prompts.length - MAX_PROMPTS);
    return {
      ok: true,
      data: {
        id: sessionId,
        title: typeof sess.title === "string" ? sess.title.slice(0, 400) : "",
        updatedAt: Number(sess.time_updated) || 0,
        prompts: prompts.slice(-MAX_PROMPTS),
        omitted,
      },
    };
  } catch {
    // Locked db, corrupted page, schema drift — the hover card falls back.
    return { ok: false, reason: "unavailable" };
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

/**
 * Reads every goal target ZCode has recorded (session_target table). The
 * sidebar title of a goal session is generated from the goal objective and
 * loses the `/goal` command — the renderer uses this map to put a goal chip
 * back in front of such titles. `homeDir` is injectable for tests.
 */
export async function readGoalSessions(homeDir: string = os.homedir()): Promise<GoalSessionsResult> {
  const dbPath = sessionDbPath(homeDir);
  if (!fs.existsSync(dbPath)) return { ok: false, reason: "unavailable" };
  const sqlite = await loadSqlite();
  if (!sqlite) return { ok: false, reason: "unavailable" };

  let db: SqliteDb | undefined;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try { db.exec("PRAGMA busy_timeout = 400"); } catch { /* older builds */ }
    const rows = db.prepare(
      "SELECT session_id, status, summary_title FROM session_target"
    ).all() as Array<{ session_id?: unknown; status?: unknown; summary_title?: unknown }>;
    const sessions: Record<string, GoalSessionEntry> = {};
    for (const row of rows) {
      const id = typeof row.session_id === "string" ? row.session_id : "";
      if (!id || !SESSION_ID_RE.test(id)) continue;
      sessions[id] = {
        status: typeof row.status === "string" ? row.status : "",
        title: typeof row.summary_title === "string" ? row.summary_title.slice(0, 200) : "",
      };
      if (Object.keys(sessions).length >= MAX_GOAL_SESSIONS) break;
    }
    return { ok: true, sessions };
  } catch {
    // Missing table on old builds / locked db: the sidebar simply keeps the
    // plain title (no goal chip), never an error.
    return { ok: false, reason: "unavailable" };
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}
