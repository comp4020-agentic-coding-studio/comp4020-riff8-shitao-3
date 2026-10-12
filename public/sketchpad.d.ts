// Types for public/sketchpad.js, which stays plain JavaScript for the browser.
import type { Stroke } from "./fingerprint.js";

export const STATIONARY_MS: number;
export const MIN_SAMPLE_MS: number;
export const KEY_STEP: number;
export const KEY_SMALL_STEP: number;

export interface SketchPad {
  readonly strokes: Stroke[];
  readonly drawing: boolean;
  setStrokes(next: Stroke[]): void;
  undo(): void;
  clear(): void;
  paint(): void;
}

export function createSketchPad(
  svg: SVGSVGElement,
  options?: {
    now?: () => number;
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (id: unknown) => void;
    onChange?: () => void;
    onStatus?: (text: string) => void;
    ink?: () => { pen: string; colour: string };
  },
): SketchPad;
