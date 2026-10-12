// The museum's drawing fingerprint: what a sketch's recorded samples mean,
// and how they become a trace seal. Pure functions only, no DOM, so the
// server (src/museum.ts) and the browser (public/contribute.js) run the
// same code: the browser to preview a seal, the server to compute the one
// that's actually stored, from samples it has validated itself.
//
// Units. Positions are drawing units (du): the drawing is a fixed square,
// 1000 du across, whatever size it's shown at. Times are whole milliseconds
// from the start of each stroke, from performance.now(). Time between
// strokes is never recorded, so it never counts.
//
// Sampling. The browser records a point on every pointer move (at most one
// per 10 ms) and, while a stroke is held still, one every 100 ms, so a
// pause is captured deliberately rather than inferred from missing events.
// Here every stroke is resampled at a fixed STEP_MS, so the result depends
// on the movement, not on how often a device happens to fire events.

export const VERSION = 1;
export const SPACE = 1000;
export const STEP_MS = 50;
// Moving less than this in one 50 ms step (50 du/s, 5% of the drawing's
// width per second) is negligible: it's jitter or a held hand, not drawing.
export const STILL_DU = 2.5;
// A pause is at least this long without movement while a stroke is held.
export const PAUSE_MS = 500;
// A gap this long between two samples means the browser stopped reporting
// (a hidden tab, a sleeping phone). It counts as this long and no longer.
export const MAX_GAP_MS = 1000;
// Turning is measured along the path every SPACING_DU, so a shaky hand at
// rest doesn't read as a tight spiral, and a change of heading under
// MIN_TURN_DEG there (a curve gentler than a ~380 du radius, or rounding to
// whole du) counts as straight.
export const SPACING_DU = 20;
export const MIN_TURN_DEG = 3;
export const SHARP_TURN_DEG = 45;
// Fixed scales, the same for every exhibit, so two seals can be compared.
// Anything beyond a cap is drawn at the cap and marked as capped.
export const SPEED_CAP = 1500; // du/s
export const TURN_CAP = 360; // degrees per 100 du of path
export const PAUSE_BEAD_CAP_MS = 3000;
// Two gestures are "similar" when their feature distance is at most this.
export const SIMILAR_MAX = 0.2;
export const SEAL_BINS = 180;

export const LIMITS = {
  strokes: 40,
  pointsPerStroke: 3000,
  points: 8000,
  strokeMs: 60_000,
};

export const INPUTS = ["mouse", "touch", "pen", "keyboard"];

// Checks a submitted sketch and returns a clean copy, or the first problem.
// Everything the seal is computed from passes through here first.
export function validateStrokes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "A sketch needs at least one stroke." };
  if (raw.length > LIMITS.strokes) return { error: `A sketch can have at most ${LIMITS.strokes} strokes.` };
  let total = 0;
  const strokes = [];
  for (const stroke of raw) {
    if (!stroke || typeof stroke !== "object") return { error: "That isn't a stroke." };
    if (!INPUTS.includes(stroke.input)) return { error: "Unknown input method." };
    const pts = stroke.points;
    if (!Array.isArray(pts) || pts.length < 2) return { error: "Every stroke needs at least two points." };
    if (pts.length > LIMITS.pointsPerStroke) return { error: "A stroke has too many points." };
    total += pts.length;
    if (total > LIMITS.points) return { error: "The sketch has too many points." };
    const clean = [];
    let lastT = 0;
    for (const p of pts) {
      if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isInteger)) {
        return { error: "Every point is three whole numbers: x, y and milliseconds." };
      }
      const [x, y, t] = p;
      if (x < 0 || x > SPACE || y < 0 || y > SPACE) return { error: "A point is outside the drawing." };
      if (clean.length === 0 && t !== 0) return { error: "Every stroke's time starts at 0." };
      if (t < lastT) return { error: "A stroke's times go backwards." };
      if (t > LIMITS.strokeMs) return { error: "A stroke can last at most a minute." };
      lastT = t;
      clean.push([x, y, t]);
    }
    strokes.push({ input: stroke.input, points: clean });
  }
  return { strokes };
}

export function inputOf(strokes) {
  const kinds = new Set(strokes.map((s) => s.input));
  return kinds.size === 1 ? [...kinds][0] : "mixed";
}

