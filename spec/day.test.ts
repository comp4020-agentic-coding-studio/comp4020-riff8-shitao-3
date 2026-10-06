import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// "One mark a day" means 24 hours since a hand's last mark. Real time can't
// be fast-forwarded over HTTP, so this drives src/db.ts directly against a
// scratch database, with the clock passed in.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "trace-day-")), "trace.db");
const { addMark, createHand, msUntilNextMark, MARK_INTERVAL_MS } = await import("../src/db.ts");

const HOUR = 60 * 60 * 1000;

it("lets a hand that has never drawn draw now", () => {
  createHand("fresh", "fresh", "#000");
  expect(msUntilNextMark("fresh")).toBe(0);
});

it("refuses a second mark an hour later, even across UTC midnight", () => {
  // 23:30 UTC is 10:30am in Canberra; the old UTC-day rule reopened at 11am.
  createHand("night", "night", "#000");
  const drawnAt = Date.UTC(2026, 9, 3, 23, 30);
  addMark("night", "M1,1 L2,2", "#000", "line", drawnAt);
  expect(msUntilNextMark("night", drawnAt + HOUR)).toBe(23 * HOUR);
});

it("lets a hand draw again once 24 hours have passed, whatever the calendar says", () => {
  createHand("noon", "noon", "#000");
  const drawnAt = Date.UTC(2026, 9, 4, 1, 0);
  addMark("noon", "M1,1 L2,2", "#000", "line", drawnAt);
  // Next morning in Canberra is still the same UTC day: the old rule refused it.
  expect(msUntilNextMark("noon", drawnAt + 23 * HOUR)).toBeGreaterThan(0);
  expect(msUntilNextMark("noon", drawnAt + MARK_INTERVAL_MS)).toBe(0);
});
