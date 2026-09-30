/* audio.js — music + SFX with separate volumes.
 * Recorded one-shots/music come from audio/*.mp3 (optional; missing files are
 * skipped). Engine, sonar, hull scrape and threat cues are synthesised with
 * WebAudio so they respond continuously to the simulation. The context is
 * created on the first user gesture and suspended in background tabs. */

const TRACKS = ["music", "music02", "music03"];
const ONESHOTS = ["fire", "kill", "pickup", "gate", "hit", "win", "lose", "click", "deadend"];

export class GameAudio {
  constructor(settings) {
    this.settings = settings; this.ctx = null; this.buf = {};
    this.track = 0; this.musicOn = false;
    settings.onChange((k) => { if (k === "musicVol" || k === "sfxVol") this._vol(); if (k === "musicEnabled") this._applyMusic(); });
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else if (this.wantRunning) this.ctx.resume();
    });
  }

  async unlock() {
    this.wantRunning = true;
    if (this.ctx) { if (this.ctx.state !== "running") try { await this.ctx.resume(); } catch (_) {} return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.connect(ctx.destination);
      this.music = ctx.createGain(); this.music.connect(this.master);
      this.sfx = ctx.createGain(); this.sfx.connect(this.master);
      this._vol();
      this._synth();
      await Promise.all([...TRACKS, ...ONESHOTS, "ambient"].map((n) => this._load(n)));
      this._ambient();
      this._applyMusic();
    } catch (_) { this.ctx = null; }
  }

  _vol() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(this.settings.get("musicVol") * 0.6, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.settings.get("sfxVol"), t, 0.05);
  }

  async _load(n) {
    try {
      const r = await fetch(`audio/${n}.mp3`); if (!r.ok) return;
      this.buf[n] = await this.ctx.decodeAudioData(await r.arrayBuffer());
    } catch (_) { /* optional asset */ }
  }

  _noiseBuffer() {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + (Math.random() * 2 - 1) * 0.08) * 0.985; d[i] = last * 3 + (Math.random() * 2 - 1) * 0.15; }
    return b;
  }

  _synth() {
    const c = this.ctx;
    this.noise = this._noiseBuffer();
    // engine: low hum + filtered wash, driven by thrust and speed
    this.eng = { osc: c.createOscillator(), osc2: c.createOscillator(), gain: c.createGain(), wash: c.createBufferSource(), washF: c.createBiquadFilter(), washG: c.createGain() };
    const e = this.eng;
    e.osc.type = "sawtooth"; e.osc.frequency.value = 42; e.osc2.type = "sine"; e.osc2.frequency.value = 84;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220;
    e.osc.connect(lp); e.osc2.connect(lp); lp.connect(e.gain); e.gain.gain.value = 0; e.gain.connect(this.sfx);
    e.wash.buffer = this.noise; e.wash.loop = true; e.washF.type = "bandpass"; e.washF.frequency.value = 400; e.washF.Q.value = 0.8;
    e.wash.connect(e.washF).connect(e.washG).connect(this.sfx); e.washG.gain.value = 0;
    e.osc.start(); e.osc2.start(); e.wash.start();
    this.lp = lp;
    // hull scrape: gritty band noise, level follows contact slide speed
    this.scr = { src: c.createBufferSource(), f: c.createBiquadFilter(), g: c.createGain() };
    this.scr.src.buffer = this.noise; this.scr.src.loop = true; this.scr.src.playbackRate.value = 1.7;
    this.scr.f.type = "bandpass"; this.scr.f.frequency.value = 900; this.scr.f.Q.value = 2.5; this.scr.g.gain.value = 0;
    this.scr.src.connect(this.scr.f).connect(this.scr.g).connect(this.sfx); this.scr.src.start();
  }

  _ambient() {
    if (!this.buf.ambient) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf.ambient; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0.55; s.connect(g).connect(this.sfx); s.start();
  }

  /** gameplay wants music (true while diving); plays only if the player has music enabled */
  setMusic(on) { this.musicOn = on; this._applyMusic(); }
  _applyMusic() { if (!this.ctx) return; if (this.musicOn && this.settings.get("musicEnabled") !== false) this._startMusic(); else this._stopMusic(); }
  nextTrack() { this.track = (this.track + 1) % TRACKS.length; if (this.musicSrc) { this._stopMusic(); this._applyMusic(); } return this.track; }
  _startMusic() {
    if (this.musicSrc) return;
    const b = this.buf[TRACKS[this.track]]; if (!b) return;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(1, this.ctx.currentTime, 1.2);
    s.connect(g).connect(this.music); s.start(); this.musicSrc = s; this.musicG = g;
  }
  _stopMusic() {
    if (!this.musicSrc) return;
    const s = this.musicSrc, g = this.musicG; this.musicSrc = null;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); setTimeout(() => { try { s.stop(); } catch (_) {} }, 1500);
  }

  /** continuous parameters, called every frame */
  update(s) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime, e = this.eng;
    const load = Math.min(1, Math.abs(s.thrust) * 0.7 + s.speed / 18);
    e.osc.frequency.setTargetAtTime(38 + load * 34 + (s.boost ? 18 : 0), t, 0.15);
    e.osc2.frequency.setTargetAtTime(76 + load * 70, t, 0.15);
    this.lp.frequency.setTargetAtTime(160 + load * 380 + (s.boost ? 300 : 0), t, 0.15);
    e.gain.gain.setTargetAtTime(s.active ? 0.05 + load * 0.12 : 0, t, 0.2);
    e.washG.gain.setTargetAtTime(s.active ? Math.min(0.25, s.speed / 18 * 0.22) + (s.boost ? 0.08 : 0) : 0, t, 0.25);
    e.washF.frequency.setTargetAtTime(300 + s.speed * 40, t, 0.2);
    this.scr.g.gain.setTargetAtTime(s.active && s.scrape > 0.3 ? Math.min(0.5, s.scrape * 0.07) : 0, t, 0.05);
  }

  play(name, vol = 1, rate = 1) {
    if (!this.ctx || !this.buf[name]) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[name]; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol; s.connect(g).connect(this.sfx); s.start();
  }

  tone({ f = 440, f2 = f, dur = 0.3, type = "sine", vol = 0.2, delay = 0, q = 0 }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (q) { const f0 = c.createBiquadFilter(); f0.type = "bandpass"; f0.frequency.value = f; f0.Q.value = q; o.connect(f0); node = f0; }
    node.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  noiseHit({ dur = 0.4, f = 300, vol = 0.4, delay = 0 }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.6 + Math.random() * 0.3;
    const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.setValueAtTime(f * 3, t); fl.frequency.exponentialRampToValueAtTime(f * 0.3, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.sfx); s.start(t); s.stop(t + dur + 0.05);
  }

  // ---- named cues
  cue(name, x = {}) {
    switch (name) {
      case "fire": this.tone({ f: 1400, f2: 380, dur: 0.12, type: "square", vol: 0.05 }); this.play("fire", 0.35, 1.2); break;
      case "dry": this.tone({ f: 180, f2: 140, dur: 0.08, type: "square", vol: 0.05 }); break;
      case "sonar":
        this.tone({ f: 1180, f2: 1150, dur: 0.9, vol: 0.18, q: 8 });
        for (let k = 1; k <= 3; k++) this.tone({ f: 1170, f2: 1140, dur: 0.6, vol: 0.07 / k, delay: 0.35 * k, q: 8 });
        break;
      case "echo": this.tone({ f: x.threat ? 520 : 900, f2: x.threat ? 480 : 880, dur: 0.25, vol: 0.06, delay: x.delay || 0, type: x.threat ? "triangle" : "sine" }); break;
      case "sonarBusy": this.tone({ f: 300, dur: 0.06, vol: 0.04 }); break;
      case "pickup": this.play("pickup", 0.7); this.tone({ f: 660, f2: 1320, dur: 0.18, vol: 0.06, type: "triangle" }); break;
      case "repair": this.tone({ f: 440, f2: 880, dur: 0.4, vol: 0.08, type: "triangle" }); this.tone({ f: 660, f2: 1320, dur: 0.4, vol: 0.05, delay: 0.1, type: "triangle" }); break;
      case "kill": this.play("kill", 0.6); break;
      case "enemyHit": this.tone({ f: 520, f2: 260, dur: 0.1, type: "square", vol: 0.05 }); break;
      case "bump": this.noiseHit({ dur: 0.25, f: 180, vol: Math.min(0.5, 0.08 * x.impact) }); break;
      case "damage": this.play("hit", 0.8); this.noiseHit({ dur: 0.5, f: 140, vol: 0.5 }); break;
      case "explode": this.noiseHit({ dur: 1.1, f: 120, vol: 0.9 }); this.tone({ f: 90, f2: 30, dur: 0.8, vol: 0.3 }); break;
      case "arm": this.tone({ f: 1800, dur: 0.07, vol: 0.06, type: "square" }); this.tone({ f: 1800, dur: 0.07, vol: 0.06, type: "square", delay: 0.18 }); break;
      case "disarm": this.tone({ f: 900, f2: 500, dur: 0.2, vol: 0.04 }); break;
      case "tell": this.noiseHit({ dur: 0.9, f: 1400, vol: 0.18 }); this.tone({ f: 220, f2: 330, dur: 0.8, type: "sawtooth", vol: 0.05 }); break;
      case "lunge": this.noiseHit({ dur: 0.4, f: 500, vol: 0.3 }); break;
      case "roar": this.tone({ f: 70, f2: 45, dur: 2.2, type: "sawtooth", vol: 0.22 }); this.noiseHit({ dur: 2, f: 200, vol: 0.4 }); break;
      case "freeze": this.tone({ f: 2400, f2: 3100, dur: 0.35, vol: 0.05, type: "triangle" }); break;
      case "stalk": this.tone({ f: 330, f2: 310, dur: 1.2, vol: 0.035, type: "triangle", q: 3 }); break;
      case "shadeBurst": this.noiseHit({ dur: 0.35, f: 2200, vol: 0.2 }); break;
      case "rumble": this.noiseHit({ dur: 1.6, f: 70, vol: 0.7, delay: x.delay || 0 }); break;
      case "checkpoint": this.tone({ f: 523, dur: 0.18, vol: 0.07, type: "triangle" }); this.tone({ f: 784, dur: 0.3, vol: 0.07, type: "triangle", delay: 0.14 }); break;
      case "objective": this.tone({ f: 392, dur: 0.2, vol: 0.05, type: "triangle" }); this.tone({ f: 587, dur: 0.3, vol: 0.05, type: "triangle", delay: 0.12 }); break;
      case "seal": this.tone({ f: 200, f2: 60, dur: 1.4, type: "sawtooth", vol: 0.15 }); this.noiseHit({ dur: 1.5, f: 300, vol: 0.5 }); break;
      case "win": this.play("win", 0.8); break;
      case "lose": this.play("lose", 0.8); break;
      case "click": this.play("click", 0.5); break;
    }
  }
}
