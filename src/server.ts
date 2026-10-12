import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { SIMILAR_MAX } from "../public/fingerprint.js";
import {
  addMark,
  allMarks,
  cabinetCounts,
  cabinetPage as cabinetRows,
  createHand,
  eventsSince,
  getExhibit,
  getHand,
  lastMark,
  latestSeq,
  msUntilNextExhibit,
  msUntilNextMark,
  oldestSeq,
  ownedExhibitIds,
  publishExhibit,
  reportCount,
  reportExhibit,
  sameReason,
  similarGesture,
  withdrawExhibit,
  type MuseumEvent,
} from "./db.ts";
import { colourFor, isPaletteColour, nameFor, newHandId, parseHandCookie, setHandCookie } from "./identity.ts";
import { accession, DURATIONS, prepareExhibit, REPORT_REASONS, TOKEN_RE } from "./museum.ts";
import {
  CABINET_PAGE,
  cabinetPage,
  comparePage,
  contributePage,
  DEFAULT_INK,
  exhibitCard,
  exhibitPage,
  goneExhibitPage,
  museumPage,
} from "./museum-pages.ts";
import { readmePage, untilPhrase, wallPage } from "./pages.ts";
import { DEFAULT_PEN, isPen } from "./pens.ts";

const PORT = Number(process.env.PORT ?? 8080);
// Fly's proxy terminates TLS and forwards plain http; FLY_APP_NAME is only
// set on a real Fly machine, so it's a reliable stand-in for "the browser's
// connection is actually https" without trusting a header the app can't verify.
const isProd = Boolean(process.env.FLY_APP_NAME);

const STATIC_FILES: Record<string, string> = {
  "/style.css": "text/css; charset=utf-8",
  "/wall.js": "text/javascript; charset=utf-8",
  "/fingerprint.js": "text/javascript; charset=utf-8",
  "/sketchpad.js": "text/javascript; charset=utf-8",
  "/contribute.js": "text/javascript; charset=utf-8",
  "/museum.js": "text/javascript; charset=utf-8",
};

// Everything the pages need is same-origin; this makes the browser hold
// them to it, a second line behind escaping every visitor-written string.
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

class TooLarge extends Error {}

function readBody(req: IncomingMessage, limit = 100_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new TooLarge("body too large"));
        req.pause();
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// One "M" then one or more "L" segments, in the viewBox's integer-ish
// coordinate space --- exactly what public/wall.js emits. Capped at 2000
// points so a hand-rolled request can't post an arbitrarily large stroke.
const PATH_RE = /^M-?\d+(\.\d+)?,-?\d+(\.\d+)?(\sL-?\d+(\.\d+)?,-?\d+(\.\d+)?){1,2000}$/;

interface HandInfo {
  id: string;
  name: string;
  colour: string;
}

function ensureHand(req: IncomingMessage, res: ServerResponse): HandInfo {
  const existing = parseHandCookie(req.headers.cookie);
  const found = existing ? getHand(existing) : undefined;
  if (found) return { id: found.id, name: found.name, colour: found.colour };

  const id = newHandId();
  const hand = createHand(id, nameFor(id), colourFor(id));
  res.setHeader("Set-Cookie", setHandCookie(id, isProd));
  console.log(`hand.new hand=${hand.name}`);
  return { id: hand.id, name: hand.name, colour: hand.colour };
}

// The server's log is where "who did what" lives: a hand's name (never
// shown to anyone else, never its id) and the action. `flyctl logs` reads it.
const log = (action: string, hand: HandInfo, detail = "") =>
  console.log(`${action} hand=${hand.name}${detail ? ` ${detail}` : ""}`);

// A browser always says where a write came from; a page on another site
// can't make one look like ours. Requests with neither header (curl, the
// spec) aren't from a browser page at all.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  const site = req.headers["sec-fetch-site"];
  return !site || site === "same-origin" || site === "none";
}

