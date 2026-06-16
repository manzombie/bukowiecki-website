/* postfx.js — cinematic post stack: bloom (headlights/pickups/hostiles glow) +
 * a final vignette & cold deep-sea colour grade. Falls back to plain rendering
 * if addons fail to load, and can be toggled off for performance auto-scaling. */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vig: { value: 0.82 }, cold: { value: 0.1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vig; uniform float cold; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // cold deep-sea grade: lift blue/green, pull red
      c.rgb = mix(c.rgb, c.rgb * vec3(0.86, 1.0, 1.08), cold);
      // vignette
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, vig*0.35, dot(d,d)*2.2);
      c.rgb *= mix(0.76, 1.0, v);
      gl_FragColor = c;
    }`,
};

export function setupPost(renderer, scene, camera) {
  try {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.55, 0.96);   // strength, radius, threshold (only bright sources bloom)
    composer.addPass(bloom);
    const grade = new ShaderPass(GradeShader);
    grade.renderToScreen = true;
    composer.addPass(grade);
    return {
      enabled: true,
      composer, bloom,
      render() { composer.render(); },
      setSize(w, h) { composer.setSize(w, h); bloom.setSize(w, h); },
    };
  } catch (e) {
    console.warn("postfx unavailable, plain render:", e.message);
    return {
      enabled: false,
      render() { renderer.render(scene, camera); },
      setSize() {},
    };
  }
}
