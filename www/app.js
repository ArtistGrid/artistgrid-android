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

// ---------- i18n (follows the device language) ----------
const I18N = {
  en: {
    back: "Back", prev: "Previous", next: "Next", playPause: "Play/Pause", favorite: "Favorite", play: "Play",
    tabAll: "Artists", tabBest: "Top", tabUpdated: "Updated", tabFav: "Favorites",
    titleBest: "Recommended", titleUpdated: "Recently updated",
    favAdded: "Added to favorites", favRemoved: "Removed from favorites", retry: "Retry",
    artistsOffline: "Artist list offline (saved copy)", loadingArtists: "Loading artists…",
    artistsError: "Couldn't load the artist list.", searchArtist: "Search artists…",
    nArtists: ["{n} artist", "{n} artists"], noFavs: "No favorites yet: open an artist and tap ♥.", noResults: "No results.",
    artistNotFound: "Artist not found.", loadingTracker: "Loading tracker…",
    trackerError: "Couldn't load the tracker. Check your connection.", trackerOffline: "Offline: cached tracker",
    nTracks: ["{n} track", "{n} tracks"], nEras: ["{n} era", "{n} eras"], updatedOn: "upd. {d}", trackerBy: "Tracker by {c}",
    searchTracks: ["Search {n} track…", "Search {n} tracks…"],
    fAll: "All", fPlay: "▶ Playable", fFull: "Full", fSnippet: "Snippet",
    emptyTab: "No data in this tab.", noTracks: "No tracks.", nResults: ["{n} result", "{n} results"],
    showMore: "Show more ({n})", cantPlay: "Can't play this track", audioError: "Error loading audio",
  },
  it: {
    back: "Indietro", prev: "Precedente", next: "Successivo", playPause: "Play/Pausa", favorite: "Preferito", play: "Riproduci",
    tabAll: "Artisti", tabBest: "Top", tabUpdated: "Recenti", tabFav: "Preferiti",
    titleBest: "Consigliati", titleUpdated: "Aggiornati di recente",
    favAdded: "Aggiunto ai preferiti", favRemoved: "Rimosso dai preferiti", retry: "Riprova",
    artistsOffline: "Lista artisti offline (copia salvata)", loadingArtists: "Carico gli artisti…",
    artistsError: "Impossibile caricare la lista artisti.", searchArtist: "Cerca un artista…",
    nArtists: ["{n} artista", "{n} artisti"], noFavs: "Nessun preferito: apri un artista e tocca ♥.", noResults: "Nessun risultato.",
    artistNotFound: "Artista non trovato.", loadingTracker: "Carico il tracker…",
    trackerError: "Impossibile caricare il tracker. Controlla la connessione.", trackerOffline: "Offline: tracker in cache",
    nTracks: ["{n} brano", "{n} brani"], nEras: ["{n} era", "{n} ere"], updatedOn: "agg. {d}", trackerBy: "Tracker di {c}",
    searchTracks: ["Cerca in {n} brano…", "Cerca in {n} brani…"],
    fAll: "Tutti", fPlay: "▶ Ascoltabili", fFull: "Full", fSnippet: "Snippet",
    emptyTab: "Nessun dato in questa scheda.", noTracks: "Nessun brano.", nResults: ["{n} risultato", "{n} risultati"],
    showMore: "Mostra altri ({n})", cantPlay: "Impossibile riprodurre questo brano", audioError: "Errore nel caricamento audio",
  },
  es: {
    back: "Atrás", prev: "Anterior", next: "Siguiente", playPause: "Reproducir/Pausa", favorite: "Favorito", play: "Reproducir",
    tabAll: "Artistas", tabBest: "Top", tabUpdated: "Recientes", tabFav: "Favoritos",
    titleBest: "Recomendados", titleUpdated: "Actualizados",
    favAdded: "Añadido a favoritos", favRemoved: "Eliminado de favoritos", retry: "Reintentar",
    artistsOffline: "Lista de artistas sin conexión (copia guardada)", loadingArtists: "Cargando artistas…",
    artistsError: "No se pudo cargar la lista de artistas.", searchArtist: "Buscar artistas…",
    nArtists: ["{n} artista", "{n} artistas"], noFavs: "Aún no hay favoritos: abre un artista y toca ♥.", noResults: "Sin resultados.",
    artistNotFound: "Artista no encontrado.", loadingTracker: "Cargando tracker…",
    trackerError: "No se pudo cargar el tracker. Revisa tu conexión.", trackerOffline: "Sin conexión: tracker en caché",
    nTracks: ["{n} canción", "{n} canciones"], nEras: ["{n} era", "{n} eras"], updatedOn: "act. {d}", trackerBy: "Tracker de {c}",
    searchTracks: ["Buscar en {n} canción…", "Buscar en {n} canciones…"],
    fAll: "Todo", fPlay: "▶ Reproducibles", fFull: "Full", fSnippet: "Snippet",
    emptyTab: "No hay datos en esta pestaña.", noTracks: "No hay canciones.", nResults: ["{n} resultado", "{n} resultados"],
    showMore: "Mostrar más ({n})", cantPlay: "No se puede reproducir esta canción", audioError: "Error al cargar el audio",
  },
  fr: {
    back: "Retour", prev: "Précédent", next: "Suivant", playPause: "Lecture/Pause", favorite: "Favori", play: "Lire",
    tabAll: "Artistes", tabBest: "Top", tabUpdated: "Récents", tabFav: "Favoris",
    titleBest: "Recommandés", titleUpdated: "Mis à jour",
    favAdded: "Ajouté aux favoris", favRemoved: "Retiré des favoris", retry: "Réessayer",
    artistsOffline: "Liste des artistes hors ligne (copie enregistrée)", loadingArtists: "Chargement des artistes…",
    artistsError: "Impossible de charger la liste des artistes.", searchArtist: "Rechercher un artiste…",
    nArtists: ["{n} artiste", "{n} artistes"], noFavs: "Aucun favori : ouvrez un artiste et touchez ♥.", noResults: "Aucun résultat.",
    artistNotFound: "Artiste introuvable.", loadingTracker: "Chargement du tracker…",
    trackerError: "Impossible de charger le tracker. Vérifiez votre connexion.", trackerOffline: "Hors ligne : tracker en cache",
    nTracks: ["{n} titre", "{n} titres"], nEras: ["{n} ère", "{n} ères"], updatedOn: "maj {d}", trackerBy: "Tracker par {c}",
    searchTracks: ["Rechercher dans {n} titre…", "Rechercher dans {n} titres…"],
    fAll: "Tout", fPlay: "▶ Écoutables", fFull: "Full", fSnippet: "Snippet",
    emptyTab: "Aucune donnée dans cet onglet.", noTracks: "Aucun titre.", nResults: ["{n} résultat", "{n} résultats"],
    showMore: "Afficher plus ({n})", cantPlay: "Impossible de lire ce titre", audioError: "Erreur de chargement audio",
  },
  de: {
    back: "Zurück", prev: "Zurück", next: "Weiter", playPause: "Wiedergabe/Pause", favorite: "Favorit", play: "Abspielen",
    tabAll: "Künstler", tabBest: "Top", tabUpdated: "Neu", tabFav: "Favoriten",
    titleBest: "Empfohlen", titleUpdated: "Kürzlich aktualisiert",
    favAdded: "Zu Favoriten hinzugefügt", favRemoved: "Aus Favoriten entfernt", retry: "Erneut versuchen",
    artistsOffline: "Künstlerliste offline (gespeicherte Kopie)", loadingArtists: "Künstler werden geladen…",
    artistsError: "Künstlerliste konnte nicht geladen werden.", searchArtist: "Künstler suchen…",
    nArtists: ["{n} Künstler", "{n} Künstler"], noFavs: "Noch keine Favoriten: Öffne einen Künstler und tippe auf ♥.", noResults: "Keine Ergebnisse.",
    artistNotFound: "Künstler nicht gefunden.", loadingTracker: "Tracker wird geladen…",
    trackerError: "Tracker konnte nicht geladen werden. Prüfe deine Verbindung.", trackerOffline: "Offline: Tracker aus dem Cache",
    nTracks: ["{n} Titel", "{n} Titel"], nEras: ["{n} Ära", "{n} Ären"], updatedOn: "akt. {d}", trackerBy: "Tracker von {c}",
    searchTracks: ["{n} Titel durchsuchen…", "{n} Titel durchsuchen…"],
    fAll: "Alle", fPlay: "▶ Abspielbar", fFull: "Full", fSnippet: "Snippet",
    emptyTab: "Keine Daten in diesem Tab.", noTracks: "Keine Titel.", nResults: ["{n} Ergebnis", "{n} Ergebnisse"],
    showMore: "Mehr anzeigen ({n})", cantPlay: "Dieser Titel kann nicht abgespielt werden", audioError: "Fehler beim Laden des Audios",
  },
  pt: {
    back: "Voltar", prev: "Anterior", next: "Próxima", playPause: "Reproduzir/Pausar", favorite: "Favorito", play: "Reproduzir",
    tabAll: "Artistas", tabBest: "Top", tabUpdated: "Recentes", tabFav: "Favoritos",
    titleBest: "Recomendados", titleUpdated: "Atualizados",
    favAdded: "Adicionado aos favoritos", favRemoved: "Removido dos favoritos", retry: "Tentar novamente",
    artistsOffline: "Lista de artistas offline (cópia salva)", loadingArtists: "Carregando artistas…",
    artistsError: "Não foi possível carregar a lista de artistas.", searchArtist: "Buscar artistas…",
    nArtists: ["{n} artista", "{n} artistas"], noFavs: "Nenhum favorito: abra um artista e toque em ♥.", noResults: "Nenhum resultado.",
    artistNotFound: "Artista não encontrado.", loadingTracker: "Carregando tracker…",
    trackerError: "Não foi possível carregar o tracker. Verifique a conexão.", trackerOffline: "Offline: tracker em cache",
    nTracks: ["{n} faixa", "{n} faixas"], nEras: ["{n} era", "{n} eras"], updatedOn: "atual. {d}", trackerBy: "Tracker de {c}",
    searchTracks: ["Buscar em {n} faixa…", "Buscar em {n} faixas…"],
    fAll: "Tudo", fPlay: "▶ Reproduzíveis", fFull: "Full", fSnippet: "Snippet",
    emptyTab: "Sem dados nesta aba.", noTracks: "Nenhuma faixa.", nResults: ["{n} resultado", "{n} resultados"],
    showMore: "Mostrar mais ({n})", cantPlay: "Não foi possível reproduzir esta faixa", audioError: "Erro ao carregar o áudio",
  },
};
const LOCALE = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
const LANG = I18N[LOCALE.slice(0, 2).toLowerCase()] ? LOCALE.slice(0, 2).toLowerCase() : "en";
const plural = new Intl.PluralRules(LANG);
function L(key, vars = {}) {
  let s = I18N[LANG][key] ?? I18N.en[key] ?? key;
  if (Array.isArray(s)) s = s[plural.select(vars.n ?? 0) === "one" ? 0 : 1];
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
document.documentElement.lang = LANG;
document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = L(el.dataset.i18n)));
document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", L(el.dataset.i18nAria)));

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

