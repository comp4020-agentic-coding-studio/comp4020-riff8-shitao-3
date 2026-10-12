import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_PEN, type Pen } from "./pens.ts";

export interface Hand {
  id: string;
  name: string;
  colour: string;
  created_at: number;
}

export interface Mark {
  id: number;
  hand_id: string;
  path: string;
  colour: string;
  pen: Pen;
  created_at: number;
}

const dbPath = process.env.DB_PATH ?? "./data/trace.db";
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS hands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    colour TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id TEXT NOT NULL REFERENCES hands(id),
    path TEXT NOT NULL,
    colour TEXT NOT NULL,
    pen TEXT NOT NULL DEFAULT '${DEFAULT_PEN}',
    created_at INTEGER NOT NULL
  );
`);

// CREATE TABLE IF NOT EXISTS leaves an existing table exactly as it was, and
// fly.toml's volume outlives every deploy: a column added after the first
// deploy has to be added to the live table here, or every insert naming it
// fails. Marks drawn before pens existed were all drawn with the default.
// `spec/migrate.test.ts` runs this against a database in the old shape.
const markColumns = db.prepare("PRAGMA table_info(marks)").all() as unknown as { name: string }[];
if (!markColumns.some((c) => c.name === "pen")) {
  db.exec(`ALTER TABLE marks ADD COLUMN pen TEXT NOT NULL DEFAULT '${DEFAULT_PEN}'`);
}

const insertHandStmt = db.prepare(
  "INSERT INTO hands (id, name, colour, created_at) VALUES (?, ?, ?, ?)",
);
const getHandStmt = db.prepare("SELECT * FROM hands WHERE id = ?");
const insertMarkStmt = db.prepare(
  "INSERT INTO marks (hand_id, path, colour, pen, created_at) VALUES (?, ?, ?, ?, ?)",
);
const allMarksStmt = db.prepare("SELECT * FROM marks ORDER BY created_at ASC");
const latestMarkStmt = db.prepare("SELECT MAX(created_at) as t FROM marks WHERE hand_id = ?");
const lastMarkStmt = db.prepare(
  "SELECT * FROM marks WHERE hand_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
);

export function getHand(id: string): Hand | undefined {
  return getHandStmt.get(id) as unknown as Hand | undefined;
}

export function createHand(id: string, name: string, colour: string): Hand {
  const created_at = Date.now();
  insertHandStmt.run(id, name, colour, created_at);
  return { id, name, colour, created_at };
}

export function allMarks(): Mark[] {
  return allMarksStmt.all() as unknown as Mark[];
}

// "A day" is the 24 hours since a hand's last mark, not a calendar day: any
// calendar boundary (UTC midnight is 11am in Canberra) lets a hand mark twice
// in an hour across it, or refuses one that comes back "tomorrow" in its own
// time zone.
export const MARK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function msUntilNextMark(handId: string, now = Date.now()): number {
  const row = latestMarkStmt.get(handId) as unknown as { t: number | null };
  return row.t === null ? 0 : Math.max(0, row.t + MARK_INTERVAL_MS - now);
}

// What a returning hand drew with last time, so its picker starts there.
export function lastMark(handId: string): Mark | undefined {
  return lastMarkStmt.get(handId) as unknown as Mark | undefined;
}

export function addMark(
  handId: string,
  path: string,
  colour: string,
  pen: Pen = DEFAULT_PEN,
  created_at = Date.now(),
): Mark {
  const result = insertMarkStmt.run(handId, path, colour, pen, created_at);
  return { id: Number(result.lastInsertRowid), hand_id: handId, path, colour, pen, created_at };
}

// --- The museum. ---
//
// `exhibits` holds what's public (and, privately, the hand that published
// it). `publications` is the cooldown record: one row per publication,
// never deleted, so withdrawing an exhibit can't reset a hand's 24 hours.
// `museum_events` numbers every addition and withdrawal, so a tab that
// reconnects can ask for everything after the last number it saw; it holds
// ids only, never content, and keeps 30 days.
db.exec(`
  PRAGMA busy_timeout = 2000;
  CREATE TABLE IF NOT EXISTS exhibits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id TEXT NOT NULL REFERENCES hands(id),
    label TEXT NOT NULL,
    story TEXT NOT NULL,
    duration TEXT NOT NULL,
    origin TEXT NOT NULL,
    reason TEXT NOT NULL,
    pen TEXT NOT NULL,
    colour TEXT NOT NULL,
    input TEXT NOT NULL,
    strokes TEXT NOT NULL,
    sketch TEXT NOT NULL,
    descriptor TEXT NOT NULL,
    descriptor_version INTEGER NOT NULL,
    f_speed REAL NOT NULL,
    f_pause REAL NOT NULL,
    f_turn REAL NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS exhibits_by_cabinet ON exhibits(duration, hidden, id);
  CREATE INDEX IF NOT EXISTS exhibits_by_reason ON exhibits(reason, hidden, id);
  CREATE INDEX IF NOT EXISTS exhibits_by_input ON exhibits(input, hidden);
  CREATE INDEX IF NOT EXISTS exhibits_by_hand ON exhibits(hand_id);
  CREATE TABLE IF NOT EXISTS publications (
    token TEXT PRIMARY KEY,
    hand_id TEXT NOT NULL,
    exhibit_id INTEGER NOT NULL,
    published_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS publications_by_hand ON publications(hand_id, published_at);
  CREATE TABLE IF NOT EXISTS reports (
    exhibit_id INTEGER NOT NULL,
    hand_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (exhibit_id, hand_id)
  );
  CREATE INDEX IF NOT EXISTS reports_by_hand ON reports(hand_id, created_at);
  CREATE TABLE IF NOT EXISTS museum_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    exhibit_id INTEGER NOT NULL,
    cabinet TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);
