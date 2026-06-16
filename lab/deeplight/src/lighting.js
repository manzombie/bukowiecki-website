/* lighting.js — readable, lit tunnels (the "headlight is the only light" gimmick
 * is retired). Even ambient + hemisphere fill so the player can SEE and navigate,
 * a gentle moving sub lamp for local punch, and a soft water-coloured fog that
 * fades distance without hiding the path. */

import * as THREE from "three";

export function setupLighting(scene, camera) {
  scene.background = new THREE.Color(0x0e2b34);
  // Keep distant branches atmospheric without turning nearby rock into black.
  scene.fog = new THREE.FogExp2(0x12333b, 0.0027);

  // bright even fill lights the WHOLE tunnel (no torch dependency)
  scene.add(new THREE.AmbientLight(0xa7d6da, 2.25));
  const hemi = new THREE.HemisphereLight(0x72bec7, 0x1c454d, 2.35);
  scene.add(hemi);

  // a soft local fill on the sub for a little nearby warmth/shape
  const lamp = new THREE.PointLight(0xc8f3f4, 65, 120, 1.7);
  lamp.position.set(0, 2, 4);
  camera.add(lamp);
  scene.add(camera);

  // forward muzzle flash used when firing
  const muzzle = new THREE.PointLight(0xff8a3c, 0.0, 140, 2.0);
  muzzle.position.set(0, -2, -6);
  camera.add(muzzle);

  return {
    lamp, muzzle,
    flash(t) { muzzle.intensity = 2500; muzzle._until = t + 0.08; },
    update(t) {
      if (muzzle.intensity > 0 && t > (muzzle._until || 0)) muzzle.intensity = 0;
      // faint caustic shimmer on the lamp for life
      lamp.intensity = 90 + Math.sin(t * 3.1) * 18;
    },
  };
}
