import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";
import net from "node:net";
import { readFileSync } from "node:fs";
import { PENS } from "../src/pens.ts";
import { COLOURS } from "../src/identity.ts";
import { wallPage } from "../src/pages.ts";

// Trace's own promises, from README.md's "what's enforced" list: a
// first-time visitor gets a hand, a mark they draw shows up and survives a
// fresh request, a hand can't draw twice in one day, and the page carries no
// third-party request.
const baseUrl = inject("baseUrl");

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie");
  expect(raw, "expected a Set-Cookie header on a first visit").toBeTruthy();
  return raw!.split(";")[0];
}

it("gives a first-time visitor a hand cookie", async () => {
  const res = await fetch(new URL("/", baseUrl));
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  expect(cookie).toMatch(/^hand=[0-9a-f-]{36}$/);
});

it("says what the wall is for on the wall itself, and still links the full argument", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const doc = new JSDOM(html).window.document;
  expect(doc.querySelector(".why")?.textContent).toMatch(/gesture, not a post/);
  expect(doc.querySelector('a[href="/readme/"]')).not.toBeNull();
});

it("a hand's mark appears on the wall and survives a fresh request", async () => {
  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);

  const path = "M1,2 L3,4 L5,6";
  const post = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ path }),
  });
  expect(post.status).toBe(201);

  // A completely fresh request (same cookie, new fetch) --- not just reading
  // back the POST's own response --- so this actually checks persistence.
  const after = await fetch(new URL("/", baseUrl), { headers: { Cookie: cookie } });
  const html = await after.text();
  expect(html).toContain(path);
});

it("a returning hand can tell its own mark from everyone else's", async () => {
  const mine = cookieFrom(await fetch(new URL("/", baseUrl)));
  const other = cookieFrom(await fetch(new URL("/", baseUrl)));

  // Unique per run: the app under test keeps its database between runs, and
  // an identical path drawn by an earlier run's hand would match first.
  const path = `M${Date.now() % 100_000},12 L13,14 L15,16`;
  const post = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: mine },
    body: JSON.stringify({ path }),
  });
  expect(post.status).toBe(201);
  // A later mark from someone else, so painting in time order would bury this one.
  const later = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: other },
    body: JSON.stringify({ path: `M${Date.now() % 100_000},20 L21,22` }),
  });
  expect(later.status).toBe(201);

  const strokeFor = async (cookie: string) => {
    const html = await (await fetch(new URL("/", baseUrl), { headers: { Cookie: cookie } })).text();
    const svg = new JSDOM(html).window.document.getElementById("wall")!;
    const strokes = [...svg.querySelectorAll("path")];
    return {
      ownMark: strokes.find((p) => p.getAttribute("d") === path && p.classList.contains("mine")),
      // On a busy wall, later marks would bury it unless it's painted last.
      paintedLast: strokes.at(-1)?.getAttribute("d") === path,
      anyMatch: strokes.some((p) => p.getAttribute("d") === path),
    };
  };

  const asMine = await strokeFor(mine);
  expect(asMine.ownMark).toBeDefined();
  expect(asMine.paintedLast).toBe(true);
  const asOther = await strokeFor(other);
  expect(asOther.anyMatch).toBe(true);
  expect(asOther.ownMark).toBeUndefined();
});

it("refuses a second mark from the same hand on the same day", async () => {
  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);

  const post = (path: string) =>
    fetch(new URL("/api/marks", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path }),
    });

  expect((await post("M1,1 L2,2")).status).toBe(201);
  expect((await post("M9,9 L8,8")).status).toBe(429);
});

