import { configure, itemHTML, tileHTML, detailHTML, dayLabel, esc, caseHref, trendingOrder, voteCount } from "./render.js";

const dataEl = document.getElementById("page-data");
const DATA = dataEl ? JSON.parse(dataEl.textContent) : { cases: [], base: "/", today: "", platforms: {}, contact: "" };
configure(DATA);
const byId = new Map(DATA.cases.map((c) => [c.id, c]));
const $ = (s) => document.querySelector(s);

const store = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};
const saved = new Set(store.get("dlg.saved", []));
const voted = new Set(store.get("dlg.votes", []));

// ---------- votes ----------
// With the votes service configured, counts are shared by everyone; without it, a
// vote is remembered in this browser only and the count reflects just that vote.
const API = DATA.votesApi || "";
let counts = {}; // id -> [total, last 24h]
const total = (id) => (API ? counts[id]?.[0] || 0 : voted.has(id) ? 1 : 0);

function syncVotes(root = document) {
  root.querySelectorAll("[data-vote]").forEach((b) => {
    const on = voted.has(b.dataset.vote);
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", on);
  });
  root.querySelectorAll("[data-vote-n]").forEach((el) => (el.textContent = voteCount(total(el.dataset.voteN))));
  root.querySelectorAll("[data-vote-sep]").forEach((el) => (el.hidden = total(el.dataset.voteSep) === 0));
}

async function loadCounts() {
  if (!API) return;
  try {
    const res = await fetch(`${API}/counts`);
    if (!res.ok) return;
    counts = (await res.json()).counts || {};
    syncVotes();
    renderTrending();
  } catch {}
}