// Successful publications per address per hour, on top of one per hand per
// day: minting a fresh cookie is free, an address isn't. Fly's proxy sets
// Fly-Client-IP; anywhere else the header could be forged, so it's ignored.
const PUBLISH_PER_ADDRESS_HOUR = Number(process.env.MUSEUM_PER_ADDRESS_HOUR ?? 30);
const recent = new Map<string, number[]>();
const addressOf = (req: IncomingMessage) =>
  (isProd ? (req.headers["fly-client-ip"] as string | undefined) : undefined) ?? req.socket.remoteAddress ?? "?";
const windowed = (key: string, now = Date.now()) => (recent.get(key) ?? []).filter((t) => t > now - 3_600_000);
setInterval(() => {
  for (const [key] of recent) {
    const kept = windowed(key);
    if (kept.length) recent.set(key, kept);
    else recent.delete(key);
  }
}, 600_000).unref();

const send = (res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, ...SECURITY_HEADERS });
  res.end(body);
};
const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
const html = (res: ServerResponse, status: number, body: string) => send(res, status, body, "text/html; charset=utf-8");

// The wall's real-time layer: every open wall tab holds one of these open,
// and a mark lands in all of them (this one included --- wall.js tells its
// own gesture apart from the echo by the nonce it posted) the moment
// `addMark` commits. A plain in-memory Set is enough because fly.toml runs
// exactly one machine.
interface SseClient {
  res: ServerResponse;
  heartbeat: ReturnType<typeof setInterval>;
}

const sseClients = new Set<SseClient>();

function broadcastMark(mark: { path: string; colour: string; pen: string; nonce?: string }): void {
  const payload = JSON.stringify({
    path: mark.path,
    colour: mark.colour,
    pen: mark.pen,
    nonce: mark.nonce,
  });
  for (const client of sseClients) {
    client.res.write(`event: mark\ndata: ${payload}\n\n`);
  }
}

// The museum's own stream. Every event comes from the museum_events table
// after its transaction commits, so nothing is announced before it's saved,
// and each carries its sequence number as the SSE id: a tab that reconnects
// (EventSource's Last-Event-ID, or ?since= from the page it loaded) gets
// everything after it. `pump` also runs on a timer, so a reviewer's change
// made from another process (src/review.ts) reaches open tabs too.
interface MuseumClient extends SseClient {
  handId: string | undefined;
}

const museumClients = new Set<MuseumClient>();
let pumped = latestSeq();

function frames(event: MuseumEvent): ((handId: string | undefined) => string) | null {
  const head = `id: ${event.seq}\nevent: ${event.kind}\ndata: `;
  if (event.kind === "withdraw") {
    const data = JSON.stringify({ seq: event.seq, id: event.exhibit_id, cabinet: event.cabinet });
    return () => `${head}${data}\n\n`;
  }
  const exhibit = getExhibit(event.exhibit_id);
  if (!exhibit || exhibit.hidden) return null;
  const base = {
    seq: event.seq,
    id: exhibit.id,
    cabinet: exhibit.duration,
    accession: accession(exhibit.id),
    html: exhibitCard(exhibit),
  };
  const plain = JSON.stringify(base);
  // `mine` only ever goes to the owning hand's own connection.
  const owned = JSON.stringify({ ...base, mine: true });
  return (handId) => `${head}${handId === exhibit.hand_id ? owned : plain}\n\n`;
}

function pump(): void {
  for (;;) {
    const events = eventsSince(pumped, 200);
    if (events.length === 0) return;
    for (const event of events) {
      const frame = frames(event);
      if (frame) for (const client of museumClients) client.res.write(frame(client.handId));
      pumped = event.seq;
    }
  }
}
setInterval(pump, 2000).unref();

function openStream(req: IncomingMessage, res: ServerResponse): ReturnType<typeof setInterval> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  // Fly's proxy (and some browsers) will drop an idle connection; a
  // comment line every 20s is invisible to EventSource but keeps it open.
  return setInterval(() => res.write(": ping\n\n"), 20_000);
}

const pad = (id: number) => String(id).padStart(4, "0");
const idFrom = (s: string | undefined) => (s && /^\d{1,9}$/.test(s) ? Number(s) : null);

