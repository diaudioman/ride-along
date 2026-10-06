let plannerSeq = 0,
  plannerTimer = null,
  plannerMap = null,
  plannerLayer = null,
  plannerCandidates = [];
const plannerPlaceCache = new Map(),
  plannerGeoCache = new Map();
function plannerEscape(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
async function resolvePlannerEndpoints() {
  let { start, finish } = planEndpoints();
  async function resolve(p) {
    if (!p || typeof p !== "object" || RouteEfficiency.mapped(p)) return p;
    let key = p.name;
    if (!plannerGeoCache.has(key))
      plannerGeoCache.set(
        key,
        geocodeNear(key)
          .then((p) => {
            if (!p) plannerGeoCache.delete(key);
            return p;
          })
          .catch(() => {
            plannerGeoCache.delete(key);
            return null;
          }),
      );
    return await plannerGeoCache.get(key);
  }
  return { start: await resolve(start), finish: await resolve(finish) };
}
function plannerTrip(start, finish) {
  return {
    start,
    finish,
    stops: state.planStops.map((p) => ({ ...p })),
    region: state.regionCenter?.name || "",
  };
}
function requestPlannerSuggestions() {
  refreshPlanner(true);
  const status = $("#planSuggestionsStatus");
  status.setAttribute("tabindex", "-1");
  status.focus({ preventScroll: true });
  status.scrollIntoView({ behavior: "smooth", block: "center" });
}
function setSuggestionsLoading(loading) {
  const button = $("#findRegionThings");
  button.disabled = loading;
  button.textContent = loading ? "Finding places…" : "Suggest places here";
  $("#planSuggestions").setAttribute("aria-busy", String(loading));
}
function refreshPlanner(force = false) {
  let seq = ++plannerSeq;
  clearTimeout(plannerTimer);
  plannerCandidates = [];
  setSuggestionsLoading(false);
  if (!state.regionCenter) {
    plannerCandidates = [];
    $("#planMapPanel").classList.add("hidden");
    $("#planSuggestions").replaceChildren();
    $("#planSuggestionsStatus").textContent =
      "Choose a destination to see suggested attractions here.";
    $("#planRouteEstimate").textContent = "Choose your destination first.";
    return;
  }
  setSuggestionsLoading(true);
  $("#planMapPanel").classList.remove("hidden");
  $("#planSuggestionsStatus").textContent =
    "Finding attractions for your trip…";
  $("#planSuggestions").replaceChildren();
  $("#planMapStatus").textContent = "Updating route…";
  $("#planRouteEstimate").textContent = "Calculating your route…";
  plannerTimer = setTimeout(() => loadPlanner(seq, force === true), 250);
}
async function plannerPlaces(center, force) {
  let key = center.lat.toFixed(2) + "," + center.lon.toFixed(2);
  if (force) plannerPlaceCache.delete(key);
  if (!plannerPlaceCache.has(key)) {
    plannerPlaceCache.set(
      key,
      discoverRegionCandidates(center, state.regionCenter.name).then((list) => {
        if (!list.length) plannerPlaceCache.delete(key);
        return list;
      }),
    );
  }
  return plannerPlaceCache.get(key);
}
function drawPlannerMap(points, line, suggestions, road) {
  if (!window.L) {
    $("#planMapStatus").textContent +=
      " Map unavailable. Route details and suggestions are listed below.";
    return;
  }
  if (!plannerMap) {
    plannerMap = L.map("planMap").setView(
      [state.regionCenter.lat, state.regionCenter.lon],
      11,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(plannerMap);
  }
  if (plannerLayer) plannerMap.removeLayer(plannerLayer);
  plannerLayer = L.layerGroup().addTo(plannerMap);
  let bounds = [];
  points.forEach((p, i) => {
    if (!RouteEfficiency.mapped(p)) return;
    let ll = [p.lat, p.lon];
    bounds.push(ll);
    let label = document.createElement("span");
    label.textContent =
      (i === 0 ? "Start: " : i === points.length - 1 ? "Finish: " : "Stop: ") +
      (p.name || "");
    L.marker(ll).addTo(plannerLayer).bindPopup(label);
  });
  if (line.length > 1)
    L.polyline(
      line.map((p) => [p.lat, p.lon]),
      { color: "#8d3f2b", weight: 4, ...(!road ? { dashArray: "7 7" } : {}) },
    ).addTo(plannerLayer);
  suggestions.forEach((p, i) => {
    let ll = [p.lat, p.lon];
    bounds.push(ll);
    let popup = document.createElement("div"),
      title = document.createElement("strong"),
      button = document.createElement("button");
    title.textContent = i + 1 + ". " + p.name;
    button.textContent = "Add stop";
    button.className = "ghost";
    button.onclick = () => addPlannerSuggestion(p);
    popup.append(title, document.createElement("br"), button);
    L.circleMarker(ll, {
      radius: 9,
      color: "#fff",
      weight: 2,
      fillColor: "#226f88",
      fillOpacity: 1,
    })
      .addTo(plannerLayer)
      .bindPopup(popup);
  });
  setTimeout(() => {
    plannerMap.invalidateSize();
    if (bounds.length)
      plannerMap.fitBounds(bounds, { padding: [25, 25], maxZoom: 13 });
  }, 0);
}
function showPlannerSuggestions(list, trip) {
  const box = $("#planSuggestions");
  box.replaceChildren();
  list.forEach((p, i) => {
    let card = document.createElement("article");
    card.className = "plannerSuggestion";
    let d = p.detour,
      driving = d
        ? `+${d.mi.toFixed(1)} mi · +${Math.ceil(d.min)} min driving`
        : "";
    card.innerHTML = `<div><h4>${i + 1}. ${plannerEscape(p.name)}</h4><p>${plannerEscape(p.type || p.cats?.[0] || "Attraction")} · ${p.visit || 30} min visit</p></div><button type="button" class="ghost">Add stop</button><div class="tags">${d ? `<span class="tag">${driving}</span><span class="tag">${d.routed ? "Road estimate" : "Approximate driving estimate"}</span>` : `<span class="tag">${miles(state.regionCenter, p).toFixed(1)} mi from destination · straight line</span>`}</div>`;
    card.querySelector("button").onclick = () => addPlannerSuggestion(p);
    box.append(card);
  });
}
function addPlannerSuggestion(p) {
  if (
    state.planStops.some(
      (s) => s.id === p.id || s.name.toLowerCase() === p.name.toLowerCase(),
    )
  )
    return;
  const index = p.detour?.index;
  queuePlanStop(p);
  if (Number.isInteger(index) && index < state.planStops.length - 1) {
    const added = state.planStops.pop();
    state.planStops.splice(index, 0, added);
    save();
    renderPlanStops();
  }
  $("#planStopMsg").textContent =
    p.name + " added. Route and suggestions are updating.";
}
async function loadPlanner(seq, force) {
  try {
    let { start, finish } = await resolvePlannerEndpoints();
    if (seq !== plannerSeq) return;
    let hasStart = RouteEfficiency.mapped(start),
      end =
        finish === "return"
          ? start
          : finish === "last"
            ? state.regionCenter
            : finish;
    let trip = hasStart ? plannerTrip(start, finish) : null;
    let points = trip ? RouteEfficiency.context(trip)?.points : null;
    if (!points) {
      points = [state.regionCenter];
      trip = null;
    }
    // A region-only exploration has no drive until a stop is selected.
    let routed = points.length > 1 ? await roadRoute(points, true) : null;
    if (seq !== plannerSeq) return;
    let line = routed?.geometry || points;
    let drive =
      routed ||
      points.slice(1).reduce(
        (sum, p, i) => {
          let leg = roadEstimate(points[i], p);
          return { mi: sum.mi + (leg.mi || 0), min: sum.min + leg.min };
        },
        { mi: 0, min: 0 },
      );
    let visit = state.planStops.reduce((sum, p) => sum + (+p.visit || 30), 0),
      total = drive.min + visit,
      budget = $("#planningMode").value === "time" ? +$("#duration").value : 0;
    $("#planMapStatus").textContent = trip
      ? routed
        ? "Driving route shown. Blue pins are suggested attractions."
        : "Dashed line shows stop order; road routing is unavailable or no driving leg is selected."
      : "Showing attractions near your destination. Set a starting location above to see the driving route.";
    $("#planRouteEstimate").innerHTML = trip
      ? `<b>${formatMinutes(total)} total · ${drive.mi.toFixed(1)} mi</b><span>${formatMinutes(drive.min)} driving + ${formatMinutes(visit)} visiting</span><small>${routed ? "Road estimate; excludes live traffic." : "Approximate; road route not verified."}</small>${budget ? `<small class="${total > budget ? "warning" : "success"}">${formatMinutes(Math.abs(budget - total))} ${total > budget ? "over your time target" : "remaining"}</small>` : ""}`
      : "<b>Set your starting location to calculate the route.</b><span>You can still browse and add attractions below.</span>";
    drawPlannerMap(points, line, [], !!routed);
    let centers = [state.regionCenter];
    if (line.length > 1)
      for (let i = 0; i < 4; i++)
        centers.push(line[Math.round((i * (line.length - 1)) / 4)]);
    centers = centers.filter(
      (p, i, a) => a.findIndex((x) => miles(x, p) < 2) === i,
    );
    let results = await Promise.allSettled(
      centers.map((p) => plannerPlaces(p, force)),
    );
    if (seq !== plannerSeq) return;
    let seen = new Set(),
      pool = [];
    for (let result of results) {
      if (result.status !== "fulfilled") continue;
      for (let p of result.value) {
        if (
          seen.has(p.name) ||
          state.planStops.some((s) => s.id === p.id || s.name === p.name) ||
          miles(state.regionCenter, p) < 0.08
        )
          continue;
        seen.add(p.name);
        if (line.length > 1 && distanceToRoute(p, line) > 5) continue;
        pool.push(p);
      }
    }
    pool = pool.filter(matchesPlanPreferences);
    let ranked = trip
      ? await rankByDriving(pool, trip)
      : pool.sort(
          (a, b) => miles(state.regionCenter, a) - miles(state.regionCenter, b),
        );
    if (seq !== plannerSeq) return;
    plannerCandidates = ranked;
    let shown = ranked.slice(0, 12);
    showPlannerSuggestions(shown, trip);
    drawPlannerMap(points, line, shown, !!routed);
    $("#planSuggestionsStatus").textContent = shown.length
      ? (trip
          ? "Suggested stops along your trip, lowest added driving first."
          : "Suggested attractions near your destination.") +
        " Tap Add stop or a blue map pin. Visiting time is separate." +
        (shown.some((p) => p.curated) ? " Includes saved curated places." : "")
      : "No matches for this area and your filters. Try different trip options, refresh, or search for a specific place below.";
    $("#refreshPlanSuggestions").classList.remove("hidden");
  } catch (e) {
    if (seq !== plannerSeq) return;
    $("#planSuggestionsStatus").textContent =
      "Suggestions could not load. Refresh to retry or search for a place below.";
    $("#refreshPlanSuggestions").classList.remove("hidden");
  } finally {
    if (seq === plannerSeq) setSuggestionsLoading(false);
  }
}
// The markup is present before this script; application state is read only on interaction.
document.querySelector("#refreshPlanSuggestions").onclick = requestPlannerSuggestions;
document.querySelector("#planUseLocation").onclick = () => {
  if (!navigator.geolocation) {
    document.querySelector("#planMapStatus").textContent =
      "Location is unavailable. Choose Another location above.";
    return;
  }
  document.querySelector("#regionSearchStatus").textContent =
    "Finding your starting location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.location = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        at: Date.now(),
      };
      document.querySelector("#start").value = "gps";
      conditional();
      save();
      refreshPlanner();
      document.querySelector("#regionSearchStatus").textContent =
        "Starting from your current location.";
    },
    () => {
      document.querySelector("#regionSearchStatus").textContent =
        "Location unavailable. Choose Another location or Explore around destination above.";
      refreshPlanner();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
};
