const { test } = require("node:test"),
  assert = require("node:assert/strict");
const core = require("../core.js");
test("saved trips are isolated snapshots, limited to five and replaceable explicitly", () => {
  const trip = {
    start: { name: "Start", lat: 35, lon: -111 },
    finish: "return",
    stops: [{ name: "Museum", visit: 30 }],
  };
  let entries = [];
  for (let i = 0; i < 5; i++)
    entries = core.saveTripPreset(entries, "Trip " + i, trip, {
      walking: "easy",
    });
  assert.equal(entries.length, 5);
  trip.stops[0].visit = 90;
  assert.equal(entries[0].trip.stops[0].visit, 30);
  assert.throws(
    () => core.saveTripPreset(entries, "Sixth", trip),
    /five slots/,
  );
  const replacement = core.saveTripPreset(
    entries,
    "Updated",
    trip,
    {},
    entries[1].id,
  );
  assert.equal(replacement.length, 5);
  assert.equal(replacement[1].trip.stops[0].visit, 90);
  assert.equal(entries[1].name, "Trip 1");
  assert.throws(() => core.saveTripPreset(entries, "", trip), /name/);
  assert.throws(() => core.saveTripPreset(entries, "Name", null), /itinerary/);
});
test("legacy visited progress migrates and malformed saved trip entries are excluded", () => {
  const trip = {
    start: {},
    finish: "last",
    stops: [{ name: "Museum", done: true }],
  };
  const state = core.normalize({
    trip,
    savedTrips: [
      null,
      {},
      { id: "a", name: "Good", trip },
      { id: "a", name: "Duplicate", trip },
    ],
  });
  assert.equal(state.visited[0].name, "Museum");
  assert.equal(state.savedTrips.length, 1);
  assert.deepEqual(state.dismissed, []);
  assert.equal(core.normalize({ trip, visited: [] }).visited.length, 0);
});
test("corrupted saved JSON cannot crash startup", () => {
  const state = core.read({ getItem: () => "{broken" });
  assert.equal(state.trip, null);
  assert.deepEqual(state.planStops, []);
  assert.match(core.storageWarning, /could not/);
});
test("storage quota errors are visible and do not crash interactions", () => {
  assert.equal(
    core.write(
      {
        setItem() {
          throw Error("Quota");
        },
      },
      {},
    ),
    false,
  );
  assert.match(core.storageWarning, /could not save/);
});
test("loaded stops are normalized and missing fields receive safe defaults", () => {
  const state = core.normalize({
    planStops: [null, { name: "A", lat: "35", lon: "-111", visit: -20 }],
    favs: "bad",
    trip: {},
  });
  assert.equal(state.planStops.length, 1);
  assert.equal(state.planStops[0].visit, 0);
  assert.equal(state.planStops[0].lat, 35);
  assert.deepEqual(state.favs, []);
  assert.equal(state.trip, null);
});
test("place text cannot inject markup and URLs reject executable protocols", () => {
  assert.equal(
    core.escapeHTML('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  );
  assert.equal(core.safeURL("javascript:alert(1)"), "#");
  assert.equal(
    core.safeURL("https://example.com/?a=1&b=2"),
    "https://example.com/?a=1&amp;b=2",
  );
});
test("invalid coordinate ranges are not treated as mapped points", () => {
  assert.equal(core.point({ lat: 100, lon: 200 }).lat, null);
  assert.equal(
    require("../route-efficiency.js").mapped({ lat: 100, lon: 200 }),
    false,
  );
});
const vm = require("node:vm"),
  fs = require("node:fs");
test("skipped stops contribute neither driving nor visiting time", async () => {
  const source = fs.readFileSync("app.js", "utf8"),
    s = {
      state: {
        trip: {
          start: { lat: 0, lon: 0 },
          finish: "return",
          stops: [
            { lat: 0, lon: 1, visit: 30 },
            { lat: 0, lon: 50, visit: 90, skipped: true },
          ],
        },
      },
      roadEstimate: (a, b) => ({
        min: Math.abs(a.lon - b.lon) * 10,
        mi: Math.abs(a.lon - b.lon),
      }),
      save() {},
      roadRoute: async () => null,
      mappedFinish: (t) => t.start,
    };
  vm.createContext(s);
  vm.runInContext(
    source.slice(
      source.indexOf("function recalc()"),
      source.indexOf("function mapsUrl("),
    ),
    s,
  );
  await s.recalc();
  assert.equal(s.state.trip.estimated, 50);
  assert.equal(s.state.trip.stops[1].driveMin, 0);
});
test("road-leg refresh updates itinerary totals from driving service", async () => {
  const source = fs.readFileSync("app.js", "utf8"),
    s = {
      state: {
        trip: {
          start: { lat: 0, lon: 0 },
          finish: "last",
          stops: [{ lat: 0, lon: 1, visit: 30 }],
        },
      },
      roadEstimate: () => ({ min: 100, mi: 100 }),
      save() {},
      roadRoute: async () => ({
        min: 12,
        mi: 5,
        legs: [{ duration: 720, distance: 8046.72 }],
        geometry: [],
      }),
      mappedFinish: () => null,
      renderTrip() {},
    };
  vm.createContext(s);
  vm.runInContext(
    source.slice(
      source.indexOf("function recalc()"),
      source.indexOf("function mapsUrl("),
    ),
    s,
  );
  await s.recalc();
  assert.equal(s.state.trip.estimated, 42);
  assert.equal(s.state.trip.roadVerified, true);
});
test("skipped stops do not distort route insertion slots", () => {
  const r = require("../route-efficiency.js"),
    p = (lon) => ({ lat: 0, lon });
  const t = {
    start: p(0),
    stops: [{ ...p(50), skipped: true }, p(10)],
    finish: "last",
  };
  const d = r.bestInsertion(r.context(t), p(5), (a, b) => ({
    mi: Math.abs(a.lon - b.lon),
    min: Math.abs(a.lon - b.lon),
  }));
  assert.equal(d.index, 1);
  assert.equal(d.mi, 0);
});
