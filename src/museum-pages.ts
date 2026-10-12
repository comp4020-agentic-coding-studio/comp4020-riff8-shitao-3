import {
  features,
  INPUT_LABELS,
  measurements,
  PAUSE_MS,
  sealSvg,
  similarityReason,
  SPEED_CAP,
  TURN_CAP,
  type Descriptor,
} from "../public/fingerprint.js";
import type { Exhibit } from "./db.ts";
import { COLOURS } from "./identity.ts";
import {
  accession,
  DURATIONS,
  durationOf,
  exhibitHref,
  LABEL_MAX,
  ORIGINS,
  originOf,
  REASONS,
  reasonOf,
  REPORT_REASONS,
  STORY_MAX,
} from "./museum.ts";
import { colourPicker, escape, layout, nav, penPicker, untilPhrase } from "./pages.ts";
import { DEFAULT_PEN, type Pen } from "./pens.ts";

const TITLE = "The Museum of Things We Keep";
const INVITATION = "Draw something you kept. Leave the story of why.";

export const descriptorOf = (e: Exhibit): Descriptor => JSON.parse(e.descriptor) as Descriptor;

// The drawing, as the visitor drew it: `full` draws every recorded point,
// otherwise the simplified paths stored for cabinet cards.
function sketchSvg(e: Exhibit, full = false): string {
  const paths: string[] = full
    ? (JSON.parse(e.strokes) as { points: number[][] }[]).map((s) =>
        s.points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" "),
      )
    : (JSON.parse(e.sketch) as string[]);
  const strokes = paths
    .map((d) => `<path d="${escape(d)}" class="pen-${escape(e.pen)}" stroke="${escape(e.colour)}" />`)
    .join("");
  return `<svg class="sketch" viewBox="0 0 1000 1000" role="img" aria-label="${escape(`Sketch: ${e.label}`)}">${strokes}</svg>`;
}

const originBadge = (e: Exhibit) =>
  `<span class="badge origin origin-${escape(e.origin)}">${escape(originOf(e.origin).badge)}</span>`;
const reasonTag = (e: Exhibit) =>
  `<span class="tag reason-${escape(e.reason)}">${escape(reasonOf(e.reason).label)}</span>`;

// One framed exhibit for a cabinet shelf. The same markup goes out over
// /api/museum/stream, so it carries nothing private: `mine` is added only
// when rendering for the hand that owns it.
export function exhibitCard(e: Exhibit, mine = false): string {
  return `<li class="exhibit-card${mine ? " mine" : ""}" data-id="${e.id}" data-cabinet="${escape(e.duration)}">
        <a class="card-link" href="${exhibitHref(e.id)}">
          <span class="frame">${sketchSvg(e)}</span>
          <span class="card-caption"><span class="card-label">${escape(e.label)}</span>${sealSvg(descriptorOf(e), e.colour, "seal seal-small")}</span>
        </a>
        <span class="card-meta"><span class="accession">${accession(e.id)}</span><span class="yours">Your exhibit</span></span>
        <span class="card-tags">${originBadge(e)} ${reasonTag(e)}</span>
      </li>`;
}

