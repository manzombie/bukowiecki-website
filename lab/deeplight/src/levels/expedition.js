/* expedition.js — "Halcyon's Grave": the single authored Deeplight dive.
 *
 *  1 Launch Bay        safe chamber: thrust, turn, brake, depth (three tutorial crates)
 *  2 Kelp Galleries    wide descending run, forgiving pillars, gentle current, boost
 *  3 Echo Hall         dark hall: sonar introduction, first threat (mines), side alcove
 *  4 The Fork          marked safe passage (wide, calm, cyan beacons) vs. salvage run
 *                      (narrow, current, red buoys, lurker eel, rich salvage)
 *  5 Halcyon's Grave   crystal cavern with the wreck of the research sub Halcyon;
 *                      recover its flight recorder; shades introduced; side grotto
 *  6 The Throat        winding basalt tunnel: shades + mines + eel + counter-current
 *  7 Warden's Gate     the Warden patrols a chamber below a sealed shaft; destroy the
 *                      three seal nodes, then ascend (rockfalls, upward current) to extract
 *
 * Coordinates in metres; y is up; yaw 0 faces -z (north). The graph below is
 * the authoritative navigable space (see core/levelgraph.js). */

const Y = (a, b) => Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));   // yaw facing a -> b

export default {
  id: "expedition",
  name: "Halcyon's Grave",
  start: { node: "bay", pos: [0, -1, 13], yaw: 0 },

  nodes: [
    { id: "bay", p: [0, 0, 0], r: 8, room: [15, 9, 21], palette: "bay" },
    { id: "k1", p: [10, -6, -70], r: 8 },
    { id: "k2", p: [40, -15, -152], r: 10 },
    { id: "echo", p: [28, -24, -215], r: 9, room: [30, 15, 27], palette: "echo" },
    { id: "alcove", p: [66, -20, -250], r: 6.5, palette: "echo" },
    { id: "fork", p: [-25, -32, -265], r: 8, room: [13, 9, 13], palette: "echo" },
    { id: "merge", p: [-50, -46, -402], r: 8, room: [11, 8, 11], palette: "base" },
    { id: "cavern", p: [-50, -62, -468], r: 9, room: [42, 22, 36], palette: "crystal" },
    { id: "grotto", p: [2, -60, -505], r: 6.5, palette: "crystal" },
    { id: "gate", p: [-140, -52, -662], r: 9, room: [26, 14, 24], palette: "warden" },
    { id: "surface", p: [-140, 44, -664], r: 8, room: [14, 7, 14], palette: "shaft" },
  ],

  edges: [
    { id: "bayRun", a: "bay", b: "k1", via: [[0, -2, -32, 7.5]], palette: "bay" },
    { id: "galleries", a: "k1", b: "k2", via: [[22, -9, -100, 11], [35, -12, -126, 12]], palette: "kelp" },
    { id: "toEcho", a: "k2", b: "echo", via: [[38, -18, -182, 10]], palette: "kelp" },
    { id: "alcoveRun", a: "echo", b: "alcove", via: [[52, -22, -238, 6.5]], palette: "echo" },
    { id: "echoExit", a: "echo", b: "fork", via: [[0, -31, -238, 8]], palette: "echo" },
    // safe passage: wide, calm, beacon-lit
    { id: "safe", a: "fork", b: "merge", via: [[-62, -30, -282, 9], [-88, -36, -326, 9], [-80, -42, -372, 9]], palette: "safe" },
    // salvage run: narrow, fast water, dangerous, rich
    { id: "salvage", a: "fork", b: "merge", via: [[-24, -37, -300, 5.8], [-38, -42, -330, 6.5], [-30, -44, -364, 5.8]], palette: "rust" },
    { id: "cavernIn", a: "merge", b: "cavern", via: [[-50, -52, -428, 8]], palette: "crystal" },
    { id: "grottoRun", a: "cavern", b: "grotto", via: [[-18, -60, -492, 6.5]], palette: "crystal" },
    { id: "throat", a: "cavern", b: "gate", via: [[-98, -60, -486, 8], [-124, -58, -526, 8], [-110, -55, -570, 8], [-134, -53, -610, 8]], palette: "basalt" },
    { id: "shaft", a: "gate", b: "surface", via: [[-140, -32, -664, 7.5], [-138, 0, -667, 7.5], [-141, 24, -665, 7.5]], palette: "shaft" },
  ],

  // extra water volumes (pockets along edges)
  rooms: [
    { c: [-38, -42, -330], r: [10, 7, 11], palette: "rust" },          // eel den on the salvage run
    { c: [-124, -58, -526], r: [11, 8, 11], palette: "basalt" },       // throat bend pocket
  ],

  solids: [
    // Kelp Galleries: forgiving pillars (always a wide way round)
    { type: "capsule", a: [26, -26, -95], b: [26, 8, -95], r: 2.3 },
    { type: "capsule", a: [40, -30, -122], b: [40, 6, -122], r: 2.6 },
    { type: "capsule", a: [31, -30, -140], b: [33, 4, -142], r: 2.0 },
    { type: "sphere", c: [28, -20, -112], r: 3.2 },
    // Echo Hall: a central rock spire to navigate around in the dark
    { type: "capsule", a: [26, -42, -212], b: [30, -12, -216], r: 3.6 },
    // Halcyon wreck (metal) resting on a rock ridge
    { type: "capsule", a: [-74, -74, -478], b: [-36, -70, -458], r: 5.0, mat: "metal" },
    { type: "box", c: [-53, -65.5, -467], h: [2.4, 3.2, 4.2], yaw: 0.49, round: 0.6, mat: "metal" },
    { type: "box", c: [-78, -73.5, -480], h: [0.4, 4.5, 3], yaw: 0.49, round: 0.2, mat: "metal" },   // tail fin
    { type: "sphere", c: [-56, -86, -468], r: 9 },
    // The Throat: a hanging rock to slip under/over
    { type: "sphere", c: [-111, -47, -568], r: 3.0 },
  ],

  currents: [
    { a: [15, -7, -80], b: [38, -16, -150], radius: 12, speed: 1.8 },          // galleries: gentle, downhill
    { a: [-24, -37, -298], b: [-30, -44, -366], radius: 8, speed: 3.2 },       // salvage run: strong
    { a: [-110, -55, -572], b: [-124, -58, -528], radius: 9, speed: 2.3 },     // throat: against you
    { a: [-140, -34, -664], b: [-140, 30, -665], radius: 8, speed: 2.6 },      // shaft: helps you up
  ],

  seal: { pos: [-140, -40.8, -663], r: 10.5 },

  objectives: [
    { id: "launch", text: "Leave the launch bay — follow the tunnel north", target: [10, -6, -70] },
    { id: "galleries", text: "Descend through the Kelp Galleries", target: [40, -15, -152] },
    { id: "echo", text: "Cross the Echo Hall — ping sonar to find the way on", target: [-25, -32, -265] },
    { id: "fork", text: "Choose: safe passage (cyan, left) or salvage run (red, right)", target: [-50, -46, -402] },
    { id: "cavern", text: "Recover the Halcyon's flight recorder", target: [-47, -60.5, -474] },
    { id: "throat", text: "Head west through the Throat", target: [-140, -52, -662] },
    { id: "gate", text: "Destroy the 3 seal nodes above the Warden's Gate", target: [-140, -42, -663] },
    { id: "ascend", text: "Ascend the shaft to extraction", target: [-140, 44, -664] },
  ],
  afterRecorder: "throat",

  zones: [
    { id: "zStart", pos: [0, -1, 13], r: 30, prompt: "basics" },
    { id: "zGall", pos: [14, -8, -80], r: 14, objective: "galleries", prompt: "boost" },
    { id: "zEcho", pos: [36, -18, -188], r: 13, objective: "echo", prompt: "sonar" },
    { id: "zMines", pos: [10, -30, -226], r: 22, prompt: "fire" },
    { id: "zFork", pos: [-24, -32, -262], r: 11, objective: "fork", prompt: "fork",
      checkpoint: { pos: [-16, -32, -259], yaw: Y([-16, -32, -259], [-40, -34, -285]) } },
    { id: "zSalv", pos: [-24, -37, -300], r: 7, prompt: "current" },
    { id: "zCav", pos: [-50, -52, -430], r: 11, objective: "cavern", prompt: "shades",
      checkpoint: { pos: [-50, -53, -432], yaw: Y([-50, -53, -432], [-50, -60, -460]) } },
    { id: "zGate", pos: [-136, -52, -624], r: 10, objective: "gate", flag: "wardenWake", prompt: "warden",
      checkpoint: { pos: [-135, -52.5, -616], yaw: Y([-135, -52, -616], [-140, -52, -662]) } },
    { id: "zShaftCp", pos: [-140, -30, -664], r: 7, requires: "sealBroken", prompt: "ascend",
      checkpoint: { pos: [-140, -30, -664], yaw: 0 } },
    { id: "zFall1", pos: [-140, -14, -665], box: [9, 3, 9], rockfall: "fall1" },
    { id: "zFall2", pos: [-139, 10, -666], box: [9, 3, 9], rockfall: "fall2" },
    { id: "zExtract", pos: [-140, 41, -664], box: [14, 3, 14], extract: true },
  ],

  entities: [
    // 1 — tutorial crates: ahead, high, low
    { type: "salvage", pos: [0, -1, -4] },
    { type: "salvage", pos: [5, 3.5, -12] },
    { type: "salvage", pos: [-4, -4.5, -16] },
    // 2 — galleries
    { type: "salvage", pos: [12, -4, -60] },
    { type: "salvage", pos: [26, -8, -118] },
    { type: "salvage", pos: [44, -18, -140] },
    { type: "repair", pos: [36, -14, -168] },
    // 3 — echo hall: mines guard the exit; alcove holds a relic
    { type: "mine", pos: [10, -27, -226] },
    { type: "mine", pos: [6, -31, -222] },
    { type: "mine", pos: [16, -31, -232] },
    { type: "salvage", pos: [46, -16, -212] },
    { type: "relic", pos: [64, -20, -250] },
    { type: "salvage", pos: [58, -21, -245] },
    // 4a — safe passage: calm, one crate
    { type: "salvage", pos: [-86, -36, -330] },
    // 4b — salvage run: rich and guarded
    { type: "salvage", pos: [-24, -37, -292] },
    { type: "salvage", pos: [-26, -39, -310] },
    { type: "salvage", pos: [-34, -41, -322] },
    { type: "relic", pos: [-42, -44, -334] },
    { type: "salvage", pos: [-34, -43, -348] },
    { type: "salvage", pos: [-30, -44, -362] },
    { type: "mine", pos: [-28, -40, -318] },
    { type: "mine", pos: [-33, -45, -356] },
    { type: "lurker", pos: [-40, -42, -334], patrol: [[-34, -40, -324], [-44, -44, -338], [-34, -43, -346]] },
    // 5 — Halcyon's Grave
    { type: "recorder", pos: [-47, -60.5, -474] },
    { type: "salvage", pos: [-70, -64, -470] },
    { type: "salvage", pos: [-30, -62, -452] },
    { type: "shade", pos: [-68, -56, -448] },
    { type: "shade", pos: [-24, -58, -482] },
    { type: "relic", pos: [2, -60, -506] },
    { type: "repair", pos: [-6, -60, -500] },
    // 6 — The Throat
    { type: "shade", pos: [-100, -58, -490] },
    { type: "mine", pos: [-118, -60, -512] },
    { type: "mine", pos: [-128, -55, -532] },
    { type: "lurker", pos: [-126, -58, -528], patrol: [[-118, -58, -520], [-130, -60, -532], [-120, -56, -536]] },
    { type: "shade", pos: [-116, -55, -556] },
    { type: "shade", pos: [-111, -54, -578] },
    { type: "repair", pos: [-124, -53, -596] },
    { type: "shade", pos: [-132, -54, -604] },
    { type: "salvage", pos: [-112, -58, -546] },
    // 7 — Warden's Gate
    { type: "warden", pos: [-140, -55, -670], patrol: [[-156, -55, -652], [-124, -57, -654], [-124, -52, -674], [-156, -53, -674]] },
    { type: "seal", pos: [-135.5, -44.5, -663] },
    { type: "seal", pos: [-142.3, -44.5, -659.1] },
    { type: "seal", pos: [-142.3, -44.5, -666.9] },
    { type: "mine", pos: [-156, -48, -668] },
    { type: "mine", pos: [-125, -48, -655] },
    { type: "boulder", pos: [-137, 22, -664], group: "fall1", delay: 0 },
    { type: "boulder", pos: [-143, 26, -667], group: "fall1", delay: 0.9 },
    { type: "boulder", pos: [-141, 38, -663], group: "fall2", delay: 0 },
    { type: "boulder", pos: [-137, 40, -667], group: "fall2", delay: 0.7 },
    { type: "salvage", pos: [-140, 10, -670] },
  ],

  // non-colliding dressing, anchored to walls by the renderer
  decor: {
    kelpEdges: ["galleries", "toEcho", "bayRun"],
    safeBeacons: [[-40, -31, -270], [-62, -30, -282], [-80, -33, -304], [-88, -36, -326], [-86, -39, -350], [-80, -42, -372], [-64, -44, -390]],
    dangerBuoys: [[-22, -35, -284], [-26, -39, -304], [-36, -42, -340]],
    bones: [[-40, -48, -334], [60, -25, -250], [-122, -64, -528]],
    crystals: "cavern",
  },

  // main route for the test pilot / completion checks (safe passage)
  route: [
    [0, -1, 13], [0, -1, -4], [0, -2, -32], [10, -6, -70], [22, -9, -100], [30, -12, -126], [40, -15, -152], [38, -18, -182],
    [42, -22, -200], [34, -28, -228], [8, -32, -238], [-12, -32, -258], [-40, -31, -270], [-62, -30, -282], [-88, -36, -326], [-80, -42, -372],
    [-50, -46, -402], [-50, -52, -428], [-47, -57, -450], [-47, -60.5, -474], [-70, -60, -482], [-98, -60, -486], [-124, -58, -526],
    [-110, -55, -570], [-134, -53, -610], [-138, -52, -630], [-140, -52, -650], [-140, -52, -663],
    [-140, -30, -664], [-138, 0, -667], [-141, 24, -665], [-140, 42, -664],
  ],
  routeSalvage: [[-12, -32, -258], [-22, -35, -282], [-24, -37, -300], [-34, -41, -322], [-38, -42, -333], [-34, -43, -348], [-30, -44, -364], [-50, -46, -402]],
};
