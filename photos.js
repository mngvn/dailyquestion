// photos.js — finds a freely licensed photograph of a place to be guessed.
//
// Two sources, tried in order:
//
//   1. Commons geosearch. Files on Wikimedia Commons carry coordinates, so we
//      ask for pictures taken within a few km of the city and pick one. These
//      are ordinary street and neighbourhood photographs rather than the
//      postcard shot, which is what makes them worth guessing from.
//   2. The city's Wikipedia article image, if geosearch finds nothing usable.
//      Usually a skyline, so it is the easier of the two — the fallback, not
//      the first choice.
//
// Licensing guard, same rule as artwork.js: Wikipedia serves freely licensed
// media from Commons (/wikipedia/commons/...) and non-free "fair use" uploads
// from the local wiki. Only the former may be shown on someone else's site, so
// anything not on Commons is rejected.
//
// Everything here is best-effort. If the network is unavailable, or nothing
// suitable comes back, the caller is told so and falls back to the written
// clues — the game still works with no pictures at all.

window.Photos = (function () {
  "use strict";

  const COMMONS = "https://commons.wikimedia.org/w/api.php";
  const WIKI = "https://en.wikipedia.org/w/api.php";
  const CACHE_KEY = "daily.placeimg.v1";
  const RETRY_MS = 7 * 24 * 60 * 60 * 1000;   // re-ask about a miss after a week
  const RADIUS_M = 4000;                       // how close the photo must be taken
  const TIMEOUT = 8000;

  // Commons is full of things that are not photographs of a place. Titles
  // matching any of these are skipped.
  const REJECT = /(map|karte|plan|logo|coat[ _]of[ _]arms|flag|seal|diagram|chart|graph|icon|svg|banner|locator|blazon|emblem|schema|timeline|satellite|topograph)/i;
  const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;

  const isFree = (u) => typeof u === "string" && u.indexOf("/wikipedia/commons/") !== -1;

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCache(c) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
  }

  function fetchJSON(url) {
    if (typeof fetch !== "function") return Promise.resolve(null);
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT) : null;
    const opts = { mode: "cors", credentials: "omit" };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((v) => { if (timer) clearTimeout(timer); return v; });
  }

  function urlFor(base, params) {
    return base + "?" + new URLSearchParams(
      Object.assign({ action: "query", format: "json", origin: "*" }, params)
    ).toString();
  }

  // ---- source 1: pictures taken near the place ----
  function geoCandidates(place) {
    return fetchJSON(urlFor(COMMONS, {
      generator: "geosearch",
      ggscoord: place.lat + "|" + place.lon,
      ggsradius: String(RADIUS_M),
      ggslimit: "50",
      ggsnamespace: "6",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "1200"
    })).then((json) => {
      const pages = json && json.query && json.query.pages;
      if (!pages) return null;                       // no reply at all
      return Object.keys(pages).map((k) => pages[k]).filter((page) => {
        const title = (page.title || "").replace(/^File:/, "");
        if (!PHOTO_EXT.test(title) || REJECT.test(title)) return false;
        const info = page.imageinfo && page.imageinfo[0];
        return info && isFree(info.thumburl || info.url);
      }).map((page) => {
        const info = page.imageinfo[0];
        const meta = info.extmetadata || {};
        return {
          src: info.thumburl || info.url,
          title: (page.title || "").replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " "),
          credit: (meta.Artist && strip(meta.Artist.value)) || "Wikimedia Commons",
          licence: (meta.LicenseShortName && strip(meta.LicenseShortName.value)) || ""
        };
      });
    });
  }

  // ---- source 2: the article's own picture ----
  function articleImage(place) {
    return fetchJSON(urlFor(WIKI, {
      titles: place.wiki, redirects: "1",
      prop: "pageimages", piprop: "thumbnail", pithumbsize: "1200"
    })).then((json) => {
      const pages = json && json.query && json.query.pages;
      if (!pages) return null;
      const key = Object.keys(pages)[0];
      const src = key && pages[key].thumbnail && pages[key].thumbnail.source;
      if (!isFree(src)) return [];
      return [{ src: src, title: "", credit: "Wikimedia Commons", licence: "" }];
    });
  }

  // Wikimedia returns little HTML fragments for credits.
  function strip(html) {
    const d = document.createElement("div");
    d.innerHTML = String(html);
    return (d.textContent || "").trim().slice(0, 120);
  }

  /**
   * Resolves to { src, credit, licence, status }:
   *   ok           a freely licensed photograph to show
   *   unavailable  the lookup worked, nothing suitable exists nearby
   *   error        the lookup itself failed (offline, blocked, API down)
   * Only "unavailable" is cached; an outage must not be remembered as a fact.
   */
  function find(place) {
    const cache = loadCache();
    const hit = cache[place.city];
    if (hit && (hit.src || Date.now() - hit.t < RETRY_MS)) {
      return Promise.resolve(hit.src
        ? { src: hit.src, credit: hit.credit || "", licence: hit.licence || "", status: "ok" }
        : { src: null, status: "unavailable" });
    }

    let reached = false;
    const note = (list) => { if (list !== null) reached = true; return list; };

    return geoCandidates(place).then(note)
      .then((list) => (list && list.length) ? list : articleImage(place).then(note))
      .then((list) => {
        if (!reached) return { src: null, status: "error" };
        const pick = (list && list.length)
          ? list[Math.floor(Math.random() * list.length)]
          : null;
        const c = loadCache();
        c[place.city] = pick
          ? { src: pick.src, credit: pick.credit, licence: pick.licence, t: Date.now() }
          : { src: null, t: Date.now() };
        saveCache(c);
        return pick
          ? { src: pick.src, credit: pick.credit, licence: pick.licence, status: "ok" }
          : { src: null, status: "unavailable" };
      })
      .catch(() => ({ src: null, status: "error" }));
  }

  return { find: find };
})();