db.prepare("DELETE FROM museum_events WHERE created_at < ?").run(Date.now() - 30 * 24 * 60 * 60 * 1000);

export interface ExhibitInput {
  label: string;
  story: string;
  duration: string;
  origin: string;
  reason: string;
  pen: string;
  colour: string;
  input: string;
  strokes: string;
  sketch: string;
  descriptor: string;
  descriptor_version: number;
  f_speed: number;
  f_pause: number;
  f_turn: number;
}

export interface Exhibit extends ExhibitInput {
  id: number;
  hand_id: string;
  hidden: number;
  created_at: number;
}

export type MuseumEvent = { seq: number; kind: "add" | "withdraw"; exhibit_id: number; cabinet: string };

export const EXHIBIT_INTERVAL_MS = 24 * 60 * 60 * 1000;

const findPublicationStmt = db.prepare("SELECT * FROM publications WHERE token = ?");
const lastPublicationStmt = db.prepare("SELECT MAX(published_at) AS t FROM publications WHERE hand_id = ?");
const insertExhibitStmt = db.prepare(`
  INSERT INTO exhibits (hand_id, label, story, duration, origin, reason, pen, colour, input, strokes,
    sketch, descriptor, descriptor_version, f_speed, f_pause, f_turn, created_at)
  VALUES (:hand_id, :label, :story, :duration, :origin, :reason, :pen, :colour, :input, :strokes,
    :sketch, :descriptor, :descriptor_version, :f_speed, :f_pause, :f_turn, :created_at)`);
const insertPublicationStmt = db.prepare(
  "INSERT INTO publications (token, hand_id, exhibit_id, published_at) VALUES (?, ?, ?, ?)",
);
const insertEventStmt = db.prepare(
  "INSERT INTO museum_events (kind, exhibit_id, cabinet, created_at) VALUES (?, ?, ?, ?)",
);
const getExhibitStmt = db.prepare("SELECT * FROM exhibits WHERE id = ?");

export function msUntilNextExhibit(handId: string, now = Date.now()): number {
  const row = lastPublicationStmt.get(handId) as unknown as { t: number | null };
  return row.t === null ? 0 : Math.max(0, row.t + EXHIBIT_INTERVAL_MS - now);
}

