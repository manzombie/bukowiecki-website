# Locked 3D viewer recipe (film GLB nodes)

These are the agreed lighting/material defaults for the real-time Three.js film
objects, locked from the `alien` test. Apply the same rig to all five GLBs so the
set stays coherent. Tuned on `films/alien+creature+3d+model.glb`.

| Control      | Value     | Maps to (Three.js) |
|--------------|-----------|--------------------|
| Rim color    | `#FF4D00` | rim + bottom light color |
| Rim power    | 2.5       | back/rim DirectionalLight intensity |
| Rim azimuth  | −39°      | rim light horizontal angle (orbit) |
| Rim elevation| 27°       | rim light vertical angle |
| Bottom light | 1         | underside PointLight intensity |
| Key light    | 0.8       | cool front-fill DirectionalLight intensity |
| Metalness    | 0.35      | material.metalness (override) |
| Roughness    | 0.45      | material.roughness (override) |
| Env sheen    | 0.7       | material.envMapIntensity (RoomEnvironment) |
| Auto-spin    | 0.1       | OrbitControls.autoRotateSpeed |
| Float        | on        | sine bob ±0.06u @ 0.8 Hz |
| Background   | `#000000` | page/section behind transparent canvas |

Interaction: auto-rotate + drag-to-orbit, zoom & pan disabled.
Renderer: ACESFilmic tone mapping, exposure 1.1, sRGB, alpha (transparent) canvas.
Live tuner: `glb-test.html` (throwaway; not part of the production site).
