# Deeplight — Research Studio #02

An atmospheric arcade submarine expedition. Pilot a compact research sub through
flooded caves, read the dark with headlights and sonar, choose between a safe
passage and a salvage run, recover the lost *Halcyon*'s flight recorder, break
the seal at the Warden's Gate and ascend to extraction. One complete 6–10 minute dive.

Static site, no backend, no install. Route: `lab.bukowiecki.co/deeplight/`.
three.js 0.160 loads from jsDelivr through the import map in `index.html`.

## Run locally

```bash
cd lab && python3 -m http.server 8765
# open http://localhost:8765/deeplight/
```

URL options: `?level=sandbox` (test tank) · `?debug=1` (overlay, also the backquote key) ·
`?bot=safe|salvage` (test pilot flies) · `?quality=low|medium|high`.

## Controls

| Keyboard + mouse | | Touch | |
|---|---|---|---|
| W / S | thrust / brake & reverse | left thumb stick | up thrust, down brake, sideways turn |
| A / D | turn | drag on the right | aim |
| Space / Ctrl or Z | rise / descend | ▲ ▼ | rise / descend |
| Shift | boost (energy) | FIRE, BOOST | hold |
| mouse | aim headlights (gimbal ±40° × ±38°) | SONAR, CAM, II | tap |
| left click (hold) | light pulses (energy) | | |
| right click / Q | sonar | | |
| C | chase / cockpit camera | | |
| Esc | pause, settings, key rebinding | | |
| R | restart from the failure screen | | |

## Architecture

```
src/core/      pure JS — runs in the browser, a Web Worker and Node tests
  world.js       the ONE authoritative navigable space: signed distance field
  levelgraph.js  level graph -> world primitives; validateLevel()
  sub.js         flight model + full-hull capsule collision
  loop.js        fixed 120 Hz timestep, bounded catch-up, render interpolation
  camera.js      swept chase boom / cockpit rig
  mesher.js      surface-nets extraction of the render mesh from the same field
  game.js        entities, weapon, sonar, zones, scoring, checkpoints
  tuning.js      every gameplay number
  autopilot.js, bot.js   test pilot (player inputs only)
src/levels/    expedition.js (the dive), sandbox.js (test tank)
src/render/    three.js view, procedural models, pooled effects
src/ui/        input (rebindable keys, pointer lock, multi-touch), HUD, settings
src/audio/     music/SFX volumes, synthesised engine/sonar/scrape/threat cues
src/worker/    builds the cave mesh off the main thread
tests/         node --test tests/*.test.mjs; tests/browser/*.mjs drive headless Chrome
```

**Why a distance field?** The previous build extruded a separate tube mesh per
edge, followed a spline and clamped a 2D offset. Junction shells overlapped,
walls crossed the hull, and steering did not move the sub. Now the level graph
becomes a smooth union of tubes and chambers, minus solids. Collision samples
that field, and the render mesh is extracted from it in chunks whose seams are
exact. Junctions are one open space, and what you see is what you collide with.

## Tests

```bash
cd lab/deeplight
node --test tests/*.test.mjs                        # simulation, collision, level, completion
node tests/browser/scenarios.mjs                    # real Chrome: input, pause, stalls, memory
node tests/browser/playthrough.mjs safe             # real-time bot run with frame timing
node tests/browser/drive.mjs --input=keyboard       # full run through real key/mouse events
node tests/browser/drive.mjs --input=touch          # full run through real multi-touch events
```

Browser tests need the local server running and Google Chrome installed.

## Legacy authoring pipeline

`tools/extract_level.py` and `levels/level01.json`/`level03.json` are the old
image-to-graph extractor and its output. The shipped dive no longer uses them.
The authored expedition replaced the extracted topology, whose junction
geometry and overlapping edges could not give a good playable level.