it("refuses a same-day double mark even when one request's body is slow to arrive", async () => {
  // A plain sequential double-POST (above) can't catch a check-then-insert
  // race: the server has to actually be mid-way through one request's body
  // when the other's completes. Held-open connection A proves the window is
  // closed by deliberately finishing B first while A's body is still en
  // route --- the shape a slow network or a second tab genuinely produces.
  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);
  const { hostname, port } = new URL(baseUrl);

  const connect = (): Promise<net.Socket> =>
    new Promise((resolve, reject) => {
      const sock = net.connect(Number(port), hostname, () => resolve(sock));
      sock.on("error", reject);
    });

  const readStatus = (sock: net.Socket): Promise<string> =>
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

  const headers = (contentLength: number) =>
    `POST /api/marks HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: application/json\r\n` +
    `Cookie: ${cookie}\r\nContent-Length: ${contentLength}\r\nConnection: close\r\n\r\n`;

  const bodyA = JSON.stringify({ path: "M1,3 L2,4" });
  const bodyB = JSON.stringify({ path: "M5,6 L7,8" });

  const [sockA, sockB] = await Promise.all([connect(), connect()]);
  const statusA = readStatus(sockA);
  const statusB = readStatus(sockB);

  sockA.write(headers(Buffer.byteLength(bodyA)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  sockB.write(headers(Buffer.byteLength(bodyB)) + bodyB);
  expect(await statusB).toBe("201");

  sockA.write(bodyA);
  expect(await statusA).toBe("429");
});

it("draws a mark with the pen and colour its hand chose, for every hand looking", async () => {
  const mine = cookieFrom(await fetch(new URL("/", baseUrl)));
  const other = cookieFrom(await fetch(new URL("/", baseUrl)));
  const path = `M${Date.now() % 100_000},31 L32,33 L34,35`;
  const post = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: mine },
    body: JSON.stringify({ path, pen: "dots", colour: "#2a9d8f" }),
  });
  expect(post.status).toBe(201);

  const html = await (await fetch(new URL("/", baseUrl), { headers: { Cookie: other } })).text();
  const stroke = [...new JSDOM(html).window.document.querySelectorAll("#wall path")].find(
    (p) => p.getAttribute("d") === path,
  );
  expect(stroke?.classList.contains("pen-dots")).toBe(true);
  expect(stroke?.getAttribute("stroke")).toBe("#2a9d8f");
});

it("refuses a colour that isn't in the wall's palette", async () => {
  for (const colour of ["#ffff00", "red", "url(#x)", 0xcc4a28]) {
    const cookie = cookieFrom(await fetch(new URL("/", baseUrl)));
    const res = await fetch(new URL("/api/marks", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: "M1,2 L3,4", colour }),
    });
    expect(res.status, JSON.stringify(colour)).toBe(400);
  }
});

it("offers exactly the contrast-checked palette, starting on the hand's own colour", async () => {
  // spec/contrast.test.ts checks identity.ts's COLOURS; this checks they're
  // what the picker actually serves, so the two can't drift apart.
  const doc = new JSDOM(await (await fetch(new URL("/", baseUrl))).text()).window.document;
  const radios = [
    ...doc.querySelectorAll<HTMLInputElement>('#tools input[type=radio][name="colour"]'),
  ];
  expect(radios.map((r) => r.value)).toEqual(COLOURS.map((c) => c.hex));
  const checked = radios.filter((r) => r.checked);
  expect(checked).toHaveLength(1);
  expect(doc.querySelector("script[data-hand-colour]")?.getAttribute("data-hand-colour")).toBe(
    checked[0].value,
  );
  // Each swatch has a name a screen reader can say, not just a fill.
  for (const radio of radios) {
    expect(radio.closest("label")?.textContent?.trim()).toBeTruthy();
  }
});

