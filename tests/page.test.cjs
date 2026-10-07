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

test("direct trip retains its named finish without turning the hotel into a sightseeing stop", async () => {
  const app = openApp();
  try {
    vm.runInContext(
      `state.regionCenter={name:'Crater',lat:35.03,lon:-111.02};
 document.querySelector('#customRegion').value='Crater'; document.querySelector('#planningMode').value='places';
 resolvePlannerEndpoints=async()=>({start:state.regionCenter,finish:{name:'Hotel',lat:34.85,lon:-111.83}});
 discoverRegionCandidates=async()=>[];`,
      app.context,
    );
    await vm.runInContext("build()", app.context);
    assert.equal(
      vm.runInContext("state.trip.finish.name", app.context),
      "Hotel",
    );
    assert.equal(vm.runInContext("state.trip.stops.length", app.context), 0);
  } finally {
    app.dom.window.close();
  }
});

test("Create itinerary automatically reorders stops and preserves the finish", async () => {
  const app = openApp();
  try {
    vm.runInContext(
      `state.regionCenter={name:'Finish',lat:35,lon:-111};
 state.planStops=[{id:'far',name:'Far',lat:35,lon:-111.1,visit:10},{id:'near',name:'Near',lat:35,lon:-111.8,visit:10}];
 document.querySelector('#customRegion').value='Finish';document.querySelector('#planningMode').value='places';
 resolvePlannerEndpoints=async()=>({start:{name:'Start',lat:35,lon:-112},finish:state.regionCenter});
 discoverRegionCandidates=async()=>[];`,
      app.context,
    );
    await vm.runInContext("build()", app.context);
    assert.equal(
      vm.runInContext("state.trip.stops[0].id", app.context),
      "near",
    );
    assert.equal(vm.runInContext("state.trip.stops[1].id", app.context), "far");
    assert.equal(
      vm.runInContext("state.trip.finish.name", app.context),
      "Finish",
    );
  } finally {
    app.dom.window.close();
  }
});

test("visited controls persist, suppress recommendations, and support undo", () => {
  const app = openApp();
  try {
    const button = app.$("#places .visitedButton");
    assert.ok(button);
    button.click();
    assert.equal(vm.runInContext("state.visited.length", app.context), 1);
    assert.equal(
      vm.runInContext("matchesPlanPreferences(state.visited[0])", app.context),
      false,
    );
    const saved = app.w.localStorage.getItem("rideAlongStateV3");
    assert.equal(JSON.parse(saved).visited.length, 1);
    const reopened = openApp(saved);
    try {
      assert.equal(
        reopened.$("#visitedPlaces .visitedButton").textContent,
        "Visited ✓ · Undo",
      );
      reopened.$("#visitedPlaces .visitedButton").click();
      assert.equal(
        vm.runInContext("state.visited.length", reopened.context),
        0,
      );
    } finally {
      reopened.dom.window.close();
    }
  } finally {
    app.dom.window.close();
  }
});

function configureTimePlan(app, extra = "") {
  vm.runInContext(
    `
    state.regionCenter={name:'Finish',lat:35,lon:-111};
    document.querySelector('#customRegion').value='Finish';
    document.querySelector('#planningMode').value='time';
    document.querySelector('#duration').value='120';
    resolvePlannerEndpoints=async()=>({start:{name:'Start',lat:35,lon:-111.1},finish:state.regionCenter});
    discoverRegionCandidates=async()=>[];
    drivingCosts=async()=>({leg:(a,b)=>({min:Math.abs(a.lon-b.lon)*200,mi:Math.abs(a.lon-b.lon)*50}),routed:true});
    roadRoute=async points=>{
      const legs=points.slice(1).map((p,i)=>({duration:Math.abs(points[i].lon-p.lon)*12000,distance:Math.abs(points[i].lon-p.lon)*80467.2}));
      return {min:legs.reduce((n,p)=>n+p.duration/60,0),mi:legs.reduce((n,p)=>n+p.distance/1609.344,0),legs,geometry:points};
    };
    ${extra}
  `,
    app.context,
  );
}