// One stroke's samples on a fixed time grid: duplicate timestamps keep the
// last position, over-long gaps are shortened to MAX_GAP_MS, and the path is
// linearly interpolated every STEP_MS (plus a final partial step).
function steps(points) {
  const merged = [];
  for (const [x, y, t] of points) {
    if (merged.length && merged[merged.length - 1][2] === t) merged[merged.length - 1] = [x, y, t];
    else merged.push([x, y, t]);
  }
  let clock = 0;
  const timed = merged.map(([x, y, t], i) => {
    if (i > 0) clock += Math.min(t - merged[i - 1][2], MAX_GAP_MS);
    return [x, y, clock];
  });
  const duration = clock;
  const at = (time, from) => {
    let i = from;
    while (i < timed.length - 2 && timed[i + 1][2] < time) i++;
    const [x0, y0, t0] = timed[i];
    const [x1, y1, t1] = timed[Math.min(i + 1, timed.length - 1)];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 1;
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, i };
  };
  const out = [];
  let prev = { x: timed[0][0], y: timed[0][1], i: 0 };
  for (let t = STEP_MS; t < duration + STEP_MS; t += STEP_MS) {
    const end = Math.min(t, duration);
    const dt = end - (t - STEP_MS);
    if (dt <= 0) break;
    const next = at(end, prev.i);
    const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
    const moving = dist >= STILL_DU * (dt / STEP_MS);
    out.push({ t0: t - STEP_MS, t1: end, dt, x0: prev.x, y0: prev.y, x1: next.x, y1: next.y, dist, moving });
    prev = next;
  }
  return { duration, steps: out };
}

