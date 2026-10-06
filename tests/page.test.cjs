const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { JSDOM } = require("jsdom");
function openApp(saved) {
  const dom = new JSDOM(fs.readFileSync("index.html", "utf8"), {
      url: "https://ride.test/",
      runScripts: "outside-only",
    }),
    w = dom.window;
  w.scrollTo = () => {};
  w.confirm = () => true;
  w.alert = () => {};
  w.structuredClone = structuredClone;
  w.AbortSignal = AbortSignal;
  w.AbortController = AbortController;
  w.Response = Response;
  w.fetch = async (url) => {
    throw Error("Offline fixture");
  };
  if (saved) w.localStorage.setItem("rideAlongStateV3", saved);
  for (const file of [
    "core.js",
    "places.js",
    "route-efficiency.js",
    "planner.js",
    "app.js",
  ])
    vm.runInContext(fs.readFileSync(file, "utf8"), dom.getInternalVMContext(), {
      filename: file,
    });
  return {
    dom,
    w,
    context: dom.getInternalVMContext(),
    $: (id) => w.document.querySelector(id),
  };
}
test("complete page starts with corrupt storage and both planning modes remain usable", () => {
  const app = openApp("{corrupt");
  try {
    app.$('[data-mode="places"]').click();
    assert.equal(app.$("#planningMode").value, "places");
    assert.equal(app.$("#durationWrap").classList.contains("hidden"), true);
    app.$('[data-mode="time"]').click();
    assert.equal(app.$("#durationWrap").classList.contains("hidden"), false);
    assert.equal(
      app.w.localStorage.getItem("rideAlongStateV3.recovery"),
      "{corrupt",
    );
  } finally {
    app.dom.window.close();
  }
});
test("real planner DOM displays curated suggestions when the live service is offline", async () => {
  const app = openApp();
  try {
    vm.runInContext(
      "state.regionCenter={name:'Sunset Crater',lat:35.371,lon:-111.511};document.querySelector('#start').value='region';document.querySelector('#finish').value='destination';plannerSeq=1",
      app.context,
    );
    await vm.runInContext("loadPlanner(1,false)", app.context);
    assert.ok(app.$("#planSuggestions").children.length > 0);
    assert.match(app.$("#planSuggestionsStatus").textContent, /curated/);
    app.$("#planSuggestions button").click();
    assert.ok(app.$("#selectedPlanStops").textContent.includes("Visit"));
  } finally {
    app.dom.window.close();
  }
});
test("saved trip rendering escapes injected place names and retains usable actions", () => {
  const trip = {
    start: { name: "Start", lat: 35, lon: -111 },
    finish: "return",
    stops: [
      {
        id: "x",
        name: "<img src=x onerror=alert(1)>",
        lat: 35.1,
        lon: -111,
        visit: 30,
      },
    ],
    region: "Test",
  };
  const app = openApp(JSON.stringify({ trip }));
  try {
    assert.equal(app.$("#tripStops img"), null);
    assert.match(app.$("#tripStops").textContent, /<img/);
    app.$('#tripStops [data-a="skip"]').click();
    assert.match(app.$("#tripStops").textContent, /Skipped/);
  } finally {
    app.dom.window.close();
  }
});

test("suggest button immediately reveals destination guidance instead of silently updating above viewport", () => {
  const app = openApp();
  try {
    let revealed = false,
      focused = false;
    const status = app.$("#planSuggestionsStatus");
    status.scrollIntoView = () => {
      revealed = true;
    };
    status.focus = () => {
      focused = true;
    };
    vm.runInContext("state.regionCenter=null", app.context);
    app.$("#findRegionThings").click();
    assert.equal(revealed, true);
    assert.equal(focused, true);
    assert.match(status.textContent, /Choose a destination/);
    assert.equal(app.$("#findRegionThings").disabled, false);
  } finally {
    app.dom.window.close();
  }
});
test("suggest button shows immediate loading feedback while revealing results", () => {
  const app = openApp();
  try {
    const status = app.$("#planSuggestionsStatus");
    status.scrollIntoView = () => {};
    vm.runInContext(
      "state.regionCenter={name:'Sedona',lat:34.87,lon:-111.76}",
      app.context,
    );
    app.$("#findRegionThings").click();
    assert.equal(app.$("#findRegionThings").disabled, true);
    assert.match(app.$("#findRegionThings").textContent, /Finding places/);
    assert.equal(app.$("#planSuggestions").getAttribute("aria-busy"), "true");
    vm.runInContext("clearTimeout(plannerTimer)", app.context);
  } finally {
    app.dom.window.close();
  }
});