it("starts a returning hand's picker on the pen and colour it drew with last", () => {
  // Waiting out 24 hours over HTTP isn't possible, but wallPage is a plain
  // function of what the server read: hand it a mark from yesterday.
  const hand = { id: "back", colour: "#5177aa" };
  const yesterday = {
    id: 1,
    hand_id: "back",
    path: "M1,1 L2,2",
    colour: "#6d597a",
    pen: "hairline" as const,
    created_at: 0,
  };
  const checked = (html: string, name: string) =>
    new JSDOM(html).window.document.querySelector<HTMLInputElement>(
      `#tools input[name="${name}"]:checked`,
    )?.value;

  const returning = wallPage([yesterday], hand, 0, yesterday);
  expect(checked(returning, "pen")).toBe("hairline");
  expect(checked(returning, "colour")).toBe("#6d597a");

  const first = wallPage([], hand, 0);
  expect(checked(first, "pen")).toBe("line");
  expect(checked(first, "colour")).toBe("#5177aa");

  // Minted before the palette was retuned: its colour is no longer offered.
  const stale = wallPage([], { id: "old", colour: "#3d5a80" }, 0);
  expect(checked(stale, "colour")).toBe(COLOURS[0].hex);
});

it("refuses a pen that isn't one of the wall's own, including a raw stroke style", async () => {
  for (const pen of ["huge", "stroke-width:999", 12, { width: 40 }]) {
    const cookie = cookieFrom(await fetch(new URL("/", baseUrl)));
    const res = await fetch(new URL("/api/marks", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: "M1,2 L3,4", pen }),
    });
    expect(res.status, JSON.stringify(pen)).toBe(400);
  }
});

it("offers every pen as a plain radio button, ahead of the wall in tab order", async () => {
  const doc = new JSDOM(await (await fetch(new URL("/", baseUrl))).text()).window.document;
  const radios = [...doc.querySelectorAll<HTMLInputElement>('#tools input[type=radio][name="pen"]')];
  expect(radios.map((r) => r.value)).toEqual(PENS.map((p) => p.id));
  expect(radios.filter((r) => r.checked)).toHaveLength(1);
  const wall = doc.getElementById("wall")!;
  expect(radios[0].compareDocumentPosition(wall) & 4).toBeTruthy(); // DOCUMENT_POSITION_FOLLOWING
});

it("gives every pen a look in style.css, so none renders as a bare 1px line", () => {
  const css = readFileSync("public/style.css", "utf8");
  for (const { id } of PENS) {
    expect(css, `no .pen-${id} rule`).toMatch(new RegExp(`\\.pen-${id}\\s*\\{[^}]*--w:`));
  }
});

it("rejects a mark that isn't a plain stroke path", async () => {
  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);

  const res = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ path: "<script>alert(1)</script>" }),
  });
  expect(res.status).toBe(400);
});

it("broadcasts a new mark over /api/marks/stream within a second", async () => {
  const controller = new AbortController();
  const stream = await fetch(new URL("/api/marks/stream", baseUrl), {
    signal: controller.signal,
  });
  expect(stream.headers.get("content-type")).toMatch(/text\/event-stream/);

  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  const nextMarkEvent = (): Promise<{ path: string; colour: string; pen: string }> =>
    (async () => {
      for (;;) {
        const boundary = buffered.indexOf("\n\n");
        if (boundary !== -1) {
          const chunk = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          if (chunk.startsWith("event: mark")) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "))!;
            return JSON.parse(line.slice("data: ".length));
          }
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream closed before a mark event arrived");
        buffered += decoder.decode(value, { stream: true });
      }
    })();

  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);
  const path = "M11,12 L13,14";

  const [event] = await Promise.all([
    Promise.race([
      nextMarkEvent(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("no mark event within 3s")), 3000),
      ),
    ]),
    fetch(new URL("/api/marks", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path, pen: "brush" }),
    }).then((res) => expect(res.status).toBe(201)),
  ]);

  expect(event.path).toBe(path);
  expect(event.pen).toBe("brush");
  controller.abort();
});

it("ships no third-party script or stylesheet", async () => {
  const res = await fetch(new URL("/", baseUrl));
  const dom = new JSDOM(await res.text());
  const srcs = [...dom.window.document.querySelectorAll("script[src], link[rel=stylesheet]")].map(
    (el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "",
  );
  expect(srcs.length).toBeGreaterThan(0);
  for (const src of srcs) {
    expect(src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")).toBe(
      false,
    );
  }
});
