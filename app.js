const escapeHTML = AppCore.escapeHTML,
  safeURL = AppCore.safeURL,
  appFetch = AppCore.appFetch;
let state;
try {
  state = AppCore.read(localStorage);
} catch {
  state = AppCore.normalize({});
}
let watchId = null,
  currentStory = null,
  tripMap = null,
  tripMapLayer = null,
  gpsMapMarker = null;
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const save = () => {
  let ok = false;
  try {
    ok = AppCore.write(localStorage, state);
  } catch {}
  const box = document.querySelector("#storageNotice");
  if (box) {
    box.textContent =
      AppCore.storageWarning ||
      (!ok ? "Device storage is unavailable. Changes are temporary." : "");
    box.classList.toggle("hidden", ok);
  }
  return ok;
};
const rad = (x) => (x * Math.PI) / 180;
function miles(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  let dlat = rad(b.lat - a.lat),
    dlon = rad(b.lon - a.lon),
    q =
      Math.sin(dlat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, q))));
}
function roadEstimate(a, b) {
  let air = miles(a, b);
  if (air != null && air < 0.001) return { min: 0, mi: 0, approx: true };
  if (air == null) return { min: 25, mi: null, approx: true };
  let road = air * (air < 8 ? 1.35 : air < 40 ? 1.22 : 1.15),
    speed = road < 8 ? 27 : road < 30 ? 42 : 55;
  return {
    min: Math.max(5, Math.round(((road / speed) * 60) / 5) * 5),
    mi: Math.round(road),
    approx: true,
  };
}
function tab(id) {
  $$(".screen").forEach((x) => x.classList.toggle("active", x.id === id));
  $$("nav button").forEach((x) =>
    x.classList.toggle("selected", x.dataset.tab === id),
  );
  window.scrollTo(0, 0);
  setTimeout(() => {
    if (id === "trip" && tripMap) tripMap.invalidateSize();
    if (id === "plan" && plannerMap) plannerMap.invalidateSize();
  }, 0);
}
$$("nav button").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
$("#offlineBtn").onclick = () => tab("offline");
$("#sourcesBtn").onclick = () => tab("sources");
REGIONS.forEach((r) => $("#discoverRegion").add(new Option(r, r)));
for (let m = 30; m <= 720; m += 30) {
  let h = Math.floor(m / 60),
    mm = m % 60;
  $("#duration").add(
    new Option(`${h ? h + " hr " : ""}${mm ? mm + " min" : ""}`.trim(), m),
  );
}
$("#duration").value = state.prefs.duration || "180";
$("#duration").onchange = previewPlanRoute;
$("#planningMode").value = state.prefs.planningMode || "time";
if (state.prefs.customRegion)
  $("#customRegion").value = state.prefs.customRegion;
else if (state.prefs.region && state.prefs.region !== "__custom__")
  $("#customRegion").value = state.prefs.region;
for (let m = 30; m <= 720; m += 30) {
  let h = Math.floor(m / 60),
    mm = m % 60;
  $("#tripBudget").add(
    new Option(`${h ? h + " hr " : ""}${mm ? mm + " min" : ""}`.trim(), m),
  );
}
$("#tripBudget").add(new Option("No limit", "0"));
for (const [id, key] of [
  ["start", "startMode"],
  ["finish", "finishMode"],
  ["customStart", "customStart"],
  ["customFinish", "customFinish"],
]) {
  if (state.prefs[key]) $("#" + id).value = state.prefs[key];
}
[
  "Scenic views",
  "History",
  "Geology / nature",
  "Small towns",
  "Easy walks",
  "Food / coffee",
].forEach((i) => {
  let b = document.createElement("button");
  b.type = "button";
  b.className = "chip on";
  b.textContent = i;
  b.onclick = () => {
    b.classList.toggle("on");
    previewPlanRoute();
  };
  $("#interests").append(b);
});
function conditional() {
  let places = $("#planningMode").value === "places";
  $("#customStartWrap").classList.toggle(
    "hidden",
    $("#start").value !== "custom",
  );
  $("#customFinishWrap").classList.toggle(
    "hidden",
    $("#finish").value !== "custom",
  );
  $("#durationWrap").classList.toggle("hidden", places);
  $("#planOverrideWrap").classList.toggle("hidden", places);
  $("#placesModeHelp").classList.toggle("hidden", !places);
}
$("#start").onchange = () => {
  conditional();
  previewPlanRoute();
};
$("#finish").onchange = () => {
  conditional();
  previewPlanRoute();
};
$("#planningMode").onchange = () => {
  conditional();
  syncModeUI();
  previewPlanRoute();
};
$("#customStart").onchange = previewPlanRoute;
$("#customFinish").onchange = previewPlanRoute;
function syncModeUI() {
  let m = $("#planningMode").value;
  $$(".modeCard").forEach(
    (b) => (
      b.classList.toggle("selected", b.dataset.mode === m),
      b.setAttribute("aria-pressed", String(b.dataset.mode === m))
    ),
  );
}
$$(".modeCard").forEach(
  (b) =>
    (b.onclick = () => {
      $("#planningMode").value = b.dataset.mode;
      $("#planningMode").dispatchEvent(new Event("change"));
    }),
);
conditional();
syncModeUI();
function endpoint(which) {
  let v = $(which).value;
  if (v === "destination") return state.regionCenter;
  if (v === "region")
    return state.regionCenter
      ? {
          name: $("#customRegion").value.trim() || state.regionCenter.name,
          ...state.regionCenter,
        }
      : null;
  if (PRESETS[v]) return PRESETS[v];
  if (v === "gps")
    return state.location
      ? { name: "Current GPS location", ...state.location }
      : null;
  if (v === "return") return "return";
  if (v === "last") return "last";
  if (v === "custom") {
    let name =
      which === "#start"
        ? $("#customStart").value.trim()
        : $("#customFinish").value.trim();
    return name ? { name, lat: null, lon: null } : null;
  }
  return null;
}
function scorePlace(p, style, ints) {
  let s = p.cats.filter((c) => ints.includes(c)).length * 4;
  if (style === "Hidden gems") s += p.hidden ? 8 : -2;
  if (style === "Highlights") s += p.hidden ? -2 : 4;
  if (style === "A mix") s += p.hidden ? 2 : 3;
  return s;
}
function formatMinutes(n) {
  n = Math.max(0, Math.round(n || 0));
  let h = Math.floor(n / 60),
    m = n % 60;
  return h ? h + " hr" + (m ? " " + m + " min" : "") : m + " min";
}
function planEndpoints() {
  let start = endpoint("#start"),
    finish = endpoint("#finish");
  return { start, finish };
}
async function roadRoute(points, geometry = false) {
  if (points.length < 2 || !points.every(RouteEfficiency.mapped)) return null;
  let ctrl = new AbortController(),
    timer = setTimeout(() => ctrl.abort(), 6500);
  try {
    let coords = points.map((p) => p.lon + "," + p.lat).join(";"),
      r = await appFetch(
        "https://router.project-osrm.org/route/v1/driving/" +
          coords +
          "?overview=" +
          (geometry ? "full&geometries=geojson" : "false") +
          "&steps=false",
        { signal: ctrl.signal },
      );
    if (!r.ok) return null;
    let j = await r.json(),
      route = j.routes?.[0];
    if (j.code !== "Ok" || !route) return null;
    return {
      min: route.duration / 60,
      mi: route.distance / 1609.344,
      legs: route.legs || [],
      geometry: route.geometry?.coordinates.map(([lon, lat]) => ({ lat, lon })),
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function estimatedDetour(p, trip = state.trip) {
  let ctx = RouteEfficiency.context(trip);
  return RouteEfficiency.bestInsertion(ctx, p, roadEstimate);
}
function detourTags(p) {
  let d =
    p.routeKey === JSON.stringify(state.trip) ? p.detour : estimatedDetour(p);
  if (!d) return "";
  return `<span class="tag">+${d.mi.toFixed(1)} mi driving</span><span class="tag">+${Math.ceil(d.min)} min driving</span><span class="tag">${d.routed ? "Road estimate" : "Approximate · roads not checked"}</span><span class="tag">${p.visit || 30} min visit separately</span>`;
}
async function rankByDriving(list, trip) {
  const ctx = RouteEfficiency.context(trip),
    key = JSON.stringify(trip);
  if (!ctx) return list;
  let candidates = list
    .filter(RouteEfficiency.mapped)
    .filter(
      (p) => !trip.stops.some((s) => s.id === p.id || miles(s, p) < 0.03),
    );
  candidates = candidates
    .map((p) => ({ ...p, routeKey: key, detour: estimatedDetour(p, trip) }))
    .sort((a, b) => (a.detour?.min ?? Infinity) - (b.detour?.min ?? Infinity))
    .slice(0, 30);
  let points = [...ctx.points, ...candidates];
  if (points.length > 95 || !candidates.length) return candidates;
  const ctrl = new AbortController(),
    timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    let coords = points.map((p) => p.lon + "," + p.lat).join(";");
    let r = await appFetch(
      "https://router.project-osrm.org/table/v1/driving/" +
        coords +
        "?annotations=distance,duration",
      { signal: ctrl.signal },
    );
    if (!r.ok) return candidates;
    let data = await r.json();
    if (data.code !== "Ok" || !data.distances || !data.durations)
      return candidates;
    // Reject excessive road snapping (for example a hiking summit far from a road).
    const snapped =
      data.sources?.every((p) => p.distance <= 400) &&
      data.destinations?.every((p) => p.distance <= 400);
    if (!snapped) return candidates;
    const leg = (a, b) => {
      let i = points.indexOf(a),
        j = points.indexOf(b),
        mi = data.distances[i]?.[j],
        min = data.durations[i]?.[j];
      return mi == null || min == null
        ? null
        : { mi: mi / 1609.344, min: min / 60 };
    };
    candidates = candidates
      .map((p) => ({
        ...p,
        detour: RouteEfficiency.bestInsertion(ctx, p, leg),
      }))
      .filter((p) => p.detour)
      .map((p) => ({ ...p, detour: { ...p.detour, routed: true } }));
  } catch (e) {
  } finally {
    clearTimeout(timer);
  }
  return candidates.sort(
    (a, b) =>
      (a.detour?.min ?? Infinity) - (b.detour?.min ?? Infinity) ||
      (a.detour?.mi ?? Infinity) - (b.detour?.mi ?? Infinity),
  );
}
let previewSeq = 0;
function previewPlanRoute() {
  state.prefs = {
    ...state.prefs,
    startMode: $("#start").value,
    finishMode: $("#finish").value,
    customStart: $("#customStart").value,
    customFinish: $("#customFinish").value,
    customRegion: $("#customRegion").value,
    planningMode: $("#planningMode").value,
    duration: $("#duration").value,
  };
  save();
  return refreshPlanner();
}
function renderPlanStops() {
  let box = $("#selectedPlanStops");
  box.innerHTML = "";
  if (!state.planStops.length) {
    box.innerHTML = '<p class="muted">No stops added yet.</p>';
    previewPlanRoute();
    return;
  }
  state.planStops.forEach((p, i) => {
    let d = document.createElement("div");
    d.className = "planStopRow";
    d.innerHTML = `<div class="stopNumber">${i + 1}</div><div class="stopInfo"><b>${escapeHTML(p.name)}</b><div class="meta">${p.lat != null ? "Mapped" : "Needs location"} • <label class="inlineVisit">Visit <select data-a="visit"><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hr</option><option value="90">1.5 hr</option><option value="120">2 hr</option></select></label></div></div><div class="row stopReorder"><button type="button" data-a="up" aria-label="Move up">↑</button><button type="button" data-a="down" aria-label="Move down">↓</button><button type="button" data-a="remove">Remove</button></div>`;
    let sel = d.querySelector("select");
    sel.value = String(p.visit || 30);
    sel.onchange = () => {
      p.visit = +sel.value;
      save();
      previewPlanRoute();
    };
    d.querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.a === "up" && i)
            [state.planStops[i - 1], state.planStops[i]] = [
              state.planStops[i],
              state.planStops[i - 1],
            ];
          if (b.dataset.a === "down" && i < state.planStops.length - 1)
            [state.planStops[i + 1], state.planStops[i]] = [
              state.planStops[i],
              state.planStops[i + 1],
            ];
          if (b.dataset.a === "remove") state.planStops.splice(i, 1);
          save();
          renderPlanStops();
          previewPlanRoute();
        }),
    );
    box.append(d);
  });
  previewPlanRoute();
}
function queuePlanStop(p) {
  if (
    state.planStops.some(
      (x) => x.id === p.id || x.name.toLowerCase() === p.name.toLowerCase(),
    )
  ) {
    alert("That stop is already selected for the plan.");
    return;
  }
  state.planStops.push({
    ...p,
    id: p.id || "plan-" + Date.now(),
    visit: p.visit || 30,
    cats: p.cats || ["Custom"],
    desc: p.desc || "Selected custom stop.",
    fact: p.fact || "Selected by you.",
    source: p.source || [
      "Google Maps",
      "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(p.name),
    ],
    walk: p.walk || "unknown",
    fee: p.fee || "Verify",
    hours: p.hours || "Verify before visiting",
    checked: p.checked || new Date().toISOString().slice(0, 10),
    story: p.story || p.name,
  });
  save();
  renderPlanStops();
}
let selectedPlanSearchPlace = null,
  planSearchTimer = null;
