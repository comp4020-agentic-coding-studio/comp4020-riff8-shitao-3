import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

// A redeploy reuses fly.toml's volume, so src/db.ts opens a database written
// by an older version of itself far more often than an empty one. This
// builds one in the exact shape the app shipped with before marks had a pen
// --- with a mark already in it --- then opens it the way a new deploy would.
const dbPath = join(mkdtempSync(join(tmpdir(), "trace-migrate-")), "trace.db");
const old = new DatabaseSync(dbPath);
old.exec(`
  CREATE TABLE hands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    colour TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id TEXT NOT NULL REFERENCES hands(id),
    path TEXT NOT NULL,
    colour TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  INSERT INTO hands VALUES ('before', 'quiet-heron', '#5177aa', 1);
  INSERT INTO marks (hand_id, path, colour, created_at) VALUES ('before', 'M1,1 L2,2', '#5177aa', 2);
`);
old.close();

process.env.DB_PATH = dbPath;
const { addMark, allMarks, createHand } = await import("../src/db.ts");

it("keeps every mark drawn before pens existed, as the default pen", () => {
  const [mark] = allMarks();
  expect(mark).toMatchObject({ hand_id: "before", path: "M1,1 L2,2", colour: "#5177aa", pen: "line" });
});

it("stores a pen for marks drawn after the migration", () => {
  createHand("after", "bold-ember", "#cc4a28");
  addMark("after", "M3,3 L4,4", "#2a9d8f", "dots");
  expect(allMarks().at(-1)).toMatchObject({ hand_id: "after", colour: "#2a9d8f", pen: "dots" });
});

it("opens an already-migrated database again without touching it", async () => {
  // A second deploy against the same volume: the ALTER must not run twice.
  vi.resetModules();
  const reopened = await import("../src/db.ts");
  expect(reopened.allMarks()).toHaveLength(2);
  const again = new DatabaseSync(dbPath);
  const columns = again.prepare("PRAGMA table_info(marks)").all() as unknown as { name: string }[];
  expect(columns.filter((c) => c.name === "pen")).toHaveLength(1);
  again.close();
});