test("time planning inserts scenic stops before the fixed last-stop destination", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      `
      resolvePlannerEndpoints=async()=>({start:{name:'Start',lat:35,lon:-111.1},finish:'last'});
      plannerCandidates=[{id:'view',name:'Viewpoint',lat:35,lon:-111.08,visit:15,cats:['Scenic views']}];
    `,
    );
    await vm.runInContext("build()", app.context);
    const trip = JSON.parse(
      vm.runInContext("JSON.stringify(state.trip)", app.context),
    );
    assert.equal(trip.stops[0].id, "view");
    assert.equal(trip.stops.at(-1).requiredDestination, true);
    assert.equal(trip.finish, "last");
    assert.ok(trip.estimated <= 120);
    assert.equal(trip.roadVerified, true);
  } finally {
    app.dom.window.close();
  }
});

test("final road time removes automatic additions without removing selected stops", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      `
      document.querySelector('#duration').value='90';
      state.planStops=[{id:'must',name:'Selected museum',lat:35,lon:-111.09,visit:15,cats:['History']}];
      plannerCandidates=[{id:'extra',name:'Optional view',lat:35,lon:-111.08,visit:30,cats:['Scenic views']}];
      roadRoute=async points=>{
        const min=points.some(p=>p.id==='extra')?100:20;
        return {min,mi:5,legs:points.slice(1).map(()=>({duration:min*60/(points.length-1),distance:1000})),geometry:points};
      };
    `,
    );
    await vm.runInContext("build()", app.context);
    assert.equal(vm.runInContext("state.trip.stops.length", app.context), 1);
    assert.equal(
      vm.runInContext("state.trip.stops[0].id", app.context),
      "must",
    );
    assert.equal(vm.runInContext("state.trip.estimated", app.context), 35);
    assert.equal(
      vm.runInContext("state.trip.timeOverride", app.context),
      false,
    );
  } finally {
    app.dom.window.close();
  }
});

test("selected stops over the real road budget require the explicit time override", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      `
      document.querySelector('#duration').value='60';
      state.planStops=[{id:'must',name:'Museum',lat:35,lon:-111.08,visit:30,cats:['History']}];
      roadRoute=async points=>({min:80,mi:40,legs:points.slice(1).map(()=>({duration:2400,distance:16093})),geometry:points});
    `,
    );
    await vm.runInContext("build()", app.context);
    assert.equal(vm.runInContext("state.trip", app.context), null);
    assert.match(app.$("#planMsg").textContent, /selected route needs/);
    app.$("#planOverrideTime").checked = true;
    await vm.runInContext("build()", app.context);
    assert.equal(vm.runInContext("state.trip.timeOverride", app.context), true);
    assert.equal(vm.runInContext("state.trip.estimated", app.context), 110);
  } finally {
    app.dom.window.close();
  }
});

test("changing the draft during asynchronous routing cannot overwrite the current itinerary", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      "resolvePlannerEndpoints=()=>new Promise(resolve=>window.finishResolution=resolve);",
    );
    const pending = vm.runInContext("build()", app.context);
    app.$("#duration").value = "90";
    vm.runInContext(
      "window.finishResolution({start:{name:'Start',lat:35,lon:-111.1},finish:state.regionCenter})",
      app.context,
    );
    await pending;
    assert.equal(vm.runInContext("state.trip", app.context), null);
    assert.match(app.$("#planMsg").textContent, /plan changed/);
  } finally {
    app.dom.window.close();
  }
});

test("declining an over-budget addition leaves the itinerary and persisted state untouched", async () => {
  const app = openApp();
  try {
    configureTimePlan(app);
    await vm.runInContext("build()", app.context);
    vm.runInContext("state.trip.budget=30;save();", app.context);
    const before = app.w.localStorage.getItem("rideAlongStateV3");
    app.w.confirm = () => false;
    vm.runInContext(
      "rankByDriving=async list=>list.map(p=>({...p,detour:{index:0,min:5,mi:1,routed:true}}));",
      app.context,
    );
    await vm.runInContext(
      "addToTrip({id:'extra',name:'Extra stop',lat:35,lon:-111.05,visit:60})",
      app.context,
    );
    assert.equal(vm.runInContext("state.trip.stops.length", app.context), 0);
    assert.equal(app.w.localStorage.getItem("rideAlongStateV3"), before);
  } finally {
    app.dom.window.close();
  }
});

