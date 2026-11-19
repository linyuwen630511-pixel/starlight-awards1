// ============================================================
// 原創音樂與音效（Web Audio API 即時合成，無任何外部錄音）
// - 輕柔背景音樂：琶音鋼琴＋柔和弦樂墊
// - 原創軍樂進行曲：銅管旋律、和聲、低音、大小鼓、銅鈸
// - 典禮音效：鼓聲滾奏、聚光燈、升起、揭曉、號角、掌聲、彩帶
// 所有曲調皆為本專案原創編寫。
// ============================================================
const SETTINGS_KEY = "starlight-audio";
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class StarAudio {
  constructor() {
    this.ctx = null;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
    this.settings = { bgm: saved.bgm ?? true, sfx: saved.sfx ?? true, volume: saved.volume ?? 0.8 };
    this.loop = null;
  }
  save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch {} }

  /** 必須在使用者點擊後呼叫（瀏覽器自動播放限制） */
  ensure() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      const c = this.ctx = new C();
      this.master = c.createGain(); this.master.gain.value = this.settings.volume;
      this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -16; this.comp.ratio.value = 4;
      this.master.connect(this.comp).connect(c.destination);
      this.bgmBus = c.createGain(); this.bgmBus.gain.value = this.settings.bgm ? 1 : 0; this.bgmBus.connect(this.master);
      this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.settings.sfx ? 1 : 0; this.sfxBus.connect(this.master);
      // 簡易殘響
      this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.4);
      this.verbGain = c.createGain(); this.verbGain.gain.value = 0.28;
      this.verb.connect(this.verbGain).connect(this.master);
      this.noiseBuf = this.makeNoise();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }
  impulse(sec) {
    const c = this.ctx, len = c.sampleRate * sec, b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }
  makeNoise() {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // ---------- 設定 ----------
  setVolume(v) { this.settings.volume = v; this.save(); if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setBgm(on) { this.settings.bgm = on; this.save(); if (this.bgmBus) this.bgmBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.3); }
  setSfx(on) { this.settings.sfx = on; this.save(); if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05); }

  // ---------- 基本音色 ----------
  piano(bus, t, midi, dur = 1.6, vel = 0.12) {
    const c = this.ctx, g = c.createGain(), o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = "triangle"; o2.type = "sine"; o1.frequency.value = mtof(midi); o2.frequency.value = mtof(midi) * 2.001;
    const g2 = c.createGain(); g2.gain.value = 0.25;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o1.connect(g); o2.connect(g2).connect(g); g.connect(bus); g.connect(this.verb);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  pad(bus, t, midis, dur, vel = 0.03) {
    const c = this.ctx, f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + dur * 0.35); g.gain.linearRampToValueAtTime(0, t + dur);
    f.connect(g); g.connect(bus); g.connect(this.verb);
    for (const m of midis) for (const det of [-6, 6]) {
      const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.1);
    }
  }
  brass(bus, t, midi, dur, vel = 0.09) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = "sawtooth"; o2.type = "square"; o.frequency.value = mtof(midi); o2.frequency.value = mtof(midi) / 2;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 5.5; lg.gain.value = 3; lfo.connect(lg).connect(o.detune);
    const m2 = c.createGain(); m2.gain.value = 0.18;
    f.type = "lowpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(2600, t + 0.05); f.frequency.exponentialRampToValueAtTime(1500, t + Math.max(0.1, dur));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.03); g.gain.setValueAtTime(vel * 0.8, t + Math.max(0.04, dur - 0.05)); g.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    o.connect(f); o2.connect(m2).connect(f); f.connect(g); g.connect(bus); g.connect(this.verb);
    [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + dur + 0.1); });
  }
  noise(bus, t, dur, { type = "highpass", freq = 5000, q = 0.7, vel = 0.2, attack = 0.002 } = {}) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(bus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    return g;
  }
  kick(bus, t, vel = 0.5) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(bus); o.start(t); o.stop(t + 0.32);
  }
  snare(bus, t, vel = 0.16) { this.noise(bus, t, 0.14, { type: "bandpass", freq: 2400, q: 0.8, vel }); this.piano(bus, t, 50, 0.08, vel * 0.4); }
  crash(bus, t, vel = 0.14, dur = 2.2) { this.noise(bus, t, dur, { type: "highpass", freq: 6000, vel }); }

  // ---------- 背景音樂（循環排程） ----------
  stopBgm(fade = 1.2) {
    if (!this.loop) return;
    const { gain, timer } = this.loop;
    clearInterval(timer);
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => gain.disconnect(), fade * 1000 + 300);
    this.loop = null;
  }
  startLoop(name, stepDur, steps, play, fade = 1.5) {
    if (!this.ensure()) return;
    if (this.loop?.name === name) return;
    this.stopBgm(0.8);
    const c = this.ctx, gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime); gain.gain.linearRampToValueAtTime(1, c.currentTime + fade);
    gain.connect(this.bgmBus);
    let next = c.currentTime + 0.1, step = 0;
    const tick = () => {
      while (next < c.currentTime + 0.25) { play(gain, next, step % steps); next += stepDur; step++; }
    };
    tick();
    this.loop = { name, gain, timer: setInterval(tick, 50) };
  }

  /** 輕柔典禮／投票背景音樂：Cmaj7 – Am7 – Fmaj7 – G6，64 BPM 琶音 */
  playAmbient() {
    const chords = [[48, 55, 64, 71, 76], [45, 52, 60, 67, 72], [41, 48, 57, 64, 69], [43, 50, 59, 64, 71]];
    const pattern = [0, 2, 3, 4, 3, 2, 1, 2];
    const eighth = 60 / 64 / 2;
    this.startLoop("ambient", eighth, 32, (bus, t, s) => {
      const ch = chords[Math.floor(s / 8)];
      if (s % 8 === 0) { this.pad(bus, t, ch.slice(1, 4), eighth * 8.2, 0.016); this.piano(bus, t, ch[0], 3, 0.09); }
      this.piano(bus, t, ch[pattern[s % 8]] + 12, 1.8, s % 8 === 0 ? 0.07 : 0.045);
    }, 2.5);
  }

  /** 原創軍樂進行曲（2/4 拍，116 BPM，16 小節循環） */
  playMarch() {
    const M = [
      [67, 0, 72, 0], [76, 0, 76, 74], [72, 0, 76, 0], [79, 0, 0, 0],
      [81, 0, 79, 77], [76, 0, 74, 72], [74, 0, 0, 76], [74, 0, 0, 0],
      [67, 0, 72, 0], [76, 76, 77, 79], [81, 0, 77, 0], [76, 0, 72, 0],
      [77, 0, 81, 0], [79, 0, 76, 72], [74, 0, 67, 71], [72, 0, 0, 0]
    ].flat();
    const H = ["C", "C", "C", "C", "F", "C", "G", "G", "C", "C", "F", "C", "F", "C", "G", "C"];
    const ROOT = { C: 36, F: 41, G: 43 };
    const THIRD = { C: [64, 67], F: [65, 69], G: [62, 67] };
    const eighth = 60 / 116 / 2;
    // 計算每個音的長度（遇到下一個非 0 為止）
    const len = M.map((m, i) => { if (!m) return 0; let k = 1; while (i + k < M.length && M[i + k] === 0 && k < 4) k++; return k; });
    this.startLoop("march", eighth, 64, (bus, t, s) => {
      const bar = Math.floor(s / 4), pos = s % 4, h = H[bar];
      if (M[s]) {
        this.brass(bus, t, M[s], len[s] * eighth * 0.92, 0.075);
        // 和聲（三度下方）
        const harm = THIRD[h].filter((x) => x < M[s]).pop() ?? M[s] - 4;
        this.brass(bus, t, harm, len[s] * eighth * 0.92, 0.035);
      }
      // 低音 oom-pah
      if (pos === 0) this.brass(bus, t, ROOT[h], eighth * 0.9, 0.07);
      if (pos === 2) this.brass(bus, t, ROOT[h] + 7, eighth * 0.9, 0.06);
      // 打擊樂
      if (pos === 0 || pos === 2) this.kick(bus, t, pos === 0 ? 0.42 : 0.3);
      if (pos === 1 || pos === 3) this.snare(bus, t, 0.11);
      if ((bar === 7 || bar === 15) && pos >= 2) { this.snare(bus, t + eighth / 2, 0.08); }
      if ((bar === 0 || bar === 8) && pos === 0) this.crash(bus, t, 0.08, 1.6);
    }, 1.2);
  }

  // ---------- 音效 ----------
  sfx(fn) { if (!this.ensure()) return; fn(this.sfxBus, this.ctx.currentTime + 0.02); }
  click() { this.sfx((b, t) => this.piano(b, t, 88, 0.15, 0.05)); }
  chime() { this.sfx((b, t) => [84, 88, 91, 96].forEach((m, i) => this.piano(b, t + i * 0.07, m, 1.2, 0.06))); }
  /** 典禮開場：柔和鐘琴上行 */
  intro() { this.sfx((b, t) => { [72, 76, 79, 84, 88].forEach((m, i) => this.piano(b, t + i * 0.16, m, 2.4, 0.06)); this.pad(b, t, [60, 64, 67, 71], 4, 0.02); }); }
  /** 鼓聲滾奏（逐漸增強） */
  drumroll(dur = 2) {
    this.sfx((b, t) => {
      const n = Math.floor(dur * 22);
      for (let i = 0; i < n; i++) this.noise(b, t + i * dur / n, 0.07, { type: "bandpass", freq: 2200, q: 0.9, vel: 0.03 + 0.11 * (i / n) });
    });
  }
  spotlight() { this.sfx((b, t) => { this.kick(b, t, 0.35); this.noise(b, t, 0.9, { type: "lowpass", freq: 900, vel: 0.06, attack: 0.25 }); }); }
  rise() {
    this.sfx((b, t) => {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(720, t + 1.2);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 1.3);
      o.connect(g).connect(b); o.start(t); o.stop(t + 1.4);
      const f = this.noise(b, t, 1.3, { type: "bandpass", freq: 1200, q: 2, vel: 0.05, attack: 0.9 });
    });
  }
  /** 揭曉音效：銅、銀、金依序更華麗 */
  reveal(tier) {
    this.sfx((b, t) => {
      const chord = { bronze: [55, 60, 64, 67], silver: [57, 60, 64, 69, 72], gold: [60, 64, 67, 72, 76, 79] }[tier];
      this.crash(b, t, tier === "gold" ? 0.18 : 0.12, tier === "gold" ? 3 : 2);
      this.kick(b, t, 0.5);
      chord.forEach((m) => this.brass(b, t, m, tier === "gold" ? 1.8 : 1.2, tier === "gold" ? 0.05 : 0.04));
      chord.forEach((m, i) => this.piano(b, t + 0.2 + i * 0.06, m + 24, 1.6, 0.04));
    });
  }
  /** 華麗勝利號角（金獎） */
  fanfare() {
    this.sfx((b, t) => {
      const e = 0.13;
      [[67, 0, 1], [67, 1, 1], [67, 2, 1], [72, 3, 3], [76, 6, 2], [79, 8, 6]].forEach(([m, at, d]) => this.brass(b, t + at * e, m, d * e * 0.95, 0.08));
      [[64, 3, 3], [67, 6, 2], [72, 8, 6], [76, 8, 6]].forEach(([m, at, d]) => this.brass(b, t + at * e, m, d * e * 0.95, 0.045));
      this.brass(b, t + 8 * e, 48, 6 * e, 0.07);
      this.crash(b, t + 8 * e, 0.16, 3);
      for (let i = 0; i < 8; i++) this.snare(b, t + i * e, 0.06 + i * 0.01);
    });
  }
  applause(dur = 4.5) {
    this.sfx((b, t) => {
      const n = Math.floor(dur * 70);
      for (let i = 0; i < n; i++) {
        const at = t + Math.random() * dur, fade = 1 - (at - t) / dur;
        this.noise(b, at, 0.05 + Math.random() * 0.04, { type: "bandpass", freq: 900 + Math.random() * 1800, q: 1.4, vel: 0.05 * Math.min(1, fade * 1.6) });
      }
    });
  }
  confetti() { this.sfx((b, t) => { for (let i = 0; i < 14; i++) this.piano(b, t + Math.random() * 1.2, 90 + Math.floor(Math.random() * 10), 0.5, 0.025); this.noise(b, t, 0.25, { type: "highpass", freq: 3000, vel: 0.08 }); }); }
}

export const audio = new StarAudio();
