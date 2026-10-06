import { randomUUID } from "node:crypto";

// A hand's name and colour are derived once, at creation, and stored --- not
// recomputed from the id --- so they stay stable even if these lists change.
const ADJECTIVES = [
  "quiet",
  "steady",
  "quick",
  "idle",
  "careful",
  "restless",
  "gentle",
  "bold",
  "patient",
  "curious",
];
const NOUNS = [
  "sparrow",
  "willow",
  "lantern",
  "creek",
  "ember",
  "pebble",
  "heron",
  "maple",
  "harbour",
  "orchard",
];
// The wall's whole palette: what colourFor assigns a new hand, and the only
// colours a hand can pick for a mark (server.ts refuses any other). Distinct
// hues, each lightness-adjusted (hue/saturation kept) so every colour clears
// WCAG 1.4.11's 3:1 non-text contrast against *both* a white and a black
// background --- `color-scheme: light dark` means a mark's stroke has to
// read against either, depending on the visitor's own system preference,
// not just the one a screenshot happens to be taken against.
// `spec/contrast.test.ts` checks this against the literal values below.
export const COLOURS = [
  { hex: "#cc4a28", name: "Brick" },
  { hex: "#5177aa", name: "Slate" },
  { hex: "#4e8067", name: "Fern" },
  { hex: "#a06a13", name: "Ochre" },
  { hex: "#9d4edd", name: "Violet" },
  { hex: "#457b9d", name: "Steel" },
  { hex: "#e63946", name: "Poppy" },
  { hex: "#2a9d8f", name: "Teal" },
  { hex: "#bb5a0d", name: "Rust" },
  { hex: "#6d597a", name: "Plum" },
];

export function isPaletteColour(value: unknown): value is string {
  return COLOURS.some((c) => c.hex === value);
}

function pick<T>(list: T[], seed: number): T {
  return list[seed % list.length];
}

export function newHandId(): string {
  return randomUUID();
}

export function nameFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${pick(ADJECTIVES, hash)}-${pick(NOUNS, hash >>> 8)}`;
}

export function colourFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 17 + ch.charCodeAt(0)) >>> 0;
  return pick(COLOURS, hash >>> 4).hex;
}

const COOKIE_NAME = "hand";
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function parseHandCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE_NAME) return rest.join("=");
  }
  return undefined;
}

export function setHandCookie(id: string, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${id}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${YEAR_SECONDS}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}