async function toggleVote(id) {
  const on = !voted.has(id);
  on ? voted.add(id) : voted.delete(id);
  store.set("dlg.votes", [...voted]);
  if (API) {
    const c = counts[id] || [0, 0];
    counts[id] = [Math.max(0, c[0] + (on ? 1 : -1)), Math.max(0, c[1] + (on ? 1 : -1))];
  }
  syncVotes();
  if (!API) return;
  try {
    const res = await fetch(`${API}/vote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, on }) });
    if (res.ok) {
      const { total: t } = await res.json();
      counts[id] = [t, counts[id]?.[1] || 0];
      syncVotes();
    } else if (res.status === 429) toast("Too many votes, try again later");
  } catch {}
}

// "Trending today": re-ranked by real votes once they are known.
function renderTrending() {
  const grid = $("#trending");
  if (!grid || !DATA.trendingSeed) return;
  const anyRecent = Object.values(counts).some((c) => c[1] > 0);
  if (!anyRecent) return;
  const seed = DATA.trendingSeed.map((id) => byId.get(id)).filter(Boolean);
  grid.innerHTML = trendingOrder(seed, counts).slice(0, grid.children.length || 12).map(tileHTML).join("");
  syncVotes(grid);
}

// ---------- home: search / sort / chips ----------
// With no query and the default view, the curated sections show. Anything
// else swaps them for a flat result list.
const state = { q: "", sort: "top", chip: "all" };
const sections = $("#sections");
const results = $("#results");
const weekAgo = (() => {
  if (!DATA.today) return "";
  const d = new Date(DATA.today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
})();

function readURL() {
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") || "";
  state.sort = p.get("sort") === "new" ? "new" : "top";
  state.chip = ["week", "saved"].includes(p.get("show")) ? p.get("show") : "all";
}
function writeURL() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.sort !== "top") p.set("sort", state.sort);
  if (state.chip !== "all") p.set("show", state.chip);
  const qs = p.toString();
  try {
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  } catch {}
}

function updateSavedChip() {
  const chip = $('[data-chip="saved"]');
  if (!chip) return;
  chip.textContent = `Saved ${saved.size}`;
  chip.hidden = saved.size === 0 && state.chip !== "saved";
}

function filtered() {
  let list = DATA.cases;
  if (state.chip === "week") list = list.filter((c) => c.added >= weekAgo);
  if (state.chip === "saved") list = list.filter((c) => saved.has(c.id));
  if (state.q) {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((c) => {
      const hay = [c.title, c.summary, c.platform, c.domain, c.agent_role, c.outcome, c.source.name, c.source.author, ...c.tags, ...c.tools]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  return [...list].sort((a, b) =>
    state.sort === "new" ? b.added.localeCompare(a.added) || b.score - a.score : b.score - a.score || b.added.localeCompare(a.added),
  );
}

function renderHome() {
  if (!sections || !results) return;
  const press = (b, on) => (b.classList.toggle("is-on", on), b.setAttribute("aria-pressed", on));
  document.querySelectorAll("[data-sort]").forEach((b) => press(b, b.dataset.sort === state.sort));
  document.querySelectorAll("[data-chip]").forEach((b) => press(b, b.dataset.chip === state.chip));
  updateSavedChip();
  const search = $("#search");
  if (search && document.activeElement !== search) search.value = state.q;
  writeURL();

  const browsing = !state.q && state.sort === "top" && state.chip === "all";
  sections.hidden = !browsing;
  results.hidden = browsing;
  if (browsing) return;

  const list = filtered();
  let html = `<div class="section"><div class="section-head"><h2>${list.length} use case${list.length === 1 ? "" : "s"}</h2>${
    state.q ? `<span class="blurb">matching “${esc(state.q)}”</span>` : ""
  }</div>`;
  if (!list.length) {
    html += `<p class="empty">${
      state.chip === "saved" ? "Nothing saved yet. Use the bookmark on any use case." : "No matches."
    } <button data-reset>Show everything</button></p>`;
  } else if (state.sort === "new") {
    let day = null;
    html += '<ul class="items">';
    for (const c of list) {
      if (c.added !== day) {
        day = c.added;
        html += `</ul><p class="mono-label day-head">${esc(dayLabel(day))}</p><ul class="items">`;
      }
      html += itemHTML(c);
    }
    html += "</ul>";
  } else {
    html += `<ul class="items">${list.map((c) => itemHTML(c)).join("")}</ul>`;
  }
  results.innerHTML = html + "</div>";
  syncSaved(results);
  syncVotes(results);
}

let searchTimer;
$("#search")?.addEventListener("input", (e) => {
  state.q = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderHome, 120);
});

// ---------- saved state on server-rendered items ----------
function syncSaved(root = document) {
  root.querySelectorAll("[data-save]").forEach((b) => {
    const on = saved.has(b.dataset.save);
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", on);
    const label = b.querySelector("span");
    if (label) label.textContent = on ? "Saved" : "Save";
  });
}

// ---------- share menu ----------
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.previousElementSibling?.setAttribute("aria-expanded", "false");
  openMenu.remove();
  openMenu = null;
}
function toggleShare(btn) {
  const wasOpen = openMenu && openMenu.previousElementSibling === btn;
  closeMenu();
  if (wasOpen) return;
  const c = byId.get(btn.dataset.share);
  const url = new URL(c ? caseHref(c) : location.href, location.href).href;
  const text = c ? c.title : document.title;
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button role="menuitem" data-copy-url="${esc(url)}">Copy link</button>
    <a role="menuitem" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">Share to X</a>
    <a role="menuitem" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}">Share to LinkedIn</a>`;
  btn.after(menu);
  btn.setAttribute("aria-expanded", "true");
  openMenu = menu;
}

// ---------- detail dialog ----------
const dialog = $("#detail");
let dialogList = []; // ids in the order of the list the dialog was opened from, for "Next"
function openDetail(id, from) {
  const c = byId.get(id);
  if (!c || !dialog) return false;
  if (from) {
    const ul = from.closest("ul");
    const ids = ul ? [...ul.querySelectorAll(":scope > li[data-id]")].map((li) => li.dataset.id) : [];
    dialogList = ids.includes(id) ? ids : DATA.cases.map((x) => x.id);
  }
  const i = dialogList.indexOf(id);
  const next = byId.get(dialogList[i + 1]) || null;
  $("#detail-body").innerHTML = detailHTML(c);
  $("#detail-foot").innerHTML = `<span class="share-wrap share-up"><button type="button" class="btn-outline" data-share="${esc(c.id)}" aria-haspopup="menu" aria-expanded="false">Share</button></span>${
    next ? `<button type="button" class="next" data-next="${esc(next.id)}"><span class="next-label">Next</span><span class="next-title">${esc(next.title)}</span><span aria-hidden="true">→</span></button>` : ""
  }`;
  const page = $("#detail-page");
  if (page) page.href = caseHref(c);
  syncSaved(dialog);
  syncVotes(dialog);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector(".dialog-body").scrollTop = 0;
  return true;
}
dialog?.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

// ---------- global click handling ----------
// Card spotlight: move the glow and the lit edge with the mouse (style.css, "Cards").
document.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType !== "mouse") return;
    const card = e.target.closest?.(".tile, .item");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  },
  { passive: true },
);

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return closeMenu();
  const d = t.dataset;
  if (!d.share && !t.closest(".menu")) closeMenu();

  if (d.open) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (openDetail(d.open, t)) e.preventDefault();
  } else if (d.next) {
    openDetail(d.next);
  } else if (d.vote) {
    toggleVote(d.vote);
  } else if (d.copyPrompt) {
    const c = byId.get(d.copyPrompt);
    if (c?.prompt)
      navigator.clipboard?.writeText(c.prompt).then(
        () => {
          // The pill itself confirms: "Copied" with a check for two seconds.
          const label = t.querySelector("span");
          const icon = t.querySelector("svg path");
          t._icon ??= icon?.getAttribute("d");
          t.classList.add("is-copied");
          if (label) label.textContent = "Copied";
          icon?.setAttribute("d", "m3.5 8.5 3 3 6-7");
          clearTimeout(t._copied);
          t._copied = setTimeout(() => {
            t.classList.remove("is-copied");
            if (label) label.textContent = "Copy prompt";
            if (t._icon) icon?.setAttribute("d", t._icon);
          }, 2000);
        },
        () => toast("Couldn't copy, select the text instead"),
      );
  } else if ("sponsorsClose" in d) {
    document.body.classList.add("sponsors-closed");
    try {
      sessionStorage.setItem("dlg.sponsors", "closed");
    } catch {}
  } else if (d.share) {
    toggleShare(t);
  } else if (d.copyUrl) {
    navigator.clipboard?.writeText(d.copyUrl).then(() => toast("Link copied"), () => toast(d.copyUrl));
    closeMenu();
  } else if (d.save) {
    saved.has(d.save) ? saved.delete(d.save) : saved.add(d.save);
    store.set("dlg.saved", [...saved]);
    syncSaved();
    if (state.chip === "saved") renderHome();
    else updateSavedChip();
  } else if (d.sort) {
    state.sort = d.sort;
    renderHome();
  } else if (d.chip) {
    state.chip = d.chip;
    renderHome();
  } else if ("reset" in d) {
    Object.assign(state, { q: "", sort: "top", chip: "all" });
    renderHome();
  } else if ("close" in d) {
    dialog?.close();
  } else if ("filters" in d) {
    const open = document.body.classList.toggle("filters-open");
    t.setAttribute("aria-expanded", open);
  } else if ("theme" in d) {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    store.set("dlg.theme", next);
  }
});

