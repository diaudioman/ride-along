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
    const center = state.regionCenter;
    let key = JSON.stringify([p.name, center?.lat, center?.lon]);
    if (RouteEfficiency.mapped(state.customEndpoints?.[key]))
      return state.customEndpoints[key];
    if (!plannerGeoCache.has(key))
      plannerGeoCache.set(
        key,
        geocodeMany(p.name, 8, center)
          .then((results) => {
            // Bias alone is not a boundary: reject worldwide fallback matches.
            const nearby = results.filter(
              (p) =>
                RouteEfficiency.mapped(p) &&
                (!center || miles(center, p) <= 100),
            );
            const p = nearby[0] || null;
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
function plannedStops(start, finish) {
  const stops = state.planStops.map((p) => ({ ...p }));
  const destination = state.regionCenter;
  const actualFinish = finish === "return" ? start : finish;
  if (
    RouteEfficiency.mapped(destination) &&
    !(
      RouteEfficiency.mapped(actualFinish) &&
      miles(destination, actualFinish) < 0.08
    ) &&
    !(RouteEfficiency.mapped(start) && miles(destination, start) < 0.08) &&
    !stops.some(
      (p) => RouteEfficiency.mapped(p) && miles(destination, p) < 0.08,
    )
  ) {
    stops.push({
      ...destination,
      id: "destination-" + destination.lat + "," + destination.lon,
      visit: 30,
      cats: ["Destination"],
      desc: "Your selected destination.",
      requiredDestination: true,
    });
  }
  return stops;
}
function plannerTrip(start, finish) {
  return {
    start,
    finish,
    stops: plannedStops(start, finish),
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
    let trip = hasStart && finish ? plannerTrip(start, finish) : null;
    let points = trip ? RouteEfficiency.context(trip)?.points : null;
    if (!points) {
      points = [state.regionCenter];
      trip = null;
    }
    // A region-only exploration has no drive until a stop is selected.
    let routed = points.length > 1 ? await roadRoute(points, true) : null;
    if (seq !== plannerSeq) return;
    const invalid = trip && !routed ? distantTripStops(trip) : [];
    if (invalid.length || (hasStart && !finish)) {
      const names = invalid.map((p) => p.name).join(", ");
      $("#planMapStatus").textContent = invalid.length
        ? "Correct these saved stops: " + names
        : "Finish location not found near your destination. Enter its city and state.";
      $("#planRouteEstimate").textContent =
        "Route unavailable until the locations are corrected.";
      $("#planSuggestionsStatus").textContent =
        "Review your start, finish and selected stops below.";
      drawPlannerMap([state.regionCenter], [], [], false);
      if (invalid.length) {
        const button = document.createElement("button");
        button.textContent = "Remove far-away stops";
        button.onclick = () => {
          const ids = new Set(invalid.map((p) => p.id));
          state.planStops = state.planStops.filter((p) => !ids.has(p.id));
          save();
          renderPlanStops();
        };
        $("#planSuggestions").replaceChildren(button);
      }
      return;
    }
    let line = routed?.geometry || [];
    let drive =
      routed ||
      points.slice(1).reduce(
        (sum, p, i) => {
          let leg = roadEstimate(points[i], p);
          return { mi: sum.mi + (leg.mi || 0), min: sum.min + leg.min };
        },
        { mi: 0, min: 0 },
      );
    let visit = (trip?.stops || state.planStops).reduce(
        (sum, p) => sum + (+p.visit || 30),
        0,
      ),
      total = drive.min + visit,
      budget = $("#planningMode").value === "time" ? +$("#duration").value : 0;
    $("#planMapStatus").textContent = trip
      ? routed
        ? "Driving route shown. Blue pins are suggested attractions."
        : "Road route unavailable or no driving leg is selected. Pins show locations only."
      : "Showing attractions near your destination. Set a starting location above to see the driving route.";
    $("#planRouteEstimate").innerHTML = trip
      ? `<b>${formatMinutes(total)} total · ${drive.mi.toFixed(1)} mi</b><span>${formatMinutes(drive.min)} driving + ${formatMinutes(visit)} visiting</span><small>${routed ? "Road estimate; excludes live traffic." : "Approximate; road route not verified."}</small>${budget ? `<small class="${total > budget ? "warning" : "success"}">${formatMinutes(Math.abs(budget - total))} ${total > budget ? "over your time target" : "remaining"}</small>` : ""}`
      : "<b>Set your starting location to calculate the route.</b><span>You can still browse and add attractions below.</span>";
    drawPlannerMap(points, line, [], !!routed);
    const radius = +$("#planRadius").value || 5,
      maxDetour = +$("#planDetour").value || 20,
      hasRoad = !!routed?.geometry?.length && drive.mi > 0.1;
    // Never treat a straight line as a verified driving corridor.
    let centers = [state.regionCenter];
    if (hasRoad)
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
          !RouteEfficiency.mapped(p) ||
          seen.has(p.name) ||
          state.planStops.some((s) => s.id === p.id || s.name === p.name) ||
          miles(state.regionCenter, p) < 0.08
        )
          continue;
        seen.add(p.name);
        const away = hasRoad
          ? distanceToRoute(p, line)
          : miles(state.regionCenter, p);
        if (!Number.isFinite(away) || away > radius) continue;
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
    ranked = ranked.filter((p) => {
      if (!trip) return true;
      if (!p.detour || p.detour.min > maxDetour) return false;
      return !budget || total + p.detour.min + (+p.visit || 30) <= budget;
    });
    plannerCandidates = ranked;
    let shown = ranked.slice(0, 12);
    showPlannerSuggestions(shown, trip);
    drawPlannerMap(points, line, shown, !!routed);
    $("#planSuggestionsStatus").textContent = shown.length
      ? (hasRoad
          ? `Stops within ${radius} mi of your road route, lowest added driving first.`
          : `Attractions within ${radius} mi of your destination (straight-line distance).`) +
        (trip ? ` Maximum ${maxDetour} min extra driving per stop.` : "") +
        (!hasRoad && trip
          ? " Road route unavailable; browsing near the destination only."
          : "") +
        " Tap Add stop or a blue map pin. Visiting time is separate." +
        (shown.some((p) => p.curated) ? " Includes saved curated places." : "")
      : `No matches within ${radius} mi${trip ? ` and ${maxDetour} min extra driving` : ""}${budget ? " that fit your remaining trip time" : ""}. Increase the limits or search for a specific place below.`;
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
document.querySelector("#refreshPlanSuggestions").onclick =
  requestPlannerSuggestions;
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

for (const id of ["#planRadius", "#planDetour"]) {
  document.querySelector(id).onchange = () => previewPlanRoute();
}

// Let users confirm custom endpoints, including intentional long-distance trips.
for (const kind of ["Start", "Finish"]) {
  const input = document.querySelector("#custom" + kind);
  const results = document.createElement("div");
  results.className = "stopSuggestions hidden";
  results.setAttribute("aria-label", kind + " location matches");
  input.parentElement.append(results);
  let timer,
    request = 0;
  input.oninput = () => {
    const seq = ++request,
      text = input.value.trim();
    clearTimeout(timer);
    results.replaceChildren();
    results.classList.add("hidden");
    previewPlanRoute();
    if (text.length < 3) return;
    timer = setTimeout(async () => {
      try {
        const found = await geocodeMany(text, 8, state.regionCenter);
        if (seq !== request || input.value.trim() !== text) return;
        results.classList.remove("hidden");
        if (!found.length)
          results.textContent = "No matches. Add city and state.";
        for (const point of found) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "stopSuggestion";
          button.textContent = point.display || point.name;
          button.onclick = () => {
            input.value = point.display || point.name;
            const center = state.regionCenter;
            plannerGeoCache.set(
              JSON.stringify([input.value, center?.lat, center?.lon]),
              Promise.resolve({ ...point, name: input.value }),
            );
            state.customEndpoints = {
              ...state.customEndpoints,
              [JSON.stringify([input.value, center?.lat, center?.lon])]: {
                ...point,
                name: input.value,
              },
            };
            results.classList.add("hidden");
            previewPlanRoute();
          };
          results.append(button);
        }
      } catch {
        if (seq === request) {
          results.textContent = "Search unavailable. Try again shortly.";
          results.classList.remove("hidden");
        }
      }
    }, 600);
  };
}
