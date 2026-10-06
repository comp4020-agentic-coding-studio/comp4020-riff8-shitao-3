import { marked } from "marked";
import type { Mark } from "./db.ts";
import { COLOURS, isPaletteColour } from "./identity.ts";
import { DEFAULT_PEN, PENS, type Pen } from "./pens.ts";

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const layout = (title: string, body: string): string => `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)}</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
${body}
  </body>
</html>
`;

// Hours, not a clock time: the server doesn't know a hand's time zone, and a
// duration reads the same in every one.
export function untilPhrase(ms: number): string {
  const hours = Math.ceil(ms / 3_600_000);
  return ms <= 3_600_000 ? "within the hour" : `in about ${hours} hours`;
}

// One sample stroke per pen, drawn with that pen's own `.pen-<id>` rule, so
// the picker shows a hand exactly what it would put on the wall.
const PREVIEW_PATH = "M6,22 C18,4 30,30 44,14 S62,6 74,18";

function penPicker(selected: Pen): string {
  const options = PENS.map(
    (p) => `<label class="option">
          <input type="radio" name="pen" value="${p.id}"${p.id === selected ? " checked" : ""} />
          <svg class="preview" viewBox="0 0 80 32" aria-hidden="true"><path class="pen-${p.id}" d="${PREVIEW_PATH}" /></svg>
          <span>${escape(p.label)}</span>
        </label>`,
  ).join("\n        ");
  return `<fieldset class="pens">
        <legend>Pen</legend>
        <div class="options">
        ${options}
        </div>
      </fieldset>`;
}

function colourPicker(selected: string): string {
  const options = COLOURS.map(
    (c) => `<label class="option swatch" title="${c.name}">
          <input type="radio" name="colour" value="${c.hex}"${c.hex === selected ? " checked" : ""} />
          <span class="chip" style="background:${c.hex}"></span>
          <span class="visually-hidden">${escape(c.name)}</span>
        </label>`,
  ).join("\n        ");
  return `<fieldset class="colours">
        <legend>Colour</legend>
        <div class="options">
        ${options}
        </div>
      </fieldset>`;
}

export function wallPage(
  marks: Mark[],
  hand: { id: string; colour: string },
  msUntilNextMark: number,
  last?: Mark,
): string {
  const alreadyMarked = msUntilNextMark > 0;
  // Colours and pens are shared across every hand, so neither can tell a
  // returning hand which strokes are theirs; `mine` is only ever rendered to the hand
  // that drew it, and never leaves the server as a hand id. A hand's own
  // strokes are painted last, each over a background-coloured halo, so a
  // busy wall's later marks can't bury them.
  const own = marks.filter((m) => m.hand_id === hand.id);
  const strokes = [
    ...marks
      .filter((m) => m.hand_id !== hand.id)
      .map((m) => `<path d="${escape(m.path)}" stroke="${escape(m.colour)}" class="pen-${escape(m.pen)}" />`),
    ...own.flatMap((m) => [
      `<path d="${escape(m.path)}" class="halo pen-${escape(m.pen)}" />`,
      `<path d="${escape(m.path)}" stroke="${escape(m.colour)}" class="mine pen-${escape(m.pen)}" />`,
    ]),
  ].join("\n      ");
  const ownCount = own.length;
  // A hand starts from what it drew with last time, else the colour it was
  // given when its cookie was minted. A hand minted before the palette was
  // retuned can hold a colour no longer offered; it starts on the first one.
  const startColour = [last?.colour, hand.colour].find(isPaletteColour) ?? COLOURS[0].hex;

  const prompt = alreadyMarked
    ? `<p id="status">Your mark is already on the wall. You can add another ${untilPhrase(msUntilNextMark)}.</p>`
    : `<p id="status">Draw one mark with a pointer, or focus the wall and press Enter: arrow keys draw, Enter again finishes.</p>`;

  const svgAttrs = alreadyMarked
    ? `role="img" aria-label="The shared drawing, one mark per hand"`
    : `tabindex="0" role="application" aria-label="The shared drawing, one mark per hand. Press Enter or Space to start your mark, arrow keys to draw it, Enter or Space to finish, Escape to cancel."`;

  return layout(
    "Trace",
    `    <main>
      <h1>Trace</h1>
      <p>One wall. One mark each, once a day. Nothing else.</p>
      <p class="why">A mark here is a gesture, not a post: no words, no likes, nobody to follow. The wall grows by care, not engagement, one stroke per hand per day, and nothing on it ever resets.</p>
      ${
        alreadyMarked
          ? ""
          : `<fieldset id="tools" style="--ink:${startColour}">
        <legend>Today's mark: pick a pen and a colour, then draw</legend>
        ${penPicker(last?.pen ?? DEFAULT_PEN)}
        ${colourPicker(startColour)}
      </fieldset>`
      }
      <svg id="wall" viewBox="0 0 1000 600" ${svgAttrs}>
      ${strokes}
      </svg>
      ${prompt}
      <p><small>${ownCount > 0 ? `Your ${ownCount === 1 ? "mark is the stroke" : `${ownCount} marks are the strokes`} on top, ringed by a clear band. ` : ""}<a href="/readme/">What this is, and why</a>.</small></p>
    </main>
    <script
      src="/wall.js"
      data-can-draw="${alreadyMarked ? "false" : "true"}"
      data-hand-colour="${escape(hand.colour)}"
    ></script>`,
  );
}

export function readmePage(readmeMarkdown: string): string {
  const html = marked.parse(readmeMarkdown, { async: false }) as string;
  return layout("About Trace", `    <main>\n${html}\n    </main>`);
}
