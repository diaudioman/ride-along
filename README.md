# Ride Along — Standalone

A portable mobile-first web app/PWA. No Replit account or proprietary backend is required.

## Run
Serve this folder with any static web server. GPS and service workers generally require HTTPS (or localhost). Opening index.html directly will show the interface, but browsers may block GPS/offline service-worker behavior from file:// URLs.

## Implemented
- Plan / My Trip / Discover / Nearby
- 30-minute durations from 30 minutes through 12 hours
- flexible endpoints, including custom hotel/destination
- feasibility checks and approximate road-time estimates clearly labeled as estimates
- editable/reorderable/persistent itinerary and progress
- Google Maps handoff
- 40+ curated northern Arizona records with source attribution
- GPS nearby sorting and foreground story triggers with repeat suppression
- browser narration play/pause/replay and speed
- local favorites/preferences/trips
- PWA-style offline cache, check, update and remove controls

## Important limitations
- Drive estimates are planning approximations, not live traffic or a paid routing API.
- New custom addresses require online geocoding. Unresolved endpoints block itinerary creation; stored mapped endpoints remain usable.
- GPS stories run while the page/app remains active; background behavior is browser/OS dependent.
- SpeechSynthesis voices vary by device and may not work offline.
- Google Maps is external and has its own connectivity/offline requirements.
- Real-device airplane-mode, GPS, audio interruption and Maps-switch tests are still required.

## Privacy
Core state is stored locally in the browser. No API keys are included.
## Maintenance and validation

Run `npm ci --ignore-scripts`, `npm test` and `node --check app.js` before publishing. The read-only GitHub Actions workflow runs the same checks on pushes and pull requests.
The regression suite covers route insertion, skipped stops, road-based totals,
corrupt/blocked storage, safe text/links, planner suggestions, missing GPS,
and stale asynchronous responses.

### Architecture

This is a GitHub Pages static app, not an app with a private server or database.
`core.js` validates saved input, escapes display values, and bounds/caches public
service requests. `planner.js` owns draft routes and suggestion updates.
`route-efficiency.js` contains pure route insertion and corridor calculations.
`app.js` handles itinerary, search, narration and UI events.

Public dependencies: Photon for geocoding, Overpass/OpenStreetMap for attractions,
OSRM for driving, Leaflet for maps, and Wikipedia for coordinate-matched story
summaries. No credentials are shipped. Public services do not provide this app
with guaranteed capacity or availability; larger multi-user production use needs
provisioned providers or an authenticated server proxy with central rate limiting.
The browser queues requests per provider, applies timeouts, and caches successful
responses. Named search text and requested route coordinates go to these providers.

Trips and settings remain device-local. Storage failures produce an on-screen
notice. Invalid JSON is backed up to `rideAlongStateV3.recovery` where storage is
available. Do not clear browser data to update the app; use the refresh notice.
The service worker caches the app shell, not maps or live public API responses.
GPS and speech require real-device testing; background execution is not promised.

Provider documentation reviewed 2026-10-06:
- https://github.com/komoot/photon#demo-server
- https://project-osrm.org/docs/v5.24.0/api/
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers

### October 6 full-flow review (v28)

Confirmed fixes: destination retained before a separate hotel finish; edit-plan endpoint restoration; destination selection required before building; location guards on Discover additions; stable custom-place IDs; duplicate-add protection; invalid-map pin exclusion; no unverified map route lines; saved planning filters; GPS freshness; completed-story replay; stale live-search response rejection. Custom endpoints offer visible match selection, including intentional distant locations.

Automated coverage includes full-page initialization, itinerary creation/editing, offline routing, unknown/overseas places, skipped stops, budgets, road matrices, state corruption, injection escaping, and offline asset versions. Public API browser checks supplement fixtures. Phone GPS accuracy, background audio, OS interruptions, and actual airplane mode require physical-device verification and are not guaranteed by these checks.

### October 7 review (v33)

- Creating a trip discovers along-route attractions even while the preview is still loading.
- Time planning inserts optional attractions into the route, preserves a fixed last-stop destination and a separate finish, and favors scenic stops only within the driving and time limits.
- Final road totals are checked before saving. If necessary, only automatic additions are removed; selected stops require an explicit override to exceed the time target. Automatic additions require verified road detours.
- Build and add-stop requests use isolated drafts. Changing a plan while routing or declining an over-budget addition cannot leave a partially saved itinerary.
- Custom starts and finishes require choosing a search result. Saved selections and edit-plan endpoints survive reopening.
- Five named trip snapshots can be saved, opened, replaced and deleted. Current-trip edits do not mutate saved copies. Trips and feedback remain device-local.
- Not interested hides a place from suggestions, Discover and automatic narration, with undo in Discover. Visited history also has undo and stays shared across trips.
- Verified route geometry survives offline reopening, marking visited and editing visit time. Unverified legacy trips are recalculated. Zero-minute visits are supported.
- A place too far from a road is excluded individually from driving recommendations, preserving valid suggestions nearby.
- Maps label start, finish, selected stops and suggestions; skipped stops retain matching itinerary numbers. Next-stop navigation lets Maps determine the current origin.

The automated regression suite covers these workflows, existing routing, storage,
search, narration selection and offline asset consistency. Browser checks verify
real public-provider responses and user flows. Physical-device GPS accuracy,
background narration, audio interruptions and airplane-mode reopening remain
unverified. Maps, fresh geocoding and attraction searches need their external
providers. Scenic-road quality is not scored; scenic attraction selection and
minimum driving time are separate from a scenic-road navigation service.