function hidePlanSuggestions() {
  $("#planStopSuggestions").classList.add("hidden");
}
function showPlanSuggestions(list) {
  let box = $("#planStopSuggestions");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML =
      '<div class="suggestEmpty">No matches found. Keep typing or try city/state/country.</div>';
    box.classList.remove("hidden");
    return;
  }
  list.forEach((p) => {
    let b = document.createElement("button");
    b.type = "button";
    b.className = "stopSuggestion";
    b.innerHTML = `<b>${escapeHTML(p.name)}</b><span>${escapeHTML(p.display || p.desc || "")}</span>`;
    b.onclick = () => {
      selectedPlanSearchPlace = p;
      $("#planStopName").value = p.name;
      $("#planStopMsg").textContent = "Selected: " + (p.display || p.name);
      hidePlanSuggestions();
    };
    box.append(b);
  });
  box.classList.remove("hidden");
}
$("#planStopName").oninput = () => {
  selectedPlanSearchPlace = null;
  clearTimeout(planSearchTimer);
  let q = $("#planStopName").value.trim();
  if (q.length < 3) {
    hidePlanSuggestions();
    $("#planStopMsg").textContent = q
      ? "Type at least 3 characters to search."
      : "";
    return;
  }
  $("#planStopMsg").textContent = "Searching places…";
  planSearchTimer = setTimeout(async () => {
    try {
      let region = $("#customRegion").value.trim();
      let list = await geocodeMany(
        q + (region ? " " + region : ""),
        7,
        state.regionCenter,
      );
      if (!list.length && region)
        list = await geocodeMany(q, 7, state.regionCenter);
      if ($("#planStopName").value.trim() !== q) return;
      showPlanSuggestions(list);
      $("#planStopMsg").textContent = list.length
        ? "Tap the correct place below, then Add stop."
        : "No matches found.";
    } catch (e) {
      $("#planStopMsg").textContent =
        "Place search could not load. Check your connection.";
    }
  }, 600);
};
$("#addPlanStop").onclick = async () => {
  let name = $("#planStopName").value.trim();
  if (!name) {
    $("#planStopMsg").textContent = "Search for a place or address.";
    return;
  }
  $("#planStopMsg").textContent = "Finding that stop…";
  let region = $("#customRegion").value.trim(),
    p = selectedPlanSearchPlace;
  if (!p) {
    $("#planStopMsg").textContent =
      "Choose the correct search result first, then Add stop. Check its city and country.";
    return;
  }
  if (!p) {
    $("#planStopMsg").textContent =
      "I could not find that place. Choose a search suggestion or make the search more specific.";
    return;
  }
  queuePlanStop({
    ...p,
    id: p.id || "plan-" + Date.now(),
    region: region || p.display || "Worldwide",
    visit: +$("#planStopTime").value,
    cats: ["Custom", "Search result"],
    desc: p.display || "Required stop selected while planning.",
    fact: "Selected by you.",
    source: p.source || [
      "OpenStreetMap",
      "https://www.openstreetmap.org/?mlat=" + p.lat + "&mlon=" + p.lon,
    ],
    walk: "unknown",
    fee: "Verify",
    hours: "Verify current access",
    checked: new Date().toISOString().slice(0, 10),
    story: p.name,
  });
  $("#planStopName").value = "";
  selectedPlanSearchPlace = null;
  hidePlanSuggestions();
  $("#planStopMsg").textContent = "Stop added and mapped.";
};
async function fetchRegionCandidates(center, region) {
  if (!center || center.lat == null) return [];
  try {
    let q =
      '[out:json][timeout:18];(nwr["name"]["tourism"~"attraction|viewpoint|museum"](around:25000,' +
      center.lat +
      "," +
      center.lon +
      ');nwr["name"]["historic"](around:25000,' +
      center.lat +
      "," +
      center.lon +
      ');nwr["name"]["leisure"~"park|nature_reserve"](around:25000,' +
      center.lat +
      "," +
      center.lon +
      ');nwr["name"]["natural"~"peak|waterfall|cave_entrance|arch"](around:25000,' +
      center.lat +
      "," +
      center.lon +
      "););out center tags 80;";
    let r = await appFetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: "data=" + encodeURIComponent(q),
    });
    if (!r.ok) return [];
    let data = await r.json(),
      seen = new Set();
    return (data.elements || [])
      .map((e) => {
        let t = e.tags || {},
          lat = e.lat ?? e.center?.lat,
          lon = e.lon ?? e.center?.lon,
          name = t.name || t["name:en"];
        if (!name || lat == null || seen.has(name)) return null;
        seen.add(name);
        return {
          id: "auto-" + e.type + "-" + e.id,
          name,
          region,
          lat: +lat,
          lon: +lon,
          visit: 30,
          cats: categoriesForTags(t),
          desc:
            t.description ||
            "Attraction or landmark found near " + region + ".",
          fact: "Live place result from OpenStreetMap.",
          source: [
            "OpenStreetMap",
            "https://www.openstreetmap.org/?mlat=" +
              lat +
              "&mlon=" +
              lon +
              "#map=16/" +
              lat +
              "/" +
              lon,
          ],
          walk: "unknown",
          fee: "Verify",
          hours: "Verify current access",
          checked: new Date().toISOString().slice(0, 10),
          story: name + ". Check current visitor information before visiting.",
          hidden: false,
          dirt: null,
          type: overpassType(t),
        };
      })
      .filter((p) => RouteEfficiency.mapped(p) && miles(center, p) <= 16)
      .sort((a, b) => miles(center, a) - miles(center, b))
      .slice(0, 24);
  } catch (e) {
    return [];
  }
}
async function discoverRegionCandidates(center, region) {
  let live = await fetchRegionCandidates(center, region);
  let local = PLACES.filter(
    (p) => miles(center, p) != null && miles(center, p) <= 16,
  ).map((p) => ({ ...p, curated: true }));
  return [
    ...local,
    ...live.filter(
      (p) => !local.some((x) => x.name === p.name || miles(x, p) < 0.08),
    ),
  ];
}
// A distant saved/manual stop must be reviewed, even when time limits are off.
function distantTripStops(trip) {
  if (trip.roadVerified) return [];
  const finish = typeof trip.finish === "object" ? trip.finish : trip.start;
  const anchors = [trip.start, finish].filter(RouteEfficiency.mapped);
  if (!anchors.length) return [];
  return trip.stops.filter(
    (p) =>
      !p.skipped &&
      (!RouteEfficiency.mapped(p) ||
        RouteEfficiency.distanceToLine(p, anchors, miles) > 100),
  );
}
async function build() {
  if (
    state.trip &&
    !confirm("You already have a saved itinerary. Replace it with a new plan?")
  )
    return;
  let placesFirst = $("#planningMode").value === "places",
    budget = placesFirst ? 0 : +$("#duration").value,
    max = +$("#pace").value,
    rawRegion = "__custom__",
    region = $("#customRegion").value.trim(),
    override = placesFirst || $("#planOverrideTime").checked,
    style = $("#style").value,
    ints = $$("#interests .on").map((x) => x.textContent),
    start = endpoint("#start"),
    finish = endpoint("#finish");
  $("#planMsg").textContent = "Building your itinerary…";
  if (!region) {
    $("#planMsg").textContent = "Enter a custom region or destination.";
    return;
  }
  try {
    let rc =
      state.regionCenter &&
      state.regionCenter.name &&
      $("#customRegion").value.trim() === state.regionCenter.name
        ? state.regionCenter
        : await geocodeNear(region);
    if (rc) state.regionCenter = rc;
  } catch (e) {}
  ({ start, finish } = await resolvePlannerEndpoints());
  if (!start) {
    $("#planMsg").textContent =
      $("#start").value === "gps"
        ? "Use my location above, enter another start, or choose Explore around destination."
        : "Enter a custom start.";
    return;
  }
  if (!finish) {
    $("#planMsg").textContent = "Enter your hotel or custom destination.";
    return;
  }
  const distant = distantTripStops({ start, finish, stops: state.planStops });
  const checkedRoute = distant.length
    ? await roadRoute(
        [
          start,
          ...state.planStops,
          ...(typeof finish === "object"
            ? [finish]
            : finish === "return"
              ? [start]
              : []),
        ],
        true,
      )
    : null;
  if (distant.length && !checkedRoute) {
    $("#planMsg").textContent =
      "Review far-away or unmapped stops before building: " +
      distant.map((p) => p.name).join(", ") +
      ". Remove them or select the correct local result.";
    return;
  }
  let curated = plannerCandidates.length
    ? plannerCandidates
    : await discoverRegionCandidates(state.regionCenter, region);
  let stops = state.planStops.map((p) => ({
      ...p,
      done: false,
      skipped: false,
    })),
    cur = start,
    used = 0;
  stops.forEach((p) => {
    let l = roadEstimate(cur, p);
    p.driveMin = l.min;
    p.driveMiles = l.mi;
    used += l.min + p.visit;
    cur = p;
  });
  let candidates = curated.filter(
    (p) =>
      matchesPlanPreferences(p) &&
      !stops.some((s) => s.id === p.id || s.name === p.name),
  );
  let targetMax = placesFirst ? stops.length : Math.max(max, stops.length);
  while (candidates.length && stops.length < targetMax) {
    candidates.sort((a, b) => {
      let ctx = {
        points: [
          cur,
          ...(finish === "last" ? [] : [finish === "return" ? start : finish]),
        ],
        slots: 1,
      };
      return (
        (RouteEfficiency.bestInsertion(ctx, a, roadEstimate)?.min ?? Infinity) -
        (RouteEfficiency.bestInsertion(ctx, b, roadEstimate)?.min ?? Infinity)
      );
    });
    const p = candidates.shift();
    let leg = roadEstimate(cur, p),
      reserve =
        finish === "last"
          ? 0
          : roadEstimate(p, finish === "return" ? start : finish).min,
      cost = leg.min + p.visit;
    if (override || used + cost + reserve <= budget) {
      stops.push({
        ...p,
        done: false,
        skipped: false,
        driveMin: leg.min,
        driveMiles: leg.mi,
      });
      used += cost;
      cur = p;
    }
  }
  if (
    !stops.length &&
    finish !== "return" &&
    finish !== "last" &&
    RouteEfficiency.mapped(finish)
  ) {
    stops.push({
      ...finish,
      id: "destination-" + finish.lat + "," + finish.lon,
      visit: 0,
      cats: ["Destination"],
      desc: "Your selected destination.",
      source: ["OpenStreetMap", "https://www.openstreetmap.org/"],
      done: false,
      skipped: false,
      driveMin: roadEstimate(cur, finish).min,
      driveMiles: roadEstimate(cur, finish).mi,
    });
    used += stops[0].driveMin;
    cur = finish;
    finish = "last";
  }
  if (!stops.length) {
    $("#planMsg").textContent = placesFirst
      ? "Places-first mode needs at least one selected stop. Add places above or search for a stop first."
      : "No attractions were returned for that region. Try a more specific city/park name or add selected stops.";
    return;
  }
  let finalLeg =
    finish === "last"
      ? { min: 0, mi: 0 }
      : roadEstimate(cur, finish === "return" ? start : finish);
  let total = used + finalLeg.min,
    initialOverride = override || total > budget;
  if (
    total > budget &&
    !override &&
    !confirm(
      `This trip is about ${total - budget} minutes over your target. Build anyway?`,
    )
  ) {
    $("#planMsg").textContent =
      "Increase the time, remove a stop, or enable Override time limit.";
    return;
  }
  state.trip = {
    region,
    budget,
    timeOverride: initialOverride,
    planningMode: placesFirst ? "places" : "time",
    start,
    finish,
    finishLabel:
      finish === "last"
        ? "Last stop"
        : finish === "return"
          ? start.name
          : finish.name,
    stops,
    finalLeg,
    estimated: total,
    created: Date.now(),
    style,
  };
  state.prefs = {
    ...state.prefs,
    startMode: $("#start").value,
    finishMode: $("#finish").value,
    customStart: $("#customStart").value,
    customFinish: $("#customFinish").value,
    duration: placesFirst ? state.prefs.duration || "180" : String(budget),
    planningMode: placesFirst ? "places" : "time",
    region: "__custom__",
    customRegion: region,
  };
  await recalc();
  save();
  $("#planMsg").textContent = "Itinerary built.";
  renderTrip();
  updateExisting();
  tab("trip");
}
$("#buildTrip").onclick = async () => {
  const button = $("#buildTrip");
  if (button.disabled) return;
  button.disabled = true;
  try {
    await build();
  } catch (e) {
    $("#planMsg").textContent =
      "The trip could not be created. Check your connection and selected locations.";
  } finally {
    button.disabled = false;
  }
};
function recalc() {
  let t = state.trip;
  if (!t) return;
  let cur = t.start,
    total = 0;
  t.stops.forEach((p) => {
    if (p.skipped) {
      p.driveMin = 0;
      p.driveMiles = 0;
      return;
    }
    let l = roadEstimate(cur, p);
    p.driveMin = l.min;
    p.driveMiles = l.mi;
    total += p.driveMin + p.visit;
    cur = p;
  });
  t.finalLeg =
    t.finish === "last"
      ? { min: 0, mi: 0 }
      : roadEstimate(cur, t.finish === "return" ? t.start : t.finish);
  t.estimated = total + t.finalLeg.min;
  t.roadVerified = false;
  delete t.roadGeometry;
  save();
  return refreshTripRoad(t);
}
let tripRoadSeq = 0;
async function refreshTripRoad(t) {
  const seq = ++tripRoadSeq,
    active = t.stops.filter((p) => !p.skipped),
    points = [
      t.start,
      ...active,
      ...(mappedFinish(t) ? [mappedFinish(t)] : []),
    ];
  const routed = await roadRoute(points, true);
  if (
    seq !== tripRoadSeq ||
    state.trip !== t ||
    !routed ||
    routed.legs.length !== points.length - 1
  )
    return;
  active.forEach((p, i) => {
    p.driveMin = Math.round(routed.legs[i].duration / 60);
    p.driveMiles = +(routed.legs[i].distance / 1609.344).toFixed(1);
  });
  const last = mappedFinish(t) ? routed.legs.at(-1) : null;
  t.finalLeg = last
    ? {
        min: Math.round(last.duration / 60),
        mi: +(last.distance / 1609.344).toFixed(1),
      }
    : { min: 0, mi: 0 };
  t.estimated =
    Math.round(routed.min) + active.reduce((n, p) => n + p.visit, 0);
  t.roadVerified = true;
  t.roadGeometry = routed.geometry;
  save();
  renderTrip();
}
function mapsUrl(dest, origin) {
  let u = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest.lat != null ? dest.lat + "," + dest.lon : dest.name)}&travelmode=driving`;
  if (origin)
    u += `&origin=${encodeURIComponent(origin.lat != null ? origin.lat + "," + origin.lon : origin.name)}`;
  return u;
}
function mapIcon(label, cls = "") {
  return L.divIcon({
    className: "",
    html: `<div class="tripPin ${cls}">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}