const legend = `<details class="legend">
        <summary>How to read an exhibit</summary>
        <div class="legend-grid">
          <figure>
            <svg viewBox="0 0 120 70" aria-hidden="true"><path class="lg-base" d="M10,60 A50,50 0 0 1 110,60" /><path class="lg-limit" d="M2,60 A58,58 0 0 1 118,60" /><path class="lg-speed" d="M10,60 C20,40 30,8 60,4 C80,14 95,34 110,60" /></svg>
            <figcaption><strong>Speed</strong>: the outer edge rises from the solid base circle (still) towards the dashed ring (${(SPEED_CAP / 1000).toFixed(1)} drawing widths per second). A heavy line on the ring means faster than the scale can show.</figcaption>
          </figure>
          <figure>
            <svg viewBox="0 0 120 70" aria-hidden="true"><path class="lg-base" d="M10,60 A50,50 0 0 1 110,60" /><circle class="lg-bead" cx="35" cy="24" r="5" /><circle class="lg-bead" cx="85" cy="24" r="8" /></svg>
            <figcaption><strong>Pauses</strong>: a hollow bead wherever the hand was held still for ${PAUSE_MS / 1000} s or more mid-stroke; bigger beads are longer pauses (up to 3 s).</figcaption>
          </figure>
          <figure>
            <svg viewBox="0 0 120 70" aria-hidden="true"><path class="lg-band" d="M10,60 A50,50 0 0 1 110,60 L96,60 C90,40 70,30 60,26 C50,22 30,40 24,60 Z" /></svg>
            <figcaption><strong>Turning</strong>: the inner band is thicker where the line changed direction more for the distance it covered (full depth at ${TURN_CAP}° per tenth of a drawing width).</figcaption>
          </figure>
          <figure>
            <svg viewBox="0 0 120 70" aria-hidden="true"><path class="lg-arc" d="M18,60 A44,44 0 0 1 56,17" /><path class="lg-arc" d="M66,17 A44,44 0 0 1 102,60" /><path class="lg-notch" d="M58,4 L64,8 L58,12 Z" /></svg>
            <figcaption><strong>Order</strong>: read clockwise from the notch at the top, following the drawing from its first stroke to its last. Each stroke is its own arc, with a gap between.</figcaption>
          </figure>
        </div>
        <p>The frame holds the drawing; the cabinet is how long the object has been kept; the badge is how it arrived; the tag is why it's kept. The seal's colour is the drawing's ink and carries no meaning of its own. Seals are recorded sketch estimates: they describe one drawing, not the person who made it.</p>
      </details>`;

const header = (current: "museum" | "contribute" | "") => `<header class="museum-head">
      ${nav(current)}
      <p class="museum-title"><a href="/">${TITLE}</a></p>
    </header>`;

export function museumPage(
  shelves: { id: string; count: number; exhibits: Exhibit[] }[],
  owned: Set<number>,
  seq: number,
): string {
  const total = shelves.reduce((a, s) => a + s.count, 0);
  const cabinets = shelves
    .map((shelf) => {
      const d = durationOf(shelf.id);
      return `<section class="cabinet" id="cabinet-${d.id}" data-cabinet="${d.id}" aria-labelledby="cabinet-${d.id}-title">
      <h2 id="cabinet-${d.id}-title">${escape(d.cabinet)} <span class="count" data-count="${shelf.count}">${countText(shelf.count)}</span></h2>
      <ul class="shelf">
      ${shelf.exhibits.map((e) => exhibitCard(e, owned.has(e.id))).join("\n      ")}
      </ul>
      <p class="empty-shelf">Nothing on this shelf yet.</p>
      <p class="see-all"${shelf.count > shelf.exhibits.length ? "" : " hidden"}><a href="/cabinet/${d.id}">See every object in this cabinet</a></p>
    </section>`;
    })
    .join("\n    ");
  return layout(
    TITLE,
    `    ${header("museum")}
    <main id="museum" data-seq="${seq}">
      <h1>${TITLE}</h1>
      <p class="invitation">${INVITATION}</p>
      <p><a class="button" href="/contribute/">Add an exhibit</a></p>
      <p class="intro">An anonymous collection of ordinary objects people choose to keep, arranged by how long they've kept them. Each exhibit is a visitor's drawing, their reason in their own words, and a trace seal measured from how the drawing was made. New exhibits arrive here as they're published.</p>
      ${total === 0 ? `<p class="first">The cabinets are empty so far. The first object could be yours.</p>` : ""}
      ${legend}
      <div class="cabinets">
    ${cabinets}
      </div>
      <p class="live" role="status" aria-live="polite"></p>
    </main>
    <script type="module" src="/museum.js"></script>`,
    "museum",
  );
}

const countText = (n: number) => `${n} ${n === 1 ? "object" : "objects"}`;

export const CABINET_PAGE = 30;

