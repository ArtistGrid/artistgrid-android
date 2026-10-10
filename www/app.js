"use strict";

const APP_VERSION = "1.3.1";
const REPO = "mattcoc/artistgrid-android";
const ARTISTS_CSV = "https://artists.artistgrid.cx/artists.csv";
const TRACKER_API = "https://trackerapi.artistgrid.cx";
const ASSETS = "https://assets.artistgrid.cx/webp/";
const PAGE = 60; // tracks rendered per batch

// Inside the Android app, /_proxy?u=… is served by MainActivity: it fetches the URL natively
// (no referrer, no CORS), which rescues blocked covers and lets the equalizer process audio.
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const proxied = (u) => "/_proxy?u=" + encodeURIComponent(u);

const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const state = {
  artists: [],
  filter: "all",
  query: "",
  tracker: null,      // current tracker JSON
  artistName: "",
  queue: [],          // playable tracks for the player
  qIndex: -1,
  update: null,       // { version, url } when a newer release exists
};

function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); }
  catch { return null; }
}

// ---------- settings ----------
const EQ_FREQS = [60, 230, 910, 3600, 14000];
const EQ_PRESETS = { flat: [0, 0, 0, 0, 0], bass: [6, 4, 0, 0, 0], vocal: [-2, 0, 3, 4, 1], treble: [0, 0, 0, 3, 6], loud: [5, 2, -1, 2, 5] };
const SPEEDS = [0.75, 1, 1.25, 1.5];
const DEFAULTS = {
  lang: "auto", eqOn: false, eqPreset: "flat", eqGains: [0, 0, 0, 0, 0],
  autoplay: true, speed: 1, compact: false, reduceMotion: false, autoUpdate: true,
};
const settings = { ...DEFAULTS, ...(store("settings") || {}) };
const saveSettings = () => store("settings", settings);
function applyLook() {
  document.body.classList.toggle("compact", settings.compact);
  document.body.classList.toggle("reduce-motion", settings.reduceMotion);
}

// ---------- i18n (device language unless overridden in Settings) ----------
let LANG = "en", LOCALE = "en", plural = new Intl.PluralRules("en");
function setLanguage() {
  const device = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  const pick = settings.lang !== "auto" ? settings.lang : device.slice(0, 2).toLowerCase();
  LANG = I18N[pick] ? pick : "en";
  LOCALE = settings.lang === "auto" && LANG === device.slice(0, 2).toLowerCase() ? device : LANG;
  plural = new Intl.PluralRules(LANG);
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = L(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", L(el.dataset.i18nAria)));
}
function L(key, vars = {}) {
  let s = I18N[LANG][key] ?? I18N.en[key] ?? key;
  if (Array.isArray(s)) s = s[plural.select(vars.n ?? 0) === "one" ? 0 : 1];
  return String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

// ---------- utils ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isSheetId = (u) => /^[A-Za-z0-9_-]{25,}$/.test(u);

function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

// Fades the freshly rendered page in (compositor-only: opacity + transform).
function enter(el = view) {
  if (settings.reduceMotion) return;
  el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" });
}

const favs = new Set(store("favs") || []);
const saveFavs = () => store("favs", [...favs]);

// Large tracker JSON (several MB) lives in IndexedDB for offline use.
const idb = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open("artistgrid", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("cache");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction("cache", mode);
      const req = fn(t.objectStore("cache"));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (k) => tx("readonly", (s) => s.get(k)).catch(() => null),
    set: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => {}),
    count: () => tx("readonly", (s) => s.count()).catch(() => 0),
    clear: () => tx("readwrite", (s) => s.clear()).catch(() => {}),
  };
})();

async function cachedJson(url, key) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = await r.text();
    idb.set(key, text);
    return { data: JSON.parse(text), offline: false };
  } catch (e) {
    const text = await idb.get(key);
    if (text) return { data: JSON.parse(text), offline: true };
    throw e;
  }
}

function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

// ---------- images: fallback chain + placeholders ----------
// Each <img> carries the sources still to try in data-next. A failed load moves to the next one:
// the same URL through the native proxy, alternative file names, then an online lookup
// ("lookup:<kind>:<artist>:<title>" tokens). When nothing is left the image hides and the
// gradient placeholder underneath shows.
const lookupToken = (kind, artist, title = "") => `lookup:${kind}:${encodeURIComponent(artist)}:${encodeURIComponent(title)}`;
function candidates(urls) {
  const out = [];
  for (const u of urls.filter(Boolean)) {
    out.push(u);
    if (NATIVE && /^https?:/.test(u)) out.push(proxied(u));
  }
  return [...new Set(out)];
}
// "data:," fails at once, so an image whose only source is a lookup starts the chain lazily.
const EMPTY_SRC = "data:,";
function imgTag(urls, lazy = true) {
  const list = candidates(urls);
  if (!list.length) return "";
  const first = list[0].startsWith("lookup:") ? EMPTY_SRC : list.shift();
  return `<img ${lazy ? 'loading="lazy"' : ""} decoding="async" referrerpolicy="no-referrer" alt="" src="${esc(first)}" data-next="${esc(list.map(encodeURIComponent).join(" "))}" />`;
}
function setImg(img, urls) {
  const list = candidates(urls);
  img.classList.remove("loaded", "failed");
  img.dataset.next = list.slice(1).map(encodeURIComponent).join(" ");
  if (!list.length) { img.removeAttribute("src"); img.classList.add("failed"); }
  else if (list[0].startsWith("lookup:")) { img.dataset.next = list.map(encodeURIComponent).join(" "); img.src = EMPTY_SRC; }
  else img.src = list[0];
}
function advanceImg(img) {
  const [next, ...rest] = (img.dataset.next || "").split(" ").filter(Boolean);
  if (!next) { img.classList.add("failed"); return; }
  img.dataset.next = rest.join(" ");
  const src = decodeURIComponent(next);
  if (!src.startsWith("lookup:")) { img.src = src; return; }
  const [, kind, artist, title] = src.split(":");
  lookupCover(kind, decodeURIComponent(artist), decodeURIComponent(title)).then((url) => {
    if (!url) return advanceImg(img);
    img.dataset.next = [...(NATIVE ? [proxied(url)] : []).map(encodeURIComponent), ...rest].join(" ");
    img.src = url;
  });
}
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName === "IMG" && "next" in img.dataset) advanceImg(img);
}, true);
document.addEventListener("load", (e) => { if (e.target.tagName === "IMG") e.target.classList.add("loaded"); }, true);

