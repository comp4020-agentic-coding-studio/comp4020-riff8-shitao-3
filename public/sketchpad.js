// The museum's drawing surface: turns pointer and keyboard input on an SVG
// into strokes of [x, y, ms] in the fixed 1000 du drawing space, ready for
// public/fingerprint.js. It's separate from public/wall.js on purpose: the
// wall's client is left exactly as it was.
//
// Sampling: a point on every move (at most one per MIN_SAMPLE_MS), plus one
// every STATIONARY_MS while a stroke is held still, because browsers send
// no pointermove events while a pointer rests and a pause has to be
// recorded rather than guessed at. Times come from performance.now(),
// relative to the stroke's start. A stroke ends when its pointer lifts, its
// key is pressed again, or the page is hidden or loses focus (so a hidden
// tab or a sleeping phone never becomes a giant pause); a cancelled pointer
// or Escape drops the stroke entirely.
import { LIMITS, SPACE, strokePath } from "./fingerprint.js";

export const STATIONARY_MS = 100;
export const MIN_SAMPLE_MS = 10;
export const KEY_STEP = 40;
export const KEY_SMALL_STEP = 10;

const NS = "http://www.w3.org/2000/svg";
const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const clamp = (v) => Math.min(SPACE, Math.max(0, Math.round(v)));