function mappedFinish(t) {
  if (t.finish === "last") return null;
  if (t.finish === "return") return t.start;
  return t.finish;
}
function renderTripMap(fit = true) {
  if (!window.L || !$("#tripMap")) return;
  let t = state.trip;
  if (!tripMap) {
    tripMap = L.map("tripMap", { zoomControl: true }).setView(
      [34.8697, -111.761],
      11,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(tripMap);
  }
  setTimeout(() => tripMap.invalidateSize(), 50);
  if (tripMapLayer) tripMap.removeLayer(tripMapLayer);
  tripMapLayer = L.layerGroup().addTo(tripMap);
  let pts = [];
  const addMarker = (p, label, cls, title) => {
    if (!p || p.lat == null || p.lon == null) return;
    let ll = [+p.lat, +p.lon];
    pts.push(ll);
    L.marker(ll, { icon: mapIcon(label, cls) })
      .addTo(tripMapLayer)
      .bindPopup(
        `<b>${escapeHTML(title || p.name)}</b><br>${escapeHTML(p.name || "")}<br><a target="_blank" rel="noopener noreferrer" href="${mapsUrl(p)}">Navigate in Google Maps</a>`,
      );
  };
  if (!t) {
    if (state.location) {
      tripMap.setView([state.location.lat, state.location.lon], 12);
    }
    return;
  }
  addMarker(t.start, "S", "startPin", "Start");
  t.stops
    .filter((p) => !p.skipped)
    .forEach((p, i) => addMarker(p, String(i + 1), "", p.name));
  let fin = mappedFinish(t);
  if (fin && !(t.finish === "return" && t.start.lat != null))
    addMarker(fin, "F", "finishPin", "Finish");
  let line = [t.start, ...t.stops.filter((p) => !p.skipped), fin]
    .filter((p) => p && p.lat != null && p.lon != null)
    .map((p) => [+p.lat, +p.lon]);
  if (line.length > 1)
    L.polyline(t.roadGeometry?.map((p) => [p.lat, p.lon]) || line, {
      weight: 4,
      opacity: 0.72,
      ...(!t.roadVerified ? { dashArray: "8 7" } : {}),
    }).addTo(tripMapLayer);
  if (state.location) {
    let ll = [state.location.lat, state.location.lon];
    gpsMapMarker = L.marker(ll, { icon: mapIcon("●", "gpsPin") })
      .addTo(tripMapLayer)
      .bindPopup("<b>Your GPS location</b>");
    pts.push(ll);
  }
  if (fit && pts.length)
    tripMap.fitBounds(pts, { padding: [28, 28], maxZoom: 14 });
  else if (!pts.length) tripMap.setView([34.8697, -111.761], 11);
  $("#mapStatus").textContent =
    line.length > 1
      ? t.roadVerified
        ? "Road route shown. Open Maps for turn-by-turn navigation."
        : "Dashed line shows stop order; road route is not verified."
      : "Some custom locations do not have coordinates yet. Search for the place in Discover to add a mapped stop.";
}
function locateOnMap() {
  if (!navigator.geolocation) {
    $("#mapStatus").textContent = "GPS is unavailable in this browser.";
    return;
  }
  $("#mapStatus").textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.location = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        at: Date.now(),
      };
      save();
      renderTripMap(false);
      if (tripMap)
        tripMap.setView([state.location.lat, state.location.lon], 14);
      $("#mapStatus").textContent =
        `Your location shown • accuracy about ${Math.round(pos.coords.accuracy)} m`;
    },
    () =>
      ($("#mapStatus").textContent =
        "Could not get your location. Check location permission."),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
  );
}
function renderTrip() {
  let t = state.trip;
  if (!t) {
    $("#tripSummary").innerHTML =
      "<p>No saved trip yet. Build one from Plan.</p>";
    $("#tripStops").innerHTML = "";
    $("#nextStop").innerHTML = "";
    return;
  }
  let remaining = t.stops.filter((p) => !p.done && !p.skipped),
    over = t.budget > 0 && t.estimated > t.budget,
    driveTotal =
      t.stops.reduce((n, p) => n + (p.driveMin || 0), 0) +
      (t.finalLeg?.min || 0),
    visitTotal = t.stops
      .filter((p) => !p.skipped)
      .reduce((n, p) => n + (p.visit || 0), 0);
  $("#tripBudget").value = String(t.budget || 0);
  $("#timeOverride").checked = !!t.timeOverride;
  $("#tripSummary").innerHTML =
    `<b>${escapeHTML(t.region)}</b><p>${t.estimated} min estimated total${t.budget ? ` of ${t.budget} min target` : " • time ignored"} • ${t.stops.length} stops</p><p class="meta">~${driveTotal} min driving + ${visitTotal} min at stops${t.planningMode === "places" ? " • built from selected places" : ""}</p><p class="meta">Start: ${escapeHTML(t.start.name)} • Finish: ${escapeHTML(t.finishLabel)} • ${t.roadVerified ? "road routing, no live traffic" : "approximate, roads not verified"}</p>${over ? `<p class="warning">Trip is about ${t.estimated - t.budget} min over target.${t.timeOverride ? " Time override is ON." : " Turn on Override time limit to keep adding stops."}</p>` : ""}<p>Final endpoint leg: ~${t.finalLeg.min} min${t.finalLeg.mi != null ? " / ~" + t.finalLeg.mi + " mi" : ""}</p>`;
  const distant = distantTripStops(t);
  if (distant.length) {
    $("#tripSummary").innerHTML =
      `<b>Check your stop locations</b><p class="warning">These stops are unmapped or more than 100 miles from the start-to-finish corridor: ${distant.map((p) => escapeHTML(p.name)).join(", ")}.</p><p>Driving time is unavailable until these locations are corrected. Choose Edit plan to replace them, or remove them below.</p><button type="button" id="removeDistantStops">Remove far-away stops</button>`;
    $("#removeDistantStops").onclick = async () => {
      const ids = new Set(distant.map((p) => p.id));
      t.stops = t.stops.filter((p) => !ids.has(p.id));
      state.planStops = state.planStops.filter((p) => !ids.has(p.id));
      await recalc();
      save();
      renderPlanStops();
      renderTrip();
    };
  }
  let n = distant.length ? null : remaining[0];
  $("#nextStop").innerHTML = n
    ? `<div class="card next"><b>Next stop</b><h3>${escapeHTML(n.name)}</h3><p>~${n.driveMin} min drive • ${n.visit} min visit</p><a class="actionLink" target="_blank" rel="noopener noreferrer" href="${mapsUrl(n, state.location || t.start)}">Navigate in Google Maps</a> <button class="ghost" id="nextStory">Play story</button></div>`
    : distant.length
      ? '<div class="card warning">Correct the stop locations above before navigating.</div>'
      : '<div class="card success"><b>All sightseeing stops are complete.</b><p>Continue to your final endpoint when ready.</p></div>';
  if (n) $("#nextStory").onclick = () => speakPlace(n.id);
  $("#tripStops").innerHTML = "";
  renderTripMap();
  t.stops.forEach((p, i) => {
    let d = document.createElement("div");
    d.className = "stop" + (p.done ? " done" : "");
    d.innerHTML = `<div class="stopHead"><h3>${i + 1}. ${escapeHTML(p.name)}</h3><span>${p.visit} min</span></div><p>${escapeHTML(p.desc)}</p><p class="meta">${p.skipped ? "Skipped — not included in route" : "Drive from previous:"} ~${p.driveMin} min${p.driveMiles != null ? " / ~" + p.driveMiles + " mi" : ""} • ${escapeHTML(p.fee)}</p><div class="stopActions"><button data-a="done">${p.done ? "Undo" : "Complete"}</button><button data-a="skip">${p.skipped ? "Unskip" : "Skip"}</button><button data-a="up">↑</button><button data-a="down">↓</button><button data-a="minus">− 5 min</button><button data-a="plus">+ 5 min</button><button data-a="story">Story</button><button data-a="remove">Remove</button><a target="_blank" rel="noopener noreferrer" href="${mapsUrl(p)}">Navigate</a></div>`;
    d.querySelectorAll("button").forEach(
      (b) => (b.onclick = () => edit(i, b.dataset.a)),
    );
    $("#tripStops").append(d);
  });
}
function edit(i, a) {
  let s = state.trip.stops,
    p = s[i];
  if (a === "done") p.done = !p.done;
  if (a === "skip") p.skipped = !p.skipped;
  if (a === "up" && i) [s[i - 1], s[i]] = [s[i], s[i - 1]];
  if (a === "down" && i < s.length - 1) [s[i + 1], s[i]] = [s[i], s[i + 1]];
  if (a === "minus") p.visit = Math.max(10, p.visit - 5);
  if (a === "plus") p.visit += 5;
  if (a === "story") speakPlace(p.id);
  if (a === "remove") s.splice(i, 1);
  recalc();
  renderTrip();
}
function optimizeTrip() {
  let t = state.trip;
  if (!t || t.stops.length < 2) return;
  let left = [...t.stops],
    cur = t.start,
    out = [];
  while (left.length) {
    let best = 0,
      bestD = Infinity;
    left.forEach((p, i) => {
      let d = miles(cur, p);
      if (d != null && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    let p = left.splice(best, 1)[0];
    out.push(p);
    cur = p;
  }
  t.stops = out;
  recalc();
  renderTrip();
}
window.optimizeTrip = optimizeTrip;
$("#optimizeTrip").onclick = optimizeTrip;
$("#mapLocate").onclick = locateOnMap;
$("#mapFit").onclick = () => renderTripMap(true);
$("#tripBudget").onchange = () => {
  if (!state.trip) return;
  state.trip.budget = +$("#tripBudget").value;
  state.trip.timeOverride =
    state.trip.budget === 0 ? true : state.trip.timeOverride;
  save();
  renderTrip();
};
$("#timeOverride").onchange = () => {
  if (!state.trip) return;
  state.trip.timeOverride = $("#timeOverride").checked;
  save();
  renderTrip();
};
$("#newPlan").onclick = () => {
  if (state.trip) {
    state.planStops = state.trip.stops
      .filter((p) => !p.skipped)
      .map((p) => ({ ...p }));
    $("#planningMode").value = state.trip.planningMode || "places";
    conditional();
    syncModeUI();
    renderPlanStops();
  }
  tab("plan");
};
function updateExisting() {
  if (state.trip) {
    $("#existingTrip").classList.remove("hidden");
    $("#existingTrip").innerHTML =
      "<b>You have a saved trip.</b> Building a new plan will ask before replacing it.";
  } else $("#existingTrip").classList.add("hidden");
}
let favOnly = false;
function placeCard(p) {
  let d = document.createElement("div");
  d.className = "place";
  d.innerHTML = `<div class="placeHead"><h3>${escapeHTML(p.name)}</h3><button class="ghost">${state.favs.includes(p.id) ? "★" : "☆"}</button></div><div class="tags">${detourTags(p)}${p.cats.map((c) => `<span class="tag">${escapeHTML(c)}</span>`).join("")}</div><p>${escapeHTML(p.desc)}</p><p><b>Why stop:</b> ${escapeHTML(p.fact)}</p><p class="meta">${escapeHTML(p.region)} • ${p.visit} min • Walking: ${escapeHTML(p.walk)} • ${escapeHTML(p.fee)}</p><p class="meta">Hours/access: ${escapeHTML(p.hours)} • checked ${escapeHTML(p.checked)}</p><div class="row"><a target="_blank" rel="noopener noreferrer" href="${safeURL(p.source[1])}">${escapeHTML(p.source[0])}</a><button class="ghost story">Play story</button><button class="ghost add">Add to trip</button></div>`;
  d.querySelector(".placeHead button").onclick = () => {
    state.favs.includes(p.id)
      ? (state.favs = state.favs.filter((x) => x !== p.id))
      : state.favs.push(p.id);
    save();
    renderDiscover();
  };
  d.querySelector(".story").onclick = () => speakPlace(p.id);
  d.querySelector(".add").onclick = () => addToTrip(p);
  return d;
}
function renderPlaces(target, list) {
  $(target).innerHTML = "";
  if (!list.length)
    $(target).textContent =
      "No matching saved places here. Use Discover for a live search.";
  list.forEach((p) => $(target).append(placeCard(p)));
}
function renderDiscover() {
  let q = $("#search").value.toLowerCase(),
    r = $("#discoverRegion").value;
  let list = PLACES.filter(
    (p) =>
      (r === "all" || p.region === r) &&
      (!favOnly || state.favs.includes(p.id)) &&
      (p.name + " " + p.region + " " + p.desc + " " + p.cats.join(" "))
        .toLowerCase()
        .includes(q),
  );
  list.sort(
    (a, b) =>
      (estimatedDetour(a)?.min ?? Infinity) -
      (estimatedDetour(b)?.min ?? Infinity),
  );
  renderPlaces("#places", list);
}
$("#search").oninput = renderDiscover;
$("#discoverRegion").onchange = renderDiscover;
$("#favoritesOnly").onclick = () => {
  favOnly = !favOnly;
  $("#favoritesOnly").textContent = favOnly ? "Show all" : "Favorites";
  renderDiscover();
};
let liveSearchResults = [];
function livePlaceCard(p) {
  let d = document.createElement("div");
  d.className = "place livePlace";
  let dist = state.location && p.lat != null ? miles(state.location, p) : null,
    routeMeta = detourTags(p);
  d.innerHTML = `<div class="placeHead"><h3>${escapeHTML(p.name)}</h3><span class="tag">Live search</span></div><div class="tags">${p.type ? `<span class="tag">${escapeHTML(p.type)}</span>` : ""}${dist != null ? `<span class="tag">~${dist.toFixed(1)} mi away</span>` : ""}${routeMeta}</div><p>${escapeHTML(p.desc || "Place or point of interest from OpenStreetMap.")}</p><p class="meta">${escapeHTML(p.address || "")}</p><div class="row"><button class="ghost addLive">Add to trip</button><a target="_blank" rel="noopener noreferrer" href="${mapsUrl(p)}">Open in Maps</a></div>`;
  d.querySelector(".addLive").onclick = () => addToTrip(p);
  return d;
}
let liveRenderSeq = 0;
async function renderLiveResults(list) {
  let seq = ++liveRenderSeq,
    key = JSON.stringify(state.trip);
  const draw = (items) => {
    $("#liveResults").innerHTML = "";
    items.forEach((p) => $("#liveResults").append(livePlaceCard(p)));
  };
  draw(
    [...list].sort(
      (a, b) =>
        (estimatedDetour(a)?.min ?? Infinity) -
        (estimatedDetour(b)?.min ?? Infinity),
    ),
  );
  if (state.trip && !list.every((p) => p.routeKey === key)) {
    let ranked = await rankByDriving(list, structuredClone(state.trip));
    if (seq === liveRenderSeq && key === JSON.stringify(state.trip))
      draw(ranked);
  } else draw(list);
}
let searchLocationAsked = false;
function ensureSearchLocation() {
  if (searchLocationAsked || state.location || !navigator.geolocation) return;
  searchLocationAsked = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.location = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        at: Date.now(),
      };
      save();
      $("#regionSearchStatus").textContent =
        "Using your location to rank nearby matches first.";
      previewPlanRoute();
    },
    () => {},
    { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 },
  );
}
let selectedRegionPlace = null,
  regionSearchTimer = null;