export type PublishResult =
  | { kind: "created"; id: number }
  | { kind: "duplicate"; id: number }
  | { kind: "withdrawn" }
  | { kind: "token-taken" }
  | { kind: "wait"; ms: number };

// The whole publication rule in one synchronous transaction: a retried
// token returns the exhibit it already made, otherwise the hand's 24 hours
// are checked and the exhibit, its publication record and its event are
// written together. node:sqlite is synchronous and nothing here awaits, so
// two requests from one hand can't both pass the check.
export function publishExhibit(handId: string, token: string, fields: ExhibitInput, now = Date.now()): PublishResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = findPublicationStmt.get(token) as unknown as
      | { hand_id: string; exhibit_id: number }
      | undefined;
    let result: PublishResult;
    if (previous) {
      if (previous.hand_id !== handId) result = { kind: "token-taken" };
      else if (getExhibitStmt.get(previous.exhibit_id)) result = { kind: "duplicate", id: previous.exhibit_id };
      else result = { kind: "withdrawn" };
    } else {
      const wait = msUntilNextExhibit(handId, now);
      if (wait > 0) {
        result = { kind: "wait", ms: wait };
      } else {
        const info = insertExhibitStmt.run({ ...fields, hand_id: handId, created_at: now });
        const id = Number(info.lastInsertRowid);
        insertPublicationStmt.run(token, handId, id, now);
        insertEventStmt.run("add", id, fields.duration, now);
        result = { kind: "created", id };
      }
    }
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getExhibit(id: number): Exhibit | undefined {
  return getExhibitStmt.get(id) as unknown as Exhibit | undefined;
}

const cabinetCountsStmt = db.prepare(
  "SELECT duration, COUNT(*) AS n FROM exhibits WHERE hidden = 0 GROUP BY duration",
);
const cabinetPageStmt = db.prepare(
  "SELECT * FROM exhibits WHERE duration = ? AND hidden = 0 AND id < ? ORDER BY id DESC LIMIT ?",
);
const ownedStmt = db.prepare("SELECT id FROM exhibits WHERE hand_id = ?");

export function cabinetCounts(): Record<string, number> {
  const rows = cabinetCountsStmt.all() as unknown as { duration: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.duration, r.n]));
}

// Newest first, `limit` at a time, before the id a previous page ended on.
export function cabinetPage(duration: string, before: number, limit: number): Exhibit[] {
  return cabinetPageStmt.all(duration, before, limit) as unknown as Exhibit[];
}

export function ownedExhibitIds(handId: string): Set<number> {
  return new Set((ownedStmt.all(handId) as unknown as { id: number }[]).map((r) => r.id));
}

// The two threads. Both skip the exhibit itself, hidden exhibits, and the
// viewer's own exhibits. They don't skip other exhibits by this exhibit's
// owner: which exhibit a thread jumped over would say who made it.
const sameReasonStmt = db.prepare(`
  SELECT * FROM exhibits
  WHERE reason = :reason AND hidden = 0 AND id != :id AND hand_id != :viewer
  ORDER BY CASE WHEN id > :id THEN 0 ELSE 1 END, id
  LIMIT 1`);
const similarGestureStmt = db.prepare(`
  SELECT *, (f_speed - :s) * (f_speed - :s) + (f_pause - :p) * (f_pause - :p) + (f_turn - :t) * (f_turn - :t) AS d2
  FROM exhibits
  WHERE input = :input AND hidden = 0 AND id != :id AND hand_id != :viewer
  ORDER BY d2, id
  LIMIT 1`);

export function sameReason(exhibit: Exhibit, viewer: string): Exhibit | undefined {
  return sameReasonStmt.get({ reason: exhibit.reason, id: exhibit.id, viewer }) as unknown as
    | Exhibit
    | undefined;
}

export function similarGesture(exhibit: Exhibit, viewer: string): (Exhibit & { d2: number }) | undefined {
  return similarGestureStmt.get({
    s: exhibit.f_speed,
    p: exhibit.f_pause,
    t: exhibit.f_turn,
    input: exhibit.input,
    id: exhibit.id,
    viewer,
  }) as unknown as (Exhibit & { d2: number }) | undefined;
}

