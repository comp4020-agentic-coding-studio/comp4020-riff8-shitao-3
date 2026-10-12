import { describe as group, expect, it } from "vitest";
import {
  describe,
  features,
  gestureDistance,
  LIMITS,
  sealGeometry,
  sealSvg,
  SPEED_CAP,
  validateStrokes,
  type Point,
  type Stroke,
} from "../public/fingerprint.js";

// The collected-information-to-visual-form contract, on controlled
// fixtures: what changes in a sketch's samples must change exactly the
// part of the descriptor (and seal) README.md says it does, and nothing
// else. Pure functions, no server: public/fingerprint.js is the same code
// the server stores descriptors with.

// A path visited at a steady pace: `along(t)` gives the position at time t
// (ms), sampled every `every` ms for `ms` milliseconds.
function sample(along: (t: number) => [number, number], ms: number, every = 16): Point[] {
  const out: Point[] = [];
  for (let t = 0; t < ms; t += every) {
    const [x, y] = along(t);
    out.push([Math.round(x), Math.round(y), Math.round(t)]);
  }
  const [x, y] = along(ms);
  out.push([Math.round(x), Math.round(y), ms]);
  return out;
}

// Left to right across the middle, 600 du in `ms`.
const line = (ms: number, every = 16): Stroke => ({
  input: "mouse",
  points: sample((t) => [200 + (600 * t) / ms, 500], ms, every),
});

// A zigzag with `corners` sharp corners, same overall extent.
const zigzag = (corners: number, ms: number): Stroke => {
  const legs = corners + 1;
  return {
    input: "mouse",
    points: sample((t) => {
      const f = (t / ms) * legs;
      const leg = Math.min(Math.floor(f), legs - 1);
      const within = f - leg;
      const x = 200 + (600 * t) / ms;
      const y = leg % 2 === 0 ? 400 + 200 * within : 600 - 200 * within;
      return [x, y];
    }, ms),
  };
};

group("the seal is a function of the samples", () => {
  it("draws identical seals from identical samples", () => {
    const a = describe([line(1000), zigzag(3, 1500)]);
    const b = describe([line(1000), zigzag(3, 1500)]);
    expect(a).toEqual(b);
    expect(sealSvg(a, "#5177aa")).toBe(sealSvg(b, "#5177aa"));
  });

  it("lowers the speed encoding for a slower drawing of the same path", () => {
    const fast = describe([line(1000)]);
    const slow = describe([line(3000)]);
    expect(fast.distance).toBeCloseTo(slow.distance, -1);
    expect(fast.speed).toBeCloseTo(600, -1);
    expect(slow.speed).toBeCloseTo(200, -1);
    // The seal's outer edge sits at a radius that rises with speed.
    const radius = (d: ReturnType<typeof describe>) => {
      const [x, y] = sealGeometry(d).arcs[0].outer[5];
      return Math.hypot(x - 60, y - 60);
    };
    expect(radius(fast)).toBeGreaterThan(radius(slow));
  });

  it("puts a pause bead where a stroke was held still for half a second", () => {
    const moveHoldMove: Stroke = {
      input: "mouse",
      points: [
        ...sample((t) => [200 + t * 0.4, 500], 500),
        // held still: the browser's 100 ms stationary samples
        ...[600, 700, 800, 900, 1000, 1100, 1200].map((t): Point => [400, 500, t]),
        ...sample((t) => [400 + t * 0.4, 500], 500).slice(1).map(([x, y, t]): Point => [x, y, t + 1200]),
      ],
    };
    const held = describe([moveHoldMove]);
    expect(held.pauses).toBe(1);
    expect(held.pauseMs).toBeGreaterThanOrEqual(500);
    expect(sealGeometry(held).beads).toHaveLength(1);

    const steady = describe([line(1700)]);
    expect(steady.pauses).toBe(0);
    expect(sealGeometry(steady).beads).toHaveLength(0);
  });

  it("doesn't count a short hesitation, or the time between strokes, as a pause", () => {
    const hesitation: Stroke = {
      input: "mouse",
      points: [
        ...sample((t) => [200 + t * 0.4, 500], 500),
        [400, 500, 700],
        ...sample((t) => [400 + t * 0.4, 500], 500).slice(1).map(([x, y, t]): Point => [x, y, t + 800]),
      ],
    };
    expect(describe([hesitation]).pauses).toBe(0);
    // Two strokes: nothing records the gap between them at all.
    const two = describe([line(800), line(800)]);
    expect(two.pauses).toBe(0);
    expect(two.activeMs).toBe(1600);
  });

  it("raises the turning feature when turns are added", () => {
    const straight = describe([line(1500)]);
    const some = describe([zigzag(2, 1500)]);
    const more = describe([zigzag(6, 1500)]);
    expect(straight.turning).toBeLessThan(5);
    expect(some.turning).toBeGreaterThan(straight.turning);
    expect(more.turning).toBeGreaterThan(some.turning);
    expect(more.sharpTurns).toBeGreaterThan(some.sharpTurns);
    expect(features(more).turn).toBeGreaterThan(features(some).turn);
  });

  it("keeps each stroke a separate arc on the seal", () => {
    const d = describe([line(600), zigzag(2, 900), line(300)]);
    const { arcs } = sealGeometry(d);
    expect(arcs).toHaveLength(3);
    // Clockwise, in order, with a gap between each.
    for (let i = 1; i < arcs.length; i++) expect(arcs[i].from).toBeGreaterThan(arcs[i - 1].to);
  });

  it("marks speeds beyond the fixed scale as capped", () => {
    const blur = describe([line(150)]); // 600 du in 150 ms = 4000 du/s
    expect(blur.speed).toBeGreaterThan(SPEED_CAP);
    expect(sealGeometry(blur).capped.length).toBeGreaterThan(0);
    expect(sealGeometry(describe([line(2000)])).capped).toHaveLength(0);
  });
});

