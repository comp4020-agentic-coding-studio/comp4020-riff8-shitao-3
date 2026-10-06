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
