# Solar Lab — Research Studio, Day 11

An interactive 3D laboratory for exploring the Solar System: fly between
planets, run a real Newtonian N-body gravity simulation, and learn how orbits
actually work. Two clearly separated modes — a readable "Learning" view on
documented Kepler orbits, and a "True Physics" mode where you can double the
Sun's mass, stop a planet mid-orbit, or delete Jupiter and watch what happens.

- **Static build, no backend:** Vite + React + Three.js/react-three-fiber,
  compiled to `index.html` + hashed `assets/*`. Physics runs in a Web Worker.
  All textures, the starfield, and the asteroid/Kuiper belts are generated
  procedurally — no external image assets, no CDN dependency at runtime.
- Source lives in a separate repo (`mr_lobster_rebuild/apps/solar-lab`) and is
  built there with `SOLAR_LAB_BASE=/solar-system/ pnpm build`; this folder is
  the copied production output (`dist/`), same as any other static deploy.
- Full docs (architecture, physics notes, accuracy/limitations, accessibility,
  attribution) ship with the source repo, not duplicated here.

## Status

- Lives at `lab.bukowiecki.co/solar-system/`.
- **Day 11** — the "10 tools in 10 days" sprint shipped as ten; this is the
  first tool added after it wrapped. Card added to `lab/index.html`, counter
  bumped to 11 / 11.