// ---------- chrome: bottom dock ----------
const HOME_TITLES = { all: "ArtistGrid", best: "titleBest", updated: "titleUpdated", fav: "tabFav" };
const FILTER_ROUTES = { all: "#/", best: "#/best", updated: "#/updated", fav: "#/fav" };

function setChrome({ artist }) {
  document.body.classList.toggle("in-artist", !!artist);
  document.querySelectorAll("#tabs-bar .tab").forEach((b) => b.classList.toggle("on", b.dataset.f === state.filter));
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

$("#tabs-bar").onclick = (e) => {
  const b = e.target.closest(".tab"); if (!b) return;
  const target = FILTER_ROUTES[b.dataset.f];
  if (location.hash === target || (!location.hash && target === "#/")) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  // switching tabs on the home replaces history so Back leaves the app instead of cycling tabs
  if (!document.body.classList.contains("in-artist")) location.replace(target);
  else location.hash = target;
};
$("#back").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));

function loading(msg) { view.innerHTML = `<div class="state"><div class="spinner"></div>${esc(msg)}</div>`; }
function errorView(msg, retry) {
  view.innerHTML = `<div class="state">${esc(msg)}<br><button class="btn" id="retry">${esc(L("retry"))}</button></div>`;
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
  setChrome({ artist: false });
  if (!state.artists.length) {
    loading(L("loadingArtists"));
    try { await loadArtists(); }
    catch { return errorView(L("artistsError"), () => renderHome(filter)); }
  }
  const title = HOME_TITLES[filter] === "ArtistGrid" ? "ArtistGrid" : L(HOME_TITLES[filter]);
  view.innerHTML = `
    <div class="page-head"><h1>${esc(title)}</h1><span class="count" id="count"></span></div>
    <div class="search-wrap">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input class="search" id="q" type="search" placeholder="${esc(L("searchArtist"))}" value="${esc(state.query)}" autocomplete="off" />
    </div>
    <div class="grid" id="grid" style="margin-top:14px"></div>`;
  const q = $("#q");
  q.oninput = () => { state.query = q.value; drawGrid(); };
  $("#grid").onclick = (e) => {
    const c = e.target.closest(".card"); if (!c) return;
    const a = state.artists[c.dataset.i];
    if (isSheetId(a.url)) location.hash = "#/a/" + encodeURIComponent(a.name);
    else openExternal(/^https?:/.test(a.url) ? a.url : "https://" + a.url);
  };
  drawGrid();
  if (state.homeScroll?.filter === filter) window.scrollTo(0, state.homeScroll.y);
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
    : `<div class="state" style="grid-column:1/-1">${esc(state.filter === "fav" && !qn ? L("noFavs") : L("noResults"))}</div>`;
}