export function cabinetPage(
  id: string,
  count: number,
  exhibits: Exhibit[],
  owned: Set<number>,
  seq: number,
  newer: boolean,
): string {
  const d = durationOf(id);
  const older = exhibits.length === CABINET_PAGE ? exhibits[exhibits.length - 1].id : null;
  return layout(
    `${d.cabinet} · ${TITLE}`,
    `    ${header("")}
    <main id="museum" data-seq="${seq}" data-paged="${newer ? "true" : "false"}">
      <p class="crumbs"><a href="/">The museum</a> › cabinet</p>
      <section class="cabinet" data-cabinet="${d.id}" aria-labelledby="cabinet-title">
        <h1 id="cabinet-title">${escape(d.cabinet)} <span class="count" data-count="${count}">${countText(count)}</span></h1>
        <ul class="shelf">
        ${exhibits.map((e) => exhibitCard(e, owned.has(e.id))).join("\n        ")}
        </ul>
        <p class="empty-shelf">Nothing on this shelf yet.</p>
      </section>
      <p class="pager">${newer ? `<a href="/cabinet/${d.id}">Newest objects</a>` : ""} ${older ? `<a href="/cabinet/${d.id}?before=${older}">Older objects</a>` : ""}</p>
      <p class="live" role="status" aria-live="polite"></p>
    </main>
    <script type="module" src="/museum.js"></script>`,
    "museum",
  );
}