function artistImgs(name) {
  const base = name.toLowerCase();
  return [
    ...[
      base.replace(/[^a-z0-9]/g, ""),
      base.replace(/\$/g, "s").replace(/&/g, "and").replace(/[^a-z0-9]/g, ""),
      norm(base).replace(/[^a-z0-9]/g, ""),
    ].filter((s, i, a) => s && a.indexOf(s) === i).map((s) => ASSETS + s + ".webp"),
    lookupToken("artist", name),
  ];
}
const eraImgs = (era, artist) => [era.cover_art, lookupToken("album", artist, era.name)];

// ---------- cover lookup (Apple Music / Deezer) ----------
// Only results whose artist name matches are accepted, so a missing cover never turns into a
// wrong one. Answers (including "not found") are cached; network errors are not.
const lookupCache = store("cover_cache") || {};
let lookupSaveT;
const saveLookup = () => { clearTimeout(lookupSaveT); lookupSaveT = setTimeout(() => store("cover_cache", lookupCache), 800); };
const nameKey = (s) => norm(s).replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]/g, "");
const sameArtist = (found, wanted) => !!nameKey(wanted) && nameKey(found).includes(nameKey(wanted));
function sameTitle(found, wanted) {
  const f = nameKey(found), w = nameKey(wanted);
  if (!f || !w) return false;
  if (f === w) return true;
  const [short, long] = f.length < w.length ? [f, w] : [w, f];
  return short.length >= 4 && long.startsWith(short);
}
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function findArtistPicture(artist) {
  const d = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}&limit=5`);
  const hit = (d.data || []).find((x) => nameKey(x.name) === nameKey(artist));
  // Deezer's placeholder for artists without a photo has an empty id in the path
  return hit?.picture_xl && !/\/artist\/\/\d/.test(hit.picture_xl) ? hit.picture_xl : "";
}
async function findAlbumCover(artist, title) {
  const clean = title.replace(/\(.*?\)|\[.*?\]/g, "").trim();
  if (!nameKey(clean)) return "";
  try {
    const d = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(artist + " " + clean)}&entity=album&limit=20`);
    const hit = (d.results || []).find((x) => sameArtist(x.artistName, artist) && sameTitle(x.collectionName, clean));
    if (hit?.artworkUrl100) return hit.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb.");
  } catch {}
  const d = await getJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(`artist:"${artist}" album:"${clean}"`)}&limit=10`);
  const hit = (d.data || []).find((x) => sameArtist(x.artist?.name, artist) && sameTitle(x.title, clean));
  return hit?.cover_xl || "";
}
const lookupPending = new Map();
const lookupQueue = [];
let lookupActive = 0;
function pumpLookups() {
  while (lookupActive < 3 && lookupQueue.length) {
    const job = lookupQueue.shift();
    lookupActive++;
    job().finally(() => { lookupActive--; pumpLookups(); });
  }
}
function lookupCover(kind, artist, title) {
  const k = `${kind}:${nameKey(artist)}:${nameKey(title)}`;
  if (k in lookupCache) return Promise.resolve(lookupCache[k]);
  if (lookupPending.has(k)) return lookupPending.get(k);
  const p = new Promise((resolve) => {
    lookupQueue.push(() => (kind === "artist" ? findArtistPicture(artist) : findAlbumCover(artist, title))
      .then((url) => { lookupCache[k] = url; saveLookup(); resolve(url); })
      .catch(() => resolve(""))
      .finally(() => lookupPending.delete(k)));
    pumpLookups();
  });
  lookupPending.set(k, p);
  return p;
}

// Stable gradient per name, so missing covers still look intentional.
function phStyle(seed, color) {
  if (color && /^#[0-9a-f]{3,8}$/i.test(color)) return `--ph:linear-gradient(135deg, ${color}, #111)`;
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `--ph:linear-gradient(135deg, hsl(${h} 45% 28%), hsl(${(h + 40) % 360} 35% 12%))`;
}
const initial = (s) => esc((String(s).trim()[0] || "?").toUpperCase());

// ---------- audio link resolution ----------
function audioUrl(link) {
  const u = link || "";
  let m;
  if ((m = u.match(/pillows\.su\/f\/([a-f0-9]+)/))) return "https://api.pillows.su/api/download/" + m[1];
  if ((m = u.match(/pixeldrain\.com\/[du]\/([a-zA-Z0-9]+)/))) return "https://fuck-unvaulted.artistgrid.cx/" + m[1];
  if ((m = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/))) return "https://fuck-unvaulted.artistgrid.cx/gd/" + m[1];
  return null;
}
function playableUrl(track) {
  for (const l of track.links || []) {
    const a = audioUrl(l.url);
    if (a) return a;
  }
  return null;
}

// ---------- chrome: bottom dock + sticky header ----------
const HOME_TITLES = { all: null, best: "titleBest", updated: "titleUpdated", fav: "tabFav" };
const FILTER_ROUTES = { all: "#/", best: "#/best", updated: "#/updated", fav: "#/fav" };

function setChrome({ sub, tab = state.filter }) {
  document.body.classList.toggle("in-sub", !!sub);
  document.querySelectorAll("#tabs-bar .tab").forEach((b) => b.classList.toggle("on", b.dataset.f === tab));
  $("#lens").classList.toggle("none", !tab);
  moveLens();
}