function showRegionSuggestions(list) {
  let box = $("#regionSuggestions");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML =
      '<div class="suggestEmpty">No matches. Try city + state/province/country.</div>';
    box.classList.remove("hidden");
    return;
  }
  list.forEach((p) => {
    let b = document.createElement("button");
    b.type = "button";
    b.className = "stopSuggestion";
    b.innerHTML = `<b>${escapeHTML(p.name)}</b><span>${escapeHTML(p.display)}</span>`;
    b.onclick = () => {
      selectedRegionPlace = p;
      state.regionCenter = { lat: p.lat, lon: p.lon, name: p.display };
      $("#customRegion").value = p.display;
      $("#liveNear").value = p.display;
      $("#regionSearchStatus").textContent = "Selected: " + p.display;
      box.classList.add("hidden");
      save();
      previewPlanRoute();
    };
    box.append(b);
  });
  box.classList.remove("hidden");
}
function wireRegionSearch() {
  let input = $("#customRegion");
  if (!input) return;
  input.oninput = () => {
    selectedRegionPlace = null;
    state.regionCenter = null;
    previewPlanRoute();
    save();
    clearTimeout(regionSearchTimer);
    let q = input.value.trim();
    if (q.length < 3) {
      $("#regionSuggestions").classList.add("hidden");
      $("#regionSearchStatus").textContent = q
        ? "Type at least 3 characters to search."
        : "Start typing to search anywhere worldwide.";
      return;
    }
    $("#regionSearchStatus").textContent = "Searching worldwide…";
    regionSearchTimer = setTimeout(async () => {
      try {
        let list = await geocodeMany(q, 8);
        if (input.value.trim() !== q) return;
        showRegionSuggestions(list);
        $("#regionSearchStatus").textContent = list.length
          ? "Choose the correct region or destination below."
          : "No matching place found.";
      } catch (e) {
        $("#regionSearchStatus").textContent =
          "Region search could not load. Check your connection.";
      }
    }, 600);
  };
}
async function geocodeMany(text, limit = 8, near = null) {
  const q = (text || "").trim();
  if (q.length < 3) return [];
  const bias = near || state.regionCenter || state.location,
    params = new URLSearchParams({
      q,
      limit: String(Math.min(10, limit)),
      lang: "en",
    });
  if (RouteEfficiency.mapped(bias)) {
    params.set("lat", bias.lat);
    params.set("lon", bias.lon);
  }
  const r = await appFetch("https://photon.komoot.io/api/?" + params),
    data = await r.json();
  return (data.features || [])
    .map((f) => {
      let p = f.properties || {},
        coords = f.geometry?.coordinates;
      if (!coords || !p.name) return null;
      let display = [p.name, p.city, p.state, p.country]
        .filter(Boolean)
        .join(", ");
      return {
        id: "geo-" + p.osm_type + "-" + p.osm_id,
        name: p.name,
        display,
        lat: +coords[1],
        lon: +coords[0],
        type: p.osm_value || "place",
        visit: 30,
        cats: ["Search result"],
        desc: display,
        fact: "OpenStreetMap place result. Verify access before travel.",
        source: [
          "OpenStreetMap",
          "https://www.openstreetmap.org/?mlat=" +
            coords[1] +
            "&mlon=" +
            coords[0],
        ],
        walk: "unknown",
        fee: "Verify",
        hours: "Verify current access",
        checked: new Date().toISOString().slice(0, 10),
        story: p.name,
      };
    })
    .filter((p) => p && RouteEfficiency.mapped(p));
}
async function geocodeNear(text) {
  let q = (text || "").trim();
  if (!q) return state.location || null;
  let a = await geocodeMany(q, 1);
  return a[0]
    ? { lat: a[0].lat, lon: a[0].lon, name: a[0].display || a[0].name }
    : null;
}
$("#findRegionThings").onclick = requestPlannerSuggestions;
function overpassType(tags = {}) {
  return (
    tags.tourism ||
    tags.historic ||
    tags.leisure ||
    tags.amenity ||
    tags.natural ||
    "place"
  );
}
async function searchLivePlaces(opts = {}) {
  let q = ($("#liveQuery").value || "").trim(),
    nearText = $("#liveNear").value.trim(),
    near = opts.near || null;
  if (!q) q = "attractions";
  $("#liveStatus").textContent = "Searching worldwide…";
  $("#liveResults").innerHTML = "";
  try {
    near = near || (await geocodeNear(nearText));
    let categoryWords =
      /^(attractions?|things|sights?|viewpoint|scenic|museum|parks?|historic|history|ruins?|restaurant|food|coffee|cafe|trail|hike)(\s+(and|&|or)\s+)?/i;
    let looksNamed = !categoryWords.test(q);
    if (looksNamed) {
      let exact = await geocodeMany(q + (nearText ? " " + nearText : ""), 10);
      if (!exact.length && nearText) exact = await geocodeMany(q, 10);
      if (exact.length) {
        liveSearchResults = exact.map((p) => ({
          ...p,
          region: nearText || "Worldwide",
          type: p.type,
        }));
        renderLiveResults(liveSearchResults);
        $("#liveStatus").textContent =
          `${liveSearchResults.length} matching place${liveSearchResults.length === 1 ? "" : "s"} found. Named-place search works worldwide.`;
        return;
      }
    }
    if (!near) {
      $("#liveStatus").textContent =
        "For category searches, enter a city, park, region, or use Near me.";
      return;
    }
    let terms = q.toLowerCase().split(/[, ]+/).filter(Boolean);
    let filters = [];
    const add = (k, v) =>
      filters.push(
        `nwr["${k}"~"${v}",i](around:16000,${near.lat},${near.lon});`,
      );
    if (terms.some((x) => /coffee|cafe/.test(x))) add("amenity", "cafe");
    if (terms.some((x) => /restaurant|food/.test(x)))
      add("amenity", "restaurant|cafe");
    if (terms.some((x) => /museum/.test(x))) add("tourism", "museum");
    if (terms.some((x) => /view|scenic|overlook|viewpoint/.test(x)))
      add("tourism", "viewpoint");
    if (terms.some((x) => /park/.test(x)))
      add("leisure", "park|nature_reserve");
    if (terms.some((x) => /historic|history|ruin/.test(x)))
      add("historic", ".");
    if (terms.some((x) => /trail|hike/.test(x))) add("highway", "path|footway");
    if (terms.some((x) => /attraction|things|site|sight/.test(x))) {
      add("tourism", "attraction|viewpoint|museum");
      add("historic", ".");
    }
    if (!filters.length) {
      let safe = q.replace(/[^a-z0-9 .'-]/gi, "").slice(0, 50);
      filters.push(
        `nwr["name"~"${safe}",i](around:16000,${near.lat},${near.lon});`,
      );
    }
    let query =
      "[out:json][timeout:18];(" + filters.join("") + ");out center tags 60;";
    let r = await appFetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: "data=" + encodeURIComponent(query),
    });
    if (!r.ok) throw new Error("search service unavailable");
    let data = await r.json(),
      seen = new Set();
    liveSearchResults = (data.elements || [])
      .map((e, idx) => {
        let t = e.tags || {},
          lat = e.lat ?? e.center?.lat,
          lon = e.lon ?? e.center?.lon,
          name = t.name || t["name:en"];
        if (!name || lat == null || seen.has(name)) return null;
        seen.add(name);
        let address = [t["addr:housenumber"], t["addr:street"], t["addr:city"]]
          .filter(Boolean)
          .join(" ");
        return {
          id: `live-${e.type}-${e.id}`,
          name,
          region: "Live search",
          lat: +lat,
          lon: +lon,
          visit: 30,
          cats: ["Live search"],
          desc:
            [
              t.description,
              t.tourism && `Tourism: ${t.tourism}`,
              t.historic && `Historic: ${t.historic}`,
              t.amenity && `Amenity: ${t.amenity}`,
            ]
              .filter(Boolean)
              .join(" • ") || "Nearby place from OpenStreetMap.",
          fact: "Live search result — verify hours, access, fees and conditions before visiting.",
          source: [
            "OpenStreetMap",
            "https://www.openstreetmap.org/?mlat=" +
              lat +
              "&mlon=" +
              lon +
              "#map=16/" +
              lat +
              "/" +
              lon,
          ],
          walk: "unknown",
          fee: "Verify",
          hours: "Verify current hours/access",
          checked: new Date().toISOString().slice(0, 10),
          story: `${name}. Live search result. Check current access and conditions before visiting.`,
          type: overpassType(t),
          address,
        };
      })
      .filter(Boolean)
      .sort((a, b) => miles(near, a) - miles(near, b))
      .slice(0, 30);
    renderLiveResults(liveSearchResults);
    $("#liveStatus").textContent = liveSearchResults.length
      ? `${liveSearchResults.length} places found within about 10 miles. Results are live OpenStreetMap data; verify details before visiting.`
      : "No matching places found nearby. Try a broader search or category.";
  } catch (e) {
    $("#liveStatus").textContent =
      "Live search could not load right now. Check your connection or try again shortly.";
  }
}
$("#liveSearchBtn").onclick = () => searchLivePlaces();
$("#liveCats").onclick = (e) => {
  let b = e.target.closest("[data-q]");
  if (!b) return;
  $("#liveQuery").value = b.dataset.q;
  searchLivePlaces();
};
$("#searchNearMe").onclick = () => {
  if (!navigator.geolocation) {
    $("#liveStatus").textContent = "GPS is unavailable in this browser.";
    return;
  }
  $("#liveStatus").textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.location = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        at: Date.now(),
      };
      save();
      $("#liveNear").value = "Current location";
      searchLivePlaces({ near: state.location });
    },
    () =>
      ($("#liveStatus").textContent =
        "Location permission was denied or unavailable."),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
};
function routePoints() {
  if (!state.trip) return [];
  let fin = mappedFinish(state.trip);
  return [state.trip.start, ...state.trip.stops, fin].filter(
    (p) => p && p.lat != null && p.lon != null,
  );
}
function distanceToRoute(p, pts) {
  return RouteEfficiency.distanceToLine(p, pts, miles);
}
async function searchAlongRoute() {
  let trip = structuredClone(state.trip),
    key = JSON.stringify(trip),
    ctx = RouteEfficiency.context(trip),
    pts = ctx?.points;
  if (!pts || pts.length < 2) {
    $("#liveStatus").textContent =
      "Map your start, stops and finish before searching along the trip.";
    return;
  }
  let radius = +$("#routeRadius").value || 5,
    maxDetour = +$("#routeDetour").value || 0,
    cats = $$("#routeCats .on").map((b) => b.dataset.routecat);
  if (!cats.length) {
    $("#liveStatus").textContent = "Choose at least one attraction type.";
    return;
  }
  $("#runRouteSearch").disabled = true;
  $("#liveStatus").textContent =
    "Checking the road route and nearby attractions…";
  let route = await roadRoute(pts, true),
    line = route?.geometry || pts;
  // Spread search samples over the entire route rather than truncating its first section.
  let length = 0,
    cumulative = [0];
  for (let i = 1; i < line.length; i++) {
    length += miles(line[i - 1], line[i]);
    cumulative.push(length);
  }
  let samples = [],
    count = Math.min(18, Math.max(2, Math.ceil(length / radius) + 1));
  for (let n = 0; n < count; n++) {
    let target = (length * n) / (count - 1),
      i = 1;
    while (i < line.length - 1 && cumulative[i] < target) i++;
    let t =
        (target - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1] || 1),
      a = line[i - 1],
      b = line[i];
    samples.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
    });
  }
  let found = new Map(),
    meters = Math.round(radius * 1609.344);
  try {
    for (let p of samples.slice(0, 18)) {
      let parts = [];
      if (cats.includes("tourism"))
        parts.push(
          'nwr["tourism"~"attraction|artwork"](around:' +
            meters +
            "," +
            p.lat +
            "," +
            p.lon +
            ");",
        );
      if (cats.includes("historic"))
        parts.push(
          'nwr["name"]["historic"](around:' +
            meters +
            "," +
            p.lat +
            "," +
            p.lon +
            ");",
        );
      if (cats.includes("architecture"))
        parts.push(
          'nwr["building"~"cathedral|church|civic|historic|monument"](around:' +
            meters +
            "," +
            p.lat +
            "," +
            p.lon +
            ");",
        );
      if (cats.includes("museum"))
        parts.push(
          'nwr["tourism"="museum"](around:' +
            meters +
            "," +
            p.lat +
            "," +
            p.lon +
            ");",
        );
      if (cats.includes("viewpoint"))
        parts.push(
          'nwr["tourism"="viewpoint"](around:' +
            meters +
            "," +
            p.lat +
            "," +
            p.lon +
            ");",
        );
      if (cats.includes("nature"))
        parts.push(
          'nwr["natural"~"peak|waterfall|arch|cave_entrance"](around:' +
            meters +
            "," +
            p.lat +
            "," +
            p.lon +
            ");",
        );
      let q =
          "[out:json][timeout:12];(" + parts.join("") + ");out center tags 60;",
        r = await appFetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          signal: AbortSignal.timeout(15000),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: "data=" + encodeURIComponent(q),
        });
      if (!r.ok) continue;
      let data = await r.json();
      for (let e of data.elements || []) {
        let t = e.tags || {},
          lat = e.lat ?? e.center?.lat,
          lon = e.lon ?? e.center?.lon,
          name = t.name || t["name:en"];
        if (!name || lat == null) continue;
        let po = { lat: +lat, lon: +lon },
          off = distanceToRoute(po, line),
          detour = 0;
        if (off > radius) continue;
        let id = "route-" + e.type + "-" + e.id;
        if (!found.has(id))
          found.set(id, {
            id,
            name,
            region: state.trip.region,
            lat: +lat,
            lon: +lon,
            visit: 30,
            cats: ["Along route"],
            desc: t.description || "Interesting place near your route.",
            fact: "Found along your route. Verify current access, hours and conditions.",
            source: [
              "OpenStreetMap",
              "https://www.openstreetmap.org/?mlat=" +
                lat +
                "&mlon=" +
                lon +
                "#map=16/" +
                lat +
                "/" +
                lon,
            ],
            walk: "unknown",
            fee: "Verify",
            hours: "Verify current hours/access",
            checked: new Date().toISOString().slice(0, 10),
            story: name + ". A point of interest near your route.",
            type: overpassType(t),
            routeDistance: off,
            detourMin: detour,
          });
      }
    }
    let ranked = await rankByDriving([...found.values()], trip);
    if (JSON.stringify(state.trip) !== key) {
      $("#liveStatus").textContent =
        "Your trip changed. Search again for updated detours.";
      return;
    }
    liveSearchResults = ranked.filter(
      (p) => p.detour && (!maxDetour || p.detour.min <= maxDetour),
    );
    renderLiveResults(liveSearchResults);
    let approximate = liveSearchResults.some((p) => !p.detour.routed);
    $("#liveStatus").textContent =
      liveSearchResults.length +
      " stops, lowest added driving first. " +
      (maxDetour ? "Up to " + maxDetour + " extra driving minutes. " : "") +
      "Visit time is separate. " +
      (!route || approximate
        ? "Some distances are approximate; roads could not be checked. "
        : "Road estimates exclude traffic. ") +
      (length > radius * 17
        ? "Long route: results cover sampled areas, not every attraction."
        : "");
  } catch (e) {
    $("#liveStatus").textContent = "Route search could not finish. Try again.";
  } finally {
    $("#runRouteSearch").disabled = false;
  }
}