test("verified routes and visited progress survive offline reopening and marking visited", async () => {
  const trip = {
    start: { name: "Start", lat: 35, lon: -111.1 },
    finish: "last",
    stops: [
      {
        id: "a",
        name: "Museum",
        lat: 35,
        lon: -111,
        visit: 30,
        driveMin: 20,
        driveMiles: 5,
      },
    ],
    estimated: 50,
    roadVerified: true,
    roadGeometry: [
      { lat: 35, lon: -111.1 },
      { lat: 35, lon: -111 },
    ],
    region: "Test",
    finalLeg: { min: 0, mi: 0 },
  };
  const app = openApp(JSON.stringify({ trip }));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(vm.runInContext("state.trip.roadVerified", app.context), true);
    app.$('#tripStops [data-a="done"]').click();
    assert.equal(vm.runInContext("state.trip.roadVerified", app.context), true);
    assert.equal(vm.runInContext("state.trip.estimated", app.context), 50);
    const reopened = openApp(app.w.localStorage.getItem("rideAlongStateV3"));
    try {
      assert.equal(
        vm.runInContext("state.trip.stops[0].done", reopened.context),
        true,
      );
      assert.match(reopened.$("#tripSummary").textContent, /1 visited/);
      assert.equal(
        vm.runInContext("state.trip.roadGeometry.length", reopened.context),
        2,
      );
    } finally {
      reopened.dom.window.close();
    }
  } finally {
    app.dom.window.close();
  }
});

test("Not interested persists across reopening, hides recommendations, and supports undo", () => {
  const app = openApp();
  try {
    const p = JSON.parse(
      vm.runInContext("JSON.stringify(PLACES[0])", app.context),
    );
    app.$("#places .dismissedButton").click();
    assert.equal(vm.runInContext("isDismissed(PLACES[0])", app.context), true);
    assert.equal(
      vm.runInContext("matchesPlanPreferences(PLACES[0])", app.context),
      false,
    );
    assert.ok(!app.$("#places").textContent.includes(p.name));
    const reopened = openApp(app.w.localStorage.getItem("rideAlongStateV3"));
    try {
      assert.ok(reopened.$("#dismissedPlaces").textContent.includes(p.name));
      reopened.$("#dismissedPlaces .dismissedButton").click();
      assert.equal(
        vm.runInContext("isDismissed(PLACES[0])", reopened.context),
        false,
      );
      assert.ok(reopened.$("#places").textContent.includes(p.name));
    } finally {
      reopened.dom.window.close();
    }
  } finally {
    app.dom.window.close();
  }
});

test("five named trips survive reload, support replacement, and restore independent snapshots", async () => {
  const app = openApp();
  try {
    configureTimePlan(app);
    await vm.runInContext("build()", app.context);
    for (let i = 0; i < 5; i++) {
      app.$("#saveTripName").value = "Trip " + i;
      app.$("#saveNamedTrip").click();
    }
    assert.equal(app.$("#savedTripCount").textContent, "5 / 5");
    app.$("#saveTripName").value = "Sixth";
    app.$("#saveNamedTrip").click();
    assert.match(app.$("#saveTripMsg").textContent, /five slots/);
    const id = vm.runInContext("state.savedTrips[0].id", app.context);
    app.$("#saveTripSlot").value = id;
    app.$("#saveTripName").value = "Updated first";
    app.$("#saveNamedTrip").click();
    const reopened = openApp(app.w.localStorage.getItem("rideAlongStateV3"));
    try {
      assert.match(reopened.$("#savedTripList").textContent, /Updated first/);
      reopened.$('[data-saved="open"]').click();
      assert.equal(reopened.$("#trip").classList.contains("active"), true);
      vm.runInContext("state.trip.region='Changed current';", reopened.context);
      assert.equal(
        vm.runInContext("state.savedTrips[0].trip.region", reopened.context),
        "Finish",
      );
    } finally {
      reopened.dom.window.close();
    }
  } finally {
    app.dom.window.close();
  }
});

