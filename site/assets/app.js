import { cardHTML, detailHTML, dayLabel, esc } from "./render.js";

const dataEl = document.getElementById("cases-data");
const DATA = dataEl ? JSON.parse(dataEl.textContent) : { cases: [], base: "/", today: "" };
const { cases, base, today } = DATA;
const byId = new Map(cases.map((c) => [c.id, c]));

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const state = {
  q: "",
  domain: null,
  platform: null,
  evidence: null,
  view: "latest", // latest | top | saved
  saved: new Set(store.get("aip.saved", [])),
};

// ---------- URL <-> state ----------
function readURL() {
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") || "";
  state.domain = p.get("domain");
  state.platform = p.get("platform");
  state.evidence = p.get("evidence");
  state.view = ["top", "saved"].includes(p.get("view")) ? p.get("view") : "latest";
}
function writeURL() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.domain) p.set("domain", state.domain);
  if (state.platform) p.set("platform", state.platform);
  if (state.evidence) p.set("evidence", state.evidence);
  if (state.view !== "latest") p.set("view", state.view);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

// ---------- filtering ----------
function matches(c) {
  if (state.domain && c.domain !== state.domain) return false;
  if (state.platform && c.platform !== state.platform) return false;
  if (state.evidence && c.evidence !== state.evidence) return false;
  if (state.view === "saved" && !state.saved.has(c.id)) return false;
  if (state.q) {
    const hay = [c.title, c.summary, c.platform, c.domain, c.agent_role, c.outcome, c.source.name, c.source.author, ...c.tags, ...c.tools]
      .join(" ")
      .toLowerCase();
    return state.q
      .toLowerCase()
      .split(/\s+/)
      .every((w) => hay.includes(w));
  }
  return true;
}

// ---------- rendering ----------
const $ = (sel) => document.querySelector(sel);
const feed = $("#feed");

function render() {
  if (!feed) return syncNav();
  const list = cases.filter(matches);
  if (state.view === "top") list.sort((a, b) => b.score - a.score || b.added.localeCompare(a.added));

  if (list.length === 0) {
    feed.innerHTML = `<div class="empty"><p><strong>No use cases match.</strong></p><p>${
      state.view === "saved" ? "Save entries with the bookmark icon to find them here." : "Try a broader search or clear filters."
    }</p><button class="btn-ghost" data-clear>Clear filters</button></div>`;
  } else if (state.view === "latest") {
    let html = "";
    let day = null;
    for (const c of list) {
      if (c.added !== day) {
        day = c.added;
        html += `<h2 class="day">${esc(dayLabel(day, today))}</h2>`;
      }
      html += cardHTML(c, { base, saved: state.saved.has(c.id) });
    }
    feed.innerHTML = html;
  } else {
    feed.innerHTML = list.map((c) => cardHTML(c, { base, saved: state.saved.has(c.id) })).join("");
  }

  $("#result-count").textContent = `${list.length} use case${list.length === 1 ? "" : "s"}`;
  renderChips();
  syncNav();
  writeURL();
}

function renderChips() {
  const chips = [];
  if (state.q) chips.push(["q", `“${state.q}”`]);
  if (state.domain) chips.push(["domain", state.domain]);
  if (state.platform) chips.push(["platform", state.platform]);
  if (state.evidence) chips.push(["evidence", state.evidence]);
  $("#active-filters").innerHTML = chips
    .map(([k, v]) => `<button class="filter-chip" data-unset="${k}">${esc(v)} <span aria-hidden="true">×</span></button>`)
    .join("");
}

function syncNav() {
  document.querySelectorAll("[data-view]").forEach((el) => el.classList.toggle("is-active", el.dataset.view === state.view));
  document.querySelectorAll("[data-domain]").forEach((el) => el.classList.toggle("is-active", el.dataset.domain === state.domain));
  document.querySelectorAll("[data-platform]").forEach((el) => el.classList.toggle("is-active", el.dataset.platform === state.platform));
  document.querySelectorAll("[data-evidence]").forEach((el) => el.classList.toggle("is-active", el.dataset.evidence === state.evidence));
  $("#saved-count").textContent = state.saved.size || "";
  const search = $("#search");
  if (search && document.activeElement !== search) search.value = state.q;
}

// ---------- detail dialog ----------
const dialog = $("#detail");
function openDetail(id) {
  const c = byId.get(id);
  if (!c) return;
  $("#detail-body").innerHTML = detailHTML(c, { base });
  dialog.showModal();
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;

  if (d.open && byId.has(d.open) && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
    e.preventDefault();
    openDetail(d.open);
  } else if (d.save) {
    state.saved.has(d.save) ? state.saved.delete(d.save) : state.saved.add(d.save);
    store.set("aip.saved", [...state.saved]);
    t.classList.toggle("is-on", state.saved.has(d.save));
    t.setAttribute("aria-pressed", state.saved.has(d.save));
    $("#saved-count").textContent = state.saved.size || "";
    if (state.view === "saved") render();
  } else if (d.copy) {
    const url = new URL(`${base}case/${d.copy}/`, location.origin).href;
    navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => toast(url));
  } else if (d.view) {
    e.preventDefault();
    state.view = d.view;
    closeDrawer();
    render();
    window.scrollTo({ top: 0 });
  } else if ("domain" in d || "platform" in d || "evidence" in d) {
    e.preventDefault();
    const key = "domain" in d ? "domain" : "platform" in d ? "platform" : "evidence";
    state[key] = state[key] === d[key] ? null : d[key];
    closeDrawer();
    render();
  } else if (d.unset) {
    state[d.unset] = d.unset === "q" ? "" : null;
    render();
  } else if ("clear" in d) {
    Object.assign(state, { q: "", domain: null, platform: null, evidence: null, view: "latest" });
    render();
  } else if ("close" in d) {
    dialog.close();
  } else if ("menu" in d) {
    document.body.classList.toggle("drawer-open");
  } else if ("theme" in d) {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("aip.theme", next);
  }
});

dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

let searchTimer;
$("#search")?.addEventListener("input", (e) => {
  state.q = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 120);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.key === "Escape") closeDrawer();
});

function closeDrawer() {
  document.body.classList.remove("drawer-open");
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 1800);
}

readURL();
render();
