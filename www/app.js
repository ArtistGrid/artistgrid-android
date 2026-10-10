"use strict";

const ARTISTS_CSV = "https://artists.artistgrid.cx/artists.csv";
const TRACKER_API = "https://trackerapi.artistgrid.cx";
const ASSETS = "https://assets.artistgrid.cx/webp/";
const PAGE = 60; // tracks rendered per batch

const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const state = {
  artists: [],
  filter: "all",
  query: "",
  tracker: null,      // current tracker JSON
  queue: [],          // playable tracks for the player
  qIndex: -1,
};

// ---------- utils ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugImg = (name) => ASSETS + name.toLowerCase().replace(/[^a-z0-9]/g, "") + ".webp";
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isSheetId = (u) => /^[A-Za-z0-9_-]{25,}$/.test(u);

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
}

function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); }
  catch { return null; }
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

// ---------- header ----------
function setHeader({ title, back, fav }) {
  $("#title").textContent = title;
  $("#back").hidden = !back;
  const f = $("#fav-toggle");
  f.hidden = !fav;
  if (fav) f.classList.toggle("on", favs.has(fav));
  f.onclick = () => {
    favs.has(fav) ? favs.delete(fav) : favs.add(fav);
    saveFavs(); f.classList.toggle("on", favs.has(fav));
    toast(favs.has(fav) ? "Aggiunto ai preferiti" : "Rimosso dai preferiti");
  };
}
$("#back").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));

function loading(msg) { view.innerHTML = `<div class="state"><div class="spinner"></div>${esc(msg)}</div>`; }
function errorView(msg, retry) {
  view.innerHTML = `<div class="state">${esc(msg)}<br><button class="btn" id="retry">Riprova</button></div>`;
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
    toast("Lista artisti offline (copia salvata)");
  }
  state.artists = parseCsv(text).map((a, i) => ({ ...a, idx: i, key: norm(a.name) }));
}