// Slides the glass lens under the active tab.
function moveLens() {
  const on = $("#tabs-bar .tab.on"), lens = $("#lens");
  if (!on) return;
  lens.style.width = on.offsetWidth + "px";
  lens.style.transform = `translateX(${on.offsetLeft}px)`;
  requestAnimationFrame(() => lens.classList.add("ready"));
}
// the bar resizes while the back button animates in/out
new ResizeObserver(moveLens).observe($("#tabs-bar"));

// The header turns to glass once content scrolls under it (one class toggle per frame at most).
let scrollTick = false;
function onScroll() {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => { document.body.classList.toggle("scrolled", window.scrollY > 4); scrollTick = false; });
}
window.addEventListener("scroll", onScroll, { passive: true });

$("#tabs-bar").onclick = (e) => {
  const b = e.target.closest(".tab"); if (!b) return;
  const target = FILTER_ROUTES[b.dataset.f];
  if (location.hash === target || (!location.hash && target === "#/")) { window.scrollTo({ top: 0, behavior: settings.reduceMotion ? "auto" : "smooth" }); return; }
  // switching tabs on the home replaces history so Back leaves the app instead of cycling tabs
  if (!document.body.classList.contains("in-sub")) location.replace(target);
  else location.hash = target;
};
$("#back").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));

const ICONS = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.5-9.2-8.7A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 9.2 4.9C19 15.5 12 20 12 20z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="check"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};
const searchBox = (id, placeholder, value = "") =>
  `<div class="search-wrap">${ICONS.search}<input class="search" id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off" /></div>`;

function loading(msg) { view.innerHTML = `<div class="state"><div class="spinner"></div>${esc(msg)}</div>`; }
function errorView(msg, retry, head = "") {
  view.innerHTML = `${head}<div class="state">${esc(msg)}<br><button class="btn" id="retry">${esc(L("retry"))}</button></div>`;
  $("#retry").onclick = retry;
}

// ---------- home ----------
async function loadArtists() {
  if (state.artists.length) return;
  let text;
  try {
    const r = await fetch(ARTISTS_CSV);
    if (!r.ok) throw new Error();
    text = await r.text();
    store("artists_csv", text);
  } catch {
    // fall back to the last cached copy, then to the snapshot bundled in the APK
    text = store("artists_csv") || (await fetch("artists.csv").then((r) => r.text()).catch(() => null));
    if (!text) throw new Error("offline");
    toast(L("artistsOffline"));
  }
  state.artists = parseCsv(text).map((a, i) => ({ ...a, idx: i, key: norm(a.name) }));
}

async function renderHome(filter = "all") {
  state.filter = filter;
  setChrome({ sub: false });
  if (!state.artists.length) {
    loading(L("loadingArtists"));
    try { await loadArtists(); }
    catch { return errorView(L("artistsError"), () => renderHome(filter)); }
  }
  const title = HOME_TITLES[filter] ? L(HOME_TITLES[filter]) : "ArtistGrid";
  view.innerHTML = `
    <div class="head">
      <div class="head-row">
        <h1>${esc(title)}</h1>
        <span class="count" id="count"></span>
        <button id="gear" class="icon-btn round ${state.update ? "dot" : ""}" aria-label="${esc(L("settings"))}">${ICONS.gear}</button>
      </div>
      ${searchBox("q", L("searchArtist"), state.query)}
    </div>
    <div class="grid" id="grid"></div>`;
  const q = $("#q");
  q.oninput = () => { state.query = q.value; drawGrid(); };
  $("#gear").onclick = () => (location.hash = "#/settings");
  $("#grid").onclick = (e) => {
    const c = e.target.closest(".card"); if (!c) return;
    const a = state.artists[c.dataset.i];
    if (isSheetId(a.url)) location.hash = "#/a/" + encodeURIComponent(a.name);
    else openExternal(/^https?:/.test(a.url) ? a.url : "https://" + a.url);
  };
  drawGrid();
  if (state.homeScroll?.filter === filter) window.scrollTo(0, state.homeScroll.y);
  enter($("#grid"));
}

function drawGrid() {
  const qn = norm(state.query);
  const list = state.artists.filter((a) => {
    if (qn && !a.key.includes(qn)) return false;
    if (state.filter === "fav") return favs.has(a.name);
    if (state.filter === "best") return a.best === "true";
    if (state.filter === "updated") return a.updated === "1";
    return true;
  });
  $("#count").textContent = L("nArtists", { n: list.length });
  $("#grid").innerHTML = list.length ? list.map((a) => `
    <button class="card" data-i="${a.idx}" style="${phStyle(a.name)}">
      <div class="ph">${initial(a.name)}</div>
      ${imgTag(artistImgs(a.name))}
      <div class="badges">
        ${favs.has(a.name) ? '<span class="badge fav">♥</span>' : ""}
        ${a.best === "true" ? '<span class="badge">★</span>' : ""}
        ${isSheetId(a.url) ? "" : '<span class="badge ext">↗</span>'}
      </div>
      <div class="name">${esc(a.name)}</div>
    </button>`).join("")
    : `<div class="state" style="grid-column:1/-1">${esc(state.filter === "fav" && !qn ? L("noFavs") : L("noResults"))}</div>`;
}

// ---------- artist / tracker ----------
// ---------- tracker data normalisation ----------
// Tabs don't all share one shape: most return eras with tracks, but some (e.g. "Recent")
// return a flat list of tracks, or use other key names. Everything is turned into
// [{ name, cover_art, …, tracks: [track] }] with tracks in the usual track shape.
const TRACK_KEYS = ["links", "link", "url", "urls", "available_length", "quality", "notes", "track_length", "length", "leak_date", "release_date", "type", "file_date"];
const LIST_KEYS = ["tracks", "songs", "rows", "items", "data", "entries", "records"];
const GROUP_KEYS = ["eras", "sections", "groups", "categories", "albums"];
const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);
const looksLikeTrack = (o) => isObj(o) && ("name" in o || "title" in o || "song" in o) && TRACK_KEYS.some((k) => k in o);
const trackList = (a) => Array.isArray(a) && a.length > 0 && a.filter(looksLikeTrack).length * 2 >= a.length ? a.filter(looksLikeTrack) : null;