const wrap = (a) => {
  let d = a % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

// Turning along one stroke: points every SPACING_DU along the moving parts
// of the path, each tagged with the time it was reached; the turn at a
// point is the change of heading there.
function turns(stepList) {
  const marks = [];
  let carry = 0;
  let last = null;
  for (const s of stepList) {
    if (!s.moving) continue;
    if (!last) {
      last = { x: s.x0, y: s.y0 };
      marks.push({ x: s.x0, y: s.y0, t: s.t0 });
    }
    let travelled = 0;
    while (carry + (s.dist - travelled) >= SPACING_DU) {
      travelled += SPACING_DU - carry;
      carry = 0;
      const f = travelled / s.dist;
      marks.push({ x: s.x0 + (s.x1 - s.x0) * f, y: s.y0 + (s.y1 - s.y0) * f, t: s.t0 + s.dt * f });
    }
    carry += s.dist - travelled;
  }
  const out = [];
  for (let i = 2; i < marks.length; i++) {
    const h0 = (Math.atan2(marks[i - 1].y - marks[i - 2].y, marks[i - 1].x - marks[i - 2].x) * 180) / Math.PI;
    const h1 = (Math.atan2(marks[i].y - marks[i - 1].y, marks[i].x - marks[i - 1].x) * 180) / Math.PI;
    const deg = Math.abs(wrap(h1 - h0));
    if (deg >= MIN_TURN_DEG) out.push({ t: marks[i - 1].t, deg });
  }
  return out;
}

const round = (n, places = 0) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

// The descriptor: everything the seal and the exhibit page show, computed
// from validated strokes. Stored beside the exhibit with its version, so an
// exhibit keeps its meaning when this function changes.
export function describe(strokes) {
  const per = strokes.map((s) => {
    const { duration, steps: st } = steps(s.points);
    return { duration, steps: st, turns: turns(st) };
  });
  const activeMs = per.reduce((a, s) => a + s.duration, 0);
  let distance = 0;
  let movingMs = 0;
  let turning = 0;
  let sharpTurns = 0;
  const pauses = [];
  per.forEach((s, index) => {
    let still = 0;
    let stillFrom = 0;
    const endRun = () => {
      if (still >= PAUSE_MS) pauses.push([index, Math.round(stillFrom + still / 2), Math.round(still)]);
      still = 0;
    };
    for (const step of s.steps) {
      if (step.moving) {
        endRun();
        distance += step.dist;
        movingMs += step.dt;
      } else {
        if (still === 0) stillFrom = step.t0;
        still += step.dt;
      }
    }
    endRun();
    for (const turn of s.turns) {
      turning += turn.deg;
      if (turn.deg >= SHARP_TURN_DEG) sharpTurns++;
    }
  });
  const pauseMs = pauses.reduce((a, p) => a + p[2], 0);

  // The seal's resolution: SEAL_BINS shared between strokes by duration,
  // at least one each, with every bin inside a single stroke.
  const profile = [];
  const turnProfile = [];
  per.forEach((s) => {
    const k = activeMs > 0 ? Math.max(1, Math.round((SEAL_BINS * s.duration) / activeMs)) : 1;
    const dist = new Array(k).fill(0);
    const deg = new Array(k).fill(0);
    const width = s.duration / k;
    const binOf = (t) => (width > 0 ? Math.min(k - 1, Math.floor(t / width)) : 0);
    for (const step of s.steps) {
      if (!step.moving) continue;
      // Spread each step's distance over the bins it overlaps.
      for (let b = binOf(step.t0); b <= binOf(Math.max(step.t0, step.t1 - 1e-9)); b++) {
        const overlap = Math.min(step.t1, (b + 1) * width) - Math.max(step.t0, b * width);
        if (overlap > 0) dist[b] += step.dist * (overlap / step.dt);
      }
    }
    for (const turn of s.turns) deg[binOf(turn.t)] += turn.deg;
    profile.push(dist.map((d) => (width > 0 ? Math.round(d / (width / 1000)) : 0)));
    turnProfile.push(deg.map((d, i) => Math.round((d / Math.max(dist[i], 20)) * 100)));
  });

  return {
    v: VERSION,
    input: inputOf(strokes),
    strokes: strokes.length,
    samples: strokes.reduce((a, s) => a + s.points.length, 0),
    activeMs: Math.round(activeMs),
    movingMs: Math.round(movingMs),
    distance: Math.round(distance),
    speed: movingMs > 0 ? Math.round(distance / (movingMs / 1000)) : 0,
    pauses: pauses.length,
    pauseMs,
    pauseShare: activeMs > 0 ? round(pauseMs / activeMs, 3) : 0,
    turning: Math.round(turning),
    turnDensity: distance >= 1 ? round((turning / distance) * 100, 1) : 0,
    sharpTurns,
    strokeMs: per.map((s) => Math.round(s.duration)),
    pauseAt: pauses,
    profile,
    turnProfile,
  };
}

// The three numbers the "Similar gesture" thread compares, each on a fixed
// 0..1 scale: moving speed against SPEED_CAP, the share of drawing time
// spent paused, and turning per 100 du against TURN_CAP.
export function features(d) {
  return {
    speed: Math.min(d.speed / SPEED_CAP, 1),
    pause: Math.min(d.pauseShare, 1),
    turn: Math.min(d.turnDensity / TURN_CAP, 1),
  };
}

export function gestureDistance(a, b) {
  return Math.hypot(a.speed - b.speed, a.pause - b.pause, a.turn - b.turn);
}

// Why two gestures were matched, in words: the features that are close.
export function similarityReason(a, b) {
  const close = [];
  if (Math.abs(a.speed - b.speed) <= 0.08) close.push("movement speed");
  if (Math.abs(a.pause - b.pause) <= 0.08) close.push("pause proportions");
  if (Math.abs(a.turn - b.turn) <= 0.08) close.push("turning");
  if (close.length === 0) return "Both sketches have broadly similar speed, pauses and turning.";
  const list = close.length === 1 ? close[0] : `${close.slice(0, -1).join(", ")} and ${close.at(-1)}`;
  return `Both sketches have similar ${list}.`;
}

// --- Presentation, shared so a preview reads exactly like the exhibit. ---

const fmt = (n, places = 1) => n.toLocaleString("en-AU", { maximumFractionDigits: places, minimumFractionDigits: places });
const seconds = (ms) => `${fmt(ms / 1000)} s`;
const widths = (du) => fmt(du / SPACE, 2);

export const INPUT_LABELS = {
  mouse: "Mouse",
  touch: "Touch",
  pen: "Stylus",
  keyboard: "Keyboard",
  mixed: "Mixed input",
};

// The measurements, with units, as label/value pairs for a definition list.
export function measurements(d) {
  const capped = d.speed > SPEED_CAP ? " (beyond the seal's scale, drawn at its edge)" : "";
  return [
    ["Input", INPUT_LABELS[d.input] ?? d.input],
    ["Strokes", String(d.strokes)],
    ["Drawing time", `${seconds(d.activeMs)} (time between strokes not counted)`],
    ["Distance travelled", `${widths(d.distance)} drawing widths`],
    ["Moving speed", `${widths(d.speed)} drawing widths per second${capped}`],
    [
      "Pauses",
      d.pauses === 0
        ? "None held for half a second or more"
        : `${d.pauses}, ${seconds(d.pauseMs)} in all (${Math.round(d.pauseShare * 100)}% of drawing time)`,
    ],
    [
      "Turning",
      `${Math.round(d.turning).toLocaleString("en-AU")}° in all, ${fmt(d.turnDensity, 0)}° per tenth of a drawing width; ${d.sharpTurns} sharp ${d.sharpTurns === 1 ? "turn" : "turns"}`,
    ],
  ];
}

export function sealSummary(d) {
  return `Trace seal: ${d.strokes} ${d.strokes === 1 ? "stroke" : "strokes"} over ${seconds(d.activeMs)}, moving at ${widths(d.speed)} drawing widths per second, ${d.pauses} ${d.pauses === 1 ? "pause" : "pauses"}, ${Math.round(d.turning)}° of turning.`;
}

// --- The seal. ---
// Read clockwise from the notch at the top, which is where the sketch
// starts. Each stroke is one arc, separated by a gap. The arc's outer edge
// rises with speed from the base circle (still) to the dashed limit circle
// (SPEED_CAP); a capped stretch is drawn as a heavy line on the limit
// circle. Hollow beads sit on the base circle where a pause was held, larger
// for longer pauses up to PAUSE_BEAD_CAP_MS. The inner band thickens where
// the line turned more for the distance it covered, up to TURN_CAP.

const C = 60;
const R_BASE = 34;
const R_LIMIT = 54;
const R_BAND = 30;
const BAND_DEPTH = 12;

const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [round(C + r * Math.cos(a), 2), round(C + r * Math.sin(a), 2)];
};

