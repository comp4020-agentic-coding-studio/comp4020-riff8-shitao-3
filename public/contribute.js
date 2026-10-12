// The contribution flow: draw, tell, preview, publish. Everything stays in
// this browser (a draft in localStorage, so an accidental reload loses
// nothing) until Publish sends the exact exhibit the preview showed, once,
// with a token that makes a retry return the same exhibit instead of a
// second one.
import { describe, measurements, sealSvg, strokePath, validateStrokes } from "./fingerprint.js";
import { createSketchPad } from "./sketchpad.js";

const DRAFT_KEY = "trace-museum-draft";
const LABEL_MAX = 60;
const STORY_MAX = 240;
// Gentle, not enforced: a nudge if a story looks like it holds contact details.
const CONTACT_LIKE = /@\S+\.|https?:\/\/|www\.|(?:\+?\d[\s-]?){8,}/i;

const main = document.getElementById("contribute");
const form = document.getElementById("exhibit-form");
const tools = document.getElementById("tools");
const svg = document.getElementById("sketchpad");
const $ = (sel) => main.querySelector(sel);
const padStatus = $(".pad-status");
const errors = $(".form-errors");
const preview = $(".exhibit-preview");
const previewBody = $(".preview-body");
const publishBtn = $(".publish");
const publishStatus = $(".publish-status");
const canPublish = main.dataset.canPublish === "true";

const chosen = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value ?? "";
const chosenText = (name) => form.querySelector(`input[name="${name}"]:checked`)?.closest("label")?.textContent.trim() ?? "";
const ink = () => ({ pen: chosen("pen") || "line", colour: chosen("colour") || "currentColor" });

let token = null;
let previewed = null;

const storage = (() => {
  try {
    const probe = "__trace";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
})();

const pad = createSketchPad(svg, {
  ink,
  onChange: () => edited(),
  onStatus: (text) => (padStatus.textContent = text),
});

function snapshot() {
  return {
    v: 1,
    strokes: pad.strokes,
    pen: chosen("pen"),
    colour: chosen("colour"),
    label: form.label.value,
    story: form.story.value,
    duration: chosen("duration"),
    origin: chosen("origin"),
    reason: chosen("reason"),
    token,
  };
}

let saveTimer = null;
function saveDraft() {
  if (!storage) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const draft = snapshot();
    const empty = draft.strokes.length === 0 && !draft.label.trim() && !draft.story.trim();
    if (empty) storage.removeItem(DRAFT_KEY);
    else storage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, 250);
}

// Any change after a preview means the preview no longer shows what would
// be published, and the token no longer names this exhibit.
function edited() {
  token = null;
  previewed = null;
  preview.hidden = true;
  counters();
  saveDraft();
}

function counters() {
  $("#label-count").textContent = `${[...form.label.value].length} of ${LABEL_MAX}`;
  $("#story-count").textContent = `${[...form.story.value].length} of ${STORY_MAX}`;
  $("#story-warn").textContent = CONTACT_LIKE.test(form.story.value)
    ? "That looks like it might include contact details. Everything here is public, so consider leaving them out."
    : "";
}

function setRadio(name, value) {
  const input = value && form.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
  if (input) input.checked = true;
}

function restore() {
  if (!storage) return;
  let draft;
  try {
    draft = JSON.parse(storage.getItem(DRAFT_KEY) ?? "null");
  } catch {
    draft = null;
  }
  if (!draft || draft.v !== 1) return;
  const checked = Array.isArray(draft.strokes) && draft.strokes.length ? validateStrokes(draft.strokes) : { strokes: [] };
  if (checked.strokes) pad.setStrokes(checked.strokes);
  for (const name of ["pen", "colour", "duration", "origin", "reason"]) setRadio(name, draft[name]);
  form.label.value = typeof draft.label === "string" ? draft.label.slice(0, LABEL_MAX * 2) : "";
  form.story.value = typeof draft.story === "string" ? draft.story.slice(0, STORY_MAX * 2) : "";
  token = typeof draft.token === "string" ? draft.token : null;
  tools.style.setProperty("--ink", ink().colour);
  pad.paint();
  $(".draft-note").hidden = false;
}

function discard() {
  storage?.removeItem(DRAFT_KEY);
  form.reset();
  pad.clear();
  token = null;
  previewed = null;
  preview.hidden = true;
  $(".draft-note").hidden = true;
  errors.textContent = "";
  tools.style.setProperty("--ink", ink().colour);
  pad.paint();
  counters();
  svg.focus();
}

const meaningful = (s) => /[\p{L}\p{N}]/u.test(s);