test("an unselected custom hotel cannot silently use the first local or worldwide match", async () => {
  const app = openApp();
  try {
    vm.runInContext(
      `
      state.regionCenter={name:'Sedona',lat:34.87,lon:-111.76};
      document.querySelector('#start').value='region';
      document.querySelector('#finish').value='custom';
      document.querySelector('#customFinish').value='Courtyard Sedona';
      geocodeMany=async()=>[{name:'Wrong hotel',lat:34.8,lon:-111.7}];
    `,
      app.context,
    );
    const result = await vm.runInContext(
      "resolvePlannerEndpoints()",
      app.context,
    );
    assert.equal(result.finish, null);
  } finally {
    app.dom.window.close();
  }
});

test("zero-minute visits remain zero in the editor and route preview", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      `
      state.planStops=[{id:'pass',name:'Drive-through point',lat:35,lon:-111.08,visit:0,cats:['Scenic views']}];
      document.querySelector('#planningMode').value='places';
      renderPlanStops();
    `,
    );
    assert.equal(app.$("#selectedPlanStops select").value, "0");
    await vm.runInContext("build()", app.context);
    assert.equal(vm.runInContext("state.trip.stops[0].visit", app.context), 0);
    assert.equal(vm.runInContext("state.trip.estimated", app.context), 20);
  } finally {
    app.dom.window.close();
  }
});

test("road routing rejects excessive snapping and malformed driving durations", async () => {
  const app = openApp();
  try {
    let payload = {
      code: "Ok",
      waypoints: [{ distance: 0 }, { distance: 800 }],
      routes: [
        {
          duration: 120,
          distance: 200,
          legs: [{ duration: 120, distance: 200 }],
        },
      ],
    };
    app.w.fetch = async () =>
      new Response(JSON.stringify(payload), { status: 200 });
    assert.equal(
      await vm.runInContext(
        "roadRoute([{lat:35,lon:-111},{lat:35,lon:-111.01}])",
        app.context,
      ),
      null,
    );
    payload.waypoints[1].distance = 10;
    payload.routes[0].legs[0].duration = null;
    assert.equal(
      await vm.runInContext(
        "roadRoute([{lat:35,lon:-111},{lat:35,lon:-111.02}])",
        app.context,
      ),
      null,
    );
    payload.routes[0].legs[0].duration = 120;
    const valid = await vm.runInContext(
      "roadRoute([{lat:35,lon:-111},{lat:35,lon:-111.03}])",
      app.context,
    );
    assert.equal(valid.min, 2);
  } finally {
    app.dom.window.close();
  }
});

test("automatic attractions are withheld when road detours cannot be verified", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      `
      plannerCandidates=[{id:'extra',name:'Unverified attraction',lat:35,lon:-111.08,visit:15,cats:['Scenic views']}];
      drivingCosts=async()=>({leg:roadEstimate,routed:false});
    `,
    );
    await vm.runInContext("build()", app.context);
    assert.equal(vm.runInContext("state.trip.stops.length", app.context), 0);
    assert.match(
      app.$("#planMsg").textContent,
      /detours could not be verified/,
    );
  } finally {
    app.dom.window.close();
  }
});

test("scenic stops win a small driving tradeoff while staying within the time target", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      `
      document.querySelector('#duration').value='60';
      plannerCandidates=[
        {id:'ordinary',name:'Museum',lat:35,lon:-111.05,visit:30,cats:['History']},
        {id:'scenic',name:'Panorama',lat:35,lon:-111.04,visit:30,cats:['Scenic views']}
      ];
      drivingCosts=async()=>({leg:(a,b)=>({min:Math.abs(a.lon-b.lon)*200 + ((a.id==='scenic'||b.id==='scenic')?2:0),mi:Math.abs(a.lon-b.lon)*50}),routed:true});
    `,
    );
    await vm.runInContext("build()", app.context);
    assert.equal(
      vm.runInContext("state.trip.stops[0].id", app.context),
      "scenic",
    );
    assert.equal(vm.runInContext("state.trip.stops.length", app.context), 1);
    assert.ok(vm.runInContext("state.trip.estimated<=60", app.context));
  } finally {
    app.dom.window.close();
  }
});

