// The museum's pages, live: new exhibits arrive on the shelves and
// withdrawn ones leave, without a reload and without moving whatever the
// visitor is looking at. Also hide-on-this-device, reporting, withdrawal
// and the comparison's two views. Every card's HTML comes from the server,
// already escaped; nothing visitor-written is turned into markup here.

const HIDDEN_KEY = "trace-hidden-exhibits";
const main = document.querySelector("#museum, #exhibit, #compare");
const live = document.querySelector(".live");

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const hiddenIds = () => {
  try {
    return new Set(JSON.parse(storage?.getItem(HIDDEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
};
const saveHidden = (ids) => storage?.setItem(HIDDEN_KEY, JSON.stringify([...ids].slice(-500)));

const say = (text) => {
  if (live) live.textContent = text;
};

// --- Shelves. ---

function setCount(cabinet, delta) {
  for (const count of document.querySelectorAll(`.cabinet[data-cabinet="${cabinet}"] .count`)) {
    const n = Math.max(0, Number(count.dataset.count) + delta);
    count.dataset.count = String(n);
    count.textContent = `${n} ${n === 1 ? "object" : "objects"}`;
  }
}

function hideCard(card) {
  card.classList.add("hidden-here");
  if (card.querySelector(".unhide")) return;
  const note = document.createElement("p");
  note.className = "hidden-card-note";
  note.textContent = "Hidden on this device. ";
  const show = document.createElement("button");
  show.type = "button";
  show.className = "unhide";
  show.textContent = "Show";
  show.addEventListener("click", () => {
    const ids = hiddenIds();
    ids.delete(Number(card.dataset.id));
    saveHidden(ids);
    card.classList.remove("hidden-here");
    note.remove();
  });
  note.append(show);
  card.append(note);
}

for (const card of document.querySelectorAll(".exhibit-card")) {
  if (hiddenIds().has(Number(card.dataset.id))) hideCard(card);
}

function addCard(data) {
  if (main.id !== "museum") return;
  setCount(data.cabinet, 1);
  // A paged cabinet view only counts arrivals; its own pages stay put.
  if (main.dataset.paged === "true") return;
  const shelf = document.querySelector(`.cabinet[data-cabinet="${data.cabinet}"] .shelf`);
  if (!shelf || shelf.querySelector(`[data-id="${data.id}"]`)) return;
  const template = document.createElement("template");
  template.innerHTML = data.html.trim();
  const card = template.content.firstElementChild;
  if (!card) return;
  if (data.mine) card.classList.add("mine");
  card.classList.add("arrived");
  // Inserting above the reader would push what they're reading down the
  // page; hold the scroll position so it stays put.
  const before = shelf.getBoundingClientRect().bottom;
  shelf.prepend(card);
  if (before < 0) window.scrollBy(0, shelf.getBoundingClientRect().bottom - before);
  if (hiddenIds().has(data.id)) hideCard(card);
  const label = card.querySelector(".card-label")?.textContent ?? "";
  const cabinet = card.closest(".cabinet")?.querySelector("h1, h2")?.firstChild?.textContent?.trim() ?? "";
  say(`New in ${cabinet}: ${data.accession}, ${label}.`);
}

function removeCard(data) {
  if (main.id === "exhibit" && Number(main.dataset.id) === data.id) {
    for (const part of main.querySelectorAll(".exhibit, .fingerprint, .threads, .owner, .report")) part.remove();
    const note = document.createElement("p");
    note.className = "notice";
    note.textContent = "This exhibit has just been withdrawn, and is no longer in the museum.";
    main.querySelector(".crumbs")?.after(note);
    return;
  }
  if (main.id !== "museum") return;
  setCount(data.cabinet, -1);
  document.querySelector(`.exhibit-card[data-id="${data.id}"]`)?.remove();
}

// --- The stream. ---

let lastSeq = Number(main?.dataset.seq ?? 0);
let stream = null;
let retry = null;

function connect() {
  stream?.close();
  clearTimeout(retry);
  stream = new EventSource(`/api/museum/stream?since=${lastSeq}`);
  const handle = (fn) => (evt) => {
    const data = JSON.parse(evt.data);
    if (data.seq <= lastSeq) return;
    lastSeq = data.seq;
    fn(data);
  };
  stream.addEventListener("add", handle(addCard));
  stream.addEventListener("withdraw", handle(removeCard));
  stream.addEventListener("reset", () => {
    stream.close();
    say("A lot has changed since this page loaded. Reload the page to catch up.");
  });
  // Chrome gives up on a stream whose server went away (a redeploy) instead
  // of retrying; reopen it from the last event seen.
  stream.addEventListener("error", () => {
    if (stream.readyState === EventSource.CLOSED) retry = setTimeout(connect, 2000);
  });
}

if (main && (main.id === "museum" || main.id === "exhibit")) {
  connect();
  // A backgrounded phone can hold a dead connection without an error.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") connect();
  });
}

const params = new URLSearchParams(window.location.search);
if (params.has("withdrawn")) say("Your exhibit has been withdrawn.");

// --- One exhibit. ---

if (main?.id === "exhibit") {
  const id = Number(main.dataset.id);
  const parts = () => main.querySelectorAll(".exhibit, .fingerprint, .threads");
  const hiddenNote = main.querySelector(".hidden-note");
  const setHidden = (hidden) => {
    for (const part of parts()) part.hidden = hidden;
    hiddenNote.hidden = !hidden;
    const ids = hiddenIds();
    if (hidden) ids.add(id);
    else ids.delete(id);
    saveHidden(ids);
  };
  if (hiddenIds().has(id)) setHidden(true);
  main.querySelector(".hide-here")?.addEventListener("click", () => {
    setHidden(true);
    hiddenNote.querySelector("button")?.focus();
  });
  hiddenNote?.querySelector(".unhide")?.addEventListener("click", () => setHidden(false));

  if (params.has("published")) say("Published. This is your exhibit: only this browser marks it as yours.");

  const reportForm = main.querySelector(".report-form");
  const reportStatus = reportForm?.querySelector(".form-status");
  if (params.has("reported") && reportStatus) {
    reportForm.closest("details").open = true;
    reportStatus.textContent = "Thank you. A person will review it.";
  }
  reportForm?.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const reason = reportForm.querySelector("input[name=reason]:checked")?.value;
    if (!reason) {
      reportStatus.textContent = "Choose what's wrong with it first.";
      return;
    }
    try {
      const res = await fetch(reportForm.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      reportStatus.textContent = res.ok
        ? body.reported === "already"
          ? "You've already reported this one. It's waiting for review."
          : "Thank you. A person will review it. You can hide it on this device in the meantime."
        : (body.error ?? "That report didn't go through.");
    } catch {
      reportStatus.textContent = "Couldn't reach the museum; try again.";
    }
  });

  const withdrawForm = main.querySelector(".withdraw");
  withdrawForm?.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const button = withdrawForm.querySelector("button");
    if (!withdrawForm.dataset.confirming) {
      withdrawForm.dataset.confirming = "true";
      button.textContent = "Yes, withdraw it for good";
      say("Press again to withdraw this exhibit for good.");
      return;
    }
    button.disabled = true;
    try {
      const res = await fetch(withdrawForm.action, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) {
        window.location.assign("/?withdrawn=1");
        return;
      }
      say("That didn't work. Only the browser that published an exhibit can withdraw it.");
    } catch {
      say("Couldn't reach the museum; try again.");
    }
    button.disabled = false;
  });
}

// --- The comparison: same pair, two ways of looking. ---

if (main?.id === "compare") {
  for (const link of main.querySelectorAll(".view-switch a")) {
    link.addEventListener("click", (evt) => {
      evt.preventDefault();
      const view = link.dataset.view;
      main.dataset.view = view;
      for (const other of main.querySelectorAll(".view-switch a")) {
        if (other === link) other.setAttribute("aria-current", "true");
        else other.removeAttribute("aria-current");
      }
      main.classList.remove("reveal");
      void main.offsetWidth;
      main.classList.add("reveal");
      const url = new URL(window.location.href);
      url.searchParams.set("view", view);
      window.history.replaceState(null, "", url);
    });
  }
}