function problems() {
  const out = [];
  if (pad.strokes.length === 0) out.push(["sketchpad", "Draw your object first."]);
  if (!meaningful(form.label.value)) out.push(["label", "Say what the object is."]);
  else if ([...form.label.value.trim()].length > LABEL_MAX) out.push(["label", `Keep the label to ${LABEL_MAX} characters.`]);
  if (!meaningful(form.story.value)) out.push(["story", "Say why you kept it."]);
  else if ([...form.story.value.trim()].length > STORY_MAX) out.push(["story", `Keep the story to ${STORY_MAX} characters.`]);
  if (!chosen("duration")) out.push(["duration", "Choose how long you've kept it (Not sure is fine)."]);
  if (!chosen("origin")) out.push(["origin", "Choose how it came to you (Not sure is fine)."]);
  if (!chosen("reason")) out.push(["reason", "Choose the reason that fits best."]);
  return out;
}

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function showPreview() {
  const found = problems();
  for (const field of form.querySelectorAll("[aria-invalid]")) field.removeAttribute("aria-invalid");
  if (found.length) {
    errors.replaceChildren(el("span", "", "Before previewing: "), ...found.map(([, msg]) => el("span", "err", `${msg} `)));
    for (const [name] of found) {
      const field = name === "sketchpad" ? svg : form.querySelector(`[name="${name}"]`);
      field?.setAttribute("aria-invalid", "true");
    }
    const first = found[0][0];
    (first === "sketchpad" ? svg : form.querySelector(`[name="${first}"]`))?.focus();
    return;
  }
  errors.textContent = "";
  const { pen, colour } = ink();
  previewed = {
    label: form.label.value.trim(),
    story: form.story.value.trim(),
    duration: chosen("duration"),
    origin: chosen("origin"),
    reason: chosen("reason"),
    pen,
    colour,
    strokes: pad.strokes.map((s) => ({ input: s.input, points: s.points })),
  };
  const descriptor = describe(previewed.strokes);

  const sketch = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sketch.setAttribute("viewBox", "0 0 1000 1000");
  sketch.setAttribute("class", "sketch");
  sketch.setAttribute("role", "img");
  sketch.setAttribute("aria-label", `Sketch: ${previewed.label}`);
  for (const s of previewed.strokes) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", strokePath(s.points));
    p.setAttribute("class", `pen-${pen}`);
    p.setAttribute("stroke", colour);
    sketch.append(p);
  }
  const art = el("div", "exhibit-art");
  const frame = el("figure", "frame frame-large");
  frame.append(sketch);
  const sealFig = el("figure", "seal-figure");
  // sealSvg only interpolates numbers it computed and a checked colour.
  sealFig.innerHTML = sealSvg(descriptor, colour, "seal seal-large");
  sealFig.append(el("figcaption", "", "Trace seal"));
  art.append(frame, sealFig);

  const text = el("div", "exhibit-text");
  text.append(el("p", "accession", "Object number given on publishing"), el("h3", "preview-label", previewed.label));
  const quote = el("blockquote", "story");
  quote.append(el("p", "", previewed.story));
  const facts = el("dl", "facts");
  for (const [k, v] of [
    ["Kept for", chosenText("duration")],
    ["How it came", chosen("origin") === "unknown" ? "Origin uncertain" : chosenText("origin")],
    ["Kept because of", chosenText("reason")],
  ]) {
    const row = el("div");
    row.append(el("dt", "", k), el("dd", "", v));
    facts.append(row);
  }
  text.append(quote, facts);

  const measures = el("dl", "measures");
  for (const [k, v] of measurements(descriptor)) {
    const row = el("div");
    row.append(el("dt", "", k), el("dd", "", v));
    measures.append(row);
  }
  const article = el("article", "exhibit");
  article.append(art, text);
  previewBody.replaceChildren(article, measures);
  publishStatus.textContent = canPublish ? "" : "You can publish once your 24 hours are up; the draft will wait here.";
  preview.hidden = false;
  preview.focus();
}

async function publish() {
  if (!previewed || !canPublish) return;
  token ??= crypto.randomUUID();
  saveDraft();
  publishBtn.disabled = true;
  publishStatus.textContent = "Publishing…";
  try {
    const res = await fetch("/api/exhibits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...previewed, token }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      clearTimeout(saveTimer);
      storage?.removeItem(DRAFT_KEY);
      publishStatus.textContent = `Published as ${body.accession}. Opening it…`;
      window.location.assign(`${body.href}?published=1`);
      return;
    }
    publishStatus.textContent = `${body.error ?? "The museum couldn't accept that."} Your draft is still here.`;
  } catch {
    publishStatus.textContent = "Couldn't reach the museum. Your draft is safe in this browser; try again.";
  }
  publishBtn.disabled = false;
}

tools.addEventListener("change", () => {
  tools.style.setProperty("--ink", ink().colour);
  pad.paint();
  edited();
});
form.addEventListener("input", (evt) => {
  if (evt.target.closest("#tools")) return;
  edited();
});
form.addEventListener("submit", (evt) => evt.preventDefault());
$(".undo").addEventListener("click", () => {
  pad.undo();
  padStatus.textContent = pad.strokes.length ? "Last stroke removed." : "The drawing is empty.";
});
$(".clear").addEventListener("click", () => {
  pad.clear();
  padStatus.textContent = "Drawing cleared.";
});
$(".discard").addEventListener("click", discard);
$(".preview-btn").addEventListener("click", showPreview);
$(".keep-editing").addEventListener("click", () => {
  preview.hidden = true;
  form.label.focus();
});
publishBtn.addEventListener("click", publish);

restore();
counters();
