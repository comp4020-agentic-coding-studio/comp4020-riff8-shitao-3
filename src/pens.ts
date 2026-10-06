// The only stroke styles a mark can carry. A mark stores one of these ids,
// never a raw width or dash pattern: what each one looks like lives in
// public/style.css's `.pen-<id>` rules, so the server never has to trust a
// number from the client. No pen changes opacity --- a translucent stroke
// would sink under identity.ts's 3:1 contrast bar.
export const PENS = [
  { id: "line", label: "Line" },
  { id: "hairline", label: "Hairline" },
  { id: "brush", label: "Brush" },
  { id: "dots", label: "Dots" },
  { id: "dashes", label: "Dashes" },
] as const;

export type Pen = (typeof PENS)[number]["id"];

export const DEFAULT_PEN: Pen = "line";

export function isPen(value: unknown): value is Pen {
  return PENS.some((p) => p.id === value);
}