document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
    const s = $("#search");
    if (s) {
      e.preventDefault();
      s.focus();
    }
  }
  if (e.key === "Escape") closeMenu();
});

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 1800);
}

if (/Mac|iPhone|iPad/.test(navigator.platform) === false) {
  const k = $(".kbd");
  if (k) k.textContent = "Ctrl K";
}
try {
  if (sessionStorage.getItem("dlg.sponsors") === "closed") document.body.classList.add("sponsors-closed");
} catch {}
readURL();
// ---------- live counters ----------
function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  if (!(min >= 0)) return "";
  if (min < 2) return "Updated just now";
  if (min < 60) return `Updated ${min} min ago`;
  const h = Math.round(min / 60);
  return h < 36 ? `Updated ${h} h ago` : `Updated ${Math.round(h / 24)} days ago`;
}
function tickUpdated() {
  document.querySelectorAll("[data-updated]").forEach((el) => {
    const text = ago(el.dataset.updated);
    if (text) el.textContent = text;
  });
}

async function loadStats() {
  if (!API) return;
  try {
    const res = await fetch(`${API}/stats`);
    if (!res.ok) return;
    const st = await res.json();
    document.querySelectorAll('[data-stat="votes24h"]').forEach((el) => {
      el.querySelector("b").textContent = Number(st.votes24h || 0).toLocaleString("en-US");
      el.hidden = !st.votes24h;
    });
    if (st.subscribers >= (DATA.subCountFrom ?? 100))
      document.querySelectorAll("[data-sub-count]").forEach((el) => (el.textContent = `Join ${st.subscribers.toLocaleString("en-US")} readers`));
  } catch {}
}

