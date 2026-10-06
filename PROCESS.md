# Process

Trace started from the brief's question --- what would make this app good ---
before it started from a stack. The first commit,
[`2828f3e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/2828f3e),
landed the README's argument (a mark is a gesture, not a post; the wall grows
by care, not engagement) and `CLAUDE.md`'s rules in the same change as the
code, so every later session read the argument before it read the source.
Those rules are the harness: no text field, no accounts, one mark a day
enforced in `src/db.ts` rather than the client, no third-party requests,
broadcast only after persistence.

## Decision record: the stack

**Context.** One `shared-cpu-1x` Fly machine with 256 MB, one volume at
`/data`, no separate database server. The core interaction is tiny: mint a
cookie, store one SVG path per hand per day, render every path, push new ones
to open tabs.

**Decision.** A framework-free `node:http` server in TypeScript, run directly
by Node 24's type-stripping (no build step), with `node:sqlite` for
persistence at `DB_PATH` and server-sent events for the live layer. The only
runtime dependency is `marked`, for rendering `README.md` at `/readme/`.

**Alternatives I rejected.** Astro SSR with `better-sqlite3`, which I'd used for
the previous crit, would be most of the code for two pages and three routes,
and its native addon has to compile in the slim image; `node:sqlite` ships
with the runtime. WebSockets lost to SSE because the
wall only ever pushes one thing one way --- a finished mark, server to browser
--- so a long-lived HTTP response is the smaller mechanism
([`f080752`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/f080752)).
An in-memory set of open connections is enough because `fly.toml` pins one
machine; that stops being true the day there are two, and that's when this
record needs a successor.

**Consequences.** Nothing hides concurrency from me. The first real bug was a
race: `hasMarkedToday` ran before `await readBody`, so a client holding its
body open could mark twice. Ordinary concurrent requests never reproduced it;
it only showed up once a test sent one request's headers, let a second
request finish, then released the first body
([`7a89c68`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/7a89c68)).
That held-open-body shape is now the regression test, because a
fire-two-and-hope test passes against the broken code.

## The client needed its own harness

Early tests only drove the server over HTTP. After a browser session found a hand could
start a second stroke once its daily mark had landed
([`2e59190`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/2e59190)),
I added `spec/wall-client.test.ts`, which loads the real `wall.js` into jsdom
and dispatches real pointer events at it, stubbing only what jsdom lacks
(layout boxes, pointer capture, `EventSource`)
([`ec78095`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/ec78095)).
Each fix since must fail its new test against the pre-fix file and pass
against the fixed one. That caught the self-echo
filter matching marks by content rather than a nonce
([`672e486`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/672e486)),
a second gesture starting while the first was still posting
([`176b787`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/176b787)),
and a keyboard-only hand having no way to draw at all
([`5138836`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/5138836)).

Rereading the spec itself, one line at a time, turned up gaps no test had
a reason to look for. "Find their trace still there when they come back" was
checked as "the mark persists," but ten colours shared across every hand
meant a returning stranger couldn't tell which stroke was theirs. A hand's
own marks now render thicker, for that hand only
([`6e07998`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/6e07998)).
That held on a test wall but not a busy one: seeding a scratch database with
300 marks showed later strokes burying a hand's own, so its marks now paint
last, over a halo
([`a9d92f3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/a9d92f3)),
and a first-time hand is told which stroke is theirs the moment it lands
([`51bbd82`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/51bbd82)).
Reading the README the same way caught "one mark a day" meaning a UTC day,
which reopens at 11am in Canberra; it is now 24 hours since a hand's last
mark
([`79989b6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/79989b6)).

Another change came from a comment, not a test: `identity.ts`
said its hand colours were "not tuned for contrast," and nothing tuned them.
Five of ten failed WCAG's 3:1 non-text minimum against white or black; they
were retuned and `spec/contrast.test.ts` now reads the palette from source
([`de8164a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/de8164a)).

## Decision record: a pen and a colour per mark (riff 8)

**Context.** A pod's brief for this riff asked for three things on top of
the crit-8 app: say on the wall what it means, let a hand choose a pen and
a colour for its daily mark, and get the schema change onto an existing
volume safely. Every rule in `CLAUDE.md` still held: no text, no accounts,
the one-mark limit on the server, broadcast after persistence.

**Decision.** The wall now carries one line, condensed from this README,
above the drawing
([`e7eaef0`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-3/commit/e7eaef0)).
A hand picks one of five pens and one of the ten palette colours before it
draws. Both are plain radio buttons, both are validated on the server
against fixed lists (`src/pens.ts`, `identity.ts`'s `COLOURS`), and a pen
is stored as a name whose look lives only in `style.css`
([`6a356c7`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-3/commit/6a356c7),
[`0377d0b`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-3/commit/0377d0b)).
`colourFor`'s hashed colour **coexists** with the choice, as the default: a
new hand's picker starts on it, and a hand that has drawn starts on what it
used last. Replacing it would have made every first visit open on an
arbitrary first swatch, and it still serves as the fallback for a request
that names no colour, so a bare `curl` keeps working.

**Alternatives I rejected.** A free colour input or width slider, because
the palette's 3:1 contrast against both backgrounds is a property of the
list, not of whatever a hand types; translucent pens, for the same reason.
Hiding the hashed colour entirely, for the reason above. A custom swatch
widget with its own key handling, because native radios already give Tab
between groups and arrows within one, and `wall.js` can't break what it
doesn't implement.

**The migration.** `CREATE TABLE IF NOT EXISTS` never touches the table
already on the volume, so `db.ts` reads `PRAGMA table_info(marks)` and adds
`pen` with a `'line'` default when it's missing
([`c48bd57`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-3/commit/c48bd57)).
`spec/migrate.test.ts` builds a database in the old shape, opens it, and
opens it again. Before changing anything I also ran the unchanged app's own
test suite against a scratch database to get one the old code genuinely
wrote; the new server opened it with all six marks intact, as `line`.

**What 150 marks showed.** I seeded a scratch wall with 150 marks, three of
every pen and colour pairing, and looked at it in light and dark at both
viewports. It still read as one wall, but not an even one: the brush, at 11
units wide, was a fifth of the marks and most of the picture, and hairlines
at 1.5 disappeared under it. A pen that buys more wall is the engagement the
README argues against, so the range narrowed to brush 7.5, hairline 2
([`8359fb7`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-3/commit/8359fb7)).
A hand's own mark used to be "the thicker stroke"; next to a brush, a
hairline that's yours isn't thicker, so own marks now grow from their own
pen's width and the copy calls them the stroke on top, ringed by a clear
band. I checked a hairline of my own on the dense wall in dark mode, and
the ring was what made it findable.

**Drawing my own mark.** Last, I drew one through the real flow on that
dense wall: fresh cookie, Brush and Plum picked in the browser, then one
continuous pointer gesture of 115 points, a ridge of peaks climbing into a
spiral sun. A second browser session watching the same wall got it live,
pen and colour included. It caught one thing no test had looked for:
after the mark landed, the greyed-out picker still said "pick a pen and a
colour, then draw", right above a status line saying the mark was in. The
legend now says what the mark was drawn with instead
([`f2ccd63`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-3/commit/f2ccd63)).
I kept the picker on screen rather than hiding it, because hiding it would
jump the wall up under the stroke the hand had just drawn.
