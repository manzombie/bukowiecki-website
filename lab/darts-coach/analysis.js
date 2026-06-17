/* analysis.js — PURE posture analysis. No DOM, no camera, no model. It takes
 * buffers of pose frames (MediaPipe landmarks) and turns them into beginner
 * coaching metrics + plain-language feedback. Same discipline as the art engine:
 * deterministic, side-effect free, easy to reason about and test.
 *
 * A "frame" = { t:ms, lm:[{x,y,z,visibility}, ...33] }  (normalised 0..1 coords) */

// MediaPipe Pose landmark indices we use
export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lAnkle: 27, rAnkle: 28,
};

const VIS = 0.5;   // landmark visibility below this = not trusted

// which landmarks are the "throwing" side
export function throwIdx(hand) {
  return hand === "left"
    ? { wrist: LM.lWrist, elbow: LM.lElbow, shoulder: LM.lShoulder }
    : { wrist: LM.rWrist, elbow: LM.rElbow, shoulder: LM.rShoulder };
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function std(vals) {
  if (vals.length < 2) return 0;
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length);
}
const visOk = (lm, i) => lm[i] && (lm[i].visibility ?? 1) >= VIS;

/** torso length (shoulder-mid to hip-mid) of a frame — used to normalise distances */
function torsoLen(lm) {
  const sh = mid(lm[LM.lShoulder], lm[LM.rShoulder]);
  const hp = mid(lm[LM.lHip], lm[LM.rHip]);
  return dist(sh, hp) || 0.25;
}

/**
 * metricsForWindow — compute fundamentals over a window of frames (one throw or a
 * short live window). Returns raw metrics (smaller = steadier) + per-metric
 * confidence so the UI only coaches on what the camera actually sees.
 */
export function metricsForWindow(frames, hand) {
  if (!frames.length) return null;
  const t = throwIdx(hand);
  const noseX = [], noseY = [], swayX = [], hipX = [], hipY = [], shAng = [];
  let visNose = 0, visTorso = 0, visArm = 0, follow = 0, followN = 0;

  for (const fr of frames) {
    const lm = fr.lm; if (!lm) continue;
    if (visOk(lm, LM.nose)) { noseX.push(lm[LM.nose].x); noseY.push(lm[LM.nose].y); visNose++; }
    if (visOk(lm, LM.lShoulder) && visOk(lm, LM.rShoulder)) {
      const sm = mid(lm[LM.lShoulder], lm[LM.rShoulder]); swayX.push(sm.x);
      shAng.push(Math.atan2(lm[LM.rShoulder].y - lm[LM.lShoulder].y, lm[LM.rShoulder].x - lm[LM.lShoulder].x));
      visTorso++;
    }
    if (visOk(lm, LM.lHip) && visOk(lm, LM.rHip)) { const hm = mid(lm[LM.lHip], lm[LM.rHip]); hipX.push(hm.x); hipY.push(hm.y); }
    if (visOk(lm, t.wrist) && visOk(lm, t.shoulder)) {
      follow += dist(lm[t.wrist], lm[t.shoulder]) / torsoLen(lm); followN++; visArm++;
    }
  }
  const n = frames.length;
  return {
    head: std(noseX) + std(noseY),                       // head stillness (lower better)
    sway: std(swayX),                                    // torso side-sway
    balance: std(hipX) + std(hipY),                      // weight shift
    shoulder: std(shAng),                                // shoulder-line wobble
    follow: followN ? follow / followN : 0,              // mean throwing-arm extension
    conf: {
      head: visNose / n, torso: visTorso / n, arm: visArm / n,
    },
  };
}

/** live one-liner from the most recent ~0.6s. Returns null if nothing pressing. */
export function liveCue(frames, hand) {
  const m = metricsForWindow(frames, hand);
  if (!m) return null;
  if (m.conf.torso < 0.5) return "Can't see you clearly — adjust the camera";
  if (m.sway > 0.022) return "Steady — you're swaying";
  if (m.conf.head > 0.5 && m.head > 0.018) return "Keep your head still";
  if (m.balance > 0.02) return "Plant your weight, stop shifting";
  return "Good — hold it steady";
}

const THRESH = { head: 0.016, sway: 0.018, balance: 0.018, shoulder: 0.07 };

/** grade a single throw window -> notes (with WHY). Only comments where confident. */
export function gradeThrow(metrics) {
  if (!metrics) return { notes: ["No pose captured for this dart."], scoreable: false };
  const notes = [];
  const m = metrics;
  if (m.conf.head >= 0.5) {
    notes.push(m.head <= THRESH.head
      ? { ok: true, text: "Head steady — good aim reference." }
      : { ok: false, text: "Head moved — a still head keeps your aim line honest." });
  }
  if (m.conf.torso >= 0.5) {
    notes.push(m.sway <= THRESH.sway
      ? { ok: true, text: "Balanced stance, no sway." }
      : { ok: false, text: "You swayed — plant your weight so the throw repeats." });
    if (m.shoulder > THRESH.shoulder)
      notes.push({ ok: false, text: "Shoulder line rotated — keep it square to the board." });
  }
  if (m.conf.arm >= 0.4) {
    notes.push(m.follow >= 0.9
      ? { ok: true, text: "Nice extension — you followed through." }
      : { ok: false, text: "Short follow-through — extend toward the board and hold the finish." });
  } else {
    notes.push({ ok: null, text: "Throwing arm hard to see from this angle — best-effort only." });
  }
  return { notes, scoreable: true };
}

/**
 * summarizeTurn — across the 3 darts of a turn, judge CONSISTENCY (the thing that
 * matters most for beginners) and, if scores are present, surface the killer
 * insight correlating posture with the best dart.
 * throws: [{ metrics, score, releaseT }]
 */
export function summarizeTurn(throws) {
  const valid = throws.filter((d) => d.metrics);
  if (valid.length < 2) return { text: "Throw a few darts to see consistency feedback." };
  const tempo = [];
  for (let i = 1; i < throws.length; i++)
    if (throws[i].releaseT && throws[i - 1].releaseT) tempo.push(throws[i].releaseT - throws[i - 1].releaseT);
  const tempoVar = std(tempo) / (tempo.reduce((s, v) => s + v, 0) / (tempo.length || 1) || 1);
  const headVar = std(valid.map((d) => d.metrics.head));
  const swayVar = std(valid.map((d) => d.metrics.sway));

  let line = tempoVar < 0.25
    ? "Consistent rhythm across your darts — that's the foundation."
    : "Your tempo varied between darts — aim for the SAME beat every throw.";
  if (headVar > 0.012 || swayVar > 0.012)
    line += " Your stance also changed dart-to-dart; lock one position and repeat it.";

  // insight: best-scoring dart vs its posture (only if scores present)
  let insight = "";
  const scored = throws.filter((d) => d.metrics && typeof d.score === "number");
  if (scored.length >= 2) {
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
    if (best.score > 0 && best.metrics.head <= THRESH.head && best.metrics.sway <= THRESH.sway)
      insight = `Your best dart (${best.score}) had the steadiest head and stance — that's not a coincidence.`;
  }
  return { text: line, insight, consistency: 1 - Math.min(1, tempoVar) };
}