export function sealGeometry(d) {
  const n = d.strokes;
  const gap = Math.min(4, 90 / n);
  const available = 360 - gap * n;
  const total = d.strokeMs.reduce((a, b) => a + b, 0);
  const raw = d.strokeMs.map((ms) => (total > 0 ? (available * ms) / total : available / n));
  const floored = raw.map((s) => Math.max(s, Math.min(2, available / n)));
  const scale = available / floored.reduce((a, b) => a + b, 0);
  const spans = floored.map((s) => s * scale);

  const arcs = [];
  const capped = [];
  const beads = [];
  let angle = -90 + gap / 2;
  spans.forEach((span, s) => {
    const speeds = d.profile[s] ?? [0];
    const bends = d.turnProfile[s] ?? [0];
    const k = speeds.length;
    const angleAt = (i) => angle + (span * (i + 0.5)) / k;
    const outer = speeds.map((v, i) => polar(R_BASE + (R_LIMIT - R_BASE) * Math.min(v / SPEED_CAP, 1), angleAt(i)));
    const area = [polar(R_BASE, angle), ...outer, polar(R_BASE, angle + span)];
    const band = [
      polar(R_BAND, angle),
      ...bends.map((t, i) => polar(R_BAND - BAND_DEPTH * Math.min(t / TURN_CAP, 1), angleAt(i))),
      polar(R_BAND, angle + span),
    ];
    let run = null;
    speeds.forEach((v, i) => {
      if (v >= SPEED_CAP) {
        if (!run) run = { from: angle + (span * i) / k };
        run.to = angle + (span * (i + 1)) / k;
      } else if (run) {
        capped.push(run);
        run = null;
      }
    });
    if (run) capped.push(run);
    const ms = d.strokeMs[s];
    for (const [stroke, mid, len] of d.pauseAt) {
      if (stroke !== s) continue;
      const at = ms > 0 ? angle + (span * mid) / ms : angle + span / 2;
      const [x, y] = polar(R_BASE, at);
      beads.push({ x, y, r: round(2 + 2.5 * Math.min(len / PAUSE_BEAD_CAP_MS, 1), 2) });
    }
    arcs.push({ area, outer, band, from: angle, to: angle + span });
    angle += span + gap;
  });
  return { arcs, capped, beads };
}

const pts = (list) => list.map(([x, y]) => `${x},${y}`).join(" ");

const arcPath = (r, from, to) => {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, to);
  return `M${x0},${y0} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1},${y1}`;
};

export const HEX = /^#[0-9a-f]{6}$/i;

// The seal as SVG markup. Everything interpolated is a number this module
// computed, or a colour checked against HEX, so it's safe to insert as-is.
export function sealSvg(d, colour, className = "seal") {
  const ink = HEX.test(colour) ? colour : "currentColor";
  const { arcs, capped, beads } = sealGeometry(d);
  const parts = [
    `<circle class="seal-limit" cx="${C}" cy="${C}" r="${R_LIMIT}" />`,
    `<circle class="seal-base" cx="${C}" cy="${C}" r="${R_BASE}" />`,
    `<path class="seal-start" d="M${C - 3},${C - R_LIMIT - 5} L${C + 3},${C - R_LIMIT - 2} L${C - 3},${C - R_LIMIT + 1} Z" />`,
  ];
  for (const a of arcs) {
    parts.push(`<polygon class="seal-speed" points="${pts(a.area)}" />`);
    parts.push(`<polyline class="seal-edge" points="${pts(a.outer)}" />`);
    parts.push(`<polygon class="seal-band" points="${pts(a.band)}" />`);
  }
  for (const c of capped) parts.push(`<path class="seal-cap" d="${arcPath(R_LIMIT, c.from, c.to)}" />`);
  for (const b of beads) parts.push(`<circle class="seal-bead" cx="${b.x}" cy="${b.y}" r="${b.r}" />`);
  return `<svg class="${className}" viewBox="0 0 120 120" role="img" aria-label="${sealSummary(d)}" style="--ink:${ink}">${parts.join("")}</svg>`;
}

// --- The sketch. ---

// Ramer-Douglas-Peucker: the smaller path a cabinet card draws.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist =
      len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (dist > worst) {
      worst = dist;
      index = i;
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

export function strokePath(points, tolerance = 0) {
  const list = tolerance > 0 ? simplify(points, tolerance) : points;
  return list.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}
