import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { describe, inputOf } from "../public/fingerprint.js";
import { createSketchPad, KEY_STEP, STATIONARY_MS } from "../public/sketchpad.js";

// The museum's drawing surface, loaded as-is and driven with real DOM
// events in jsdom, with the clock and timer handed in so time is exact.
// jsdom has no layout, so the SVG's screen transform is stubbed: `scale`
// and `offset` stand for its displayed size and its letterboxed, scrolled
// position on the page.
function setup() {
  const dom = new JSDOM(`<!doctype html><body><svg id="pad" viewBox="0 0 1000 1000" tabindex="0"></svg></body>`);
  const { window } = dom;
  const svg = window.document.getElementById("pad") as unknown as SVGSVGElement;
  let ctm = { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 };
  (svg as unknown as { getScreenCTM: () => typeof ctm }).getScreenCTM = () => ctm;
  let clock = 1000;
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const pad = createSketchPad(svg, {
    now: () => clock,
    setInterval: (fn) => {
      timers.set(nextTimer, fn);
      return nextTimer++;
    },
    clearInterval: (id) => timers.delete(id as number),
  });
  // Advance the clock, firing the held-still timer as a browser would.
  const wait = (ms: number) => {
    for (let t = 0; t < ms; t += STATIONARY_MS) {
      clock += Math.min(STATIONARY_MS, ms - t);
      for (const fn of [...timers.values()]) fn();
    }
  };
  const pointer = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
    svg.dispatchEvent(
      new window.PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", bubbles: true, ...extra }),
    );
  const key = (k: string) => svg.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  // Drawing units (du) to client pixels through the current transform.
  const at = (x: number, y: number): [number, number] => [x * ctm.a + ctm.e, y * ctm.d + ctm.f];
  const drag = (from: [number, number], to: [number, number], ms: number) => {
    pointer("pointerdown", ...at(...from));
    for (let t = 20; t <= ms; t += 20) {
      clock += 20;
      const f = t / ms;
      pointer("pointermove", ...at(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f));
    }
    pointer("pointerup", ...at(...to));
  };
  return {
    window,
    svg,
    pad,
    wait,
    pointer,
    key,
    at,
    drag,
    timers,
    resize: (scale: number, e: number, f: number) => (ctm = { a: scale, b: 0, c: 0, d: scale, e, f }),
    tick: (ms: number) => (clock += ms),
  };
}

it("records a pointer stroke in drawing units, with times from its start", () => {
  const { pad, drag } = setup();
  drag([100, 100], [500, 100], 400);
  expect(pad.strokes).toHaveLength(1);
  const [first, ...rest] = pad.strokes[0].points;
  expect(first).toEqual([100, 100, 0]);
  expect(rest.at(-1)).toEqual([500, 100, 400]);
  expect(pad.strokes[0].input).toBe("mouse");
});

it("keeps the same drawing-space geometry when the surface is resized, letterboxed or scrolled", () => {
  const small = setup();
  small.drag([200, 300], [700, 800], 300);
  const large = setup();
  large.resize(1.37, 212, -480); // bigger, offset sideways, page scrolled down
  large.drag([200, 300], [700, 800], 300);
  expect(large.pad.strokes).toEqual(small.pad.strokes);
});

it("records a held-still interval deliberately, so it becomes a pause", () => {
  const { pad, pointer, at, wait, tick } = setup();
  pointer("pointerdown", ...at(100, 500));
  for (let x = 120; x <= 400; x += 20) {
    tick(20);
    pointer("pointermove", ...at(x, 500));
  }
  wait(1200); // no pointermove events arrive while the hand rests
  for (let x = 420; x <= 700; x += 20) {
    tick(20);
    pointer("pointermove", ...at(x, 500));
  }
  pointer("pointerup", ...at(700, 500));
  const stationary = pad.strokes[0].points.filter(([x]) => x === 400);
  expect(stationary.length).toBeGreaterThanOrEqual(10);
  const d = describe(pad.strokes);
  expect(d.pauses).toBe(1);
  expect(d.pauseMs).toBeGreaterThanOrEqual(1000);
});