function normTrack(t) {
  let name = t.name ?? t.title ?? t.song ?? "";
  if (typeof name !== "object" || name === null) name = { title: String(name), raw: String(name) };
  else name = { ...name, title: name.title ?? name.raw ?? "", raw: name.raw ?? name.title ?? "" };
  let links = t.links ?? t.urls ?? t.link ?? t.url ?? [];
  if (!Array.isArray(links)) links = [links];
  links = links.flatMap((l) => {
    if (!l) return [];
    if (typeof l === "string") return l.split(/\s+/).filter((u) => /^https?:\/\//.test(u)).map((url) => ({ url }));
    return l.url ? [{ ...l, url: String(l.url) }] : [];
  });
  const notes = Array.isArray(t.notes) ? t.notes.join("\n") : t.notes;
  return { ...t, name, links, notes };
}

function normalizeEras(d, fallbackName = "") {
  const list = (o) => { for (const k of LIST_KEYS) { const l = trackList(o?.[k]); if (l) return l; } return null; };
  const eraName = (e) => String(e.name ?? e.title ?? e.era ?? "");
  let groups = null;
  for (const k of GROUP_KEYS) {
    if (Array.isArray(d[k]) && d[k].some(isObj)) {
      groups = d[k].filter(isObj).map((e) => ({ ...e, name: eraName(e), tracks: list(e) || [] }));
      break;
    }
  }
  // flat list of tracks at the top level (or the response itself is the list)
  const flat = trackList(d) || list(d);
  if (flat && !(groups && groups.some((g) => g.tracks.length))) {
    // keep the tracker's own grouping when each track says which era it belongs to
    const byEra = new Map();
    for (const t of flat) {
      const key = String(t.era?.name ?? t.era ?? t.section ?? t.album ?? "").trim() || fallbackName;
      if (!byEra.has(key)) byEra.set(key, { name: key, tracks: [] });
      byEra.get(key).tracks.push(t);
    }
    // carry over era details (cover, colour, description) when the response also lists them
    const known = new Map((groups || []).map((g) => [nameKey(g.name), g]));
    groups = [...byEra.values()].map((g) => ({ ...(known.get(nameKey(g.name)) || {}), ...g }));
  }
  if (!groups || !groups.some((g) => g.tracks.length)) {
    // last resort: any list of tracks anywhere in the response, grouped by its parent
    const found = [];
    const walk = (node, parent, depth) => {
      if (depth > 5 || !node || typeof node !== "object") return;
      const l = trackList(node);
      if (l) {
        const era = isObj(parent) && parent !== d ? parent : {};
        found.push({ ...era, name: eraName(era) || fallbackName, tracks: l });
        return;
      }
      for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, Array.isArray(node) ? parent : node, depth + 1);
    };
    walk(d, null, 0);
    if (found.length) groups = found;
  }
  return (groups || []).map((g, i) => ({ ...g, i, tracks: (g.tracks || []).map(normTrack) }));
}

const TRACK_FILTERS = ["all", "play", "full", "snippet"];
const FILTER_LABELS = { all: "fAll", play: "fPlay", full: "fFull", snippet: "fSnippet" };

// The artist page keeps one sticky header (photo, name, favorite, search, filter, sections);
// switching section only reloads what is below it.
async function renderArtist(name, tabSlug) {
  setChrome({ sub: true });
  try { await loadArtists(); } catch {}
  const a = state.artists.find((x) => x.name === name);
  if (!a) {
    return errorView(L("artistNotFound"), () => route(), `<div class="head"><div class="head-row"><h1>${esc(name)}</h1></div></div>`);
  }
  state.artistName = a.name;
  const pic = artistImgs(a.name);
  const ui = { q: "", f: "all", tab: tabSlug || "" };

  view.innerHTML = `
    <div class="backdrop" aria-hidden="true">${imgTag(pic, false)}</div>
    <div class="head artist-head">
      <div class="head-row">
        <div class="thumb avatar" style="${phStyle(a.name)}">${initial(a.name)}${imgTag(pic, false)}</div>
        <div class="titles">
          <h1>${esc(a.name)}</h1>
          <div class="sub" id="a-sub">${esc(L("loadingTracker"))}</div>
        </div>
        <button id="fav-toggle" class="icon-btn round ${favs.has(a.name) ? "on" : ""}" aria-label="${esc(L("favorite"))}">${ICONS.heart}</button>
      </div>
      <div class="search-row">
        ${searchBox("tq", L("search"))}
        <button id="filter-btn" class="icon-btn round" aria-label="${esc(L("filter"))}" aria-haspopup="true">${ICONS.filter}</button>
        <div class="menu glass" id="filter-menu" role="menu" hidden>
          ${TRACK_FILTERS.map((k) => `<button class="menu-item ${k === "all" ? "on" : ""}" role="menuitemradio" data-f="${k}">${esc(L(FILTER_LABELS[k]))}${ICONS.check}</button>`).join("")}
        </div>
      </div>
      <div class="chips sections" id="tabs"></div>
    </div>
    <div id="a-body"><div class="state"><div class="spinner"></div>${esc(L("loadingTracker"))}</div></div>`;

  const fav = $("#fav-toggle");
  fav.onclick = () => {
    favs.has(a.name) ? favs.delete(a.name) : favs.add(a.name);
    saveFavs();
    fav.classList.toggle("on", favs.has(a.name));
    fav.classList.remove("pop"); void fav.offsetWidth; fav.classList.add("pop");
    toast(L(favs.has(a.name) ? "favAdded" : "favRemoved"));
  };

  // filter menu
  const menu = $("#filter-menu"), fbtn = $("#filter-btn");
  const closeMenu = () => { menu.hidden = true; fbtn.classList.remove("open"); };
  fbtn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; fbtn.classList.toggle("open", !menu.hidden); };
  menu.onclick = (e) => {
    const b = e.target.closest(".menu-item"); if (!b) return;
    ui.f = b.dataset.f;
    menu.querySelectorAll(".menu-item").forEach((x) => x.classList.toggle("on", x === b));
    fbtn.classList.toggle("on", ui.f !== "all");
    closeMenu();
    ui.draw?.();
  };
  document.addEventListener("click", function off(e) {
    if (!document.body.contains(menu)) return document.removeEventListener("click", off);
    if (!menu.hidden && !e.target.closest("#filter-menu")) closeMenu();
  });

  $("#tq").oninput = (ev) => { ui.q = norm(ev.target.value.trim()); ui.draw?.(); };

  $("#tabs").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b || b.classList.contains("on")) return;
    $("#tabs").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    // update the URL without a hashchange, so the header (and its scroll) stays put
    history.replaceState(null, "", `#/a/${encodeURIComponent(a.name)}/${encodeURIComponent(b.dataset.s)}`);
    ui.tab = b.dataset.s;
    window.scrollTo(0, 0);
    loadSection(a, ui);
  };

  await loadSection(a, ui);
}