$("#searchAlongTrip").onclick = () => {
  if (!state.trip) {
    $("#liveStatus").textContent = "Build a trip first to search along it.";
    return;
  }
  $("#routeSearchOptions").classList.toggle("hidden");
};
$("#routeCats").onclick = (e) => {
  let b = e.target.closest("[data-routecat]");
  if (b) b.classList.toggle("on");
};
$("#runRouteSearch").onclick = searchAlongRoute;
async function addToTrip(p) {
  if (!state.trip) {
    queuePlanStop(p);
    alert("Added to Selected / custom stops on Plan.");
    return;
  }
  if (
    state.trip.stops.some(
      (x) =>
        x.id === p.id ||
        (RouteEfficiency.mapped(x) &&
          RouteEfficiency.mapped(p) &&
          miles(x, p) < 0.03),
    )
  ) {
    alert("That place is already in your trip.");
    return;
  }
  let key = JSON.stringify(state.trip),
    ranked = await rankByDriving([p], state.trip);
  if (JSON.stringify(state.trip) !== key) {
    alert("Your trip changed. Please add the stop again.");
    return;
  }
  let d = ranked[0]?.detour,
    index = d?.index ?? state.trip.stops.length,
    candidate = { ...p, done: false, skipped: false };
  state.trip.stops.splice(index, 0, candidate);
  await recalc();
  let excess = state.trip.estimated - state.trip.budget;
  if (state.trip.budget > 0 && excess > 0 && !state.trip.timeOverride) {
    if (
      !confirm(
        `Adding this stop puts the estimated trip ${Math.ceil(excess)} minutes over target. Add anyway?`,
      )
    ) {
      state.trip.stops.splice(index, 1);
      recalc();
      renderTrip();
      return;
    }
    state.trip.timeOverride = true;
  }
  save();
  renderTrip();
  renderDiscover();
  $("#liveResults").innerHTML = "";
  $("#liveStatus").textContent =
    "Trip updated. Search again to refresh detours.";
  alert("Stop added as stop " + (index + 1) + ".");
}

