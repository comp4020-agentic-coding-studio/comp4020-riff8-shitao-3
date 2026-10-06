# Trace: ideas for this riff

Work through these in order. Keep `spec/invariants.test.ts` green. Keep
`CLAUDE.md`'s rules intact (no text field, no accounts, one-mark-a-day
enforced server-side in `src/db.ts`/`server.ts`, no third-party requests,
broadcast only after persistence, state only at `DB_PATH`). Run `pnpm check`
before you're done. Delete this file in your last commit.

## 1. Say what this wall means, on the wall itself

`pages.ts`'s `wallPage()` currently shows only the rule ("One wall. One mark
each, once a day. Nothing else.") and buries the *why* behind a `/readme/`
link. Add a short static note on the wall page — a sentence or two, condensed
from what `README.md` already argues (a gesture, not a post; grows by care,
not engagement), not a new pitch. This is app-authored copy, not a visitor
text field — don't turn it into an input. Keep the `/readme/` link too, and
make sure the two don't contradict each other.

## 2. Let a hand choose a pen style for today's mark

Before the gesture starts, offer a small, fixed set of stroke presets (width,
cap, maybe dash or opacity) — three to six, your call. Validate the choice
server-side against a fixed enum (like `PATH_RE` validates the path) — never
accept a raw stroke-width/dasharray from the client. Locks in once the
gesture starts. Store it per mark in `marks` (like `colour` already is).

## 3. Let a hand choose a colour for today's mark

Choose from a vetted palette only — reuse/extend `identity.ts`'s
WCAG-3:1-checked `COLOURS`, never a free colour input. Keep
`spec/contrast.test.ts` reading the real offered palette from source, not a
stale copy. Decide whether `colourFor`'s hash-assigned identity colour stays
as a default, gets replaced, or coexists — note which, and why, in
`PROCESS.md`.

## 4. Migrate the schema safely

`CREATE TABLE IF NOT EXISTS` won't add new columns to an existing `/data`
volume on redeploy. Add a real migration (check `PRAGMA table_info`, `ALTER
TABLE ... ADD COLUMN` if missing) and prove it against a pre-existing scratch
db, not just a fresh one.

## 5. Check the wall still reads as one wall

Seed a scratch db with 100+ marks spanning every pen/colour combination you
shipped. Look at it. Write in `PROCESS.md` what you saw and whether it
changed what you shipped.

## 6. Keyboard parity

Whatever UI you add for picking pen/colour must be reachable and operable by
keyboard, the same as drawing already is (`spec/wall-client.test.ts`).

## 7. Rewrite specs and docs, don't bolt on

Update `spec/contrast.test.ts`, `spec/wall.test.ts`, `spec/wall-client.test.ts`
for the new mechanic. Rewrite the affected parts of `README.md` and add a
`PROCESS.md` decision record, the way every prior riff did — don't append.


## Finally: draw your own mark on the wall

Once everything above is shipped and `pnpm check` is green, draw one real
mark on the wall yourself, through the actual flow (get a hand cookie, pick a
pen and colour if you built the picker, `POST /api/marks`), not by inserting
a row directly. Make it an actual drawing, not a throwaway two-point test
stroke — you're the first hand to use whatever you built, so draw something
that shows it off and gives you a reason to actually look at the result. If
the picker is awkward or the flow breaks for a real hand, you'll find out
before anyone else does. Note in `PROCESS.md` that you did this and what, if
anything, it caught.