async function loadSection(a, ui) {
  const body = $("#a-body");
  const token = (ui.token = {});
  body.innerHTML = `<div class="state"><div class="spinner"></div>${esc(L("loadingTracker"))}</div>`;
  const path = ui.tab ? `/sh/${a.url}/tab/${encodeURIComponent(ui.tab)}` : `/sh/${a.url}/`;
  let res;
  try { res = await cachedJson(TRACKER_API + path, "t:" + a.url + ":" + ui.tab); }
  catch {
    if (ui.token !== token || state.artistName !== a.name) return;
    $("#a-sub").textContent = "";
    body.innerHTML = `<div class="state">${esc(L("trackerError"))}<br><button class="btn" id="retry">${esc(L("retry"))}</button></div>`;
    $("#retry").onclick = () => loadSection(a, ui);
    return;
  }
  if (ui.token !== token || state.artistName !== a.name) return; // navigated away while loading
  if (res.offline) toast(L("trackerOffline"));

  const d = res.data;
  state.tracker = d;
  const tabName = (d.tabs || []).find((t) => t.slug === (d.tab?.slug || ui.tab))?.name || d.tab?.name || "";
  const eras = normalizeEras(d, tabName);
  const all = [];
  for (const e of eras) for (const t of e.tracks) all.push({ t, e });
  const curTab = d.tab?.slug || ui.tab || "";
  const updated = d.last_updated ? new Date(d.last_updated * 1000).toLocaleDateString(LOCALE) : "";
  const credits = Array.isArray(d.credits) ? d.credits.join(", ") : (d.credits || a.credit);

  $("#a-sub").textContent = [L("nTracks", { n: all.length }), L("nEras", { n: eras.length }), updated && L("updatedOn", { d: updated })].filter(Boolean).join(" · ");
  $("#tq").placeholder = L("searchTracks", { n: all.length });

  const tabs = (d.tabs || []).filter((t, i, arr) => arr.findIndex((x) => x.slug === t.slug) === i && !["key", "template"].includes(t.slug));
  const tabsEl = $("#tabs");
  if (!tabsEl.children.length) {
    tabsEl.innerHTML = tabs.map((t, i) => `<button class="chip ${t.slug === curTab || (!curTab && !i) ? "on" : ""}" data-s="${esc(t.slug)}">${esc(t.name)}</button>`).join("");
    tabsEl.hidden = tabs.length < 2;
    const on = tabsEl.querySelector(".chip.on");
    if (on) tabsEl.scrollLeft = on.offsetLeft - (tabsEl.clientWidth - on.offsetWidth) / 2;
  }

  body.innerHTML = `
    <div class="info-block">
      ${credits ? `<p>${esc(L("trackerBy", { c: credits }))}</p>` : ""}
      <div class="links-row">
        <a class="pill-link" href="https://docs.google.com/spreadsheets/d/${esc(a.url)}/edit" target="_blank" rel="noopener">Google Sheet ↗</a>
        ${(d.discord || []).slice(0, 1).map((u) => `<a class="pill-link" href="${esc(u)}" target="_blank" rel="noopener">Discord ↗</a>`).join("")}
      </div>
    </div>
    <div id="list"></div>`;

  // nothing readable in this tab: offer the same tab in the Google Sheet
  const gid = (d.tabs || []).find((t) => t.slug === curTab)?.gid ?? d.tab?.gid;
  const emptyTabHtml = () => `<div class="state">${esc(L("emptyTab"))}<br>
    <a class="btn ghost" style="display:inline-block;margin-top:14px;text-decoration:none" target="_blank" rel="noopener"
      href="https://docs.google.com/spreadsheets/d/${esc(a.url)}/edit${gid != null ? "#gid=" + esc(gid) : ""}">${esc(L("openSheet"))} ↗</a></div>`;

  const matches = ({ t, e }) => {
    const al = norm(t.available_length);
    if (ui.f === "play" && !playableUrl(t)) return false;
    if (ui.f === "full" && !/full|og file/.test(al)) return false;
    if (ui.f === "snippet" && !/snippet|partial/.test(al)) return false;
    if (!ui.q) return true;
    return norm(t.name?.raw ?? t.name).includes(ui.q) || norm(t.notes).includes(ui.q) || norm(e.name).includes(ui.q);
  };

  const list = $("#list");
  ui.draw = () => {
    // while searching/filtering, hide the tracker info so results start right under the header
    view.classList.toggle("searching", !!(ui.q || ui.f !== "all"));
    if (!ui.q && ui.f === "all") {
      list.innerHTML = eras.map((e) => eraHtml(e, a.name)).join("") || emptyTabHtml();
      return;
    }
    renderFlat(list, all.filter(matches));
  };

  list.onclick = (ev) => {
    const head = ev.target.closest(".era-head");
    if (head) {
      const el = head.parentElement, e = eras[el.dataset.e];
      el.classList.toggle("open");
      head.setAttribute("aria-expanded", el.classList.contains("open"));
      const eb = el.querySelector(".era-body");
      if (el.classList.contains("open") && !eb.dataset.ready) {
        eb.dataset.ready = "1";
        eb.innerHTML = (e.description ? `<div class="era-desc">${esc(e.description)}</div>` : "") +
          (e.tracks.length ? "" : `<div class="state">${esc(L("noTracks"))}</div>`);
        appendTracks(eb, e.tracks.map((t) => ({ t, e })), false);
      }
      return;
    }
    const more = ev.target.closest(".more");
    if (more) { more._next(); return; }
    const playBtn = ev.target.closest(".play");
    if (playBtn) { playItem(playBtn.closest(".track")._item, playBtn.closest(".era-body, #list")); return; }
    if (ev.target.closest("a")) return;
    const tr = ev.target.closest(".track");
    if (tr) tr.classList.toggle("expanded");
  };

  ui.draw();
  enter(body);
}