test("changing only visit duration preserves verified road geometry and adjusts the total", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      `state.planStops=[{id:'a',name:'Museum',lat:35,lon:-111.08,visit:30}];document.querySelector('#planningMode').value='places';`,
    );
    await vm.runInContext("build()", app.context);
    const before = vm.runInContext("state.trip.estimated", app.context);
    app.$('#tripStops [data-a="plus"]').click();
    assert.equal(vm.runInContext("state.trip.roadVerified", app.context), true);
    assert.equal(
      vm.runInContext("state.trip.estimated", app.context),
      before + 5,
    );
    assert.ok(vm.runInContext("state.trip.roadGeometry.length>1", app.context));
  } finally {
    app.dom.window.close();
  }
});

test("editing a search hides old destination and stop choices immediately", () => {
  const app = openApp();
  try {
    vm.runInContext(
      "showRegionSuggestions([{name:'Old result',display:'Old result, old city',lat:35,lon:-111}]);showPlanSuggestions([{name:'Old stop',display:'Old stop, old city',lat:35,lon:-111}]);",
      app.context,
    );
    app.$("#customRegion").value = "New destination";
    app.$("#customRegion").dispatchEvent(new app.w.Event("input"));
    assert.equal(
      app.$("#regionSuggestions").classList.contains("hidden"),
      true,
    );
    assert.equal(app.$("#regionSuggestions").children.length, 0);
    app.$("#planStopName").value = "New stop";
    app.$("#planStopName").dispatchEvent(new app.w.Event("input"));
    assert.equal(
      app.$("#planStopSuggestions").classList.contains("hidden"),
      true,
    );
  } finally {
    app.dom.window.close();
  }
});

test("creating a time plan before preview completion still discovers attractions along the road route", async () => {
  const app = openApp();
  try {
    configureTimePlan(
      app,
      `
      plannerCandidates=[];
      window.queriedCenters=[];
      discoverRegionCandidates=async center=>{
        window.queriedCenters.push(center.lon);
        return center.lon===-111.1 ? [{id:'road-view',name:'View near the start',lat:35,lon:-111.09,visit:15,cats:['Scenic views']}] : [];
      };
    `,
    );
    await vm.runInContext("build()", app.context);
    assert.equal(
      vm.runInContext("state.trip.stops[0].id", app.context),
      "road-view",
    );
    assert.ok(app.w.queriedCenters.includes(-111.1));
    assert.ok(
      vm.runInContext("state.trip.estimated<=state.trip.budget", app.context),
    );
  } finally {
    app.dom.window.close();
  }
});

test("visited and rejected places match named search results with address suffixes", () => {
  const app = openApp();
  try {
    vm.runInContext(
      `state.visited=[AppCore.place({id:'search',name:'Oak Creek Vista, Coconino County, Arizona, United States',lat:35.0291,lon:-111.7379})];`,
      app.context,
    );
    assert.equal(
      vm.runInContext(
        "isVisited({id:'osm',name:'Oak Creek Vista',lat:35.0291,lon:-111.7379})",
        app.context,
      ),
      true,
    );
    assert.equal(
      vm.runInContext(
        "isVisited({id:'other',name:'Different attraction',lat:35.0291,lon:-111.7379})",
        app.context,
      ),
      false,
    );
    assert.equal(
      vm.runInContext(
        "isVisited({id:'other',name:'Oak Creek Vista',lat:40,lon:-111})",
        app.context,
      ),
      false,
    );
    vm.runInContext(
      "state.dismissed=[...state.visited];setVisited({id:'osm',name:'Oak Creek Vista',lat:35.0291,lon:-111.7379},false);",
      app.context,
    );
    assert.equal(vm.runInContext("state.visited.length", app.context), 0);
    assert.equal(
      vm.runInContext(
        "isDismissed({id:'osm',name:'Oak Creek Vista',lat:35.0291,lon:-111.7379})",
        app.context,
      ),
      true,
    );
  } finally {
    app.dom.window.close();
  }
});