test("saved Arizona itinerary with an overseas stop shows correction instead of impossible total", async () => {
  const trip = {
    start: { name: "Sedona", lat: 34.87, lon: -111.76 },
    finish: { name: "Meteor Crater Arizona", lat: 35.03, lon: -111.02 },
    stops: [
      { id: "bad", name: "Wrong overseas match", lat: 39, lon: 42, visit: 30 },
      { id: "local", name: "Local stop", lat: 35, lon: -111.1, visit: 30 },
    ],
    estimated: 17920,
    region: "Arizona",
  };
  const app = openApp(JSON.stringify({ trip }));
  try {
    assert.match(app.$("#tripSummary").textContent, /Wrong overseas match/);
    assert.doesNotMatch(app.$("#tripSummary").textContent, /17920/);
    await app.$("#removeDistantStops").onclick();
    assert.equal(vm.runInContext("state.trip.stops.length", app.context), 1);
    assert.equal(
      vm.runInContext("state.trip.stops[0].id", app.context),
      "local",
    );
    assert.equal(app.$("#removeDistantStops"), null);
  } finally {
    app.dom.window.close();
  }
});
test("typing a stop cannot silently add the first worldwide match", async () => {
  const app = openApp();
  try {
    app.$("#planStopName").value = "Meteor Crater";
    await app.$("#addPlanStop").onclick();
    assert.equal(vm.runInContext("state.planStops.length", app.context), 0);
    assert.match(
      app.$("#planStopMsg").textContent,
      /Choose the correct search result/,
    );
  } finally {
    app.dom.window.close();
  }
});

test("hotel finish retains the selected destination and edit plan restores endpoints", async () => {
  const app = openApp();
  try {
    vm.runInContext(
      `state.regionCenter={name:'Meteor Crater',lat:35.03,lon:-111.02};
 state.planStops=[]; document.querySelector('#customRegion').value='Meteor Crater';
 document.querySelector('#planningMode').value='places';
 resolvePlannerEndpoints=async()=>({start:{name:'Sedona',lat:34.87,lon:-111.76},finish:{name:'Hotel',lat:34.86,lon:-111.8}});
 discoverRegionCandidates=async()=>[];`,
      app.context,
    );
    await vm.runInContext("build()", app.context);
    assert.equal(
      vm.runInContext("state.trip.stops[0].name", app.context),
      "Meteor Crater",
    );
    assert.equal(
      vm.runInContext("state.trip.finish.name", app.context),
      "Hotel",
    );
    app.$("#newPlan").click();
    assert.equal(app.$("#customStart").value, "Sedona");
    assert.equal(app.$("#customFinish").value, "Hotel");
    assert.equal(app.$("#customRegion").value, "Meteor Crater");
  } finally {
    app.dom.window.close();
  }
});
test("Discover cannot add an overseas place when driving is unverified", async () => {
  const app = openApp();
  try {
    vm.runInContext(
      `state.trip={start:{name:'Sedona',lat:34.87,lon:-111.76},finish:{name:'Crater',lat:35.03,lon:-111.02},stops:[]};
 rankByDriving=async list=>list.map(p=>({...p,detour:{index:0,min:10000,mi:8000}}));`,
      app.context,
    );
    await vm.runInContext(
      "addToTrip({id:'bad',name:'Overseas',lat:39,lon:42,visit:30})",
      app.context,
    );
    assert.equal(vm.runInContext("state.trip.stops.length", app.context), 0);
  } finally {
    app.dom.window.close();
  }
});
test("completed stops remain available for manual story replay", () => {
  const app = openApp();
  try {
    vm.runInContext(
      "state.trip={stops:[{id:'done',name:'Completed museum',lat:35,lon:-111,done:true}]}",
      app.context,
    );
    assert.equal(
      vm.runInContext(
        "allTourPlaces(true).some(p=>p.id==='done')",
        app.context,
      ),
      true,
    );
    assert.equal(
      vm.runInContext("allTourPlaces().some(p=>p.id==='done')", app.context),
      false,
    );
  } finally {
    app.dom.window.close();
  }
});