// ---------- newsletter sign-up ----------
// Posts to the votes service (which hands the address to the email provider). Without
// JavaScript the same form posts normally and the service redirects back here.
const FEED = `${DATA.base}feed.xml`;
const notYet = `Sign-ups open soon. Meanwhile, the <a href="${FEED}">RSS feed</a> has every new use case.`;
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-subscribe]");
  if (!form) return;
  e.preventDefault();
  const note = form.querySelector("[data-sub-note]");
  const button = form.querySelector("button[type=submit]");
  const say = (html, state) => {
    note.innerHTML = html;
    form.dataset.state = state;
  };
  if (!API) return say(notYet, "info");
  button.disabled = true;
  try {
    const res = await fetch(`${API}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email.value, website: form.website.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      form.querySelector(".sub-row").hidden = true;
      say("<b>Almost there.</b> Check your inbox and confirm your address to start getting the email.", "ok");
    } else if (res.status === 503) say(notYet, "info");
    else say(esc(body.error || "That didn't work. Try again in a moment."), "error");
  } catch {
    say("That didn't work. Check your connection and try again.", "error");
  } finally {
    button.disabled = false;
  }
});
if (new URLSearchParams(location.search).get("subscribed") === "1") toast("Check your inbox to confirm your subscription");

// ---------- use case submissions ----------
// Same pattern: posted to the votes service, with a plain form post as the fallback.
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-submit]");
  if (!form || !API) return;
  e.preventDefault();
  const note = form.querySelector("[data-submit-note]");
  const button = form.querySelector("button[type=submit]");
  const say = (html, state) => {
    note.innerHTML = html;
    form.dataset.state = state;
  };
  button.disabled = true;
  try {
    const res = await fetch(`${API}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: form.url.value, note: form.note.value, website: form.website.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      form.reset();
      say("<b>Thanks, got it.</b> It goes through the next daily check. Send another any time.", "ok");
    } else say(esc(body.error || "That didn't work. Try again in a moment."), "error");
  } catch {
    say("That didn't work. Check your connection and try again.", "error");
  } finally {
    button.disabled = false;
  }
});
{
  const sent = new URLSearchParams(location.search).get("submitted");
  const note = document.querySelector("[data-submit-note]");
  if (sent && note) {
    note.innerHTML = sent === "1" ? "<b>Thanks, got it.</b> It goes through the next daily check." : "check the link starts with https:// and try again.";
    note.closest("form").dataset.state = sent === "1" ? "ok" : "error";
  }
}

// ---------- margin texture: a few grid cells that glow and fade ----------
// Each cell fades in and out over 9 s; when it is fully faded it moves to another free cell
// in the margins, so nothing ever jumps while visible. Skipped with reduced motion.
function ambientGrid() {
  const frame = $(".frame");
  if (!frame || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const PITCH = 24, CELLS = 8, PERIOD = 9;
  const layer = document.createElement("div");
  layer.className = "grid-glow";
  layer.setAttribute("aria-hidden", "true");
  document.body.prepend(layer);
  const place = (el) => {
    const { left, right } = frame.getBoundingClientRect();
    const cols = [];
    for (let c = 0; (c + 1) * PITCH <= left - PITCH; c++) cols.push(c); // keep a cell clear of the frame
    for (let c = Math.ceil((right + PITCH) / PITCH); (c + 1) * PITCH <= innerWidth; c++) cols.push(c);
    const rows = Math.floor(innerHeight / PITCH);
    el.hidden = !cols.length || !rows;
    if (el.hidden) return;
    const col = cols[Math.floor(Math.random() * cols.length)];
    const row = Math.floor(Math.random() * rows);
    el.style.transform = `translate(${col * PITCH + 2}px, ${row * PITCH + 2}px)`;
  };
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const el = document.createElement("span");
    el.style.animationDelay = `${(i * PERIOD) / CELLS}s`;
    el.addEventListener("animationiteration", () => place(el));
    layer.append(el);
    place(el);
    return el;
  });
  let t;
  addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => cells.forEach(place), 200);
  });
}

ambientGrid();
syncSaved();
syncVotes();
renderHome();
loadCounts();
loadStats();
tickUpdated();
setInterval(tickUpdated, 60e3);