function eraHtml(e, artist) {
  const s = e.stats;
  const sum = s ? [s.og_file && `${s.og_file} OG`, s.full && `${s.full} full`, s.snippet && `${s.snippet} snippet`].filter(Boolean).join(" · ") : "";
  return `
    <div class="era" data-e="${e.i}">
      <button class="era-head" aria-expanded="false">
        <div class="thumb" style="${phStyle(e.name, e.color)}">${initial(e.name)}${imgTag(eraImgs(e, artist))}</div>
        <div class="t"><b>${esc(e.name)}</b><span>${L("nTracks", { n: e.tracks.length })}${sum ? " · " + sum : ""}</span></div>
        <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <div class="era-body"></div>
    </div>`;
}

function renderFlat(list, items) {
  list.innerHTML = `<div class="count">${L("nResults", { n: items.length })}</div><div class="era open"><div class="era-body" data-ready="1"></div></div>`;
  appendTracks(list.querySelector(".era-body"), items, true);
}

// Appends tracks in batches so eras with thousands of rows stay fast.
function appendTracks(container, items, showEra, from = 0) {
  const frag = document.createDocumentFragment();
  for (const it of items.slice(from, from + PAGE)) frag.appendChild(trackEl(it, showEra));
  container.querySelector(":scope > .more")?.remove();
  container.appendChild(frag);
  container._items = items;
  if (from + PAGE < items.length) {
    const m = document.createElement("button");
    m.className = "more";
    m.textContent = L("showMore", { n: items.length - from - PAGE });
    m._next = () => appendTracks(container, items, showEra, from + PAGE);
    container.appendChild(m);
  }
}

function qualityClass(q) {
  const n = norm(q);
  if (/high|cd|lossless|og/.test(n)) return "q-ok";
  if (/low|recording|not available|unavailable/.test(n)) return "q-bad";
  return n ? "q-mid" : "";
}

