/* pose.js — webcam + on-device MediaPipe Pose. Owns the camera, the model, the
 * live skeleton overlay, per-joint confidence (for the placement helper) and
 * throw detection (wrist-velocity peaks). Keeps a rolling frame buffer so the
 * UI can pull a window for analysis. Nothing leaves the device. */

import { LM, throwIdx } from "./analysis.js";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// skeleton lines to draw (index pairs)
const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],          // torso
  [11, 13], [13, 15], [12, 14], [14, 16],          // arms
  [23, 25], [25, 27], [24, 26], [26, 28],          // legs
  [11, 0], [12, 0],                                // neck-ish
];

const BUFFER_MS = 3000;
const THROW_SPEED = 1.6;   // normalised wrist speed (per s) that counts as a throw
const THROW_GAP = 380;     // ms min between detected throws

export class PoseTracker {
  constructor() {
    this.buffer = [];          // [{t, lm}]
    this.latest = null;
    this.running = false;
    this.hand = "right";
    this.onThrow = null;       // (release {t}) => void
    this._lastWrist = null;
    this._speed = 0;
    this._rising = false;
    this._lastThrowT = 0;
    this._peak = 0; this._peakT = 0;
  }

  async start(video, canvas) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video = video; this.canvas = canvas; this.ctx = canvas.getContext("2d");
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const { FilesetResolver, PoseLandmarker } = await import(`${MP}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
      runningMode: "VIDEO", numPoses: 1,
    });
    this.running = true;
    this._loop();
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    if (this.video.readyState >= 2 && this.landmarker) {
      try {
        const res = this.landmarker.detectForVideo(this.video, now);
        this._onResult(res, now);
      } catch (_) { /* transient */ }
    }
    requestAnimationFrame(() => this._loop());
  }

  _onResult(res, now) {
    const lm = (res.landmarks && res.landmarks[0]) || null;
    this.latest = lm;
    if (lm) {
      this.buffer.push({ t: now, lm });
      while (this.buffer.length && now - this.buffer[0].t > BUFFER_MS) this.buffer.shift();
      this._detectThrow(lm, now);
    }
    this._draw(lm);
  }

  _detectThrow(lm, now) {
    const ti = throwIdx(this.hand);
    const w = lm[ti.wrist];
    if (!w || (w.visibility ?? 1) < 0.4) { this._lastWrist = null; return; }
    if (this._lastWrist) {
      const dt = Math.max(1, now - this._lastWrist.t) / 1000;
      const sp = Math.hypot(w.x - this._lastWrist.x, w.y - this._lastWrist.y) / dt;
      this._speed = this._speed * 0.5 + sp * 0.5;              // smooth
      if (this._speed > THROW_SPEED) {                         // rising into a throw
        this._rising = true;
        if (this._speed > this._peak) { this._peak = this._speed; this._peakT = now; }
      } else if (this._rising) {                               // fell back -> release done
        this._rising = false;
        if (this._peak > THROW_SPEED && now - this._lastThrowT > THROW_GAP) {
          this._lastThrowT = now;
          this.onThrow && this.onThrow({ t: this._peakT });
        }
        this._peak = 0;
      }
    }
    this._lastWrist = { x: w.x, y: w.y, t: now };
  }

  _draw(lm) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;
    const X = (p) => p.x * canvas.width, Y = (p) => p.y * canvas.height;
    // bones
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(192,57,43,.85)";
    for (const [a, b] of BONES) {
      if (!lm[a] || !lm[b]) continue;
      const va = lm[a].visibility ?? 1, vb = lm[b].visibility ?? 1;
      ctx.globalAlpha = Math.min(va, vb) >= 0.5 ? 0.9 : 0.25;
      ctx.beginPath(); ctx.moveTo(X(lm[a]), Y(lm[a])); ctx.lineTo(X(lm[b]), Y(lm[b])); ctx.stroke();
    }
    // joints (green if confident, dim otherwise)
    ctx.globalAlpha = 1;
    for (let i = 0; i < lm.length; i++) {
      const v = lm[i].visibility ?? 1;
      ctx.fillStyle = v >= 0.5 ? "rgba(47,110,79,.95)" : "rgba(176,125,43,.6)";
      ctx.beginPath(); ctx.arc(X(lm[i]), Y(lm[i]), v >= 0.5 ? 5 : 3, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** frames from the last `ms` (for per-dart analysis) */
  recent(ms) {
    const now = performance.now();
    return this.buffer.filter((f) => now - f.t <= ms);
  }

  /** per-joint visibility for the placement helper (throwing side emphasised) */
  jointConfidence() {
    if (!this.latest) return null;
    const lm = this.latest, ti = throwIdx(this.hand);
    const v = (i) => Math.round(((lm[i] && lm[i].visibility) ?? 0) * 100);
    return {
      Head: v(LM.nose),
      Shoulders: Math.round((v(LM.lShoulder) + v(LM.rShoulder)) / 2),
      Hips: Math.round((v(LM.lHip) + v(LM.rHip)) / 2),
      "Throwing arm": Math.round((v(ti.shoulder) + v(ti.elbow) + v(ti.wrist)) / 3),
    };
  }

  stop() {
    this.running = false;
    if (this.video && this.video.srcObject) this.video.srcObject.getTracks().forEach((t) => t.stop());
    try { this.landmarker && this.landmarker.close(); } catch (_) {}
  }
}
