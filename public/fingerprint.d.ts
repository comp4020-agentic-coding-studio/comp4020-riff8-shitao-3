// Types for public/fingerprint.js, which stays plain JavaScript so the
// browser can load it as-is.
export type Input = "mouse" | "touch" | "pen" | "keyboard";
export type Point = [x: number, y: number, t: number];
export interface Stroke {
  input: Input;
  points: Point[];
}
export interface Descriptor {
  v: number;
  input: Input | "mixed";
  strokes: number;
  samples: number;
  activeMs: number;
  movingMs: number;
  distance: number;
  speed: number;
  pauses: number;
  pauseMs: number;
  pauseShare: number;
  turning: number;
  turnDensity: number;
  sharpTurns: number;
  strokeMs: number[];
  pauseAt: [stroke: number, midMs: number, ms: number][];
  profile: number[][];
  turnProfile: number[][];
}
export interface Features {
  speed: number;
  pause: number;
  turn: number;
}

export const VERSION: number;
export const SPACE: number;
export const STEP_MS: number;
export const STILL_DU: number;
export const PAUSE_MS: number;
export const MAX_GAP_MS: number;
export const SPACING_DU: number;
export const MIN_TURN_DEG: number;
export const SHARP_TURN_DEG: number;
export const SPEED_CAP: number;
export const TURN_CAP: number;
export const PAUSE_BEAD_CAP_MS: number;
export const SIMILAR_MAX: number;
export const SEAL_BINS: number;
export const LIMITS: { strokes: number; pointsPerStroke: number; points: number; strokeMs: number };
export const INPUTS: Input[];
export const INPUT_LABELS: Record<string, string>;
export const HEX: RegExp;

export function validateStrokes(raw: unknown): { strokes: Stroke[]; error?: undefined } | { error: string; strokes?: undefined };
export function inputOf(strokes: Stroke[]): Input | "mixed";
export function describe(strokes: Stroke[]): Descriptor;
export function features(d: Descriptor): Features;
export function gestureDistance(a: Features, b: Features): number;
export function similarityReason(a: Features, b: Features): string;
export function measurements(d: Descriptor): [label: string, value: string][];
export function sealSummary(d: Descriptor): string;
export function sealGeometry(d: Descriptor): {
  arcs: { area: number[][]; outer: number[][]; band: number[][]; from: number; to: number }[];
  capped: { from: number; to: number }[];
  beads: { x: number; y: number; r: number }[];
};
export function sealSvg(d: Descriptor, colour: string, className?: string): string;
export function strokePath(points: Point[] | number[][], tolerance?: number): string;
