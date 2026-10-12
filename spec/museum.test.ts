import { JSDOM } from "jsdom";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { describe as group, expect, inject, it } from "vitest";
import { describe, measurements } from "../public/fingerprint.js";

// The museum's promises over HTTP, against the running app: what a visitor
// publishes is validated, measured by the server, shown escaped in the right
// cabinet, streamed to every open tab after it's saved, and only ever
// withdrawn by the hand that made it. The app keeps its database between
// runs, so every check here finds its own exhibits by id, never by position.
const baseUrl = inject("baseUrl");
const url = (path: string) => new URL(path, baseUrl);

async function newHand(): Promise<string> {
  const res = await fetch(url("/"));
  return res.headers.get("set-cookie")!.split(";")[0];
}

type Pt = [number, number, number];
// A line from (x0,y0) to (x1,y1) over `ms`, sampled every 16 ms.
function stroke(x0: number, y0: number, x1: number, y1: number, ms: number, input = "mouse") {
  const points: Pt[] = [];
  for (let t = 0; t <= ms; t += 16) {
    const f = t / ms;
    points.push([Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f), t]);
  }
  return { input, points };
}

const exhibit = (overrides: Record<string, unknown> = {}) => ({
  token: randomUUID(),
  label: "A chipped mug",
  story: "It was on my grandmother's table every morning.",
  duration: "10-plus",
  origin: "inherited",
  reason: "connection",
  pen: "line",
  colour: "#5177aa",
  strokes: [stroke(200, 200, 800, 200, 900), stroke(800, 200, 800, 800, 900)],
  ...overrides,
});

const publish = (cookie: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url("/api/exhibits"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function published(cookie: string, overrides: Record<string, unknown> = {}): Promise<number> {
  const res = await publish(cookie, exhibit(overrides));
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

const page = async (path: string, cookie?: string) => {
  const res = await fetch(url(path), { headers: cookie ? { Cookie: cookie } : {} });
  const html = await res.text();
  return { status: res.status, html, doc: new JSDOM(html).window.document };
};
const objectPath = (id: number) => `/object/${String(id).padStart(4, "0")}`;

// Reads named SSE events off a stream until `want` returns a match.
async function openStream(path: string, cookie?: string) {
  const controller = new AbortController();
  const res = await fetch(url(path), { signal: controller.signal, headers: cookie ? { Cookie: cookie } : {} });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const seen: { event: string; data: Record<string, unknown>; raw: string }[] = [];
  const next = async (want: (e: { event: string; data: Record<string, unknown> }) => boolean, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = seen.find(want);
      if (found) return found;
      let boundary;
      while ((boundary = buffered.indexOf("\n\n")) !== -1) {
        const chunk = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const event = chunk.match(/^event: (.*)$/m)?.[1];
        const data = chunk.match(/^data: (.*)$/m)?.[1];
        if (event && data) seen.push({ event, data: JSON.parse(data), raw: chunk });
      }
      if (seen.find(want)) continue;
      if (Date.now() > deadline) throw new Error(`no matching event within ${ms} ms`);
      const result = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
      ]);
      if (result && !result.done) buffered += decoder.decode(result.value, { stream: true });
    }
  };
  return { next, seen, close: () => controller.abort() };
}

const seqOf = async () => Number((await page("/")).doc.getElementById("museum")!.getAttribute("data-seq"));

