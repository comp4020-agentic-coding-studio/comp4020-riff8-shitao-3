// Development only: fills a scratch database with generated exhibits so the
// museum's layout can be judged with hundreds of objects. Every label says
// it's a fixture. It refuses to run against the app's real volume, and the
// Dockerfile never copies scripts/, so it can't reach the live collection.
//
//   DB_PATH=/tmp/trace-dev.db node scripts/seed-dev.ts 200
import { randomUUID } from "node:crypto";

const dbPath = process.env.DB_PATH;
if (!dbPath || dbPath.startsWith("/data")) {
  console.error("Set DB_PATH to a scratch database; this never touches /data.");
  process.exit(1);
}

const { createHand, publishExhibit } = await import("../src/db.ts");
const { prepareExhibit, DURATIONS, ORIGINS, REASONS } = await import("../src/museum.ts");
const { COLOURS } = await import("../src/identity.ts");
const { PENS } = await import("../src/pens.ts");

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const NAMES = ["mug", "key", "shell", "ticket", "button", "scarf", "pebble", "letter", "watch", "spoon", "badge", "jar", "comb", "map"];

type Pt = [number, number, number];
function shape(): { input: string; points: Pt[] }[] {
  const input = pick(["mouse", "mouse", "touch", "pen", "keyboard"]);
  const strokes = [];
  for (let s = 0, n = 1 + Math.floor(rand() * 4); s < n; s++) {
    const cx = 250 + rand() * 500;
    const cy = 250 + rand() * 500;
    const r = 60 + rand() * 180;
    const turns = 0.3 + rand() * 1.5;
    const ms = 400 + Math.floor(rand() * 3000);
    const wobble = rand() * 40;
    const pauseAt = rand() < 0.4 ? rand() : -1;
    const pts: Pt[] = [];
    let t = 0;
    for (let i = 0; i <= 60; i++) {
      const f = i / 60;
      const a = f * turns * 2 * Math.PI;
      const x = Math.round(Math.min(1000, Math.max(0, cx + Math.cos(a) * r + Math.sin(f * 30) * wobble)));
      const y = Math.round(Math.min(1000, Math.max(0, cy + Math.sin(a) * r)));
      pts.push([x, y, t]);
      if (pauseAt >= 0 && Math.abs(f - pauseAt) < 1 / 120) {
        for (let k = 1; k <= 8; k++) pts.push([x, y, (t += 100)]);
      }
      t += Math.round(ms / 60);
    }
    strokes.push({ input, points: pts });
  }
  return strokes;
}

const count = Number(process.argv[2] ?? 150);
for (let i = 0; i < count; i++) {
  const hand = randomUUID();
  createHand(hand, "fixture", "#5177aa");
  const prepared = prepareExhibit({
    label: `Fixture ${pick(NAMES)} ${i + 1}`,
    story: "A generated development fixture for judging the layout. Not a real visitor's object.",
    duration: pick(DURATIONS).id,
    origin: pick(ORIGINS).id,
    reason: pick(REASONS).id,
    pen: pick(PENS).id,
    colour: pick(COLOURS).hex,
    strokes: shape(),
  });
  if ("error" in prepared) throw new Error(prepared.error);
  publishExhibit(hand, randomUUID(), prepared.fields);
}
console.log(`Seeded ${count} fixture exhibits into ${dbPath}.`);
