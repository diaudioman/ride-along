const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
function harness() {
  class Element {
    constructor() {
      this.children = [];
      this.classList = { add() {}, remove() {} };
      this.value = "";
      this.textContent = "";
    }
    setAttribute() {}
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    querySelector() {
      return this.button || (this.button = new Element());
    }
  }
  const elements = new Map();
  const $ = (key) => {
    if (!elements.has(key)) elements.set(key, new Element());
    return elements.get(key);
  };
  $("#planningMode").value = "places";
  let env = {
    document: { querySelector: $, createElement: () => new Element() },
    $,
    window: {},
    navigator: {},
    state: {
      regionCenter: { name: "Destination", lat: 0, lon: 10 },
      planStops: [],
    },
    RouteEfficiency: require("../route-efficiency.js"),
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    Math,
    console,
  };
  env.miles = (a, b) => Math.hypot(a.lon - b.lon, a.lat - b.lat);
  env.roadEstimate = (a, b) => ({
    min: env.miles(a, b) * 2,
    mi: env.miles(a, b),
  });
  env.formatMinutes = (n) => Math.round(n) + " min";
  env.planEndpoints = () => ({
    start: { name: "Start", lat: 0, lon: 0 },
    finish: env.state.regionCenter,
  });
  env.roadRoute = async (points) => ({ min: 20, mi: 10, geometry: points });
  env.discoverRegionCandidates = async () => [
    { id: "mid", name: "Museum", lat: 0, lon: 5, cats: ["History"], visit: 30 },
  ];
  env.distanceToRoute = () => 0;
  env.rankByDriving = async (list, trip) =>
    list.map((p) => ({
      ...p,
      detour: { index: 0, min: 2, mi: 1, routed: true },
    }));
  env.distantTripStops = () => [];
  env.geocodeMany = async (name) => [{ name, lat: 1, lon: 1 }];
  env.geocodeNear = async (name) => ({ name, lat: 1, lon: 1 });
  env.matchesPlanPreferences = () => true;
  env.save = () => {};
  env.renderPlanStops = () => {};
  env.queuePlanStop = (p) => env.state.planStops.push(p);
  vm.createContext(env);
  vm.runInContext(fs.readFileSync("planner.js", "utf8"), env);
  return { env, $ };
}
test("destination preview shows direct driving route before selecting stops and suggests attractions", async () => {
  const { env, $ } = harness();
  await env.loadPlanner(0, false);
  assert.match($("#planRouteEstimate").innerHTML, /20 min total/);
  assert.equal($("#planSuggestions").children.length, 1);
  assert.match($("#planSuggestions").children[0].innerHTML, /Museum/);
  assert.match($("#planSuggestions").children[0].innerHTML, /\+1.0 mi/);
  $("#planSuggestions").children[0].querySelector("button").onclick();
  assert.equal(env.state.planStops[0].id, "mid");
});
test("GPS denial still provides attractions and clearly requests a start", async () => {
  const { env, $ } = harness();
  env.planEndpoints = () => ({ start: null, finish: env.state.regionCenter });
  await env.loadPlanner(0, false);
  assert.match($("#planRouteEstimate").innerHTML, /Set your starting location/);
  assert.equal($("#planSuggestions").children.length, 1);
  assert.match($("#planSuggestions").children[0].innerHTML, /from destination/);
});
test("stale search results cannot overwrite a changed destination", async () => {
  const { env, $ } = harness();
  let resolve;
  env.roadRoute = () => new Promise((r) => (resolve = r));
  let pending = env.loadPlanner(0, false);
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  vm.runInContext("plannerSeq++", env);
  resolve({ min: 20, mi: 10, geometry: [] });
  await pending;
  assert.equal($("#planSuggestions").children.length, 0);
});
test("selected places are omitted from suggestions", async () => {
  const { env, $ } = harness();
  env.state.planStops = [
    { id: "mid", name: "Museum", lat: 0, lon: 5, visit: 30 },
  ];
  await env.loadPlanner(0, false);
  assert.equal($("#planSuggestions").children.length, 0);
  assert.match($("#planSuggestionsStatus").textContent, /No matches/);
});

test("destination-only suggestions exclude far-away and invalid results", async () => {
  const { env, $ } = harness();
  env.planEndpoints = () => ({ start: null, finish: env.state.regionCenter });
  env.discoverRegionCandidates = async () => [
    { id: "near", name: "Nearby", lat: 0, lon: 11 },
    { id: "far", name: "Far away", lat: 0, lon: 30 },
    { id: "invalid", name: "Invalid", lat: 120, lon: 10 },
  ];
  await env.loadPlanner(0, false);
  assert.equal($("#planSuggestions").children.length, 1);
  assert.match($("#planSuggestions").children[0].innerHTML, /Nearby/);
});
test("failed road routing never recommends along an unverified straight line", async () => {
  const { env, $ } = harness();
  env.roadRoute = async () => null;
  env.discoverRegionCandidates = async () => [
    { id: "mid", name: "Straight-line trap", lat: 0, lon: 3 },
    { id: "near", name: "Destination museum", lat: 0, lon: 11 },
  ];
  await env.loadPlanner(0, false);
  assert.equal($("#planSuggestions").children.length, 1);
  assert.match(
    $("#planSuggestions").children[0].innerHTML,
    /Destination museum/,
  );
  assert.match(
    $("#planSuggestionsStatus").textContent,
    /near the destination only/,
  );
});
test("nearby attractions with excessive driving detours are excluded", async () => {
  const { env, $ } = harness();
  env.rankByDriving = async (list) =>
    list.map((p) => ({ ...p, detour: { min: 45, mi: 35 } }));
  await env.loadPlanner(0, false);
  assert.equal($("#planSuggestions").children.length, 0);
  $("#planDetour").value = "60";
  await env.loadPlanner(0, false);
  assert.equal($("#planSuggestions").children.length, 1);
});
test("distance setting and visit time both constrain suggestions", async () => {
  const { env, $ } = harness();
  env.distanceToRoute = () => 3;
  $("#planRadius").value = "2";
  await env.loadPlanner(0, false);
  assert.equal($("#planSuggestions").children.length, 0);
  $("#planRadius").value = "5";
  $("#planningMode").value = "time";
  $("#duration").value = "45";
  await env.loadPlanner(0, false);
  assert.equal($("#planSuggestions").children.length, 0);
  $("#duration").value = "60";
  await env.loadPlanner(0, false);
  assert.equal($("#planSuggestions").children.length, 1);
});

test("planner rejects overseas custom finish rather than drawing a world route", async () => {
  const { env, $ } = harness();
  env.planEndpoints = () => ({
    start: { lat: 0, lon: 0 },
    finish: { name: "Courtyard Sedona", lat: null, lon: null },
  });
  env.geocodeMany = async () => [{ name: "Wrong continent", lat: 0, lon: 150 }];
  await env.loadPlanner(0, false);
  assert.match($("#planMapStatus").textContent, /Finish location not found/);
  assert.match($("#planRouteEstimate").textContent, /Route unavailable/);
});
test("planner flags saved overseas stops before calculating a total", async () => {
  const { env, $ } = harness();
  env.roadRoute = async () => null;
  env.distantTripStops = () => [{ id: "bad", name: "Overseas stop" }];
  await env.loadPlanner(0, false);
  assert.match($("#planMapStatus").textContent, /Overseas stop/);
  assert.match($("#planRouteEstimate").textContent, /Route unavailable/);
  assert.equal(
    $("#planSuggestions").children[0].textContent,
    "Remove far-away stops",
  );
});