group("publishing", () => {
  it("publishes uncertain answers into the Time uncertain cabinet with an Origin uncertain badge", async () => {
    const cookie = await newHand();
    const label = `Unsure keepsake ${randomUUID().slice(0, 6)}`;
    const id = await published(cookie, { label, duration: "unknown", origin: "unknown", reason: "curiosity" });

    const { doc } = await page("/cabinet/unknown");
    const card = doc.querySelector(`.exhibit-card[data-id="${id}"]`);
    expect(card, "card in the Time uncertain cabinet").not.toBeNull();
    expect(card!.querySelector(".card-label")!.textContent).toBe(label);
    expect(card!.querySelector(".origin")!.textContent).toBe("Origin uncertain");
    expect(card!.querySelector(".tag")!.textContent).toBe("Curiosity");
    expect(card!.querySelector("svg.seal")).not.toBeNull();
    expect(doc.querySelector("h1")!.textContent).toContain("Time uncertain");

    const exhibitPage = await page(objectPath(id));
    expect(exhibitPage.status).toBe(200);
    expect(exhibitPage.doc.querySelector("h1")!.textContent).toBe(label);
    expect(exhibitPage.doc.querySelector(".facts")!.textContent).toContain("Not sure");
  });

  it("shows visitor text escaped everywhere, as text", async () => {
    const cookie = await newHand();
    const label = `<img src=x onerror=alert(1)> "mug" ${randomUUID().slice(0, 4)}`;
    const story = `</blockquote><script>alert('x')</script> & that's all`;
    const stream = await openStream("/api/museum/stream");
    const id = await published(cookie, { label, story, duration: "1-5" });

    for (const path of [objectPath(id), "/", "/cabinet/1-5"]) {
      const { html, doc } = await page(path);
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<script>alert");
      expect(doc.querySelectorAll("script:not([src])")).toHaveLength(0);
      const shown = path === objectPath(id) ? doc.querySelector("h1") : doc.querySelector(`[data-id="${id}"] .card-label`);
      expect(shown!.textContent).toBe(label);
    }
    const { doc } = await page(objectPath(id));
    expect(doc.querySelector(".story")!.textContent!.trim()).toBe(story);

    const event = await stream.next((e) => e.event === "add" && e.data.id === id);
    const fragment = new JSDOM(`<ul>${event.data.html as string}</ul>`).window.document;
    expect(fragment.querySelector("img, script")).toBeNull();
    expect(fragment.querySelector(".card-label")!.textContent).toBe(label);
    stream.close();
  });

  it("measures the drawing itself rather than trusting statistics a client sends", async () => {
    const cookie = await newHand();
    const body = exhibit({ descriptor: { speed: 99999 }, speed: 99999, f_speed: 1 });
    const res = await publish(cookie, body);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    const { doc } = await page(objectPath(id));
    const shown = [...doc.querySelectorAll(".measures div")].map((d) => [
      d.querySelector("dt")!.textContent,
      d.querySelector("dd")!.textContent,
    ]);
    expect(shown).toEqual(measurements(describe(body.strokes as never)));
  });

  const refusals: [string, Record<string, unknown>][] = [
    ["an empty label", { label: "   " }],
    ["a label of only punctuation", { label: "!!! ..." }],
    ["a label over 60 characters", { label: "x".repeat(61) }],
    ["a story over 240 characters", { story: "y".repeat(241) }],
    ["a missing story", { story: undefined }],
    ["an unknown duration", { duration: "forever" }],
    ["an unknown origin", { origin: "stolen" }],
    ["an unknown reason", { reason: "spite" }],
    ["a colour off the palette", { colour: "#ffff00" }],
    ["a pen off the list", { pen: "stroke-width:99" }],
    ["no strokes", { strokes: [] }],
    ["timestamps going backwards", { strokes: [{ input: "mouse", points: [[1, 1, 0], [5, 5, 40], [9, 9, 20]] }] }],
    ["a point outside the drawing", { strokes: [{ input: "mouse", points: [[1, 1, 0], [5, 5000, 40]] }] }],
    ["a missing token", { token: undefined }],
  ];
  for (const [name, overrides] of refusals) {
    it(`refuses ${name}`, async () => {
      const res = await publish(await newHand(), exhibit(overrides));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBeTruthy();
    });
  }

  it("accepts a 60-character label in any script, counted in characters", async () => {
    const res = await publish(await newHand(), exhibit({ label: "茶".repeat(60), duration: "under-1" }));
    expect(res.status).toBe(201);
  });

  it("refuses an oversized body and a non-JSON one", async () => {
    const huge = JSON.stringify(exhibit({ story: "z".repeat(400_000) }));
    expect((await publish(await newHand(), huge)).status).toBe(413);
    const form = await fetch(url("/api/exhibits"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: await newHand() },
      body: "label=hi",
    });
    expect(form.status).toBe(415);
  });

  it("refuses writes sent from another site's page", async () => {
    const res = await publish(await newHand(), exhibit(), { Origin: "https://elsewhere.example" });
    expect(res.status).toBe(403);
  });
});