export function createSketchPad(svg, options = {}) {
  const doc = svg.ownerDocument;
  const win = doc.defaultView;
  const now = options.now ?? (() => win.performance.now());
  const every = options.setInterval ?? ((fn, ms) => win.setInterval(fn, ms));
  const cancelEvery = options.clearInterval ?? ((id) => win.clearInterval(id));
  const onChange = options.onChange ?? (() => {});
  const onStatus = options.onStatus ?? (() => {});
  const ink = options.ink ?? (() => ({ pen: "line", colour: "currentColor" }));

  let strokes = [];
  let active = null;
  let timer = null;
  let cursor = [SPACE / 2, SPACE / 2];

  const layer = doc.createElementNS(NS, "g");
  layer.setAttribute("class", "strokes");
  const live = doc.createElementNS(NS, "path");
  live.setAttribute("class", "live");
  const cross = doc.createElementNS(NS, "path");
  cross.setAttribute("class", "cursor");
  cross.setAttribute("aria-hidden", "true");
  svg.append(layer, live, cross);

  const totalPoints = () => strokes.reduce((a, s) => a + s.points.length, 0) + (active?.points.length ?? 0);

  function paint() {
    const { pen, colour } = ink();
    layer.replaceChildren(
      ...strokes.map((s) => {
        const p = doc.createElementNS(NS, "path");
        p.setAttribute("d", strokePath(s.points));
        p.setAttribute("class", `pen-${pen}`);
        p.setAttribute("stroke", colour);
        return p;
      }),
    );
    live.setAttribute("class", `live pen-${pen}`);
    live.setAttribute("stroke", colour);
    live.setAttribute("d", active ? strokePath(active.points) : "");
    const [x, y] = cursor;
    cross.setAttribute("d", `M${x - 18},${y} H${x + 18} M${x},${y - 18} V${y + 18}`);
  }

  // Client coordinates to drawing units through the SVG's actual screen
  // transform, which already accounts for its size, letterboxing and the
  // page's scroll.
  function toDrawing(evt) {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const det = m.a * m.d - m.b * m.c;
    if (!det) return null;
    const dx = evt.clientX - m.e;
    const dy = evt.clientY - m.f;
    return [clamp((m.d * dx - m.c * dy) / det), clamp((-m.b * dx + m.a * dy) / det)];
  }

  function begin(point, input, pointerId = null) {
    if (strokes.length >= LIMITS.strokes) {
      onStatus(`That's the most strokes one sketch can have (${LIMITS.strokes}).`);
      return false;
    }
    if (totalPoints() + 2 > LIMITS.points) {
      onStatus("This sketch is as detailed as one exhibit can be.");
      return false;
    }
    active = { input, pointerId, t0: now(), points: [[point[0], point[1], 0]] };
    timer = every(tick, STATIONARY_MS);
    paint();
    return true;
  }

  function record(point, force = false) {
    if (!active) return;
    const t = Math.max(Math.round(now() - active.t0), active.points.at(-1)[2]);
    const last = active.points.at(-1);
    if (!force && t - last[2] < MIN_SAMPLE_MS) return;
    active.points.push([point[0], point[1], Math.min(t, LIMITS.strokeMs)]);
    live.setAttribute("d", strokePath(active.points));
    if (t >= LIMITS.strokeMs || active.points.length >= LIMITS.pointsPerStroke || totalPoints() >= LIMITS.points) {
      onStatus("That stroke reached the longest one stroke can be, so it ended there.");
      end(true);
    }
  }

  // The held-still sample: same position, current time.
  function tick() {
    if (!active) return;
    const last = active.points.at(-1);
    if (now() - active.t0 - last[2] >= STATIONARY_MS - 1) record([last[0], last[1]], true);
  }

  function end(keep) {
    if (!active) return;
    cancelEvery(timer);
    timer = null;
    const done = active;
    active = null;
    if (keep) {
      // A tap with no movement is still a mark: a dot.
      if (done.points.length === 1) done.points.push([...done.points[0]]);
      strokes.push({ input: done.input, points: done.points });
    }
    paint();
    onChange();
  }

  svg.addEventListener("pointerdown", (evt) => {
    if (active || (evt.pointerType === "mouse" && evt.button !== 0)) return;
    const point = toDrawing(evt);
    if (!point) return;
    evt.preventDefault();
    if (!begin(point, ["mouse", "touch", "pen"].includes(evt.pointerType) ? evt.pointerType : "mouse", evt.pointerId)) return;
    // Capture keeps the stroke when the pointer leaves the frame; drawing
    // still works without it.
    try {
      svg.setPointerCapture?.(evt.pointerId);
    } catch {}
  });
  svg.addEventListener("pointermove", (evt) => {
    if (!active || evt.pointerId !== active.pointerId) return;
    const point = toDrawing(evt);
    if (point) record(point);
  });
  // On the window, not the frame: if capture was refused, a pointer lifted
  // outside the frame still ends its stroke.
  win.addEventListener("pointerup", (evt) => {
    if (!active || evt.pointerId !== active.pointerId) return;
    const point = toDrawing(evt);
    if (point) record(point, true);
    end(true);
  });
  // The OS took the pointer (a scroll, a system gesture): nothing was
  // meant, so nothing is kept.
  win.addEventListener("pointercancel", (evt) => {
    if (active && evt.pointerId === active.pointerId) end(false);
  });

  svg.addEventListener("keydown", (evt) => {
    const drawingByKey = active?.input === "keyboard";
    if (active && !drawingByKey) {
      if (evt.key === "Escape") end(false);
      return;
    }
    if (evt.key in ARROWS) {
      evt.preventDefault();
      const step = evt.shiftKey ? KEY_SMALL_STEP : KEY_STEP;
      const [dx, dy] = ARROWS[evt.key];
      cursor = [clamp(cursor[0] + dx * step), clamp(cursor[1] + dy * step)];
      if (drawingByKey) record(cursor, true);
      else paint();
      return;
    }
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      if (drawingByKey) {
        end(true);
        onStatus("Stroke added. Arrow keys move the cross; Enter starts another stroke.");
      } else if (begin(cursor, "keyboard")) onStatus("Drawing: arrow keys draw, Enter or Space ends the stroke, Escape cancels it.");
      return;
    }
    if (evt.key === "Escape" && drawingByKey) {
      evt.preventDefault();
      end(false);
      onStatus("Stroke cancelled.");
    }
  });

  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") end(true);
  });
  win.addEventListener("blur", () => end(true));

  paint();

  return {
    get strokes() {
      return strokes;
    },
    get drawing() {
      return active !== null;
    },
    setStrokes(next) {
      end(false);
      strokes = next.map((s) => ({ input: s.input, points: s.points.map((p) => [...p]) }));
      paint();
    },
    // Undo takes a stroke's timing with its geometry: they're one object.
    undo() {
      if (active) end(false);
      else strokes.pop();
      paint();
      onChange();
    },
    clear() {
      end(false);
      strokes = [];
      paint();
      onChange();
    },
    paint,
  };
}