const deleteExhibitStmt = db.prepare("DELETE FROM exhibits WHERE id = ?");
const deleteReportsStmt = db.prepare("DELETE FROM reports WHERE exhibit_id = ?");
const setHiddenStmt = db.prepare("UPDATE exhibits SET hidden = ? WHERE id = ?");

// Removes the exhibit's geometry, story and descriptor outright (the
// publication record stays, so the cooldown does too). Only its own hand
// may; `null` hand is the reviewer removing it (src/review.ts).
export function withdrawExhibit(id: number, handId: string | null, now = Date.now()): boolean {
  const exhibit = getExhibit(id);
  if (!exhibit || (handId !== null && exhibit.hand_id !== handId)) return false;
  db.exec("BEGIN IMMEDIATE");
  try {
    deleteExhibitStmt.run(id);
    deleteReportsStmt.run(id);
    if (!exhibit.hidden) insertEventStmt.run("withdraw", id, exhibit.duration, now);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return true;
}

// The reviewer's other two actions: hiding takes an exhibit out of every
// public view while keeping it for a second look; restoring puts it back.
export function setExhibitHidden(id: number, hidden: boolean, now = Date.now()): boolean {
  const exhibit = getExhibit(id);
  if (!exhibit || Boolean(exhibit.hidden) === hidden) return false;
  setHiddenStmt.run(hidden ? 1 : 0, id);
  insertEventStmt.run(hidden ? "withdraw" : "add", id, exhibit.duration, now);
  return true;
}

const insertReportStmt = db.prepare(
  "INSERT OR IGNORE INTO reports (exhibit_id, hand_id, reason, created_at) VALUES (?, ?, ?, ?)",
);
const reportsByHandStmt = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE hand_id = ? AND created_at > ?");
const reportCountStmt = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE exhibit_id = ?");
const reportedStmt = db.prepare(`
  SELECT e.id, e.label, e.story, e.hidden, COUNT(r.hand_id) AS reports, GROUP_CONCAT(r.reason) AS reasons
  FROM reports r JOIN exhibits e ON e.id = r.exhibit_id
  GROUP BY e.id ORDER BY reports DESC, e.id`);

export const REPORTS_PER_DAY = 20;

// One report per hand per exhibit; a second from the same hand is a no-op.
export function reportExhibit(
  id: number,
  handId: string,
  reason: string,
  now = Date.now(),
): "reported" | "already" | "limit" {
  const recent = (reportsByHandStmt.get(handId, now - EXHIBIT_INTERVAL_MS) as unknown as { n: number }).n;
  if (recent >= REPORTS_PER_DAY) return "limit";
  return insertReportStmt.run(id, handId, reason, now).changes > 0 ? "reported" : "already";
}

export function reportCount(id: number): number {
  return (reportCountStmt.get(id) as unknown as { n: number }).n;
}

export function reportedExhibits(): {
  id: number;
  label: string;
  story: string;
  hidden: number;
  reports: number;
  reasons: string;
}[] {
  return reportedStmt.all() as never;
}

const eventsSinceStmt = db.prepare("SELECT seq, kind, exhibit_id, cabinet FROM museum_events WHERE seq > ? ORDER BY seq LIMIT ?");
// From sqlite_sequence, not MAX(seq): pruning can empty the table, and the
// next event still continues the old numbering.
const maxSeqStmt = db.prepare(
  "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'museum_events'), 0) AS seq",
);
const minSeqStmt = db.prepare("SELECT MIN(seq) AS seq FROM museum_events");

export function eventsSince(seq: number, limit = 500): MuseumEvent[] {
  return eventsSinceStmt.all(seq, limit) as unknown as MuseumEvent[];
}

export function latestSeq(): number {
  return (maxSeqStmt.get() as unknown as { seq: number }).seq;
}

// The oldest event still kept: a tab asking for anything before it has
// missed more than the log remembers and must reload.
export function oldestSeq(): number | null {
  return (minSeqStmt.get() as unknown as { seq: number | null }).seq;
}
