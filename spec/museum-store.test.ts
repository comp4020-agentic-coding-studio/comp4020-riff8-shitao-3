import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

// The museum's storage rules, driven against a scratch database written in
// the shape the live volume had before the museum existed (hands, and marks
// with pens), then reopened the way a redeploy or restart would.
const dbPath = join(mkdtempSync(join(tmpdir(), "trace-museum-")), "trace.db");
const old = new DatabaseSync(dbPath);
old.exec(`
  CREATE TABLE hands (id TEXT PRIMARY KEY, name TEXT NOT NULL, colour TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id TEXT NOT NULL REFERENCES hands(id),
    path TEXT NOT NULL,
    colour TEXT NOT NULL,
    pen TEXT NOT NULL DEFAULT 'line',
    created_at INTEGER NOT NULL
  );
  INSERT INTO hands VALUES ('wall-hand', 'quiet-heron', '#5177aa', 1);
  INSERT INTO marks (hand_id, path, colour, pen, created_at) VALUES ('wall-hand', 'M1,1 L2,2', '#2a9d8f', 'dots', 2);
`);
old.close();
process.env.DB_PATH = dbPath;

const db = await import("../src/db.ts");
const { prepareExhibit } = await import("../src/museum.ts");

const fields = (label: string) => {
  const prepared = prepareExhibit({
    label,
    story: "Kept because it was there.",
    duration: "unknown",
    origin: "unknown",
    reason: "memory",
    pen: "line",
    colour: "#5177aa",
    strokes: [{ input: "touch", points: [[0, 0, 0], [500, 500, 400]] }],
  });
  if ("error" in prepared) throw new Error(prepared.error);
  return prepared.fields;
};

it("keeps every wall mark, pen and colour included, and leaves them without fingerprints", () => {
  expect(db.allMarks()).toEqual([
    expect.objectContaining({ hand_id: "wall-hand", path: "M1,1 L2,2", colour: "#2a9d8f", pen: "dots" }),
  ]);
  expect(db.cabinetCounts()).toEqual({});
});

it("publishes, then refuses a second exhibit within 24 hours of the first", () => {
  db.createHand("museum-hand", "bold-ember", "#cc4a28");
  const t0 = Date.UTC(2026, 9, 10, 9);
  expect(db.publishExhibit("museum-hand", "token-aaaa-1", fields("Mug"), t0)).toMatchObject({ kind: "created" });
  expect(db.publishExhibit("museum-hand", "token-aaaa-2", fields("Ticket"), t0 + 23 * 3_600_000)).toMatchObject({
    kind: "wait",
  });
  expect(db.publishExhibit("museum-hand", "token-aaaa-3", fields("Ticket"), t0 + 24 * 3_600_000)).toMatchObject({
    kind: "created",
  });
});

it("removes a withdrawn exhibit's content but keeps its cooldown, and touches nothing else", () => {
  db.createHand("withdrawer", "idle-creek", "#4e8067");
  db.createHand("bystander", "steady-willow", "#4e8067");
  const now = Date.now();
  const mine = db.publishExhibit("withdrawer", "token-bbbb-1", fields("Shell"), now);
  const theirs = db.publishExhibit("bystander", "token-bbbb-2", fields("Key"), now);
  if (mine.kind !== "created" || theirs.kind !== "created") throw new Error("setup");

  expect(db.withdrawExhibit(mine.id, "bystander")).toBe(false);
  expect(db.withdrawExhibit(mine.id, "withdrawer")).toBe(true);
  expect(db.getExhibit(mine.id)).toBeUndefined();
  expect(db.getExhibit(theirs.id)).toBeDefined();
  expect(db.allMarks()).toHaveLength(1);
  expect(db.msUntilNextExhibit("withdrawer", now + 1000)).toBeGreaterThan(0);
  // The same token can't bring it back either.
  expect(db.publishExhibit("withdrawer", "token-bbbb-1", fields("Shell"), now + 1000)).toEqual({ kind: "withdrawn" });

  const raw = new DatabaseSync(dbPath);
  expect(raw.prepare("SELECT COUNT(*) AS n FROM exhibits WHERE label = 'Shell'").get()).toEqual({ n: 0 });
  expect(raw.prepare("SELECT kind FROM museum_events WHERE exhibit_id = ? ORDER BY seq").all(mine.id)).toEqual([
    { kind: "add" },
    { kind: "withdraw" },
  ]);
  raw.close();
});

it("lets a reviewer hide and restore an exhibit, announcing both to open tabs", () => {
  db.createHand("reviewed", "gentle-maple", "#457b9d");
  const made = db.publishExhibit("reviewed", "token-cccc-1", fields("Note"));
  if (made.kind !== "created") throw new Error("setup");
  expect(db.reportExhibit(made.id, "bystander", "personal")).toBe("reported");
  expect(db.reportExhibit(made.id, "bystander", "spam")).toBe("already");
  expect(db.reportedExhibits().find((r) => r.id === made.id)).toMatchObject({ reports: 1, reasons: "personal" });
  const before = db.latestSeq();
  expect(db.setExhibitHidden(made.id, true)).toBe(true);
  expect(db.cabinetPage("unknown", Number.MAX_SAFE_INTEGER, 50).some((e) => e.id === made.id)).toBe(false);
  expect(db.setExhibitHidden(made.id, false)).toBe(true);
  expect(db.eventsSince(before).map((e) => e.kind)).toEqual(["withdraw", "add"]);
});

it("keeps exhibits, cooldowns and events across a restart", async () => {
  const counts = db.cabinetCounts();
  const seq = db.latestSeq();
  vi.resetModules();
  const reopened = await import("../src/db.ts");
  expect(reopened.cabinetCounts()).toEqual(counts);
  expect(reopened.latestSeq()).toBe(seq);
  expect(reopened.msUntilNextExhibit("withdrawer")).toBeGreaterThan(0);
  expect(reopened.allMarks()).toHaveLength(1);
});
