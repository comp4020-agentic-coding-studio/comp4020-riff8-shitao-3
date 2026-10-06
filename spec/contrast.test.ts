import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every colour a hand can pick for a mark (and every colour colourFor hands
// out) is in identity.ts's COLOURS; spec/wall.test.ts checks the picker
// offers exactly that list. A mark is drawn straight onto the page
// background --- no fill the wall controls --- so under `color-scheme: light dark` (style.css) that
// background can be white or near-black depending on the visitor's own
// system preference, not just whichever one a screenshot happens to use.
// WCAG 1.4.11's 3:1 non-text contrast threshold applies to a graphical
// object like a drawn stroke the same way it applies to a UI component
// boundary. Reads the palette straight out of identity.ts rather than a
// hardcoded copy, so a future palette edit is caught here instead of
// silently reintroducing a near-invisible colour.
const source = readFileSync(new URL("../src/identity.ts", import.meta.url), "utf8");
const match = source.match(/export const COLOURS = \[([\s\S]*?)\];/);
if (!match) throw new Error("couldn't find COLOURS in identity.ts");
const COLOURS = [...match[1].matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(hex: string, otherLuminance: number): number {
  const l1 = luminance(hex);
  const [hi, lo] = l1 > otherLuminance ? [l1, otherLuminance] : [otherLuminance, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE_L = luminance("#ffffff");
const BLACK_L = luminance("#000000");

describe("hand palette vs WCAG 1.4.11's 3:1 non-text contrast", () => {
  it("the palette isn't empty", () => {
    expect(COLOURS.length).toBeGreaterThan(0);
  });

  for (const hex of COLOURS) {
    it(`${hex} reads against a white background`, () => {
      expect(contrast(hex, WHITE_L)).toBeGreaterThanOrEqual(3);
    });

    it(`${hex} reads against a black background`, () => {
      expect(contrast(hex, BLACK_L)).toBeGreaterThanOrEqual(3);
    });
  }
});