// Withdraw and report work as plain form posts too (they redirect back),
// so neither needs JavaScript.
async function readFields(req: IncomingMessage): Promise<{ form: boolean; body: Record<string, unknown> }> {
  const raw = await readBody(req, 10_000);
  const form = (req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded");
  if (form) return { form, body: Object.fromEntries(new URLSearchParams(raw)) };
  return { form, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "POST" && !sameOrigin(req)) {
      send(res, 403, "Writes have to come from this site's own pages.");
      return;
    }

    if (req.method === "GET" && path === "/") {
      const hand = ensureHand(req, res);
      const counts = cabinetCounts();
      const seq = latestSeq();
      const shelves = DURATIONS.map((d) => ({
        id: d.id,
        count: counts[d.id] ?? 0,
        exhibits: cabinetRows(d.id, Number.MAX_SAFE_INTEGER, 12),
      }));
      html(res, 200, museumPage(shelves, ownedExhibitIds(hand.id), seq));
      return;
    }

    if (req.method === "GET" && path === "/wall/") {
      const hand = ensureHand(req, res);
      html(res, 200, wallPage(allMarks(), hand, msUntilNextMark(hand.id), lastMark(hand.id)));
      return;
    }

    if (req.method === "GET" && path === "/readme/") {
      html(res, 200, readmePage(readFileSync("README.md", "utf8")));
      return;
    }

    if (req.method === "GET" && path === "/contribute/") {
      const hand = ensureHand(req, res);
      const last = lastMark(hand.id);
      const colour = [last?.colour, hand.colour].find(isPaletteColour) ?? DEFAULT_INK.colour;
      html(res, 200, contributePage({ msUntilNext: msUntilNextExhibit(hand.id), pen: last?.pen ?? DEFAULT_PEN, colour }));
      return;
    }

    const cabinetMatch = req.method === "GET" && path.match(/^\/cabinet\/([a-z0-9-]+)\/?$/);
    if (cabinetMatch) {
      const id = cabinetMatch[1];
      if (!DURATIONS.some((d) => d.id === id)) {
        send(res, 404, "No such cabinet.");
        return;
      }
      const hand = ensureHand(req, res);
      const before = idFrom(url.searchParams.get("before") ?? undefined);
      const seq = latestSeq();
      const rows = cabinetRows(id, before ?? Number.MAX_SAFE_INTEGER, CABINET_PAGE);
      html(res, 200, cabinetPage(id, cabinetCounts()[id] ?? 0, rows, ownedExhibitIds(hand.id), seq, before !== null));
      return;
    }

    const objectMatch = req.method === "GET" && path.match(/^\/object\/(\d{1,9})\/?$/);
    if (objectMatch) {
      const hand = ensureHand(req, res);
      const id = Number(objectMatch[1]);
      const exhibit = getExhibit(id);
      if (!exhibit || exhibit.hidden) {
        html(res, 404, goneExhibitPage(id, Boolean(exhibit?.hidden)));
        return;
      }
      const gesture = similarGesture(exhibit, hand.id);
      html(
        res,
        200,
        exhibitPage(exhibit, {
          mine: exhibit.hand_id === hand.id,
          reports: reportCount(id),
          msUntilNext: msUntilNextExhibit(hand.id),
          seq: latestSeq(),
          thread: {
            reason: sameReason(exhibit, hand.id),
            gesture,
            gestureClose: gesture !== undefined && Math.sqrt(gesture.d2) <= SIMILAR_MAX,
          },
        }),
      );
      return;
    }

    const compareMatch = req.method === "GET" && path.match(/^\/compare\/(\d{1,9})\/(\d{1,9})\/?$/);
    if (compareMatch) {
      const a = getExhibit(Number(compareMatch[1]));
      const b = getExhibit(Number(compareMatch[2]));
      if (!a || !b || a.hidden || b.hidden || a.id === b.id) {
        send(res, 404, "One of those exhibits isn't in the museum.");
        return;
      }
      html(res, 200, comparePage(a, b, url.searchParams.get("thread") ?? "", url.searchParams.get("view") ?? "objects"));
      return;
    }

    if (req.method === "GET" && path === "/api/marks/stream") {
      const heartbeat = openStream(req, res);
      const client: SseClient = { res, heartbeat };
      sseClients.add(client);
      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(client);
      });
      return;
    }

    if (req.method === "GET" && path === "/api/museum/stream") {
      const since = idFrom((req.headers["last-event-id"] as string | undefined) ?? url.searchParams.get("since") ?? undefined);
      const handId = parseHandCookie(req.headers.cookie);
      const heartbeat = openStream(req, res);
      pump();
      if (since !== null && since < pumped) {
        const oldest = oldestSeq();
        const missed = eventsSince(since, 501).filter((e) => e.seq <= pumped);
        if ((oldest === null || since < oldest - 1) || missed.length > 500) {
          // More has happened than the log remembers: start again.
          res.write(`event: reset\ndata: {}\n\n`);
        } else {
          for (const event of missed) {
            const frame = frames(event);
            if (frame) res.write(frame(handId));
            else res.write(`id: ${event.seq}\n: skipped\n\n`);
          }
        }
      }
      const client: MuseumClient = { res, heartbeat, handId };
      museumClients.add(client);
      req.on("close", () => {
        clearInterval(heartbeat);
        museumClients.delete(client);
      });
      return;
    }

    if (req.method === "GET" && path in STATIC_FILES) {
      res.writeHead(200, { "Content-Type": STATIC_FILES[path], "Cache-Control": "no-cache", ...SECURITY_HEADERS });
      res.end(readFileSync(join("public", path)));
      return;
    }

    if (req.method === "POST" && path === "/api/marks") {
      const hand = ensureHand(req, res);

      const raw = await readBody(req);
      let markPath: unknown;
      let nonce: unknown;
      let pen: unknown;
      let colour: unknown;
      try {
        const body = JSON.parse(raw) as {
          path?: unknown;
          nonce?: unknown;
          pen?: unknown;
          colour?: unknown;
        };
        markPath = body.path;
        nonce = body.nonce;
        pen = body.pen ?? DEFAULT_PEN;
        colour = body.colour ?? hand.colour;
      } catch {
        send(res, 400, "Malformed request.");
        return;
      }

      if (typeof markPath !== "string" || !PATH_RE.test(markPath)) {
        send(res, 400, "That doesn't look like a mark.");
        return;
      }
      // One of src/pens.ts's ids or nothing: a raw width or dash pattern
      // would let a hand-rolled request draw a stroke no picker offers.
      if (!isPen(pen)) {
        send(res, 400, "That isn't one of the wall's pens.");
        return;
      }
      // Likewise only the palette identity.ts has checked for contrast. A
      // request that names no colour draws in the hand's own, as it always
      // did, even if that predates the palette's retuning.
      if (colour !== hand.colour && !isPaletteColour(colour)) {
        send(res, 400, "That isn't one of the wall's colours.");
        return;
      }
      // An opaque, client-chosen token so a tab can recognise its own mark
      // coming back over SSE --- never stored, never rendered, just echoed.
      const markNonce = typeof nonce === "string" && nonce.length <= 200 ? nonce : undefined;

      // The check has to be the last thing before the insert, with no
      // `await` between them: a client that holds its request body open
      // (a slow POST, or just a second tab) can otherwise pass this check
      // before either request has inserted, and post twice in one day.
      const wait = msUntilNextMark(hand.id);
      if (wait > 0) {
        send(res, 429, `Your mark is already on the wall. You can add another ${untilPhrase(wait)}.`);
        return;
      }

      const mark = addMark(hand.id, markPath, colour, pen);
      log("mark.add", hand, `mark=${mark.id}`);
      broadcastMark({ ...mark, nonce: markNonce });
      send(res, 201, "ok");
      return;
    }

    if (req.method === "POST" && path === "/api/exhibits") {
      const hand = ensureHand(req, res);
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        json(res, 415, { error: "Send the exhibit as JSON." });
        return;
      }
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(await readBody(req, 300_000));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        body = parsed as Record<string, unknown>;
      } catch (err) {
        if (err instanceof TooLarge) json(res, 413, { error: "That exhibit is too large to send." });
        else json(res, 400, { error: "Malformed request." });
        return;
      }
      if (typeof body.token !== "string" || !TOKEN_RE.test(body.token)) {
        json(res, 400, { error: "Missing publication token." });
        return;
      }
      const prepared = prepareExhibit(body);
      if ("error" in prepared) {
        log("exhibit.refused", hand, `reason="${prepared.error}"`);
        json(res, 400, { error: prepared.error });
        return;
      }
      const address = addressOf(req);
      const fromAddress = windowed(address);
      if (fromAddress.length >= PUBLISH_PER_ADDRESS_HOUR) {
        json(res, 429, { error: "A lot of exhibits have come from this network in the last hour. Try again later." });
        return;
      }
      // Nothing between here and publishExhibit's commit awaits.
      const result = publishExhibit(hand.id, body.token, prepared.fields);
      if (result.kind === "created") {
        recent.set(address, [...fromAddress, Date.now()]);
        log("exhibit.publish", hand, `object=${pad(result.id)} cabinet=${prepared.fields.duration} input=${prepared.fields.input}`);
        pump();
        json(res, 201, { id: result.id, accession: accession(result.id), href: `/object/${pad(result.id)}` });
      } else if (result.kind === "duplicate") {
        json(res, 200, { id: result.id, accession: accession(result.id), href: `/object/${pad(result.id)}` });
      } else if (result.kind === "wait") {
        log("exhibit.wait", hand);
        res.setHeader("Retry-After", String(Math.ceil(result.ms / 1000)));
        json(res, 429, { error: `You've already published an exhibit today. You can publish another ${untilPhrase(result.ms)}.` });
      } else if (result.kind === "withdrawn") {
        json(res, 409, { error: "This exhibit was published and then withdrawn." });
      } else {
        json(res, 409, { error: "That publication token is already in use." });
      }
      return;
    }

    const withdrawMatch = req.method === "POST" && path.match(/^\/api\/exhibits\/(\d{1,9})\/withdraw$/);
    if (withdrawMatch) {
      const hand = ensureHand(req, res);
      const id = Number(withdrawMatch[1]);
      await readBody(req, 10_000);
      const form = (req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded");
      if (!withdrawExhibit(id, hand.id)) {
        log("exhibit.withdraw-refused", hand, `object=${pad(id)}`);
        json(res, 403, { error: "Only the browser that published an exhibit can withdraw it." });
        return;
      }
      log("exhibit.withdraw", hand, `object=${pad(id)}`);
      pump();
      if (form) {
        res.writeHead(303, { Location: "/?withdrawn=1" });
        res.end();
      } else json(res, 200, { withdrawn: id });
      return;
    }

    const reportMatch = req.method === "POST" && path.match(/^\/api\/exhibits\/(\d{1,9})\/report$/);
    if (reportMatch) {
      const hand = ensureHand(req, res);
      const id = Number(reportMatch[1]);
      let fields: { form: boolean; body: Record<string, unknown> };
      try {
        fields = await readFields(req);
      } catch {
        json(res, 400, { error: "Malformed request." });
        return;
      }
      const reason = fields.body.reason;
      const exhibit = getExhibit(id);
      if (!exhibit || exhibit.hidden) {
        json(res, 404, { error: "No such exhibit." });
        return;
      }
      if (typeof reason !== "string" || !REPORT_REASONS.some((r) => r.id === reason)) {
        json(res, 400, { error: "Choose what's wrong with it." });
        return;
      }
      const outcome = reportExhibit(id, hand.id, reason);
      log("exhibit.report", hand, `object=${pad(id)} reason=${reason} outcome=${outcome}`);
      if (outcome === "limit") {
        json(res, 429, { error: "You've sent a lot of reports today. Thank you; please try again tomorrow." });
        return;
      }
      if (fields.form) {
        res.writeHead(303, { Location: `/object/${pad(id)}?reported=1` });
        res.end();
      } else json(res, outcome === "reported" ? 201 : 200, { reported: outcome });
      return;
    }

    send(res, 404, "Not found.");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, "Something went wrong.");
    else res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Trace listening on 0.0.0.0:${PORT}`);
});
