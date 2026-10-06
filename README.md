# Trace

Trace is a wall with one rule: draw a single mark, and it joins everyone
else's. There's no feed, no likes, no comments, no account --- just a hand
(yours, anonymous, remembered only by a cookie) adding one stroke to a
drawing that never resets. Come back tomorrow and your mark, and everyone
else's, is still there.

## What good means here

I read two things while deciding what this app should and shouldn't do.
Robin Sloan's
["An app can be a home-cooked meal"](https://www.robinsloan.com/notes/home-cooked-app/)
describes BoopSnoop, a photo-sharing app he built for exactly four people ---
his family --- with no login, no contact list, nothing to configure: "software
that stays put," made out of care rather than growth. Aral Balkan's
["What is the Small Web?"](https://ar.al/2020/08/07/what-is-the-small-web/)
names the pattern this is reacting against: the "Big Web" trusts servers
over people, and grows by trusting nobody, watching everybody, and never
sitting still.

Trace can't be single-tenant the way Balkan means (a marking crawler and a
stranger both need to reach it at the same URL), but I took the same stance
on what the *inside* of the app should feel like: nothing here is trying to
grow. There's no way to invite anyone, follow anyone, or find out who drew
which mark unless they tell you. A hand is a cookie, not a profile. You get one mark a day, the same way you'd only add one line to a
guestbook --- not because the server can't take more, but because a wall
that everyone can flood stops being a wall anyone wants to add to.

## Choosing how today's mark looks

Before a hand draws, it picks a pen and a colour for that one mark: five
pens (line, hairline, brush, dots, dashes) and the same ten colours the
wall has always handed out. The choice is the only thing a hand says about
a mark besides the gesture itself, so it gets the same treatment as the
gesture: a fixed vocabulary, not a free one. There's no colour wheel and no
width slider. Every colour has already been checked against both page
backgrounds, and no pen changes opacity, so nothing a hand picks can draw a
mark the next visitor can't see. A pen is a name the server stores, not a
width it trusts: what "brush" looks like lives in the stylesheet.

The widths are deliberately close together. On a scratch wall of 150
marks, a much broader brush read as the whole wall and the hairlines
vanished under it, which is just engagement by another means: the loudest
pen buying the most wall. Now a brush is about twice a line, and a hairline
half.

A new hand's picker starts on the colour it was given when its cookie was
minted, so not choosing is still a choice the wall makes for you, as
before; once a hand has drawn, it starts from whatever it used last. The
picker locks the moment a gesture starts, so the mark you see while drawing
is the one that posts.

## What I chose not to build

No text. No titles, no captions, no usernames you type in --- a mark is a
gesture, not a post, and a gesture can't be unkind in the way a sentence can.
The wall says this about itself in a line above the drawing, so nobody has
to come here to find out.
No accounts: identity is a browser cookie, so "coming back" means the same
browser, not a login you can carry between devices (yet --- that trade-off
is worth revisiting once more than one hand at a time is actually drawing on
it, in the crit after this one). No moderation queue: the constraint is
upstream, in what a mark is even allowed to be.

## What's enforced, and what's judged

`spec/` checks the claims that are actually mechanical: a first-time visitor
gets a hand (a cookie, minted once); a mark they draw shows up on the wall
and is still there on a completely fresh request; a hand can't draw a second
mark until 24 hours after its last, measured from the mark rather than
from midnight, since UTC midnight lands at 11am in Canberra and any
calendar day would be somebody's mid-afternoon; a mark's pen has to be one
of the five names in `src/pens.ts` and its colour one of the palette's ten,
or the server refuses it, whatever a hand-built request sends; the picker
offers exactly that palette; a database written before marks had pens
opens under the new code with every old mark intact (`spec/migrate.test.ts`
builds one in the old shape), since a redeploy reuses the volume and
`CREATE TABLE IF NOT EXISTS` never adds a column; a mark broadcasts over `/api/marks/stream`
within a second of landing, pen and colour included; the page ships no third-party script or
tracking request; every hand colour reads at WCAG 1.4.11's 3:1 non-text
contrast minimum against both a white and a black background, since
`color-scheme: light dark` means a stroke has to stay visible under
whichever one a visitor's own system prefers. Whether the wall is actually *good to look at* once more
than one hand has drawn on it, whether one mark a day is the right pace, and
whether "no login, ever" survives contact with people who want their marks
back on a new phone --- those are judgement calls, not tests, and the crit is
where I find out if they were the right ones.

Nothing about "one hand, one mark" should mean one *input device*. The pen
and colour choices are plain radio buttons, so Tab reaches each group and
the arrow keys move through it, with nothing in `wall.js` to break. Focusing the wall and pressing
Enter starts a mark at its centre, the arrow keys extend it a step at a
time, and Enter again hands off to the exact same submit path a pointer
gesture uses --- same nonce, same one-mark-a-day check, same echo handling.
`spec/wall-client.test.ts` drives this the same way it already drove the
pointer path: real `KeyboardEvent`s against the real `public/wall.js`, not a
description of what it should do.

Coming back has to mean finding *your* trace, not just a trace. Ten
colours and five pens shared across every hand, and chosen afresh each
day, can't do that on their own, so a hand's own strokes render a little
thicker than their pen draws for anyone else, and on top of everyone else's, cut out by a thin
band of background so a busy wall's later marks can't bury them, and only
to that hand --- the server knows which
marks a cookie drew, but never sends a hand id to the page, so nobody else
can tell whose is whose. `spec/wall.test.ts` checks both halves: the hand
that drew a mark sees it marked as theirs, and a different hand looking at
the same wall doesn't.

## What's real-time, and why

A mark now appears in every open tab within a second of landing, no reload:
`GET /api/marks/stream` is a same-origin
[server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
stream, and `public/wall.js` opens one on every visit. SSE over WebSockets
because the wall only ever pushes one thing, a finished mark, one direction,
server to browser --- there's nothing a client needs to send back over the
same connection, so a plain long-lived HTTP response is the smaller, plainer
mechanism for the job. One in-memory list of open connections on the one Fly
machine is enough: `fly.toml` pins this app to a single machine with one
volume, so there's no second process an event could fail to reach.

This is still proof of life plus one layer, not the finished app: one hand,
one mark a day, now watchable live. One question I could actually test this
week: a stranger's first visit renders every mark drawn before they arrived
in the same request that serves the page --- no "here's what's new" banner,
no separate load for history versus live --- and only marks made while
they're actually looking stream in over `/api/marks/stream`. Two tabs open at
once, one drawing while the other watched with no reload, confirmed it: the
wall reads as a wall, not an activity feed.

I also drove three separate hands (three cookie jars, so three real identities,
not one browser tab role-playing) through the same wall at once: one hand
started a stroke and held its pointer down while a second hand drew and
finished theirs, and the first hand's in-progress gesture wasn't disturbed by
the other's mark streaming in underneath it --- it finished and posted
normally straight after. A tab that had been open the whole time picked up
every mark from every hand with no reload, in order, no duplicates. At both
marking viewports the wall still reads as one drawing, not a pile-up, with
several hands' strokes on it. What I haven't tested, because it needs real
people finding this at the same time rather than hands I drove myself, is
whether the one-mark-a-day pace still *feels* right once more than a couple
of hands are drawing in the same hour --- the mechanics hold up; whether the
pace does is still a question for the crit after this one.