function trackEl(item, showEra) {
  const { t, e } = item;
  const el = document.createElement("div");
  el.className = "track";
  el._item = item;
  const title = t.name?.title ?? t.name?.raw ?? t.name ?? "";
  const credits = (t.name?.credits || []).join(" ");
  const playable = !!playableUrl(t);
  const on = cur() && cur().t === t;
  if (on) el.classList.add("playing");
  const tags = [
    t.available_length && `<span class="tag">${esc(t.available_length)}</span>`,
    t.quality && `<span class="tag ${qualityClass(t.quality)}">${esc(t.quality)}</span>`,
    (t.track_length || t.length) && `<span class="tag">${esc(t.track_length || t.length)}</span>`,
    t.type && `<span class="tag">${esc(t.type)}</span>`,
    (t.leak_date || t.release_date) && `<span class="tag">${esc(t.leak_date || t.release_date)}</span>`,
  ].filter(Boolean).join("");
  const links = (t.links || []).filter((l) => l.url).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text || l.url)}</a>`).join("");
  el.innerHTML = `
    <button class="play ${on ? "on" : ""}" ${playable ? "" : "disabled"} aria-label="${esc(L("play"))}">
      <svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>
      <span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <div class="body">
      ${showEra ? `<div class="era-tag">${esc(e.name)}</div>` : ""}
      <div class="tt">${esc(title)}</div>
      ${credits ? `<div class="cr">${esc(credits)}</div>` : ""}
      ${tags ? `<div class="meta">${tags}</div>` : ""}
      ${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ""}
      ${links ? `<div class="lnk">${links}</div>` : ""}
    </div>`;
  return el;
}

// ---------- player + equalizer ----------
// Two elements: "fx" plays through the native proxy (same origin) so Web Audio can apply the
// equalizer; "raw" plays the remote URL directly and is used when the proxy can't serve a track.
const audioFx = $("#audio-fx"), audioRaw = $("#audio-raw");
let audio = NATIVE ? audioFx : audioRaw;
const cur = () => state.queue[state.qIndex];
const eq = { ctx: null, filters: [] };

function ensureEq() {
  if (eq.ctx || !NATIVE || !settings.eqOn) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    eq.ctx = new Ctx();
    let node = eq.ctx.createMediaElementSource(audioFx);
    eq.filters = EQ_FREQS.map((f, i) => {
      const b = eq.ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f; b.Q.value = 1;
      node.connect(b); node = b;
      return b;
    });
    node.connect(eq.ctx.destination);
  } catch { eq.ctx = null; eq.filters = []; }
  applyEq();
}
function applyEq() {
  ensureEq();
  eq.filters.forEach((b, i) => b.gain.setTargetAtTime(settings.eqOn ? settings.eqGains[i] : 0, eq.ctx.currentTime, 0.05));
  if (eq.ctx?.state === "suspended") eq.ctx.resume();
}

function playItem(item, container) {
  const items = (container?._items || [item]).filter((x) => playableUrl(x.t)).map((x) => ({ ...x, artist: state.artistName }));
  state.queue = items;
  state.qIndex = Math.max(0, items.findIndex((x) => x.t === item.t));
  startCurrent();
}

function useElement(el) {
  if (audio !== el) { audio.pause(); audio = el; }
}

function startCurrent(direct = false) {
  const it = cur(); if (!it) return;
  const { t, e } = it;
  const title = t.name?.title ?? t.name?.raw ?? "";
  const url = playableUrl(t);
  useElement(NATIVE && !direct ? audioFx : audioRaw);
  ensureEq();
  if (eq.ctx?.state === "suspended") eq.ctx.resume();
  audio.src = audio === audioFx ? proxied(url) : url;
  audio.playbackRate = settings.speed;
  audio.play().catch(() => {});
  $("#player").hidden = false;
  document.body.classList.add("has-player");
  $("#p-title").textContent = title;
  $("#p-sub").textContent = `${it.artist} · ${e.name}`;
  const thumb = $("#p-thumb");
  thumb.setAttribute("style", phStyle(e.name, e.color));
  setImg($("#p-cover"), [...eraImgs(e, it.artist), ...artistImgs(it.artist)]);
  document.querySelectorAll(".track").forEach((el) => {
    const on = el._item?.t === t;
    el.classList.toggle("playing", on);
    el.querySelector(".play")?.classList.toggle("on", on);
  });
  if ("mediaSession" in navigator) {
    const art = e.cover_art || artistImgs(it.artist)[0];
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: it.artist, album: e.name, artwork: art ? [{ src: art, sizes: "512x512" }] : [] });
  }
}

function step(dir) {
  if (!state.queue.length) return;
  state.qIndex = (state.qIndex + dir + state.queue.length) % state.queue.length;
  startCurrent();
}

const togglePlay = () => {
  if (eq.ctx?.state === "suspended") eq.ctx.resume();
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
};
$("#p-play").onclick = togglePlay;
// tapping the song in the mini-player opens its artist
$("#p-open").onclick = () => {
  const it = cur(); if (!it?.artist) return;
  const target = "#/a/" + encodeURIComponent(it.artist);
  if (!location.hash.startsWith(target)) location.hash = target;
};
$("#p-next").onclick = () => step(1);
$("#p-prev").onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1));
$("#p-progress").onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  if (audio.duration) audio.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left - 18) / (r.width - 36))) * audio.duration;
};
const playIcon = $("#p-play-icon"), bar = $("#p-bar");
for (const el of [audioFx, audioRaw]) {
  el.ontimeupdate = () => { if (el === audio) bar.style.transform = `scaleX(${el.duration ? el.currentTime / el.duration : 0})`; };
  el.onplay = () => { if (el === audio) { playIcon.setAttribute("d", "M7 4h3v16H7zM14 4h3v16h-3z"); document.body.classList.add("is-playing"); } };
  el.onpause = () => { if (el === audio) { playIcon.setAttribute("d", "M7 4l13 8-13 8z"); document.body.classList.remove("is-playing"); } };
  el.onended = () => { if (el === audio && settings.autoplay) step(1); };
  el.onerror = () => {
    if (el !== audio || !el.getAttribute("src")) return;
    // the proxy couldn't stream it: retry the same track directly (without the equalizer)
    if (el === audioFx) startCurrent(true);
    else toast(L("cantPlay"));
  };
}
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", togglePlay);
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
  navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
}

// ---------- updates ----------
const cmpVer = (a, b) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};
async function checkUpdates() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const rel = await r.json();
  const version = String(rel.tag_name || "").replace(/^v/, "");
  const apk = (rel.assets || []).find((x) => /\.apk$/i.test(x.name));
  state.update = version && cmpVer(version, APP_VERSION) > 0 ? { version, url: apk?.browser_download_url || rel.html_url, page: rel.html_url } : null;
  $("#gear")?.classList.toggle("dot", !!state.update);
  return state.update;
}
async function autoCheckUpdates() {
  if (!settings.autoUpdate) return;
  try {
    const u = await checkUpdates();
    // announce each new version once; the dot on the settings button stays until updated
    if (u && store("update_seen") !== u.version) { toast(L("newVersion", { v: u.version }), 4000); store("update_seen", u.version); }
  } catch {}
}

// ---------- settings ----------
async function renderSettings() {
  setChrome({ sub: true, tab: null });
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? "selected" : ""}>${esc(label)}</option>`;
  const sw = (id, on, dis = false) => `<input type="checkbox" class="switch" id="${id}" ${on ? "checked" : ""} ${dis ? "disabled" : ""} />`;
  const presets = Object.keys(EQ_PRESETS);
  view.innerHTML = `
    <div class="head"><div class="head-row"><h1>${esc(L("settings"))}</h1></div></div>

    <section class="group">
      <h3>${esc(L("language"))}</h3>
      <div class="rows">
        <label class="row"><span class="lbl">${esc(L("language"))}</span>
          <span class="select-wrap"><select class="select" id="s-lang">
            ${opt("auto", L("langAuto"), settings.lang === "auto")}
            ${Object.entries(LANG_NAMES).map(([k, n]) => opt(k, n, settings.lang === k)).join("")}
          </select></span>
        </label>
      </div>
    </section>

    <section class="group">
      <h3>${esc(L("eq"))}</h3>
      <div class="rows ${settings.eqOn ? "" : "eq-off"}" id="eq-rows">
        <label class="row"><span class="lbl">${esc(L("eqEnable"))}</span>${sw("s-eq", settings.eqOn, !NATIVE)}</label>
        <div class="row col">
          <div class="chips eq-presets" id="s-presets">
            ${presets.map((p) => `<button class="chip ${settings.eqPreset === p ? "on" : ""}" data-p="${p}">${esc((I18N[LANG].eqPresets || I18N.en.eqPresets)[p] || p)}</button>`).join("")}
          </div>
          ${EQ_FREQS.map((f, i) => `
            <div class="eq-band">
              <span>${f >= 1000 ? f / 1000 + " kHz" : f + " Hz"}</span>
              <input type="range" min="-12" max="12" step="1" value="${settings.eqGains[i]}" data-b="${i}" aria-label="${f} Hz" />
              <span id="eqv-${i}">${fmtDb(settings.eqGains[i])}</span>
            </div>`).join("")}
        </div>
      </div>
      ${NATIVE ? "" : `<div class="note">${esc(L("eqOnlyApp"))}</div>`}
    </section>

    <section class="group">
      <h3>${esc(L("playback"))}</h3>
      <div class="rows">
        <label class="row"><span class="lbl">${esc(L("autoplay"))}</span>${sw("s-autoplay", settings.autoplay)}</label>
        <div class="row col"><span class="lbl">${esc(L("speed"))}</span>
          <div class="chips" id="s-speed" style="padding-bottom:0">
            ${SPEEDS.map((s) => `<button class="chip ${settings.speed === s ? "on" : ""}" data-s="${s}">${s}×</button>`).join("")}
          </div>
        </div>
      </div>
    </section>

    <section class="group">
      <h3>${esc(L("appearance"))}</h3>
      <div class="rows">
        <label class="row"><span class="lbl">${esc(L("compactGrid"))}</span>${sw("s-compact", settings.compact)}</label>
        <label class="row"><span class="lbl">${esc(L("reduceMotion"))}</span>${sw("s-motion", settings.reduceMotion)}</label>
      </div>
    </section>

    <section class="group">
      <h3>${esc(L("storage"))}</h3>
      <div class="rows">
        <div class="row"><span class="lbl" id="s-cache">…</span><button class="btn ghost" id="s-clear">${esc(L("clearCache"))}</button></div>
      </div>
    </section>

    <section class="group">
      <h3>${esc(L("updates"))}</h3>
      <div class="rows">
        <div class="row">
          <span class="lbl">${esc(L("version", { v: APP_VERSION }))}<small id="s-upd-status">${state.update ? esc(L("updateAvailable", { v: state.update.version })) : ""}</small></span>
          <button class="btn ${state.update ? "" : "ghost"}" id="s-upd">${esc(state.update ? L("download") : L("checkUpdates"))}</button>
        </div>
        <label class="row"><span class="lbl">${esc(L("autoUpdates"))}</span>${sw("s-autoupd", settings.autoUpdate)}</label>
      </div>
    </section>

    <section class="group">
      <h3>${esc(L("about"))}</h3>
      <div class="rows">
        <a class="row" href="https://github.com/${REPO}" target="_blank" rel="noopener"><span class="lbl">${esc(L("sourceCode"))}</span></a>
        <a class="row" href="https://artistgrid.cx" target="_blank" rel="noopener"><span class="lbl">${esc(L("website"))}</span></a>
      </div>
      <div class="note">${esc(L("disclaimer"))}</div>
    </section>`;
  enter();

  const bind = (id, key, after) => { $(id).onchange = (e) => { settings[key] = e.target.checked; saveSettings(); after?.(); }; };
  $("#s-lang").onchange = (e) => { settings.lang = e.target.value; saveSettings(); setLanguage(); renderSettings(); };
  bind("#s-eq", "eqOn", () => { $("#eq-rows").classList.toggle("eq-off", !settings.eqOn); applyEq(); });
  bind("#s-autoplay", "autoplay");
  bind("#s-compact", "compact", applyLook);
  bind("#s-motion", "reduceMotion", applyLook);
  bind("#s-autoupd", "autoUpdate");

  const showGains = () => settings.eqGains.forEach((g, i) => {
    $(`[data-b="${i}"]`).value = g; $(`#eqv-${i}`).textContent = fmtDb(g);
  });
  $("#s-presets").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    settings.eqPreset = b.dataset.p; settings.eqGains = [...EQ_PRESETS[b.dataset.p]];
    $("#s-presets").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    saveSettings(); showGains(); applyEq();
  };
  view.querySelectorAll(".eq-band input").forEach((r) => {
    r.oninput = () => {
      settings.eqGains[r.dataset.b] = +r.value; settings.eqPreset = "custom";
      $(`#eqv-${r.dataset.b}`).textContent = fmtDb(+r.value);
      $("#s-presets").querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
      applyEq();
    };
    r.onchange = saveSettings;
  });
  $("#s-speed").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    settings.speed = +b.dataset.s; saveSettings();
    audio.playbackRate = settings.speed;
    $("#s-speed").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
  };

  const showCache = async () => { $("#s-cache").textContent = L("cacheInfo", { n: await idb.count() }); };
  showCache();
  $("#s-clear").onclick = async () => { await idb.clear(); showCache(); toast(L("cacheCleared")); };

  const upd = $("#s-upd"), status = $("#s-upd-status");
  upd.onclick = async () => {
    if (state.update) return openExternal(state.update.url);
    upd.disabled = true; upd.textContent = L("checking"); status.textContent = "";
    try {
      const u = await checkUpdates();
      status.textContent = u ? L("updateAvailable", { v: u.version }) : L("upToDate");
      upd.textContent = u ? L("download") : L("checkUpdates");
      upd.classList.toggle("ghost", !u);
    } catch {
      status.textContent = L("updateError"); upd.textContent = L("checkUpdates");
    }
    upd.disabled = false;
  };
}
const fmtDb = (g) => (g > 0 ? "+" : "") + g + " dB";

// ---------- external links ----------
function openExternal(url) {
  const a = document.createElement("a");
  a.href = url; a.target = "_blank"; a.rel = "noopener";
  a.click();
}

// ---------- router ----------
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").map(decodeURIComponent);
  if (!document.body.classList.contains("in-sub") && view.querySelector("#grid")) state.homeScroll = { filter: state.filter, y: window.scrollY };
  window.scrollTo(0, 0);
  document.body.classList.remove("scrolled");
  view.classList.remove("searching");
  state.artistName = "";
  if (parts[0] === "a" && parts[1]) renderArtist(parts[1], parts[2]);
  else if (parts[0] === "settings") renderSettings();
  else renderHome(FILTER_ROUTES[parts[0]] ? parts[0] : "all");
}

setLanguage();
applyLook();
window.addEventListener("hashchange", route);
route();
setTimeout(autoCheckUpdates, 1500);
