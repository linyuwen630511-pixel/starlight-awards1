// ============================================================
// 共用介面：主題、星光背景、提示、確認視窗、音效、須知渲染
// ============================================================
import { STATUS_LABEL } from "./rules.js";

const THEME_KEY = "starlight-theme";
const SOUND_KEY = "starlight-sound";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 先跳脫，再把 **文字** 轉為粗體 */
export const richText = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");

// ---------------- 主題 ----------------
export const THEMES = { ivory: "象牙香檳", midnight: "夜幕星光" };
export function applyTheme(t) {
  if (!THEMES[t]) t = "ivory";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  document.querySelectorAll('[data-ui="theme"]').forEach((b) => { b.title = `主題：${THEMES[t]}（點擊切換）`; b.textContent = t === "ivory" ? "☾" : "☀"; });
  starfieldReset && starfieldReset();
}
const currentTheme = () => document.documentElement.dataset.theme || "ivory";

// ---------------- 星光背景 ----------------
/** 四角星芒（星光遊戲所的 ✦ 造型） */
export function sparkle(ctx, x, y, r) {
  const k = r * 0.22;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + k, y - k, x + r, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + r);
  ctx.quadraticCurveTo(x - k, y + k, x - r, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - r);
  ctx.fill();
}
let starfieldReset = null;
function initStarfield() {
  let canvas = document.getElementById("starfield");
  if (!canvas) {
    canvas = Object.assign(document.createElement("canvas"), { id: "starfield", ariaHidden: "true" });
    document.body.prepend(canvas);
  }
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stars = [], w = 0, h = 0, dpr = 1, raf = 0;

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ivory = currentTheme() === "ivory";
    const count = Math.round(Math.min(ivory ? 46 : 150, (w * h) / (ivory ? 28000 : 9000)));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.3 + 0.25,
      p: Math.random() * Math.PI * 2,
      s: 0.4 + Math.random() * 1.1,
      v: 0.02 + Math.random() * 0.06
    }));
  };
  const draw = (t) => {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--star").trim() || "255,240,210";
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = reduce ? 0.6 : 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(s.p + t * 0.001 * s.s));
      ctx.fillStyle = `rgba(${color},${(a * (s.r > 1.1 ? 0.75 : 0.5)).toFixed(3)})`;
      if (s.r > 1.1) sparkle(ctx, s.x, s.y, s.r * 3.2);
      else { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }
      if (!reduce) { s.y -= s.v; if (s.y < -2) { s.y = h + 2; s.x = Math.random() * w; } }
    }
    if (!reduce) raf = requestAnimationFrame(draw);
  };
  resize();
  starfieldReset = () => { resize(); if (reduce) draw(performance.now()); };
  addEventListener("resize", () => { cancelAnimationFrame(raf); resize(); draw(performance.now()); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf); else if (!reduce) raf = requestAnimationFrame(draw);
  });
  draw(performance.now());
}

// ---------------- 音效（Web Audio，原創合成音） ----------------
let actx = null;
export const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; } };
function audio() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
  if (actx.state === "suspended") actx.resume();
  return actx;
}
function tone(freq, dur, { type = "sine", gain = 0.06, delay = 0 } = {}) {
  if (!soundOn()) return;
  const c = audio(); if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
export const sfx = {
  click: () => tone(1318.5, 0.08, { type: "triangle", gain: 0.035 }),
  chime: () => [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, 0.6, { gain: 0.045, delay: i * 0.07 })),
  soft: () => tone(784, 0.25, { gain: 0.04 }),
  error: () => { tone(330, 0.16, { type: "triangle", gain: 0.05 }); tone(262, 0.22, { type: "triangle", gain: 0.05, delay: 0.12 }); }
};
function syncSoundButtons() {
  document.querySelectorAll('[data-ui="sound"]').forEach((b) => {
    b.textContent = soundOn() ? "🔊" : "🔇";
    b.title = soundOn() ? "音效：開啟（點擊靜音）" : "音效：靜音（點擊開啟）";
    b.setAttribute("aria-pressed", String(soundOn()));
  });
}

// ---------------- 共用外框 ----------------
export function initChrome() {
  let t = "ivory";
  try { t = localStorage.getItem(THEME_KEY) || "ivory"; } catch {}
  applyTheme(t);
  initStarfield();
  syncSoundButtons();
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ui]");
    if (!b) return;
    if (b.dataset.ui === "theme") { applyTheme(currentTheme() === "ivory" ? "midnight" : "ivory"); sfx.click(); }
    if (b.dataset.ui === "sound") {
      try { localStorage.setItem(SOUND_KEY, soundOn() ? "off" : "on"); } catch {}
      syncSoundButtons(); sfx.click();
    }
  });
}

export function showModeBadge(mode) {
  const el = document.getElementById("modeBadge");
  if (!el) return;
  el.hidden = false;
  if (mode === "demo") {
    el.textContent = "本機示範模式";
    el.className = "mode-badge demo";
    el.title = "尚未設定 Firebase：資料只保存在此瀏覽器，無法跨裝置投票。請於 js/config.js 填入 Firebase 設定。";
  } else {
    el.textContent = "已連線 Firebase";
    el.className = "mode-badge live";
    el.title = "正式連線模式：資料即時同步";
  }
}

// ---------------- 提示訊息 ----------------
export function toast(msg, type = "info", ms = 3200) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) { wrap = Object.assign(document.createElement("div"), { className: "toast-wrap" }); wrap.setAttribute("role", "status"); document.body.appendChild(wrap); }
  const el = Object.assign(document.createElement("div"), { className: `toast ${type}` });
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------------- 視窗 ----------------
export function openModal(innerHTML, { wide = false, onMount } = {}) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal card ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${innerHTML}</div>`;
  document.body.appendChild(back);
  document.body.classList.add("no-scroll");
  const modal = back.querySelector(".modal");
  const close = () => { back.classList.remove("show"); document.body.classList.remove("no-scroll"); setTimeout(() => back.remove(), 200); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-close]")) close(); });
  requestAnimationFrame(() => back.classList.add("show"));
  onMount && onMount(modal, close);
  setTimeout(() => modal.querySelector("input,textarea,select,button.btn-gold")?.focus(), 50);
  return { modal, close };
}

export function confirmDialog({ title = "請確認", message = "", confirmText = "確認", cancelText = "取消", danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const { modal, close } = openModal(`
      <h3 class="modal-title">${esc(title)}</h3>
      <div class="modal-body">${message}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-r="0">${esc(cancelText)}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-gold"}" data-r="1">${esc(confirmText)}</button>
      </div>`);
    modal.addEventListener("click", (e) => {
      const b = e.target.closest("[data-r]");
      if (!b) return;
      done = true; resolve(b.dataset.r === "1"); close();
    });
    const back = modal.parentElement;
    const obs = new MutationObserver(() => { if (!document.body.contains(back)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

// ---------------- 共用片段 ----------------
export const statusChip = (status) =>
  `<span class="chip status-${esc(status || "draft")}">${esc(STATUS_LABEL[status] || "草稿")}</span>`;

export function noticeHTML(notice) {
  return `
    <div class="notice">
      <h3 class="notice-title"><span class="star">★</span>${esc(notice.title)}</h3>
      <ol class="notice-list">${notice.items.map((t) => `<li>${richText(t)}</li>`).join("")}</ol>
      <p class="notice-footer"><strong>${esc(notice.footer)}</strong></p>
    </div>`;
}

export function fmtDate(ms) {
  if (!ms || typeof ms !== "number") return "";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}