function measurementList(d: Descriptor): string {
  return `<dl class="measures">${measurements(d)
    .map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`)
    .join("")}</dl>`;
}

const NOT_A_SCORE =
  "These are recorded estimates of how this one sketch was drawn, measured by the browser that drew it. They aren't an identifier, a skill score, a personality reading, or a measure of how much the object means to anyone.";

export interface Thread {
  reason: Exhibit | undefined;
  gesture: (Exhibit & { d2: number }) | undefined;
  gestureClose: boolean;
}

export function exhibitPage(
  e: Exhibit,
  opts: { mine: boolean; reports: number; thread: Thread; msUntilNext: number; seq: number },
): string {
  const d = descriptorOf(e);
  const reason = reasonOf(e.reason);
  const kept = durationOf(e.duration);
  const href = exhibitHref(e.id);
  const t = opts.thread;
  const reasonThread = t.reason
    ? `<a href="/compare/${pad(e.id)}/${pad(t.reason.id)}?thread=reason">${escape(t.reason.label)}</a> <span class="why-link">Both were kept for ${escape(reason.label.toLowerCase())}.</span>`
    : `<span class="none">No other object has been kept for ${escape(reason.label.toLowerCase())} yet.</span>`;
  const inputName = (INPUT_LABELS[e.input] ?? e.input).toLowerCase();
  const gestureThread =
    t.gesture && t.gestureClose
      ? `<a href="/compare/${pad(e.id)}/${pad(t.gesture.id)}?thread=gesture">${escape(t.gesture.label)}</a> <span class="why-link">${escape(similarityReason(features(d), features(descriptorOf(t.gesture))))}</span>`
      : `<span class="none">${
          t.gesture
            ? `No ${escape(inputName)} sketch moves closely enough like this one yet.`
            : `There's no other sketch drawn with ${escape(inputName === "mixed input" ? "mixed input" : `${inputName} input`)} to compare it with yet. Gestures are only compared within one input method.`
        }</span>`;
  return layout(
    `${accession(e.id)}: ${e.label} · ${TITLE}`,
    `    ${header("")}
    <main id="exhibit" data-seq="${opts.seq}" data-id="${e.id}" data-cabinet="${escape(e.duration)}">
      <p class="crumbs"><a href="/">The museum</a> › <a href="/#cabinet-${escape(e.duration)}">${escape(kept.cabinet)}</a></p>
      <div class="hidden-note" hidden><p>You hid this exhibit on this device.</p><button type="button" class="unhide">Show it again</button></div>
      <article class="exhibit${opts.mine ? " mine" : ""}" aria-labelledby="exhibit-title">
        <div class="exhibit-art">
          <figure class="frame frame-large">${sketchSvg(e, true)}</figure>
          <figure class="seal-figure">${sealSvg(d, e.colour, "seal seal-large")}<figcaption>Trace seal</figcaption></figure>
        </div>
        <div class="exhibit-text">
          <p class="accession">${accession(e.id)}${opts.mine ? ` <span class="yours">Your exhibit</span>` : ""}</p>
          <h1 id="exhibit-title">${escape(e.label)}</h1>
          <blockquote class="story"><p>${escape(e.story)}</p></blockquote>
          <dl class="facts">
            <div><dt>Kept for</dt><dd>${escape(kept.answer)}</dd></div>
            <div><dt>How it came</dt><dd>${originBadge(e)}</dd></div>
            <div><dt>Kept because of</dt><dd>${reasonTag(e)}</dd></div>
            <div><dt>Drawn with</dt><dd>${escape(INPUT_LABELS[e.input] ?? e.input)}</dd></div>
            <div><dt>Added</dt><dd>${new Date(e.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Sydney" })}</dd></div>
          </dl>
        </div>
      </article>
      <section class="fingerprint" aria-labelledby="fp-title">
        <h2 id="fp-title">How this sketch was drawn</h2>
        <p>Read the seal clockwise from the notch at the top: each arc is one stroke, in the order it was drawn. The further its edge reaches out, the faster the line was moving; hollow beads mark pauses of half a second or more; the inner band thickens where the line turned.</p>
        ${measurementList(d)}
        <p class="caveat">${NOT_A_SCORE}</p>
      </section>
      <section class="threads" aria-labelledby="thread-title">
        <h2 id="thread-title">Follow a thread</h2>
        <ul>
          <li><h3>Same reason, another object</h3><p>${reasonThread}</p></li>
          <li><h3>Similar gesture, another story</h3><p>${gestureThread}</p></li>
        </ul>
        <p class="caveat">A thread connects what two visitors chose to submit. It says nothing about the people who made them.</p>
      </section>
      ${
        opts.mine
          ? `<section class="owner" aria-labelledby="owner-title">
        <h2 id="owner-title">Your exhibit</h2>
        <p>Only this browser sees this. Withdrawing removes the drawing, story and seal from the museum for everyone, straight away. It doesn't give back today's publication: you can add another ${opts.msUntilNext > 0 ? untilPhrase(opts.msUntilNext) : "now"}.</p>
        <form method="post" action="/api/exhibits/${e.id}/withdraw" class="withdraw">
          <button type="submit" class="danger">Withdraw this exhibit</button>
        </form>
      </section>`
          : ""
      }
      <section class="report" aria-labelledby="report-title">
        <h2 id="report-title" class="visually-hidden">Report or hide</h2>
        ${opts.reports > 0 ? `<p class="reported">Someone has reported this exhibit; it's waiting for a person to review it. It stays up until then.</p>` : ""}
        <button type="button" class="hide-here">Hide on this device</button>
        <details>
          <summary>Report this exhibit</summary>
          <form method="post" action="/api/exhibits/${e.id}/report" class="report-form">
            <fieldset>
              <legend>What's wrong with it?</legend>
              ${REPORT_REASONS.map((r, i) => `<label><input type="radio" name="reason" value="${r.id}"${i === 0 ? " required" : ""} /> ${escape(r.label)}</label>`).join("\n              ")}
            </fieldset>
            <button type="submit">Send report</button>
            <p class="form-status" role="status"></p>
          </form>
          <p class="caveat">A report goes to a person, not a filter: one report never removes an exhibit on its own.</p>
        </details>
      </section>
      <p><a href="${href}">Link to this exhibit</a> · <a href="/">Back to the museum</a></p>
      <p class="live" role="status" aria-live="polite"></p>
    </main>
    <script type="module" src="/museum.js"></script>`,
    "museum",
  );
}

const pad = (id: number) => String(id).padStart(4, "0");

// Both exhibits, on the same scales, with the reason they were paired.
export function comparePage(a: Exhibit, b: Exhibit, thread: string, view: string): string {
  const da = descriptorOf(a);
  const db = descriptorOf(b);
  const fa = features(da);
  const fb = features(db);
  const why =
    thread === "reason" && a.reason === b.reason
      ? `Both were kept for ${reasonOf(a.reason).label.toLowerCase()}.`
      : thread === "gesture" && a.input === b.input
        ? similarityReason(fa, fb)
        : "Two exhibits, side by side.";
  const differences = gestureNotes(da, db, a.input === b.input);
  const side = (e: Exhibit, d: Descriptor) => `<article class="pair-item">
          <p class="accession"><a href="${exhibitHref(e.id)}">${accession(e.id)}</a></p>
          <h2>${escape(e.label)}</h2>
          <div class="view-objects">
            <figure class="frame">${sketchSvg(e, true)}</figure>
            <blockquote class="story"><p>${escape(e.story)}</p></blockquote>
            <p class="card-tags">${originBadge(e)} ${reasonTag(e)} <span class="badge">${escape(durationOf(e.duration).answer)}</span></p>
          </div>
          <div class="view-gestures">
            <figure class="seal-figure">${sealSvg(d, e.colour, "seal seal-large")}</figure>
            ${measurementList(d)}
          </div>
        </article>`;
  const current = view === "gestures" ? "gestures" : "objects";
  return layout(
    `${accession(a.id)} and ${accession(b.id)} · ${TITLE}`,
    `    ${header("")}
    <main id="compare" data-view="${current}">
      <p class="crumbs"><a href="/">The museum</a> › <a href="${exhibitHref(a.id)}">${accession(a.id)}</a> › thread</p>
      <h1>${escape(a.label)} <span class="amp">and</span> ${escape(b.label)}</h1>
      <p class="thread-why">${escape(why)}</p>
      <div class="view-switch" role="group" aria-label="Compare">
        <a href="?thread=${escape(thread)}&amp;view=objects" data-view="objects"${current === "objects" ? ' aria-current="true"' : ""}>The objects</a>
        <a href="?thread=${escape(thread)}&amp;view=gestures" data-view="gestures"${current === "gestures" ? ' aria-current="true"' : ""}>The gestures</a>
      </div>
      <div class="pair">
        ${side(a, da)}
        ${side(b, db)}
      </div>
      <section class="view-gestures gesture-notes" aria-label="What the seals share">
        <h2>Shared and different</h2>
        <ul>${differences.map((n) => `<li>${escape(n)}</li>`).join("")}</ul>
        <p class="caveat">${NOT_A_SCORE}</p>
      </section>
    </main>
    <script type="module" src="/museum.js"></script>`,
    "museum",
  );
}

// Plain sentences about each of the three compared features.
function gestureNotes(a: Descriptor, b: Descriptor, sameInput: boolean): string[] {
  const notes: string[] = [];
  if (!sameInput) {
    notes.push(
      `These were drawn with different inputs (${INPUT_LABELS[a.input]} and ${INPUT_LABELS[b.input]}), and input changes how a line moves, so treat the comparison loosely.`,
    );
  }
  const fa = features(a);
  const fb = features(b);
  const say = (name: string, x: number, y: number, unitA: string, unitB: string) => {
    const diff = Math.abs(x - y);
    notes.push(
      diff <= 0.08
        ? `Similar ${name}: ${unitA} and ${unitB}.`
        : `Different ${name}: ${unitA} against ${unitB}.`,
    );
  };
  const w = (du: number) => `${(du / 1000).toFixed(2)} widths/s`;
  say("movement speed", fa.speed, fb.speed, w(a.speed), w(b.speed));
  say("pause proportions", fa.pause, fb.pause, `${Math.round(a.pauseShare * 100)}% paused`, `${Math.round(b.pauseShare * 100)}% paused`);
  say("turning", fa.turn, fb.turn, `${Math.round(a.turnDensity)}° per tenth width`, `${Math.round(b.turnDensity)}° per tenth width`);
  return notes;
}

export function contributePage(opts: { msUntilNext: number; pen: Pen; colour: string }): string {
  const radios = (name: string, list: readonly { id: string; answer?: string; label?: string }[]) =>
    list
      .map(
        (o) =>
          `<label class="choice"><input type="radio" name="${name}" value="${o.id}" required /> <span>${escape(o.answer ?? o.label ?? o.id)}</span></label>`,
      )
      .join("\n            ");
  const waiting = opts.msUntilNext > 0;
  return layout(
    `Add an exhibit · ${TITLE}`,
    `    ${header("contribute")}
    <main id="contribute">
      <h1>Add an exhibit</h1>
      <p class="invitation">${INVITATION}</p>
      <p>Choose an object you own, or remember keeping. Draw it, say why you kept it, preview the whole exhibit, then publish it. Nothing leaves this browser until you press Publish.</p>
      ${waiting ? `<p class="notice">You've published an exhibit in the last 24 hours. You can draft another now and publish it ${untilPhrase(opts.msUntilNext)}.</p>` : ""}
      <div class="draft-note" hidden role="status"><p>Your unfinished draft from this browser is back.</p><button type="button" class="discard">Discard draft</button></div>
      <noscript><p class="notice">Drawing an exhibit needs JavaScript. You can still browse the museum without it.</p></noscript>
      <form id="exhibit-form" novalidate>
        <section class="step" aria-labelledby="step-draw">
          <h2 id="step-draw"><span class="step-n">1</span> Draw it</h2>
          <fieldset id="tools" style="--ink:${opts.colour}">
            <legend>Ink for the whole drawing</legend>
            ${penPicker(opts.pen)}
            ${colourPicker(opts.colour)}
          </fieldset>
          <div class="pad-wrap">
            <svg id="sketchpad" class="frame frame-pad" viewBox="0 0 1000 1000" tabindex="0" role="application"
              aria-label="Drawing surface. Draw with a mouse, finger or stylus. With a keyboard: Enter or Space starts a stroke at the cross, arrow keys draw, Shift with an arrow draws a small step, Enter or Space ends the stroke, Escape cancels it."
              aria-describedby="pad-help"></svg>
          </div>
          <p id="pad-help" class="help">Several strokes are fine. Pointer: press, draw, lift. Keyboard: focus the frame, Enter starts a stroke at the cross, arrows draw, Enter ends it; move the cross between strokes with the arrows.</p>
          <div class="pad-actions">
            <button type="button" class="undo">Undo last stroke</button>
            <button type="button" class="clear">Clear drawing</button>
          </div>
          <p class="pad-status" role="status" aria-live="polite"></p>
        </section>
        <section class="step" aria-labelledby="step-story">
          <h2 id="step-story"><span class="step-n">2</span> Tell its story</h2>
          <p class="help">Write about the object. Please leave out names, contact details and places: everything here will be public.</p>
          <p class="field">
            <label for="label">What is it? <span class="hint">(up to ${LABEL_MAX} characters)</span></label>
            <input id="label" name="label" maxlength="${LABEL_MAX}" required autocomplete="off" aria-describedby="label-count" />
            <span id="label-count" class="counter" aria-live="polite"></span>
          </p>
          <p class="field">
            <label for="story">Why did you keep it? <span class="hint">(up to ${STORY_MAX} characters)</span></label>
            <textarea id="story" name="story" maxlength="${STORY_MAX}" rows="4" required aria-describedby="story-count story-warn"></textarea>
            <span id="story-count" class="counter" aria-live="polite"></span>
            <span id="story-warn" class="warn" aria-live="polite"></span>
          </p>
          <fieldset class="choices">
            <legend>How long have you kept it?</legend>
            ${radios("duration", DURATIONS)}
          </fieldset>
          <fieldset class="choices">
            <legend>How did it come to you?</legend>
            ${radios("origin", ORIGINS)}
          </fieldset>
          <fieldset class="choices">
            <legend>Which reason fits best?</legend>
            ${radios("reason", REASONS)}
          </fieldset>
        </section>
        <section class="step" aria-labelledby="step-preview">
          <h2 id="step-preview"><span class="step-n">3</span> Preview and publish</h2>
          <p class="form-errors" role="alert"></p>
          <button type="button" class="preview-btn">Preview the exhibit</button>
          <div class="exhibit-preview" hidden tabindex="-1">
            <p class="public-note"><strong>Everything shown here will be public:</strong> the drawing, its label and story, and the trace seal measured from how you drew it. It won't carry your name, and only this browser will know it's yours.</p>
            <div class="preview-body"></div>
            <div class="publish-row">
              <button type="button" class="publish">Publish to the museum</button>
              <button type="button" class="keep-editing">Keep editing</button>
            </div>
            <p class="publish-status" role="status" aria-live="polite"></p>
          </div>
        </section>
      </form>
    </main>
    <script type="module" src="/contribute.js"></script>`,
    "museum",
  );
}

export const DEFAULT_INK = { pen: DEFAULT_PEN, colour: COLOURS[0].hex };

export function goneExhibitPage(id: number, hidden: boolean): string {
  return layout(
    `${accession(id)} · ${TITLE}`,
    `    ${header("")}
    <main>
      <h1>${accession(id)}</h1>
      <p>${hidden ? "This exhibit has been taken down after a review." : "There's no exhibit with this number. It may have been withdrawn by the person who made it."}</p>
      <p><a href="/">Back to the museum</a></p>
    </main>`,
    "museum",
  );
}
