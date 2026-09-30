/* tuning.js — every gameplay number in one place.
 * Units: metres, seconds, radians. The simulation runs at a fixed SIM_HZ, so
 * none of these values depend on the display frame rate. */

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
export const MAX_CATCHUP_STEPS = 10;     // at most ~83 ms simulated per rendered frame; the rest is dropped

export const SUB = {
  // hull collider: a capsule along the sub's pitched forward axis
  halfLen: 2.3,          // centre -> nose/tail sphere centre
  radius: 1.25,          // capsule radius (full hull length = 2*(halfLen+radius) = 7.1 m)
  samples: 7,            // spheres swept along the capsule axis for contact tests
  skin: 0.06,            // separation kept between hull and rock

  // propulsion
  thrustAccel: 13,       // W
  reverseAccel: 8,       // S (while not moving forward: reverse thrust)
  brakeAccel: 18,        // S while moving forward / W while moving backward: water brake
  boostAccel: 26,        // W + Shift
  vertAccel: 9,          // Space / Ctrl
  // water drag (linear + quadratic), split by hull axis so the sub carves turns
  dragLong: 0.95,
  dragLongQuad: 0.02,
  dragLat: 6.8,          // sideways slip dies quickly: velocity follows heading
  dragVert: 2.2,
  idleDrag: 0.55,        // extra drag with no thrust input, so the sub settles to a stop
  // yaw
  yawRateMax: 1.75,      // rad/s at low speed
  yawRateMaxFast: 1.25,  // rad/s at full boost
  yawResponse: 9,        // how quickly yaw rate reaches its target (1/s)
  // visual attitude (also applied to the collider axis)
  pitchFromVy: 0.055,
  pitchFromInput: 0.12,
  pitchMax: 0.26,
  pitchResponse: 5,
  rollFromTurn: 0.028,
  rollMax: 0.32,
  rollResponse: 4,

  // contact
  restitution: 0.12,     // only for hard impacts
  hardImpact: 3.0,       // m/s into the surface before any bounce is applied
  scrapeFriction: 1.6,   // 1/s tangential damping while in contact
  damageImpact: 5.5,     // m/s into the surface before hull damage
  damagePerMs: 2.6,      // hull points per m/s above damageImpact
  damageMax: 25,         // cap for a single impact
  damageCooldown: 0.45,
};

export const ENERGY = {
  max: 100,
  regen: 16,             // per second
  regenDelay: 0.7,       // seconds after spending before regen resumes
  pulseCost: 7,
  boostDrain: 20,        // per second while boosting
  boostMin: 8,           // cannot start boosting below this
};

export const WEAPON = {
  fireInterval: 0.2,
  range: 95,
  gimbalYaw: 0.7,        // ±40°
  gimbalPitch: 0.66,     // ±38°
  aimSlew: 14,           // headlight gimbal follow rate (1/s)
  pulseDamage: 1,
};

export const SONAR = {
  cooldown: 3.5,
  speed: 75,             // m/s ring expansion
  range: 110,
  revealTime: 5,         // HUD markers stay this long
};

export const HULL = {
  max: 100,
  repairKit: 35,
  continueHull: 70,
};

export const CAMERA = {
  boom: 10.5,            // chase distance
  tilt: 0.24,            // boom elevation above the heading (rad)
  altTilts: [0.6, 0.95, 1.25], // steeper booms tried when the normal one is blocked
  clearance: 0.55,       // sphere radius kept free around the camera (near plane + margin)
  shortenRate: 30,       // boom shortening (1/s) — effectively immediate
  recoverRate: 1.8,      // boom recovery (1/s) — gentle
  yawFollow: 7,          // camera yaw follow rate (1/s)
  lookAhead: 6,
  velLead: 0.22,
  rollShare: 0.18,       // fraction of hull roll passed to the camera
  fov: 72,
  cockpitFov: 78,
};

export const SCORE = {
  salvage: 100,
  relic: 400,
  recorder: 1500,
  kill: { mine: 50, shade: 75, lurker: 250, warden: 1200, seal: 100, boulder: 25 },
  extraction: 2000,
  hullBonusPerPoint: 10,
  parTime: 480,          // seconds; time bonus counts down to zero at par
  timeBonusPerSec: 5,
  continuePenalty: 750,
  chainStep: 3,          // consecutive kills/pickups without damage per multiplier step
  maxMult: 4,
};