group("robust to how the samples arrive", () => {
  it("measures the same movement whatever the device's event rate", () => {
    const at60 = describe([{ input: "mouse", points: sample((t) => [200 + t * 0.3, 300 + t * 0.2], 2000, 16) }]);
    const at240 = describe([{ input: "mouse", points: sample((t) => [200 + t * 0.3, 300 + t * 0.2], 2000, 4) }]);
    expect(gestureDistance(features(at60), features(at240))).toBeLessThan(0.02);
    expect(Math.abs(at60.speed - at240.speed)).toBeLessThan(10);
  });

  it("handles zero distance, repeated points and duplicate timestamps", () => {
    const still = describe([{ input: "touch", points: [[500, 500, 0], [500, 500, 0], [500, 500, 0]] }]);
    expect(still).toMatchObject({ distance: 0, speed: 0, turning: 0, turnDensity: 0, activeMs: 0 });
    expect(() => sealSvg(still, "#5177aa")).not.toThrow();
    expect(sealSvg(still, "#5177aa")).not.toMatch(/NaN|Infinity/);

    const dupes = describe([
      { input: "mouse", points: [[100, 100, 0], [150, 100, 40], [160, 100, 40], [200, 100, 80], [200, 100, 80]] },
    ]);
    expect(Number.isFinite(dupes.speed)).toBe(true);
    expect(dupes.distance).toBeCloseTo(100, -1);
  });

  it("doesn't read hand jitter as movement, pauses or turning", () => {
    // Held still for two seconds, wobbling a du or so either way.
    const wobble: Point[] = Array.from({ length: 21 }, (_, i): Point => [500 + (i % 2), 500 + ((i >> 1) % 2), i * 100]);
    const d = describe([{ input: "touch", points: wobble }]);
    expect(d.distance).toBe(0);
    expect(d.turning).toBe(0);
    expect(d.pauses).toBe(1);
  });

  it("shortens a gap from a hidden tab instead of recording a giant pause", () => {
    const interrupted: Stroke = {
      input: "mouse",
      points: [
        [200, 500, 0],
        [300, 500, 200],
        // the tab was hidden for a minute; no samples arrived
        [300, 500, 59_000],
        [400, 500, 59_200],
      ],
    };
    const d = describe([interrupted]);
    expect(d.activeMs).toBeLessThanOrEqual(1400);
    expect(d.pauseMs).toBeLessThanOrEqual(1000);
  });

  it("handles a sparse stroke of only two points", () => {
    const d = describe([{ input: "keyboard", points: [[500, 500, 0], [530, 500, 400]] }]);
    expect(d.distance).toBeCloseTo(30, -1);
    expect(d.strokes).toBe(1);
  });

  it("records mixed input when strokes came from different devices", () => {
    const d = describe([line(500), { ...line(500), input: "keyboard" }]);
    expect(d.input).toBe("mixed");
  });
});

group("validating a submitted sketch", () => {
  const ok = [[0, 0, 0], [10, 10, 16]];
  const bad: [string, unknown][] = [
    ["no strokes", []],
    ["not an array", { points: ok }],
    ["unknown input", [{ input: "telepathy", points: ok }]],
    ["one point", [{ input: "mouse", points: [[0, 0, 0]] }]],
    ["time going backwards", [{ input: "mouse", points: [[0, 0, 0], [5, 5, 20], [9, 9, 10]] }]],
    ["first time not zero", [{ input: "mouse", points: [[0, 0, 5], [5, 5, 20]] }]],
    ["out of bounds", [{ input: "mouse", points: [[0, 0, 0], [1001, 5, 20]] }]],
    ["negative", [{ input: "mouse", points: [[0, -1, 0], [5, 5, 20]] }]],
    ["fractional", [{ input: "mouse", points: [[0, 0.5, 0], [5, 5, 20]] }]],
    ["not finite", [{ input: "mouse", points: [[0, 0, 0], [5, 5, Infinity]] }]],
    ["a string", [{ input: "mouse", points: [[0, 0, 0], ["5", 5, 20]] }]],
    ["too long", [{ input: "mouse", points: [[0, 0, 0], [5, 5, LIMITS.strokeMs + 1]] }]],
    ["too many strokes", Array.from({ length: LIMITS.strokes + 1 }, () => ({ input: "mouse", points: ok }))],
    [
      "too many points",
      [{ input: "mouse", points: Array.from({ length: LIMITS.pointsPerStroke + 1 }, (_, i) => [1, 1, i]) }],
    ],
  ];
  for (const [name, strokes] of bad) {
    it(`refuses ${name}`, () => {
      expect(validateStrokes(strokes).error).toBeTruthy();
    });
  }

  it("accepts duplicate timestamps and returns a clean copy", () => {
    const result = validateStrokes([{ input: "pen", points: [[0, 0, 0], [5, 5, 0], [9, 9, 16]], extra: "dropped" }]);
    expect(result.error).toBeUndefined();
    expect(result.strokes).toEqual([{ input: "pen", points: [[0, 0, 0], [5, 5, 0], [9, 9, 16]] }]);
  });
});