it("keeps nothing from a cancelled pointer", () => {
  const { pad, pointer, at, tick, timers } = setup();
  pointer("pointerdown", ...at(100, 100));
  tick(30);
  pointer("pointermove", ...at(300, 300));
  pointer("pointercancel", ...at(300, 300));
  expect(pad.strokes).toHaveLength(0);
  expect(pad.drawing).toBe(false);
  expect(timers.size).toBe(0);
});

it("ends a stroke when the page is hidden, so hidden time never counts", () => {
  const { window, pad, pointer, at, tick } = setup();
  pointer("pointerdown", ...at(100, 100));
  tick(100);
  pointer("pointermove", ...at(200, 100));
  Object.defineProperty(window.document, "visibilityState", { value: "hidden", configurable: true });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  tick(60_000);
  pointer("pointermove", ...at(300, 100));
  pointer("pointerup", ...at(300, 100));
  expect(pad.strokes).toHaveLength(1);
  expect(pad.strokes[0].points.at(-1)).toEqual([200, 100, 100]);
  expect(describe(pad.strokes).activeMs).toBe(100);
});

it("ends a stroke whose pointer lifts outside the frame", () => {
  const { window, pad, pointer, at, tick } = setup();
  pointer("pointerdown", ...at(100, 100));
  tick(50);
  pointer("pointermove", ...at(300, 100));
  window.dispatchEvent(new window.PointerEvent("pointerup", { clientX: 2000, clientY: 2000, pointerId: 1, bubbles: true }));
  expect(pad.drawing).toBe(false);
  expect(pad.strokes).toHaveLength(1);
});

it("ignores a second finger while one is drawing", () => {
  const { pad, pointer, at, tick } = setup();
  pointer("pointerdown", ...at(100, 100));
  pointer("pointerdown", ...at(900, 900), { pointerId: 2, pointerType: "touch" });
  tick(50);
  pointer("pointermove", ...at(800, 800), { pointerId: 2, pointerType: "touch" });
  pointer("pointermove", ...at(200, 100));
  pointer("pointerup", ...at(200, 100));
  expect(pad.strokes).toHaveLength(1);
  expect(pad.strokes[0].points.every(([x, y]) => x <= 200 && y === 100)).toBe(true);
});

it("undo removes a stroke's geometry and its motion together; clear resets both", () => {
  const { pad, drag } = setup();
  drag([100, 100], [400, 100], 300);
  const justFirst = describe(pad.strokes);
  drag([100, 600], [400, 900], 1200);
  expect(describe(pad.strokes)).not.toEqual(justFirst);
  pad.undo();
  expect(describe(pad.strokes)).toEqual(justFirst);
  pad.clear();
  expect(pad.strokes).toEqual([]);
});

it("draws with the keyboard: Enter starts at the cross, arrows draw, Enter ends", () => {
  const { pad, key, tick, drag } = setup();
  key("ArrowLeft"); // moving the cross between strokes draws nothing
  key("Enter");
  tick(150);
  key("ArrowDown");
  tick(150);
  key("ArrowRight");
  key("Enter");
  expect(pad.strokes).toHaveLength(1);
  expect(pad.strokes[0]).toEqual({
    input: "keyboard",
    points: [
      [500 - KEY_STEP, 500, 0],
      [500 - KEY_STEP, 500 + KEY_STEP, 150],
      [500, 500 + KEY_STEP, 300],
    ],
  });
  key("Enter");
  key("ArrowUp");
  key("Escape");
  expect(pad.strokes).toHaveLength(1);
  drag([100, 100], [200, 200], 100);
  expect(inputOf(pad.strokes)).toBe("mixed");
});