// ---------- artist / tracker ----------
async function renderArtist(name, tabSlug) {
  setChrome({ artist: true });
  try { await loadArtists(); } catch {}
  const a = state.artists.find((x) => x.name === name);
  if (!a) return errorView(L("artistNotFound"), () => route());
  state.artistName = a.name;
  loading(L("loadingTracker"));

  const path = tabSlug ? `/sh/${a.url}/tab/${encodeURIComponent(tabSlug)}` : `/sh/${a.url}/`;
  let res;
  try { res = await cachedJson(TRACKER_API + path, "t:" + a.url + ":" + (tabSlug || "")); }
  catch { return errorView(L("trackerError"), () => renderArtist(name, tabSlug)); }
  if (res.offline) toast(L("trackerOffline"));

  const d = res.data;
  state.tracker = d;
  const eras = (d.eras || []).map((e, i) => ({ ...e, i, tracks: e.tracks || [] }));
  const all = [];
  for (const e of eras) for (const t of e.tracks) all.push({ t, e });
  const curTab = d.tab?.slug || tabSlug || "main";
  const updated = d.last_updated ? new Date(d.last_updated * 1000).toLocaleDateString(LOCALE) : "";
  const credits = Array.isArray(d.credits) ? d.credits.join(", ") : (d.credits || a.credit);

  view.innerHTML = `
    <div class="hero">
      <img src="${slugImg(a.name)}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="info">
        <h2>${esc(a.name)}</h2>
        <p>${L("nTracks", { n: all.length })} · ${L("nEras", { n: eras.length })}${updated ? " · " + L("updatedOn", { d: updated }) : ""}</p>
        ${credits ? `<p>${esc(L("trackerBy", { c: credits }))}</p>` : ""}
      </div>
      <button id="fav-toggle" class="icon-btn round ${favs.has(a.name) ? "on" : ""}" aria-label="${esc(L("favorite"))}">
        <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.5-9.2-8.7A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 9.2 4.9C19 15.5 12 20 12 20z"/></svg>
      </button>
    </div>
    <div class="links-row">
      <a class="pill-link" href="https://docs.google.com/spreadsheets/d/${esc(a.url)}/edit" target="_blank" rel="noopener">Google Sheet ↗</a>
      ${(d.discord || []).slice(0, 1).map((u) => `<a class="pill-link" href="${esc(u)}" target="_blank" rel="noopener">Discord ↗</a>`).join("")}
    </div>
    <div class="chips" id="tabs">
      ${(d.tabs || []).filter((t, i, arr) => arr.findIndex((x) => x.slug === t.slug) === i && !["key", "template"].includes(t.slug))
        .map((t) => `<button class="chip ${t.slug === curTab ? "on" : ""}" data-s="${esc(t.slug)}">${esc(t.name)}</button>`).join("")}
    </div>
    <div class="search-wrap">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input class="search" id="tq" type="search" placeholder="${esc(L("searchTracks", { n: all.length }))}" autocomplete="off" />
    </div>
    <div class="chips" id="tf">
      ${[["all", L("fAll")], ["play", L("fPlay")], ["full", L("fFull")], ["snippet", L("fSnippet")]]
        .map(([k, l], i) => `<button class="chip ${i ? "" : "on"}" data-f="${k}">${l}</button>`).join("")}
    </div>
    <div id="list"></div>`;

  const fav = $("#fav-toggle");
  fav.onclick = () => {
    favs.has(a.name) ? favs.delete(a.name) : favs.add(a.name);
    saveFavs();
    fav.classList.toggle("on", favs.has(a.name));
    fav.classList.remove("pop"); void fav.offsetWidth; fav.classList.add("pop");
    toast(L(favs.has(a.name) ? "favAdded" : "favRemoved"));
  };

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
      list.innerHTML = eras.map((e) => eraHtml(e)).join("") || `<div class="state">${esc(L("emptyTab"))}</div>`;
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
          (e.tracks.length ? "" : `<div class="state">${esc(L("noTracks"))}</div>`);
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
    <button class="play ${cur() && cur().t === t ? "on" : ""}" ${playable ? "" : "disabled"} aria-label="${esc(L("play"))}">
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
  const items = (container?._items || [item]).filter((x) => playableUrl(x.t)).map((x) => ({ ...x, artist: state.artistName }));
  item = items.find((x) => x.t === item.t);
  state.queue = items;
  state.qIndex = Math.max(0, items.indexOf(item));
  startCurrent();
}

function startCurrent() {
  const it = cur(); if (!it) return;
  const { t, e } = it;
  const title = t.name?.title ?? t.name?.raw ?? "";
  audio.src = playableUrl(t);
  audio.play().catch(() => toast(L("cantPlay")));
  $("#player").hidden = false;
  document.body.classList.add("has-player");
  $("#p-title").textContent = title;
  $("#p-sub").textContent = `${it.artist} · ${e.name}`;
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
audio.onerror = () => { if (audio.src) toast(L("audioError")); };
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
  if (!document.body.classList.contains("in-artist") && view.querySelector("#grid")) state.homeScroll = { filter: state.filter, y: window.scrollY };
  window.scrollTo(0, 0);
  if (parts[0] === "a" && parts[1]) renderArtist(parts[1], parts[2]);
  else renderHome(FILTER_ROUTES[parts[0]] ? parts[0] : "all");
}
window.addEventListener("hashchange", route);
route();