$("#addCustomStop").onclick = async () => {
  if (!state.trip) {
    $("#customStopMsg").textContent = "Build a trip first.";
    return;
  }
  let name = $("#customStopName").value.trim();
  if (!name) return;
  const button = $("#addCustomStop");
  button.disabled = true;
  try {
    let p = await geocodeNear(name);
    if (!p) {
      $("#customStopMsg").textContent =
        "Place not found. Try city, state and name.";
      return;
    }
    await addToTrip({
      ...p,
      visit: +$("#customStopTime").value,
      desc: $("#customStopNotes").value.trim() || p.desc,
    });
    $("#customStopMsg").textContent = state.trip.stops.some(
      (s) => s.id === p.id,
    )
      ? "Stop added."
      : "Stop was not added.";
  } catch (e) {
    $("#customStopMsg").textContent =
      "Place search unavailable. Please try again.";
  } finally {
    button.disabled = false;
  }
};
function nearest(lat, lon) {
  return [...PLACES]
    .map((p) => ({ ...p, d: miles({ lat, lon }, p) }))
    .filter((p) => p.d <= 30)
    .sort((a, b) => a.d - b.d);
}
function setLocation(pos) {
  state.location = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    at: Date.now(),
  };
  save();
  $("#gpsStatus").textContent =
    `Location ready • accuracy about ${Math.round(pos.coords.accuracy)} m`;
  renderPlaces(
    "#nearbyPlaces",
    nearest(state.location.lat, state.location.lon).slice(0, 12),
  );
}
$("#gpsBtn").onclick = () => {
  if (!navigator.geolocation) {
    $("#gpsStatus").textContent =
      "GPS is unavailable. Use the manual location fallback.";
    return;
  }
  $("#gpsStatus").textContent = "Getting location…";
  navigator.geolocation.getCurrentPosition(
    setLocation,
    (e) =>
      ($("#gpsStatus").textContent =
        "Location denied, unavailable, or timed out. Use the manual fallback below."),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
};
$("#manualNearby").onclick = () => {
  let q = $("#manualLocation").value.trim();
  if (!q) return;
  window.open(
    "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q),
    "_blank",
  );
};
function allTourPlaces() {
  let m = new Map();
  PLACES.forEach((p) => m.set(p.id, p));
  (state.planStops || []).forEach((p) => m.set(p.id, p));
  (state.trip?.stops || []).forEach((p) => m.set(p.id, p));
  return [...m.values()].filter(
    (p) => p.lat != null && p.lon != null && !p.skipped && !p.done,
  );
}
async function enrichTourPlace(p) {
  if (p.enriched || p._enrichTried) return p;
  p._enrichTried = true;
  try {
    let title = encodeURIComponent(p.name),
      r = await appFetch(
        "https://en.wikipedia.org/api/rest_v1/page/summary/" + title,
      );
    if (r.ok) {
      let j = await r.json();
      if (
        j.extract &&
        j.extract.length > 80 &&
        j.coordinates &&
        miles(p, { lat: j.coordinates.lat, lon: j.coordinates.lon }) < 2
      ) {
        p.wikiExtract = j.extract;
        p.enriched = true;
        p.story = [p.story, j.extract].filter(Boolean).join(" ");
        p.fact =
          p.fact &&
          p.fact !==
            "Live search result — verify hours, access, fees and conditions before visiting."
            ? p.fact
            : j.extract.split(/(?<=[.!?])\s+/)[0];
        save();
      }
    }
  } catch (e) {}
  return p;
}
function tourText(p, d) {
  let cue =
    d <= 0.12
      ? "You are arriving at"
      : d <= 0.5
        ? "Coming up nearby is"
        : "Ahead is";
  let type = (p.cats || []).join(", ").toLowerCase(),
    context = [];
  if (/history|historic|museum|culture|cultural|town/.test(type))
    context.push("This stop has historical or cultural significance.");
  if (/geology|nature|scenic/.test(type))
    context.push(
      "Notice the surrounding landscape and natural features as you approach.",
    );
  let look = p.lookFor || p.desc || p.fact || "";
  let facts = [p.story, p.fact]
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(" ");
  return `${cue} ${escapeHTML(p.name)}. ${look ? "What to look for: " + look + ". " : ""}${context.join(" ")} ${facts}`
    .replace(/\s+/g, " ")
    .trim();
}
function chooseVoice() {
  let voices = speechSynthesis.getVoices(),
    saved = $("#voiceSelect")?.value;
  if (saved) {
    let v = voices.find((x) => x.name === saved);
    if (v) return v;
  }
  return (
    voices.find(
      (v) =>
        /en-US|en-GB|en-CA|en-AU/i.test(v.lang) &&
        /natural|neural|premium|enhanced|samantha|ava|aria|jenny|google|microsoft/i.test(
          v.name,
        ),
    ) ||
    voices.find((v) => /^en/i.test(v.lang) && v.localService) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0]
  );
}
function loadVoices() {
  if (!("speechSynthesis" in window) || !$("#voiceSelect")) return;
  let sel = $("#voiceSelect"),
    keep = state.prefs.voice || "";
  sel.innerHTML = '<option value="">Best available voice</option>';
  speechSynthesis
    .getVoices()
    .filter((v) => /^en/i.test(v.lang))
    .forEach((v) => sel.add(new Option(v.name + " — " + v.lang, v.name)));
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
$("#voiceSelect").onchange = () => {
  state.prefs.voice = $("#voiceSelect").value;
  save();
};
$("#approachDistance").value = state.prefs.approachDistance || "0.5";
$("#approachDistance").onchange = () => {
  state.prefs.approachDistance = $("#approachDistance").value;
  save();
};
let speechSeq = 0;
async function speakTourPlace(p, d = 0) {
  const seq = ++speechSeq;
  p = await enrichTourPlace(p);
  if (seq !== speechSeq) return;
  currentStory = p;
  $("#player").classList.remove("hidden");
  $("#playerTitle").textContent = p.name;
  $("#playerState").textContent = " • tour guide";
  if (!("speechSynthesis" in window)) {
    $("#playerState").textContent = " • narration unavailable";
    return;
  }
  speechSynthesis.cancel();
  let u = new SpeechSynthesisUtterance(tourText(p, d)),
    v = chooseVoice();
  if (v) u.voice = v;
  u.rate = +$("#speed").value || 1;
  u.pitch = 1;
  u.onstart = () => ($("#playerState").textContent = " • speaking");
  u.onend = () => ($("#playerState").textContent = " • finished");
  speechSynthesis.speak(u);
}
function gpsWatch() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    $("#watchBtn").textContent = "Start tour guide";
    $("#gpsStatus").textContent = "Tour guide stopped.";
    return;
  }
  if (!navigator.geolocation) {
    $("#gpsStatus").textContent = "GPS unavailable.";
    return;
  }
  let last = { lat: null, lon: null, at: 0 };
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      setLocation(pos);
      let here = { lat: pos.coords.latitude, lon: pos.coords.longitude },
        radius = +$("#approachDistance").value || 0.5,
        tripIds = new Set((state.trip?.stops || []).map((p) => p.id)),
        now = Date.now();
      let candidates = allTourPlaces()
        .map((p) => ({ ...p, d: miles(here, p) }))
        .filter(
          (p) => p.d != null && p.d <= radius && !state.played.includes(p.id),
        )
        .filter((p) =>
          tripIds.has(p.id)
            ? $("#tripNarration").checked
            : $("#nearbyNarration").checked,
        )
        .sort((x, y) => tripIds.has(y.id) - tripIds.has(x.id) || x.d - y.d);
      let p = candidates[0];
      if (
        p &&
        $("#autoNarrate").checked &&
        "speechSynthesis" in window &&
        !speechSynthesis.speaking
      ) {
        state.played.push(p.id);
        save();
        renderHistory();
        speakTourPlace(p, p.d);
      }
      last = { ...here, at: now };
      $("#gpsStatus").textContent =
        `Tour guide active • GPS accuracy ~${Math.round(pos.coords.accuracy)} m • trigger ${radius} mi`;
    },
    () =>
      ($("#gpsStatus").textContent =
        "GPS tracking lost location. Keep Ride Along open and check location permission."),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
  $("#watchBtn").textContent = "Stop tour guide";
  $("#gpsStatus").textContent = "Starting GPS tour guide…";
}
$("#watchBtn").onclick = gpsWatch;
function renderHistory() {
  let pool = allTourPlaces(),
    names = state.played
      .map((id) => pool.find((p) => p.id === id)?.name)
      .filter(Boolean);
  $("#playedHistory").textContent = names.length
    ? "Already narrated: " + names.slice(-12).join(", ")
    : "No GPS-triggered stories played yet.";
}
$("#resetStories").onclick = () => {
  state.played = [];
  save();
  renderHistory();
  $("#gpsStatus").textContent = "Played-story history reset.";
};
function speakPlace(id) {
  let p = allTourPlaces().find((x) => x.id === id);
  if (!p) return;
  speakTourPlace(p, 0);
}
window.speakPlace = speakPlace;
$("#playBtn").onclick = () => currentStory && speakTourPlace(currentStory, 0);
$("#pauseBtn").onclick = () => {
  if (!("speechSynthesis" in window)) return;
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
    $("#pauseBtn").textContent = "Pause";
  } else {
    speechSynthesis.pause();
    $("#pauseBtn").textContent = "Resume";
  }
};
$("#stopBtn").onclick = () => {
  speechSeq++;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("#player").classList.add("hidden");
};
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((r) => r.update())
    .catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    $("#updateNotice").classList.remove("hidden");
  });
}
$("#downloadOffline").onclick = async () => {
  let p = $("#offlineProgress");
  if (!("caches" in window)) {
    $("#offlineStatus").textContent =
      "Offline cache is unavailable in this browser.";
    return;
  }
  try {
    p.value = 20;
    let c = await caches.open("ride-along-v25");
    p.value = 50;
    await c.addAll([
      "./",
      "./index.html",
      "./styles.css?v=25",
      "./core.js?v=25",
      "./app.js?v=25",
      "./route-efficiency.js?v=25",
      "./planner.js?v=25",
      "./places.js?v=25",
      "./manifest.json",
    ]);
    p.value = 100;
    $("#offlineStatus").textContent =
      "Core app and curated database downloaded. Saved trip is stored locally. Real airplane-mode reopening still needs testing on this device.";
  } catch (e) {
    $("#offlineStatus").textContent =
      "Download incomplete; offline-ready status was not granted.";
    p.value = 0;
  }
};
$("#checkOffline").onclick = async () => {
  let required = [
    "./index.html",
    "./styles.css?v=25",
    "./core.js?v=25",
    "./app.js?v=25",
    "./route-efficiency.js?v=25",
    "./planner.js?v=25",
    "./places.js?v=25",
  ];
  let cache = "caches" in window ? await caches.open("ride-along-v25") : null;
  let ok =
    cache &&
    (await Promise.all(required.map((p) => cache.match(p)))).every(Boolean);
  $("#offlineProgress").value = ok ? 100 : 0;
  $("#offlineStatus").textContent = ok
    ? "Core offline package found. This does not include Google Maps or guarantee browser voices offline."
    : "Core offline package not found.";
};
$("#removeOffline").onclick = async () => {
  if ("caches" in window) await caches.delete("ride-along-v25");
  $("#offlineProgress").value = 0;
  $("#offlineStatus").textContent =
    "Offline app cache removed. Your saved trip remains in local storage.";
};
function renderSources() {
  let unique = [
    ...new Map(Object.values(SOURCES).map((x) => [x[1], x])).values(),
  ];
  $("#sourceList").innerHTML =
    "<p>Place records use these primary official/visitor sources. Changing conditions should be rechecked before travel.</p>" +
    unique
      .map(
        (s) =>
          `<div class="sourceRow"><a target="_blank" rel="noopener noreferrer" href="${safeURL(s[1])}">${escapeHTML(s[0])}</a></div>`,
      )
      .join("");
}
wireRegionSearch();
renderSources();
renderPlanStops();
updateExisting();
renderTrip();
renderDiscover();
renderHistory();
if (state.location)
  renderPlaces(
    "#nearbyPlaces",
    nearest(state.location.lat, state.location.lon).slice(0, 12),
  );
if (AppCore.storageWarning) {
  $("#storageNotice").textContent = AppCore.storageWarning;
  $("#storageNotice").classList.remove("hidden");
}
if (state.trip) recalc();
for (const id of ["walking", "admission", "dirt", "style", "pace"])
  $("#" + id).onchange = previewPlanRoute;
$("#reloadApp").onclick = () => location.reload();