group("one exhibit per hand per 24 hours", () => {
  it("refuses a second exhibit, and withdrawing the first doesn't reset it", async () => {
    const cookie = await newHand();
    const id = await published(cookie);
    expect((await publish(cookie, exhibit())).status).toBe(429);
    const withdraw = await fetch(url(`/api/exhibits/${id}/withdraw`), { method: "POST", headers: { Cookie: cookie } });
    expect(withdraw.status).toBe(200);
    const again = await publish(cookie, exhibit());
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("keeps the wall's allowance separate from the museum's", async () => {
    const cookie = await newHand();
    await published(cookie);
    const mark = await fetch(url("/api/marks"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: "M1,2 L3,4" }),
    });
    expect(mark.status).toBe(201);

    const other = await newHand();
    const first = await fetch(url("/api/marks"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other },
      body: JSON.stringify({ path: "M5,6 L7,8" }),
    });
    expect(first.status).toBe(201);
    await published(other);
  });

  it("returns the same exhibit for a retried token instead of a second one", async () => {
    const cookie = await newHand();
    const body = exhibit();
    const first = await publish(cookie, body);
    expect(first.status).toBe(201);
    const retry = await publish(cookie, body);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { id: number }).id).toBe(((await first.json()) as { id: number }).id);
    // Another hand can't claim that token.
    expect((await publish(await newHand(), body)).status).toBe(409);
  });

  it("lets only one of several simultaneous publications from one hand through", async () => {
    const cookie = await newHand();
    const results = await Promise.all(Array.from({ length: 6 }, () => publish(cookie, exhibit())));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it("holds even when one request's body is slow to arrive", async () => {
    // Request A's headers go first and its body last, after request B has
    // finished end to end: the shape that beats a check made before the body
    // is read.
    const cookie = await newHand();
    const { hostname, port } = new URL(baseUrl);
    const connect = (): Promise<net.Socket> =>
      new Promise((resolve, reject) => {
        const sock = net.connect(Number(port), hostname, () => resolve(sock));
        sock.on("error", reject);
      });
    const statusOf = (sock: net.Socket): Promise<string> =>
      new Promise((resolve) => {
        let data = "";
        sock.on("data", (chunk: Buffer) => {
          data += chunk.toString();
          if (data.includes("\r\n\r\n")) {
            resolve(data.split(" ")[1]);
            sock.destroy();
          }
        });
      });
    const head = (length: number) =>
      `POST /api/exhibits HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: application/json\r\n` +
      `Cookie: ${cookie}\r\nContent-Length: ${length}\r\nConnection: close\r\n\r\n`;
    const bodyA = JSON.stringify(exhibit());
    const bodyB = JSON.stringify(exhibit());
    const [a, b] = await Promise.all([connect(), connect()]);
    const statusA = statusOf(a);
    const statusB = statusOf(b);
    a.write(head(Buffer.byteLength(bodyA)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    b.write(head(Buffer.byteLength(bodyB)) + bodyB);
    expect(await statusB).toBe("201");
    a.write(bodyA);
    expect(await statusA).toBe("429");
  });

  it("lets different hands publish at the same time", async () => {
    const hands = await Promise.all([newHand(), newHand(), newHand()]);
    const results = await Promise.all(hands.map((h) => publish(h, exhibit())));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
  });
});

group("ownership and anonymity", () => {
  it("lets only the publishing hand withdraw, and withdrawal removes the exhibit everywhere", async () => {
    const owner = await newHand();
    const stranger = await newHand();
    const id = await published(owner, { duration: "5-10" });

    const asStranger = await page(objectPath(id), stranger);
    expect(asStranger.doc.querySelector(".withdraw")).toBeNull();
    expect(asStranger.doc.querySelector(".exhibit.mine")).toBeNull();
    const asOwner = await page(objectPath(id), owner);
    expect(asOwner.doc.querySelector(".withdraw")).not.toBeNull();
    expect(asOwner.doc.querySelector(".exhibit.mine")).not.toBeNull();

    const refused = await fetch(url(`/api/exhibits/${id}/withdraw`), { method: "POST", headers: { Cookie: stranger } });
    expect(refused.status).toBe(403);
    expect((await page(objectPath(id))).status).toBe(200);

    const stream = await openStream(`/api/museum/stream`);
    const ok = await fetch(url(`/api/exhibits/${id}/withdraw`), { method: "POST", headers: { Cookie: owner } });
    expect(ok.status).toBe(200);
    const event = await stream.next((e) => e.event === "withdraw" && e.data.id === id);
    expect(Object.keys(event.data).sort()).toEqual(["cabinet", "count", "id", "seq"]);
    stream.close();

    expect((await page(objectPath(id))).status).toBe(404);
    expect((await page("/cabinet/5-10")).doc.querySelector(`[data-id="${id}"]`)).toBeNull();
    expect((await page(`/compare/${id}/1`)).status).toBe(404);
  });

  it("never puts a hand's cookie in a page, a stream event or a link", async () => {
    const cookie = await newHand();
    const handId = cookie.split("=")[1];
    const stream = await openStream("/api/museum/stream", cookie);
    const id = await published(cookie);
    const event = await stream.next((e) => e.event === "add" && e.data.id === id);
    expect(event.data.mine).toBe(true);
    expect(event.raw).not.toContain(handId);
    for (const path of ["/", objectPath(id), "/cabinet/10-plus", "/contribute/"]) {
      expect((await page(path, cookie)).html).not.toContain(handId);
    }
    stream.close();
  });

  it("tells only the owner's own stream that an exhibit is theirs", async () => {
    const owner = await newHand();
    const viewer = await openStream("/api/museum/stream", await newHand());
    const id = await published(owner);
    const event = await viewer.next((e) => e.event === "add" && e.data.id === id);
    expect(event.data.mine).toBeUndefined();
    viewer.close();
  });
});

group("live and recoverable", () => {
  it("streams a complete new exhibit to open tabs within a second", async () => {
    const stream = await openStream("/api/museum/stream");
    const started = Date.now();
    const id = await published(await newHand(), { label: "Concert ticket", reason: "connection" });
    const event = await stream.next((e) => e.event === "add" && e.data.id === id, 1000);
    expect(Date.now() - started).toBeLessThan(1500);
    const card = new JSDOM(`<ul>${event.data.html as string}</ul>`).window.document;
    expect(card.querySelector(".card-label")!.textContent).toBe("Concert ticket");
    expect(card.querySelector("svg.sketch path")).not.toBeNull();
    expect(card.querySelector("svg.seal")).not.toBeNull();
    expect(event.data.cabinet).toBe("10-plus");
    stream.close();
  });

  it("replays what a tab missed, from the page it loaded or the last event it saw", async () => {
    // The page is the snapshot; anything after its sequence number comes
    // from the stream, so nothing published in between is lost.
    const since = await seqOf();
    const owner = await newHand();
    const id = await published(owner);
    await fetch(url(`/api/exhibits/${id}/withdraw`), { method: "POST", headers: { Cookie: owner } });

    const late = await openStream(`/api/museum/stream?since=${since}`);
    const added = await late.next((e) => e.event === "withdraw" && e.data.id === id);
    expect(added).toBeTruthy();
    // The withdrawn exhibit's content is gone, so its addition isn't replayed,
    // and the withdrawal carries the cabinet's real count rather than asking
    // the tab to subtract one it never added.
    expect(late.seen.some((e) => e.event === "add" && e.data.id === id)).toBe(false);
    const shown = (await page("/")).doc.querySelector('.cabinet[data-cabinet="10-plus"] .count')!;
    expect(added.data.count).toBe(Number(shown.getAttribute("data-count")));
    late.close();

    const other = await published(await newHand());
    const res = await fetch(url("/api/museum/stream"), {
      headers: { "Last-Event-ID": String(since) },
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
    expect(res?.status).toBe(200);
    const resumed = await openStream(`/api/museum/stream?since=${since}`);
    await resumed.next((e) => e.event === "add" && e.data.id === other);
    resumed.close();
  });
});

group("threads, reports and comparison", () => {
  it("follows a reason thread to another object kept for the same reason", async () => {
    const a = await published(await newHand(), { label: "Grandmother's mug", reason: "comfort" });
    await published(await newHand(), { label: "Friend's ticket", reason: "comfort" });
    const { doc } = await page(objectPath(a));
    const link = doc.querySelector<HTMLAnchorElement>(".threads li:first-child a");
    expect(link).not.toBeNull();
    expect(doc.querySelector(".threads li:first-child")!.textContent).toContain("Both were kept for comfort.");
    const [, other] = link!.getAttribute("href")!.match(/^\/compare\/\d+\/(\d+)\?thread=reason$/)!;
    expect(Number(other)).not.toBe(a);
    expect((await page(objectPath(Number(other)))).doc.querySelector(".exhibit .tag")!.textContent).toBe("Comfort");
  });

  it("matches gestures only within one input method, never the exhibit itself", async () => {
    const path = [stroke(100, 900, 900, 100, 2000)];
    const keyboard = await published(await newHand(), { strokes: path.map((s) => ({ ...s, input: "keyboard" })) });
    const mouse = await published(await newHand(), { strokes: path });
    await published(await newHand(), { strokes: [stroke(120, 880, 880, 120, 2000)] });
    const { doc } = await page(objectPath(mouse));
    const link = doc.querySelector(".threads li:nth-child(2) a");
    expect(link, "a similar mouse sketch exists").not.toBeNull();
    const [, otherId] = link!.getAttribute("href")!.match(/^\/compare\/\d+\/(\d+)\?thread=gesture$/)!;
    expect(Number(otherId)).not.toBe(keyboard);
    expect(Number(otherId)).not.toBe(mouse);
    const compare = await page(link!.getAttribute("href")!);
    expect(compare.doc.querySelector(".thread-why")!.textContent).toMatch(/^Both sketches have/);
    expect([...compare.doc.querySelectorAll(".measures")].map((m) => m.textContent!.match(/InputMouse/))).toEqual([
      expect.anything(),
      expect.anything(),
    ]);
  });

  it("shows a pair as objects or as gestures, without losing the pair", async () => {
    const a = await published(await newHand());
    const b = await published(await newHand());
    for (const view of ["objects", "gestures"]) {
      const { status, doc } = await page(`/compare/${a}/${b}?thread=reason&view=${view}`);
      expect(status).toBe(200);
      expect(doc.getElementById("compare")!.getAttribute("data-view")).toBe(view);
      expect(doc.querySelectorAll(".pair-item")).toHaveLength(2);
      expect(doc.querySelectorAll(".pair-item svg.seal")).toHaveLength(2);
      expect(doc.querySelectorAll(".pair-item .story")).toHaveLength(2);
      expect(doc.querySelector(`.view-switch a[data-view="${view}"]`)!.getAttribute("aria-current")).toBe("true");
    }
  });

  it("takes one report per hand and never removes an exhibit on a report alone", async () => {
    const id = await published(await newHand());
    const reporter = await newHand();
    const report = (cookie: string, reason = "personal") =>
      fetch(url(`/api/exhibits/${id}/report`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ reason }),
      });
    expect((await report(reporter)).status).toBe(201);
    expect(((await (await report(reporter)).json()) as { reported: string }).reported).toBe("already");
    expect((await report(await newHand(), "nonsense")).status).toBe(400);
    for (const body of ["null", "[]", "{", '"spam"']) {
      const res = await fetch(url(`/api/exhibits/${id}/report`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: reporter },
        body,
      });
      expect(res.status, body).toBe(400);
    }
    const bigWithdraw = await fetch(url(`/api/exhibits/${id}/withdraw`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: reporter },
      body: "x".repeat(20_000),
    });
    expect(bigWithdraw.status).toBe(413);
    const { status, doc } = await page(objectPath(id));
    expect(status).toBe(200);
    expect(doc.querySelector(".reported")).not.toBeNull();
    expect(doc.querySelector(".hide-here")).not.toBeNull();
  });

  it("is honest when there's nothing to follow", async () => {
    // Mixed input with a turning profile no one else will share.
    const odd = await published(await newHand(), {
      reason: "usefulness",
      strokes: [stroke(10, 10, 990, 990, 400, "pen"), stroke(990, 10, 10, 990, 30000, "touch")],
    });
    const { doc } = await page(objectPath(odd));
    const gesture = doc.querySelector(".threads li:nth-child(2)")!;
    if (!gesture.querySelector("a")) expect(gesture.querySelector(".none")!.textContent).toMatch(/mixed input|closely/);
  });
});

