# Trace

Trace is two rooms. The first is **The Museum of Things We Keep**: draw an
ordinary object you kept, say in a sentence or two why, and it joins an
anonymous collection arranged into cabinets of how long things have been
kept. Every exhibit carries a *trace seal*, a small circular figure measured
from how the sketch was drawn. The second room is the original wall, at
[`/wall/`](/wall/): one mark per hand per day, a gesture and nothing else,
exactly as it was.

## What good means here

I started from two pieces of writing. Robin Sloan's
["An app can be a home-cooked meal"](https://www.robinsloan.com/notes/home-cooked-app/)
describes software made out of care for a few people rather than growth,
and Aral Balkan's
["What is the Small Web?"](https://ar.al/2020/08/07/what-is-the-small-web/)
names the opposite: a web that trusts servers over people and watches
everybody. Nothing in Trace is trying to grow. There's no way to follow
anyone, nothing to like, no profile, and no way to find out who drew what.
A hand is a browser cookie, not an account.

The wall argued that a mark should be a gesture, not a post, because a
gesture can't be unkind the way a sentence can. The museum keeps that
instinct and changes one thing about it on purpose. A drawing of a chipped
mug says what someone kept; it can't say why. So an exhibit may carry words,
but only the words the museum asks for: a label of at most 60 characters and
a story of at most 240 answering "Why did you keep it?". Both are plain text,
escaped wherever they appear, and the museum never asks for a name, a
photograph or a place. Words still never attach to a wall mark.

A good museum, then, is one where every visible feature of an exhibit can be
traced back to something a visitor chose to give it, and nothing else. A
visitor should be able to point at any part of an exhibit and say which
collected information produced it.

## What the museum collects, and what it shows

| What a visitor gives | Where it shows |
| --- | --- |
| A sketch: strokes in a fixed 1000 × 1000 drawing space | The framed drawing at the centre of the exhibit |
| A pen and colour from the wall's own set | The drawing's ink and the seal's ink |
| How long they've kept it (or "Not sure") | Which cabinet it sits in |
| How it came to them (or "Not sure") | The origin badge, "Origin uncertain" included |
| One reason: memory, comfort, usefulness, connection or curiosity | The reason tag, and the "Same reason" thread |
| A label and a story | The exhibit's caption and its accessible description |
| How the sketch was drawn (point positions and their relative timing) | The trace seal, and the "Similar gesture" thread |
| Which input drew it (mouse, touch, pen, keyboard or mixed) | Shown on the exhibit page; gestures are only compared within one input |

Exhibits are numbered publicly ("Object 0042") and carry no author. Your own
exhibits are highlighted only in your own browser, and only you can withdraw
them.

## Contributing an exhibit

Choose an object you own or remember keeping, draw it in the frame, give it
a label and a story, answer three short questions, preview the whole
exhibit, then press Publish. How long you've kept it can be "Not sure", and
so can how it came to you; uncertainty is a real answer and gets its own
cabinet ("Time uncertain") and its own badge ("Origin uncertain"). The
drawing, label and story are required, but nothing checks spelling,
fluency or drawing skill: a label or story only has to contain at least one
letter or digit, in any script.

The drawing surface takes a mouse, a finger, a stylus or the keyboard
(focus the frame; Enter starts a stroke at the cross, the arrow keys draw,
Shift with an arrow draws a small step, Enter ends the stroke, Escape
cancels it). A sketch can have many strokes, all in one pen and colour from
the wall's own set. Undo removes the last stroke, its timing included;
Clear removes everything. Nothing leaves the browser while you draw: the
draft lives in `localStorage`, so an accidental reload brings it back, and
"Discard draft" throws it away. Publishing sends the exhibit exactly as the
preview showed it, once, with a token that makes a retry return the same
exhibit rather than a second one. If publishing fails, the draft stays.

Each hand can publish one exhibit in any 24 hours, measured from its last
publication, not from midnight. Withdrawing an exhibit doesn't give that
allowance back, and the wall's one mark a day is a separate allowance.
Drafting, undoing and starting again never use either.

## The trace seal

The seal is a description of how one sketch was drawn, measured from what
the browser recorded inside the drawing frame and nowhere else. It is not
an identifier, a skill score, a personality reading or a measure of how
much an object matters. A browser can be made to report any timing it
likes, so the seal is labelled a recorded estimate and never decides
anything.

**What's recorded.** For each stroke, points as whole drawing units (du)
in a fixed square 1000 du across, whatever size the frame is shown at, with
milliseconds since the stroke began from `performance.now()`. Positions go
through the SVG's own screen transform, so letterboxing, page scroll and
resizing don't change the geometry. A point is recorded on each pointer
move (at most one per 10 ms) and, while a stroke is held still, one every
100 ms: browsers send nothing while a pointer rests, so a pause has to be
recorded deliberately. Time between strokes is never recorded. A stroke
ends when the pointer lifts, the key is pressed again, or the page is
hidden or loses focus; a cancelled pointer leaves no stroke at all. The
input method of each stroke (mouse, touch, pen or keyboard) is kept too,
and an exhibit drawn with more than one is "mixed".

**What's measured** (`public/fingerprint.js`, version 1, stored beside
every exhibit so older exhibits stay interpretable if this changes):

- each stroke is resampled every 50 ms by linear interpolation, so results
  don't depend on how often a device fires events; repeated timestamps keep
  the last position, and a gap over 1 s between samples (a suspended
  browser) counts as 1 s
- a 50 ms step that moves less than 2.5 du (50 du per second) is negligible
  movement: jitter or a resting hand
- **distance** is the sum of the steps that moved; **moving speed** is
  distance over the time spent moving, in drawing widths per second
- a **pause** is at least 500 ms of negligible movement while a stroke is
  held; time between strokes is never a pause
- **turning** is the change of heading at points every 20 du along the
  moving path, ignoring changes under 3° there (rounding, or curves gentler
  than a radius of about 380 du); it's reported in degrees, per tenth of a
  drawing width, and as a count of sharp turns (45° or more)

**How to read it.** Clockwise from the notch at the top, following the
drawing from its first stroke to its last; each stroke is its own arc, with
a gap between. The arc's outer edge rises with speed from the solid base
circle (still) to the dashed ring at 1.5 drawing widths per second; faster
stretches are drawn on the ring with a heavy line, so a capped value is
visibly capped. Hollow beads on the base circle mark pauses, larger for
longer ones up to 3 s. The inner band thickens where the line turned more
for the distance it covered, reaching full depth at 360° per tenth of a
drawing width. The seal's colour is the drawing's ink and means nothing by
itself. These scales are fixed for every exhibit, so any two seals can be
compared directly. Every exhibit page repeats this in a sentence and lists
the numbers with their units; the seal's text alternative carries the same
numbers.

The server recomputes all of this from the samples it receives, after
checking them: whole numbers inside the drawing, times starting at 0 and
never going backwards, at most 40 strokes, 3,000 points a stroke, 8,000 in
all, and a minute a stroke. Statistics sent by a client are ignored.

## Following a thread

Every exhibit offers two threads to another visitor's object.
"Same reason, another object" goes to the next exhibit kept for the same
chosen reason. "Similar gesture, another story" goes to the exhibit whose
drawing moved most like this one, measured as the straight-line distance
between three numbers, each on a fixed 0 to 1 scale: moving speed over 1.5
widths per second, the share of drawing time spent paused, and turning over
360° per tenth of a width (all capped at 1). Only exhibits drawn with the
same input method are compared, since a mouse and a finger move
differently; ties go to the older exhibit; a match only counts if the
distance is 0.2 or less, and otherwise the page says honestly that nothing
moves closely enough yet. Neither thread ever leads to the exhibit itself,
to another exhibit by the same hand, or to one by the person looking, and
none of that exclusion is visible.

Opening a thread shows the pair side by side with the reason they were
paired ("Both were kept for connection", "Both sketches have similar pause
proportions and turning"). "The objects" puts the two drawings and stories
together; "The gestures" puts the two seals on the same scales, with the
measurements beside each and a sentence about what they share and where
they differ. Switching keeps the pair and the address. The seals turn into
place when you switch, unless your system asks for reduced motion. A
connection describes what two visitors submitted, never a relationship
between them.

## Anonymity, and what's private

There are no accounts and no names. A hand is the `hand` cookie the server
mints on a first visit; the database remembers which hand published which
exhibit so that only its own browser sees "Your exhibit", can withdraw it,
and is left out of its own threads. No hand id, or anything derived from
one, appears in a page, an address, an API response or a stream event, and
the museum never groups one visitor's exhibits together. Exhibits are
known publicly only by accession number ("Object 0042"). The contribution
page asks for no name, photograph or location, encourages stories about
the object rather than people, and nudges (without blocking) if a story
looks like it contains contact details.

The server logs each action with the hand's generated nickname (never its
id), for example `exhibit.publish hand=bold-lantern object=0042`, so
whoever runs the app can tell visitors apart in `flyctl logs` without
anyone else being able to.

Withdrawing an exhibit deletes its drawing, timing, story and descriptor
from the database and removes it from every open page within a second. The
only thing kept is the private record that the hand published, which is
what keeps the 24-hour allowance honest.

## Reporting, and the review path

Every exhibit can be reported, once per hand, for one of four reasons. A
report never removes anything by itself: the exhibit stays up, marked as
waiting for review, and any visitor can hide it on their own device in the
meantime (and show it again). A person reviews reports on the machine:

```sh
flyctl ssh console -a <app> -C "node src/review.ts list"     # reported exhibits, label, story, reasons
flyctl ssh console -a <app> -C "node src/review.ts hide 42"  # out of every public view, kept for a second look
flyctl ssh console -a <app> -C "node src/review.ts restore 42"
flyctl ssh console -a <app> -C "node src/review.ts remove 42"  # deleted, as a withdrawal would
```

Open museum tabs hear about a hide or removal within a couple of seconds.

## What's real-time, and why

A published exhibit, sketch, story and seal together, appears in every open
museum tab within a second, in its cabinet, without a reload and without
moving whatever the visitor is reading. Withdrawals leave the same way. The
museum has its own same-origin
[server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
stream, `/api/museum/stream`, so the wall's `/api/marks/stream` is
untouched. An exhibit is saved, with a numbered entry in an event log,
before anything is announced. Every page carries the event number it was
rendered at and asks the stream for everything after it, so nothing
published between loading the page and connecting is lost; a tab that
drops its connection (a locked phone, a redeploy) reconnects from the last
number it saw. The log holds exhibit numbers only, never content, and keeps
30 days.

SSE rather than WebSockets because the museum only ever pushes, server to
browser. One in-memory list of connections is enough because `fly.toml`
runs exactly one machine.

## The original wall

The wall is at [`/wall/`](/wall/), exactly as it was: every mark ever drawn,
in its pen and colour, one mark per hand per 24 hours, drawn with a pointer
or the keyboard, a hand's own marks painted last and thicker for that hand
only, live over its own stream. Wall marks carry no timing and no story, so
they have no seal and no place in the museum; nothing was invented for
them.

## What's enforced, and what's judged

`spec/` checks the mechanical promises against the running app and
against controlled fixtures. For the seal: identical samples give
identical seals; a slower drawing of the same path lowers the speed edge;
a held-still interval makes a pause bead and a short hesitation doesn't;
added turns raise the turning band; device event rate barely moves the
result; duplicate timestamps, zero distance, jitter, sparse strokes and a
hidden-tab gap don't break it; speeds beyond the scale are marked capped.
For the drawing surface, driven with real events in jsdom: resizing,
letterboxing and scrolling keep the geometry; a held pointer records
stationary samples; a cancelled pointer, a hidden page and a second finger
leave nothing accidental; undo removes motion with geometry. For the
museum over HTTP: uncertain answers publish into the right cabinet and
badge; visitor text is escaped in every page and stream card; the server
measures the drawing itself; malformed, oversized, off-list and
cross-origin submissions are refused; one exhibit per hand per day, even
when six arrive at once or one request's body arrives slowly, while
different hands publish concurrently; retries return the same exhibit;
withdrawal is the owner's alone, removes the exhibit everywhere and keeps
the cooldown; no cookie appears in pages or events; arrivals stream within
a second; missed events replay; threads stay within an input method;
reports are deduplicated and never remove anything. Against scratch
databases: an existing volume migrates with every hand and mark intact,
and exhibits survive a restart. Every ink reads at WCAG's 3:1 against both
frame mats, and text at 4.5:1 on its paper, in both colour schemes. The
wall keeps its own tests, unchanged in substance.

What no test can tell me is whether the museum is good to be in: whether
the cabinets feel like a collection rather than a feed with two objects or
with four hundred, whether a seal is legible enough that a stranger can
point at a bead and say "they paused there", and whether "Similar gesture"
finds pairings that feel like a discovery rather than noise. Those are for
the crit.
