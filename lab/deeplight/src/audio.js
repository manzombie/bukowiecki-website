/* audio.js — tiny WebAudio manager with two channels: MUSIC and SFX.
 * Loads from deeplight/audio/<name>.mp3. Everything is OPTIONAL (missing files
 * are skipped). Browsers block sound until a gesture, so call unlock() on Dive.
 *
 * Channels:
 *   MUSIC = three selectable looping tracks          -> musicGain
 *   SFX   = ambient.mp3 (loop) + all one-shots       -> sfxGain
 * Each channel has an independent on/off toggle. */

// selectable music tracks: UI label -> file (without .mp3)
const TRACKS = { track1: "music", track2: "music02", track3: "music03" };
const SFX = ["ambient", "fire", "kill", "pickup", "gate", "hit", "deadend", "win", "lose", "click"];

export class GameAudio {
  constructor(base = "audio/") {
    this.base = base;
    this.buffers = {};
    this.ctx = null;
    this.unlocked = false;
    this.sfxOn = true;
    this.currentTrack = null;     // which music track is SELECTED (persists across menus)
    this.musicActive = false;     // gameplay wants music? (false on menus)
    this.musicSrc = null;
    this.MUSIC_VOL = 0.55;
    this.SFX_VOL = 1.0;
  }

  /** which track keys actually have a loaded file (for greying out UI) */
  availableTracks() { return Object.keys(TRACKS).filter((k) => this.buffers[TRACKS[k]]); }

  async unlock() {
    if (this.unlocked) { this.ctx?.resume(); return; }
    this.unlocked = true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.MUSIC_VOL;
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = this.sfxOn ? this.SFX_VOL : 0;
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      const files = [...new Set([...Object.values(TRACKS), ...SFX])];
      await Promise.all(files.map((n) => this._load(n)));
      this._loop("ambient", this.sfxGain, 0.8);
      // default-select the first available track; it only PLAYS once gameplay
      // marks music active (menus stay silent)
      if (!this.currentTrack) this.currentTrack = this.availableTracks()[0] || null;
      this._applyMusic();
    } catch (_) { /* no audio available — fine */ }
  }

  /** select a music track (track1/2/3) or null. Plays only when musicActive. */
  selectTrack(key) { this.currentTrack = key || null; this._applyMusic(); return this.currentTrack; }

  /** gameplay on/off — music is silenced on menus */
  setMusicActive(active) { this.musicActive = active; this._applyMusic(); }

  _applyMusic() {
    if (this.musicSrc) { try { this.musicSrc.stop(); } catch (_) {} this.musicSrc = null; }
    if (!this.musicActive || !this.currentTrack || !this.ctx) return;
    const file = TRACKS[this.currentTrack];
    if (!file || !this.buffers[file]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[file]; src.loop = true;
    src.connect(this.musicGain); src.start();
    this.musicSrc = src;
  }

  async _load(name) {
    try {
      const res = await fetch(this.base + name + ".mp3");
      if (!res.ok) return;
      this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (_) { /* skip */ }
  }

  _loop(name, outGain, vol) {
    if (!this.buffers[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name]; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g).connect(outGain);
    src.start();
  }

  /** one-shot SFX */
  play(name, { volume = 1, rate = 1 } = {}) {
    if (!this.sfxOn || !this.ctx || !this.buffers[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name]; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = volume;
    src.connect(g).connect(this.sfxGain);
    src.start();
  }

  setSfx(on)  { this.sfxOn = on; if (this.sfxGain) this.sfxGain.gain.value = on ? this.SFX_VOL : 0; return on; }
  toggleSfx() { return this.setSfx(!this.sfxOn); }
}
