# This repo is a pod riff: pods write the prompt, the agent does the work

This repo is a copy of [`comp4020-final-shitao`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao) at
`0b60b87e` --- shitao's crit agent's final project as it stood at
`08-its-alive`. Their repo is untouched and off limits. From here to the end of
semester, each crit a pod picks this repo up from wherever the last run left
it.

**Pods: the only file you change is `prompt.md`, at the repo root.** Read the
live app, the code and the history, then write the prompt that would take
this app to a strong, interesting answer to the next brief (the crit runsheet
links it). The prompt can point at any file here. After the session,
shitao's crit agent runs `prompt.md` once, unattended, start to finish, and
nobody is there to answer its questions --- so say what you want, what good
looks like and what to leave alone. Push it before you leave.

**Crit agent: when `prompt.md` exists, it is your brief.** Run it to
completion in one go, keep `main` deployable, and delete `prompt.md` in your
last commit. Leave this block of `CLAUDE.md` as it is.

**Nothing here is marked.** No cutoff, no reflection, no `PROCESS.md` entry.
The next crit opens by looking at where each pod repo ended up, beside the
prompt that got it there (the `prompt-crit<N>` tag).

**The agent's own spec tests are `spec/contrast.test.ts`, `spec/day.test.ts`, `spec/wall-client.test.ts` and `spec/wall.test.ts`.** They encode the brief it was
working to, and they gate the deploy. A prompt aimed at a different brief can
have them changed or deleted; keep `spec/invariants.test.ts` green, since that
one is true of any good site.

Everything below this line was written for the agent's graded submission. Its
marks, cutoff and weekly skills don't govern this repo: read it for how the
agent was directed, not for what anyone owes.

---

# Your harness

Trace is now two rooms: the museum at `/` (an exhibit is a sketch, a short
story and a trace seal measured from how the sketch was drawn) and the
original wall at `/wall/` (a mark is one gesture, nothing else). `README.md`
argues both; these rules keep the code honest to it:

- **Words belong to exhibits, never to marks.** A museum exhibit carries a
  plain-text label (60 characters) and story (240), validated in
  `src/museum.ts` and escaped everywhere they're rendered, including the
  card HTML the stream sends. A wall mark is still a path and nothing else.
  No route accepts uploads, real names, photographs or locations.
- **No accounts, ever.** Identity is the `hand` cookie `src/identity.ts`
  mints. Ownership of exhibits and marks lives in the database and is only
  ever used privately (`mine`, withdrawal, same-owner exclusion). Never put
  a hand id, or anything derived from one, in a page, an endpoint, a stream
  event or a thread link.
- **Two rolling 24-hour limits, both enforced in `src/db.ts`.** One wall
  mark per hand, and one published exhibit per hand, counted from the
  `publications` table, which withdrawal never touches. The museum's check
  and insert run in one synchronous transaction with no `await` between.
- **The server measures the drawing.** A client sends samples; the
  descriptor (speed, pauses, turning, seal) is recomputed by
  `public/fingerprint.js` on the server from validated samples, and stored
  with its version. Never accept finished statistics from a client, and
  never use them for anything but describing the sketch.
- **Movement is only measured inside the museum's drawing surface**, only
  between a stroke's start and end, and only published if the visitor
  presses Publish. Drafts stay in the browser.
- **Persist, then broadcast.** A mark or exhibit is committed before any
  stream hears of it. Museum events go out on `/api/museum/stream` with a
  sequence number from `museum_events` so a reconnecting tab replays what it
  missed; wall marks keep their own `/api/marks/stream`.
- **No third-party requests.** Every `<script>` and `<link>` is
  same-origin; `spec/wall.test.ts` checks this.
- **Persistence lives at `DB_PATH`** (default `/data/trace.db`, matching
  `fly.toml`'s volume). A redeploy reuses the volume, so schema changes are
  idempotent migrations (`spec/migrate.test.ts`).
- **When a check catches a real mistake, fix the check or the harness too**,
  not just the code once.

What the template ships is explained where it lives --- `fly.toml`, the
`Dockerfile`, the CI workflow and `spec/README.md` each say what they fix.
