import { describe, features, strokePath, validateStrokes, VERSION } from "../public/fingerprint.js";
import type { ExhibitInput } from "./db.ts";
import { isPaletteColour } from "./identity.ts";
import { isPen } from "./pens.ts";

// What the museum asks for, as fixed vocabularies. `id` is what's stored;
// the rest is what each place says.
export const DURATIONS = [
  { id: "under-1", answer: "Under 1 year", cabinet: "Kept under a year" },
  { id: "1-5", answer: "1 to under 5 years", cabinet: "Kept 1 to under 5 years" },
  { id: "5-10", answer: "5 to under 10 years", cabinet: "Kept 5 to under 10 years" },
  { id: "10-plus", answer: "10 years or more", cabinet: "Kept 10 years or more" },
  { id: "unknown", answer: "Not sure", cabinet: "Time uncertain" },
] as const;

export const ORIGINS = [
  { id: "gift", answer: "A gift", badge: "Gifted" },
  { id: "bought", answer: "Bought", badge: "Bought" },
  { id: "found", answer: "Found", badge: "Found" },
  { id: "made", answer: "Made", badge: "Made" },
  { id: "inherited", answer: "Inherited", badge: "Inherited" },
  { id: "other", answer: "Some other way", badge: "Otherwise acquired" },
  { id: "unknown", answer: "Not sure", badge: "Origin uncertain" },
] as const;

export const REASONS = [
  { id: "memory", label: "Memory" },
  { id: "comfort", label: "Comfort" },
  { id: "usefulness", label: "Usefulness" },
  { id: "connection", label: "Connection" },
  { id: "curiosity", label: "Curiosity" },
] as const;

export const REPORT_REASONS = [
  { id: "personal", label: "It shares someone's personal or contact details" },
  { id: "unkind", label: "It's hateful, harassing or cruel" },
  { id: "spam", label: "It's spam or advertising" },
  { id: "other", label: "Something else needs a reviewer's look" },
] as const;

export const LABEL_MAX = 60;
export const STORY_MAX = 240;

const find = <T extends { id: string }>(list: readonly T[], id: string): T | undefined => list.find((x) => x.id === id);
export const durationOf = (id: string) => find(DURATIONS, id) ?? DURATIONS[4];
export const originOf = (id: string) => find(ORIGINS, id) ?? ORIGINS[6];
export const reasonOf = (id: string) => find(REASONS, id) ?? REASONS[0];

export const accession = (id: number): string => `Object ${String(id).padStart(4, "0")}`;
export const exhibitHref = (id: number): string => `/object/${String(id).padStart(4, "0")}`;

// Plain text, one paragraph: control, zero-width and bidi-override
// characters become spaces, runs of whitespace collapse, and something
// readable (a letter or a digit in any script) has to remain. Nothing checks
// spelling, language or style.
export function cleanText(raw: unknown, max: number, what: string): string | { error: string } {
  if (typeof raw !== "string") return { error: `${what} is missing.` };
  const text = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return { error: `${what} needs at least a word.` };
  if ([...text].length > max) return { error: `${what} can be at most ${max} characters.` };
  return text;
}

export const TOKEN_RE = /^[A-Za-z0-9-]{8,64}$/;

// A whole submission, checked, measured and ready to store: everything the
// client said about its drawing is recomputed here from validated samples.
export function prepareExhibit(body: Record<string, unknown>): { fields: ExhibitInput } | { error: string } {
  const label = cleanText(body.label, LABEL_MAX, "The label");
  if (typeof label !== "string") return label;
  const story = cleanText(body.story, STORY_MAX, "The story");
  if (typeof story !== "string") return story;
  if (typeof body.duration !== "string" || !find(DURATIONS, body.duration)) return { error: "Choose how long you've kept it." };
  if (typeof body.origin !== "string" || !find(ORIGINS, body.origin)) return { error: "Choose how it came to you." };
  if (typeof body.reason !== "string" || !find(REASONS, body.reason)) return { error: "Choose a reason you keep it." };
  if (!isPen(body.pen)) return { error: "That isn't one of the museum's pens." };
  if (!isPaletteColour(body.colour)) return { error: "That isn't one of the museum's colours." };
  const checked = validateStrokes(body.strokes);
  if (checked.error !== undefined) return { error: checked.error };
  const strokes = checked.strokes;
  const descriptor = describe(strokes);
  const f = features(descriptor);
  return {
    fields: {
      label,
      story,
      duration: body.duration,
      origin: body.origin,
      reason: body.reason,
      pen: body.pen,
      colour: body.colour,
      input: descriptor.input,
      strokes: JSON.stringify(strokes),
      sketch: JSON.stringify(strokes.map((s) => strokePath(s.points, 3))),
      descriptor: JSON.stringify(descriptor),
      descriptor_version: VERSION,
      f_speed: f.speed,
      f_pause: f.pause,
      f_turn: f.turn,
    },
  };
}
