/* sandbox.js — minimal test environment (?level=sandbox).
 * A straight run, a tight S-bend, a three-way junction, a Y-fork, a pillar
 * chamber, a narrow passage and a vertical shaft. Used by the regression tests
 * and for tuning handling before anything else. */

export default {
  id: "sandbox",
  name: "Test Tank",
  start: { node: "s", pos: [0, 0, -6], yaw: 0 },
  nodes: [
    { id: "s", p: [0, 0, 0], r: 8, room: [12, 8, 14] },
    { id: "j1", p: [0, 0, -70], r: 8 },                       // T junction
    { id: "bendEnd", p: [-80, -4, -150], r: 6 },
    { id: "hall", p: [55, -6, -95], r: 8, room: [22, 12, 22] },  // pillar chamber
    { id: "y", p: [0, -2, -115], r: 7 },                       // Y fork
    { id: "yl", p: [-12, -6, -175], r: 6 },
    { id: "yr", p: [14, -4, -178], r: 6 },
    { id: "shaftTop", p: [55, 45, -95], r: 7 },
    { id: "narrowEnd", p: [110, -6, -95], r: 5 },
  ],
  edges: [
    { id: "run", a: "s", b: "j1" },
    { id: "tLeft", a: "j1", b: "bendEnd", via: [[-30, 0, -72, 7], [-42, -2, -95, 6], [-62, -3, -103, 6], [-64, -4, -128, 6]] }, // S-bend
    { id: "tRight", a: "j1", b: "hall", via: [[30, -2, -75, 8]] },
    { id: "tFwd", a: "j1", b: "y" },
    { id: "yL", a: "y", b: "yl", via: [[-8, -4, -145, 6]] },
    { id: "yR", a: "y", b: "yr", via: [[10, -3, -145, 6]] },
    { id: "shaft", a: "hall", b: "shaftTop", via: [[55, 18, -95, 7]] },
    { id: "narrow", a: "hall", b: "narrowEnd", via: [[85, -6, -97, 5]] },
  ],
  solids: [
    { type: "capsule", a: [44, -20, -110], b: [44, 10, -110], r: 2.2 },
    { type: "capsule", a: [68, -20, -84], b: [68, 10, -84], r: 2.6 },
    { type: "sphere", c: [0, -6, -40], r: 3 },               // floor boulder in the straight run
  ],
  currents: [],
  checkpoints: [],
  entities: [],
};
