import { configure, itemHTML, detailHTML, dayLabel, esc, caseHref } from "./render.js";

const dataEl = document.getElementById("page-data");
const DATA = dataEl ? JSON.parse(dataEl.textContent) : { cases: [], base: "/", today: "", platforms: {}, repo: "" };
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
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
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
  document.querySelectorAll("[data-sort]").forEach((b) => b.classList.toggle("is-on", b.dataset.sort === state.sort));
  document.querySelectorAll("[data-chip]").forEach((b) => b.classList.toggle("is-on", b.dataset.chip === state.chip));
  const savedChip = $('[data-chip="saved"]');
  if (savedChip) savedChip.textContent = `Saved ${saved.size}`;
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
      html += itemHTML(c, { saved: saved.has(c.id) });
    }
    html += "</ul>";
  } else {
    html += `<ul class="items">${list.map((c) => itemHTML(c, { saved: saved.has(c.id) })).join("")}</ul>`;
  }
  results.innerHTML = html + "</div>";
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
  const url = new URL(c ? caseHref(c) : location.pathname, location.origin).href;
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
function openDetail(id) {
  const c = byId.get(id);
  if (!c || !dialog) return false;
  $("#detail-body").innerHTML = detailHTML(c);
  dialog.showModal();
  return true;
}
dialog?.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

// ---------- global click handling ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return closeMenu();
  const d = t.dataset;
  if (!d.share && !t.closest(".menu")) closeMenu();

  if (d.open) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (openDetail(d.open)) e.preventDefault();
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
    else if (sections) {
      const chip = $('[data-chip="saved"]');
      if (chip) chip.textContent = `Saved ${saved.size}`;
    }
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
readURL();
syncSaved();
renderHome();