async function renderHome() {
  setHeader({ title: "ArtistGrid" });
  if (!state.artists.length) {
    loading("Carico gli artisti…");
    try { await loadArtists(); }
    catch { return errorView("Impossibile caricare la lista artisti.", renderHome); }
  }
  view.innerHTML = `
    <input class="search" id="q" type="search" placeholder="Cerca un artista…" value="${esc(state.query)}" autocomplete="off" />
    <div class="chips" id="chips">
      ${[["all", "Tutti"], ["fav", "♥ Preferiti"], ["best", "★ Consigliati"], ["updated", "Aggiornati"]]
        .map(([k, l]) => `<button class="chip ${state.filter === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}
    </div>
    <div class="count" id="count"></div>
    <div class="grid" id="grid"></div>`;
  const q = $("#q");
  q.oninput = () => { state.query = q.value; drawGrid(); };
  $("#chips").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.filter = b.dataset.f;
    $("#chips").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    drawGrid();
  };
  $("#grid").onclick = (e) => {
    const c = e.target.closest(".card"); if (!c) return;
    const a = state.artists[c.dataset.i];
    if (isSheetId(a.url)) location.hash = "#/a/" + encodeURIComponent(a.name);
    else openExternal(/^https?:/.test(a.url) ? a.url : "https://" + a.url);
  };
  drawGrid();
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
  $("#count").textContent = `${list.length} artisti`;
  $("#grid").innerHTML = list.length ? list.map((a) => `
    <button class="card" data-i="${a.idx}">
      <div class="ph">${esc(a.name[0] || "?")}</div>
      <img loading="lazy" src="${slugImg(a.name)}" alt="" onerror="this.remove()" />
      <div class="badges">
        ${favs.has(a.name) ? '<span class="badge fav">♥</span>' : ""}
        ${a.best === "true" ? '<span class="badge">★</span>' : ""}
        ${isSheetId(a.url) ? "" : '<span class="badge ext">↗</span>'}
      </div>
      <div class="name">${esc(a.name)}</div>
    </button>`).join("")
    : `<div class="state" style="grid-column:1/-1">${state.filter === "fav" ? "Nessun preferito: apri un artista e tocca ♥." : "Nessun risultato."}</div>`;
}

// ---------- artist / tracker ----------
async function renderArtist(name, tabSlug) {
  try { await loadArtists(); } catch {}
  const a = state.artists.find((x) => x.name === name);
  if (!a) { setHeader({ title: name, back: true }); return errorView("Artista non trovato.", () => route()); }
  setHeader({ title: a.name, back: true, fav: a.name });
  loading("Carico il tracker…");

  const path = tabSlug ? `/sh/${a.url}/tab/${encodeURIComponent(tabSlug)}` : `/sh/${a.url}/`;
  let res;
  try { res = await cachedJson(TRACKER_API + path, "t:" + a.url + ":" + (tabSlug || "")); }
  catch { return errorView("Impossibile caricare il tracker. Controlla la connessione.", () => renderArtist(name, tabSlug)); }
  if (res.offline) toast("Offline: tracker in cache");

  const d = res.data;
  state.tracker = d;
  const eras = (d.eras || []).map((e, i) => ({ ...e, i, tracks: e.tracks || [] }));
  const all = [];
  for (const e of eras) for (const t of e.tracks) all.push({ t, e });
  const curTab = d.tab?.slug || tabSlug || "main";
  const updated = d.last_updated ? new Date(d.last_updated * 1000).toLocaleDateString("it-IT") : "";
  const credits = Array.isArray(d.credits) ? d.credits.join(", ") : (d.credits || a.credit);

  view.innerHTML = `
    <div class="hero">
      <img src="${slugImg(a.name)}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="info">
        <h2>${esc(a.name)}</h2>
        <p>${all.length} brani · ${eras.length} ere${updated ? " · agg. " + updated : ""}</p>
        ${credits ? `<p>Tracker di ${esc(credits)}</p>` : ""}
      </div>
    </div>
    <div class="links-row">
      <a class="pill-link" href="https://docs.google.com/spreadsheets/d/${esc(a.url)}/edit" target="_blank" rel="noopener">Google Sheet ↗</a>
      ${(d.discord || []).slice(0, 1).map((u) => `<a class="pill-link" href="${esc(u)}" target="_blank" rel="noopener">Discord ↗</a>`).join("")}
    </div>
    <div class="chips" id="tabs">
      ${(d.tabs || []).filter((t, i, arr) => arr.findIndex((x) => x.slug === t.slug) === i && !["key", "template"].includes(t.slug))
        .map((t) => `<button class="chip ${t.slug === curTab ? "on" : ""}" data-s="${esc(t.slug)}">${esc(t.name)}</button>`).join("")}
    </div>
    <input class="search" id="tq" type="search" placeholder="Cerca in ${all.length} brani…" autocomplete="off" />
    <div class="chips" id="tf">
      ${[["all", "Tutti"], ["play", "▶ Ascoltabili"], ["full", "Full"], ["snippet", "Snippet"]]
        .map(([k, l], i) => `<button class="chip ${i ? "" : "on"}" data-f="${k}">${l}</button>`).join("")}
    </div>
    <div id="list"></div>`;

  // keep the selected tab visible
  $("#tabs .chip.on")?.scrollIntoView({ inline: "center", block: "nearest" });
  $("#tabs").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b || b.classList.contains("on")) return;
    location.replace(`#/a/${encodeURIComponent(a.name)}/${encodeURIComponent(b.dataset.s)}`);
  };

  let tq = "", tf = "all";
  const matches = ({ t, e }) => {
    const al = norm(t.available_length);
    if (tf === "play" && !playableUrl(t)) return false;
    if (tf === "full" && !/full|og file/.test(al)) return false;
    if (tf === "snippet" && !/snippet|partial/.test(al)) return false;
    if (!tq) return true;
    return norm(t.name?.raw ?? t.name).includes(tq) || norm(t.notes).includes(tq) || norm(e.name).includes(tq);
  };

  const list = $("#list");
  const draw = () => {
    if (!tq && tf === "all") {
      list.innerHTML = eras.map((e) => eraHtml(e)).join("") || `<div class="state">Nessun dato in questa scheda.</div>`;
      return;
    }
    const res = all.filter(matches);
    renderFlat(list, res);
  };
  $("#tq").oninput = (ev) => { tq = norm(ev.target.value.trim()); draw(); };
  $("#tf").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    tf = b.dataset.f;
    $("#tf").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    draw();
  };

  list.onclick = (ev) => {
    const head = ev.target.closest(".era-head");
    if (head) {
      const el = head.parentElement, e = eras[el.dataset.e];
      el.classList.toggle("open");
      const body = el.querySelector(".era-body");
      if (el.classList.contains("open") && !body.dataset.ready) {
        body.dataset.ready = "1";
        body.innerHTML = (e.description ? `<div class="era-desc">${esc(e.description)}</div>` : "") +
          (e.tracks.length ? "" : `<div class="state">Nessun brano.</div>`);
        appendTracks(body, e.tracks.map((t) => ({ t, e })), false);
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

  draw();
}

function eraHtml(e) {
  const s = e.stats;
  const sum = s ? [s.og_file && `${s.og_file} OG`, s.full && `${s.full} full`, s.snippet && `${s.snippet} snippet`].filter(Boolean).join(" · ") : "";
  return `
    <div class="era" data-e="${e.i}">
      <button class="era-head">
        ${e.cover_art ? `<img loading="lazy" src="${esc(e.cover_art)}" alt="" onerror="this.style.visibility='hidden'" />` : `<img alt="" style="background:${esc(e.color || "#1a1a1c")}" />`}
        <div class="t"><b>${esc(e.name)}</b><span>${e.tracks.length} brani${sum ? " · " + sum : ""}</span></div>
        <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <div class="era-body"></div>
    </div>`;
}

function renderFlat(list, items) {
  list.innerHTML = `<div class="count">${items.length} risultati</div><div class="era open"><div class="era-body" data-ready="1"></div></div>`;
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
    m.textContent = `Mostra altri (${items.length - from - PAGE})`;
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
  if (cur() && cur().t === t) el.classList.add("playing");
  const tags = [
    t.available_length && `<span class="tag">${esc(t.available_length)}</span>`,
    t.quality && `<span class="tag ${qualityClass(t.quality)}">${esc(t.quality)}</span>`,
    (t.track_length || t.length) && `<span class="tag">${esc(t.track_length || t.length)}</span>`,
    t.type && `<span class="tag">${esc(t.type)}</span>`,
    (t.leak_date || t.release_date) && `<span class="tag">${esc(t.leak_date || t.release_date)}</span>`,
  ].filter(Boolean).join("");
  const links = (t.links || []).filter((l) => l.url).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text || l.url)}</a>`).join("");
  el.innerHTML = `
    <button class="play ${cur() && cur().t === t ? "on" : ""}" ${playable ? "" : "disabled"} aria-label="Riproduci">
      <svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>
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

// ---------- player ----------
const audio = $("#audio");
const cur = () => state.queue[state.qIndex];

function playItem(item, container) {
  const items = (container?._items || [item]).filter((x) => playableUrl(x.t));
  state.queue = items;
  state.qIndex = Math.max(0, items.indexOf(item));
  startCurrent();
}

function startCurrent() {
  const it = cur(); if (!it) return;
  const { t, e } = it;
  const title = t.name?.title ?? t.name?.raw ?? "";
  audio.src = playableUrl(t);
  audio.play().catch(() => toast("Impossibile riprodurre questo brano"));
  $("#player").hidden = false;
  $("#p-title").textContent = title;
  $("#p-sub").textContent = `${$("#title").textContent} · ${e.name}`;
  const cover = $("#p-cover");
  cover.src = e.cover_art || "";
  cover.style.visibility = e.cover_art ? "visible" : "hidden";
  document.querySelectorAll(".track").forEach((el) => {
    const on = el._item?.t === t;
    el.classList.toggle("playing", on);
    el.querySelector(".play")?.classList.toggle("on", on);
  });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist: $("#p-sub").textContent, artwork: e.cover_art ? [{ src: e.cover_art, sizes: "512x512" }] : [],
    });
  }
}

function step(dir) {
  if (!state.queue.length) return;
  state.qIndex = (state.qIndex + dir + state.queue.length) % state.queue.length;
  startCurrent();
}

$("#p-play").onclick = () => (audio.paused ? audio.play() : audio.pause());
$("#p-next").onclick = () => step(1);
$("#p-prev").onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1));
$("#p-progress").onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  if (audio.duration) audio.currentTime = ((e.clientX - r.left - 12) / (r.width - 24)) * audio.duration;
};
audio.ontimeupdate = () => { $("#p-bar").style.width = audio.duration ? (audio.currentTime / audio.duration) * 100 + "%" : "0"; };
audio.onplay = () => $("#p-play-icon").setAttribute("d", "M7 4h3v16H7zM14 4h3v16h-3z");
audio.onpause = () => $("#p-play-icon").setAttribute("d", "M7 4l13 8-13 8z");
audio.onended = () => step(1);
audio.onerror = () => { if (audio.src) toast("Errore nel caricamento audio"); };
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
  navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
}

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
  window.scrollTo(0, 0);
  if (parts[0] === "a" && parts[1]) renderArtist(parts[1], parts[2]);
  else renderHome();
}
window.addEventListener("hashchange", route);
route();