group("the museum as a whole", () => {
  it("is the home page, with five cabinets and links to the wall and the README", async () => {
    const { doc } = await page("/");
    expect(doc.querySelector("h1")!.textContent).toBe("The Museum of Things We Keep");
    expect([...doc.querySelectorAll(".cabinet h2")].map((h) => h.firstChild!.textContent!.trim())).toEqual([
      "Kept under a year",
      "Kept 1 to under 5 years",
      "Kept 5 to under 10 years",
      "Kept 10 years or more",
      "Time uncertain",
    ]);
    for (const href of ["/wall/", "/readme/", "/contribute/"]) {
      expect(doc.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    }
    expect(doc.querySelector(".legend")).not.toBeNull();
  });

  it("asks for no name, photo or location, and says what will be public", async () => {
    const { doc } = await page("/contribute/");
    const names = [...doc.querySelectorAll("input, textarea")].map((i) => i.getAttribute("name"));
    expect(new Set(names)).toEqual(new Set(["pen", "colour", "label", "story", "duration", "origin", "reason"]));
    expect(doc.querySelector('input[type="file"]')).toBeNull();
    expect(doc.querySelector(".public-note")!.textContent).toMatch(/drawing.*story.*seal/s);
    expect([...doc.querySelectorAll('input[name="duration"]')].map((i) => i.closest("label")!.textContent!.trim())).toEqual([
      "Under 1 year",
      "1 to under 5 years",
      "5 to under 10 years",
      "10 years or more",
      "Not sure",
    ]);
  });

  it("ships only same-origin scripts and styles on every museum page", async () => {
    for (const path of ["/", "/contribute/", "/cabinet/unknown"]) {
      const { doc } = await page(path);
      for (const el of doc.querySelectorAll("script[src], link[rel=stylesheet]")) {
        expect(el.getAttribute("src") ?? el.getAttribute("href")).toMatch(/^\/[a-z]/);
      }
    }
  });
});
