/* Shared input validation, resilient device storage, and bounded service requests. */
(function (root) {
  const number = (value, fallback = 0, min = 0, max = 1e7) =>
    Number.isFinite(Number(value))
      ? Math.max(min, Math.min(max, Number(value)))
      : fallback;
  const text = (value) => (typeof value === "string" ? value : "");
  const escapeHTML = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function safeURL(value) {
    try {
      let u = new URL(value);
      return ["https:", "http:"].includes(u.protocol)
        ? escapeHTML(u.href)
        : "#";
    } catch {
      return "#";
    }
  }
  function point(p) {
    if (!p || typeof p !== "object") return null;
    let lat = p.lat,
      lon = p.lon;
    return {
      ...p,
      name: text(p.name),
      lat:
        lat != null && Number.isFinite(+lat) && Math.abs(+lat) <= 90
          ? +lat
          : null,
      lon:
        lon != null && Number.isFinite(+lon) && Math.abs(+lon) <= 180
          ? +lon
          : null,
    };
  }
  function place(p) {
    if (!p || typeof p !== "object" || !text(p.name)) return null;
    return {
      ...point(p),
      id: String(p.id || p.name),
      visit: number(p.visit, 30, 0, 720),
      cats: Array.isArray(p.cats)
        ? p.cats.filter((x) => typeof x === "string")
        : [],
      source: Array.isArray(p.source)
        ? p.source
        : ["Maps", "https://www.openstreetmap.org/"],
      desc: text(p.desc),
      fact: text(p.fact),
      story: text(p.story),
      walk: text(p.walk) || "unknown",
      fee: text(p.fee) || "Verify",
      hours: text(p.hours) || "Verify access",
      checked: text(p.checked),
      driveMin: number(p.driveMin),
      driveMiles: number(p.driveMiles),
      done: !!p.done,
      skipped: !!p.skipped,
    };
  }
  function trip(t) {
    if (!t || !Array.isArray(t.stops) || !point(t.start)) return null;
    let finish = ["last", "return"].includes(t.finish)
      ? t.finish
      : point(t.finish);
    if (!finish) return null;
    return {
      ...t,
      start: point(t.start),
      finish,
      stops: t.stops.map(place).filter(Boolean),
      budget: number(t.budget),
      estimated: number(t.estimated),
      finalLeg: { min: number(t.finalLeg?.min), mi: number(t.finalLeg?.mi) },
      region: text(t.region),
      finishLabel: text(t.finishLabel),
    };
  }
  function normalize(s) {
    s = s && typeof s === "object" && !Array.isArray(s) ? s : {};
    return {
      ...s,
      trip: trip(s.trip),
      planStops: Array.isArray(s.planStops)
        ? s.planStops.map(place).filter(Boolean)
        : [],
      favs: Array.isArray(s.favs)
        ? s.favs.filter((x) => typeof x === "string")
        : [],
      played: Array.isArray(s.played)
        ? s.played.filter((x) => typeof x === "string")
        : [],
      prefs:
        s.prefs && typeof s.prefs === "object" && !Array.isArray(s.prefs)
          ? s.prefs
          : {},
      regionCenter: point(s.regionCenter),
      location: point(s.location),
    };
  }
  let storageWarning = "";
  function read(storage) {
    let raw;
    try {
      raw = storage.getItem("rideAlongStateV3");
      return normalize(JSON.parse(raw || "{}"));
    } catch (e) {
      if (raw) {
        try {
          storage.setItem("rideAlongStateV3.recovery", raw);
        } catch {}
      }
      storageWarning =
        "Saved data could not be loaded. You can plan a new trip; existing stored data has not been deleted.";
      return normalize({});
    }
  }
  function write(storage, state) {
    try {
      storage.setItem("rideAlongStateV3", JSON.stringify(state));
      storageWarning = "";
      return true;
    } catch (e) {
      storageWarning =
        "Your browser could not save this change. Keep this page open; changes may be lost when closed.";
      return false;
    }
  }
  const queues = new Map(),
    responses = new Map(),
    cooldowns = new Map();
  function appFetch(url, options = {}) {
    const host = new URL(url, location.href).host,
      key = url + "|" + (options.body || "");
    let cached = responses.get(key);
    if (cached && Date.now() - cached.at < 120000)
      return cached.promise.then((r) => r.clone());
    const task = (queues.get(host) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if ((cooldowns.get(host) || 0) > Date.now())
          throw Error("Service temporarily unavailable");
        const ctrl = new AbortController(),
          abort = () => ctrl.abort();
        if (options.signal?.aborted) throw Error("Request cancelled");
        options.signal?.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(abort, 12000);
        try {
          const result = await fetch(url, { ...options, signal: ctrl.signal });
          if (!result.ok) {
            if (result.status === 429 || result.status >= 500)
              cooldowns.set(host, Date.now() + 15000);
            throw Error("Service returned " + result.status);
          }
          return result;
        } catch (e) {
          responses.delete(key);
          throw e;
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
        }
      });
    queues.set(
      host,
      task.then(
        () => new Promise((r) => setTimeout(r, 1000)),
        () => new Promise((r) => setTimeout(r, 1000)),
      ),
    );
    if (responses.size > 100) responses.delete(responses.keys().next().value);
    responses.set(key, { at: Date.now(), promise: task });
    task.catch(() => responses.delete(key));
    return task.then((r) => r.clone());
  }
  root.AppCore = {
    number,
    escapeHTML,
    safeURL,
    point,
    place,
    trip,
    normalize,
    read,
    write,
    appFetch,
    get storageWarning() {
      return storageWarning;
    },
  };
  if (typeof module !== "undefined") module.exports = root.AppCore;
})(globalThis);

function categoriesForTags(t) {
  const cats = [];
  if (t.historic || t.tourism === "museum") cats.push("History");
  if (t.natural || t.leisure === "nature_reserve")
    cats.push("Geology / nature");
  if (t.tourism === "viewpoint" || t.tourism === "attraction")
    cats.push("Scenic views");
  if (t.amenity === "cafe" || t.amenity === "restaurant")
    cats.push("Food / coffee");
  if (!cats.length) cats.push("Scenic views");
  return cats;
}
function matchesPlanPreferences(p) {
  const value = (id) => document.querySelector(id)?.value;
  if (value("#walking") === "easy" && p.walk !== "easy") return false;
  if (
    value("#walking") === "moderate" &&
    /hard|strenuous|difficult/i.test(p.walk)
  )
    return false;
  if (value("#admission") === "free" && !/^free$/i.test(p.fee)) return false;
  if (value("#dirt") === "no" && p.dirt === true) return false;
  const ints = [...document.querySelectorAll("#interests .on")].map(
    (x) => x.textContent,
  );
  return ints.length > 0 && (p.cats || []).some((c) => ints.includes(c));
}
