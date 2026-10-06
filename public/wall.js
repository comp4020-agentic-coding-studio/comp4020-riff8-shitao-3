// Captures one pointer gesture on the wall's SVG and posts it as a mark, and
// listens for every hand's marks (including this one's, echoed back) over
// SSE so the wall updates live with no reload. No frameworks: this is the
// whole client.
(() => {
  const script = document.currentScript;
  const svg = document.getElementById("wall");
  const status = document.getElementById("status");
  const handColour = script.dataset.handColour;
  // The pen and colour picker (absent once today's mark is in). Read once a gesture
  // starts and disabled for its length, so what a hand sees chosen is what
  // posts; it only reopens if that gesture is cancelled or refused.
  const tools = document.getElementById("tools");
  const chosen = (name, fallback) =>
    tools?.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
  let pen = "line";
  let colour = handColour;
  // The pen previews draw in whichever colour is picked.
  tools?.addEventListener("change", () => {
    tools.style.setProperty("--ink", chosen("colour", handColour));
  });
  let canDraw = script.dataset.canDraw === "true";
  let points = [];
  let live = null;
  let drawing = false;
  // True from the moment a finished gesture's POST goes out until it
  // settles. Without this, pointerdown doesn't check anything but canDraw
  // (which only flips false on *success*), so a hand could start a second
  // gesture while the first mark's request was still in flight --- both
  // post, the server's one-mark-a-day check correctly rejects the loser,
  // but the single pendingNonce below belongs to whichever gesture started
  // last, orphaning the winner's own nonce and making its own echo draw a
  // visible duplicate of a stroke already on the wall.
  let submitting = false;
  // The nonce of the mark this tab just posted, so its own echo over SSE
  // draws nothing twice --- the gesture is already on the wall as `live`. A
  // second open tab for the *same* hand has no `live` element and still
  // needs the echo. Set synchronously before the POST even goes out (not
  // after it resolves), and compared by this opaque token rather than path
  // content: two different hands can draw byte-identical short strokes, and
  // the SSE push for this tab's own mark can genuinely arrive before its own
  // fetch's promise resolves.
  let pendingNonce = null;

  const toViewBox = (evt) => {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = ((evt.clientX - rect.left) / rect.width) * vb.width + vb.x;
    const y = ((evt.clientY - rect.top) / rect.height) * vb.height + vb.y;
    return [Math.round(x), Math.round(y)];
  };

  const pathFrom = (pts) => pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");

  const appendStroke = (path, colour, markPen) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path);
    p.setAttribute("stroke", colour);
    p.setAttribute("class", `pen-${markPen ?? "line"}`);
    // Under this hand's own strokes, which the server paints last.
    svg.insertBefore(p, svg.querySelector(".halo, .mine"));
  };

  // The stroke being drawn, over its halo, mirroring what the server renders
  // for a hand's own marks.
  let halo = null;

  const beginGesture = (point) => {
    drawing = true;
    points = [point];
    pen = chosen("pen", "line");
    colour = chosen("colour", handColour);
    if (tools) tools.disabled = true;
    halo = document.createElementNS("http://www.w3.org/2000/svg", "path");
    halo.setAttribute("class", `halo pen-${pen}`);
    live = document.createElementNS("http://www.w3.org/2000/svg", "path");
    live.setAttribute("stroke", colour);
    live.setAttribute("class", `mine pen-${pen}`);
    svg.append(halo, live);
  };

  const addPoint = (point) => {
    points.push(point);
    halo.setAttribute("d", pathFrom(points));
    live.setAttribute("d", pathFrom(points));
  };

  const dropLive = () => {
    halo?.remove();
    live?.remove();
    if (tools) tools.disabled = false;
  };

  if (canDraw) {
    svg.addEventListener("pointerdown", (evt) => {
      if (!canDraw || submitting) return;
      beginGesture(toViewBox(evt));
      svg.setPointerCapture(evt.pointerId);
    });

    svg.addEventListener("pointermove", (evt) => {
      if (!drawing) return;
      addPoint(toViewBox(evt));
    });

    const finish = async () => {
      if (!drawing) return;
      drawing = false;
      if (points.length < 2) {
        dropLive();
        return;
      }
      const path = pathFrom(points);
      // Chosen and recorded before the fetch is even issued, so the echo
      // check below is already armed no matter which I/O completes first.
      const nonce = crypto.randomUUID();
      pendingNonce = nonce;
      submitting = true;
      status.textContent = "Adding your mark…";
      try {
        const res = await fetch("/api/marks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, nonce, pen, colour }),
        });
        if (!res.ok) {
          const text = await res.text();
          status.textContent = text || "That mark wasn't accepted.";
          dropLive();
          pendingNonce = null;
          return;
        }
        canDraw = false;
        // The picker stays where it is, locked, so the wall doesn't jump
        // under the stroke just drawn; it just stops asking for one.
        const legend = tools?.querySelector("legend");
        if (legend) legend.textContent = "Today's mark is in, drawn with this pen and colour.";
        status.textContent =
          "Your mark is on the wall: the stroke on top, ringed by a clear band. You can add another in 24 hours.";
      } catch {
        status.textContent = "Couldn't reach the wall --- try again.";
        dropLive();
        pendingNonce = null;
      } finally {
        submitting = false;
      }
    };

    svg.addEventListener("pointerup", finish);
    svg.addEventListener("pointercancel", finish);

    // A pointer is the only way to draw unless this exists: Enter/Space
    // starts a gesture at the wall's centre, the arrow keys add a point each
    // in that direction (mirroring pointermove), and Enter/Space again hands
    // off to the same finish() a pointer gesture uses. Escape cancels before
    // anything is sent, the same way lifting a pointer after barely moving
    // does (finish() drops any gesture under two points).
    const STEP = 30;
    const ARROW_DELTAS = {
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
    };
    svg.addEventListener("keydown", (evt) => {
      if (!canDraw || submitting) return;
      if (!drawing) {
        if (evt.key !== "Enter" && evt.key !== " ") return;
        evt.preventDefault();
        const vb = svg.viewBox.baseVal;
        beginGesture([Math.round(vb.x + vb.width / 2), Math.round(vb.y + vb.height / 2)]);
        return;
      }
      if (evt.key in ARROW_DELTAS) {
        evt.preventDefault();
        const [dx, dy] = ARROW_DELTAS[evt.key];
        const [x, y] = points[points.length - 1];
        addPoint([x + dx, y + dy]);
        return;
      }
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        finish();
        return;
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        drawing = false;
        dropLive();
      }
    });
  }

  const stream = new EventSource("/api/marks/stream");
  stream.addEventListener("mark", (evt) => {
    const mark = JSON.parse(evt.data);
    if (mark.nonce && mark.nonce === pendingNonce) {
      pendingNonce = null;
      return;
    }
    appendStroke(mark.path, mark.colour, mark.pen);
  });
})();
