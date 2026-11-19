// ============================================================
// 星光頒獎舞台（第四階段）
// 管理者逐一揭曉：典禮開場 → 銅獎 → 銀獎 → 金獎 → 完整獎台
// 揭曉進度存於 awards/{eventId}/stage，多個螢幕（例如筆電＋投影）即時同步。
// 重新播放只改變動畫進度，不會修改 results（投票結果）。
// ============================================================
import { getStore } from "./store.js";
import { esc, sparkle, toast, fmtDate } from "./ui.js";
import { trophySVG } from "./trophy.js";
import { audio } from "./audio.js";

const $app = document.getElementById("app");
const ORDER = ["idle", "intro", "bronze", "silver", "gold", "all"];
const TIERS = ["silver", "gold", "bronze"]; // 舞台由左至右
const LABEL = { gold: "金獎", silver: "銀獎", bronze: "銅獎" };
const RANKN = { gold: "1", silver: "2", bronze: "3" };
const STEP_BTN = { intro: "開始頒獎典禮", bronze: "揭曉銅獎", silver: "揭曉銀獎", gold: "揭曉金獎", all: "顯示完整獎台" };
const C = { store: null, eid: null, event: null, results: null, stage: "idle", unlocked: false, timers: [], confetti: null };

const params = new URLSearchParams(location.search);
C.eid = params.get("e");

init().catch((e) => { console.error(e); msg(`載入失敗：${esc(e.message)}`); });

function msg(html) {
  $app.innerHTML = `<div class="cer-msg"><div class="card" style="max-width:560px;text-align:center;background:var(--surface-solid)">${html}
    <p style="margin-top:16px"><a class="btn btn-ghost" href="admin.html">返回控制台</a></p></div></div>`;
}

async function init() {
  if (!C.eid) return msg("<h2>缺少活動參數</h2>");
  C.store = await getStore();
  C.store.onAuth(async (u) => {
    if (!u || u.isAnonymous || !(await C.store.isAdmin(u.uid))) return msg("<h2>請先以管理者身分登入</h2><p>頒獎典禮僅限管理者操作。</p>");
    start();
  });
}

let started = false;
function start() {
  if (started) return; started = true;
  C.store.on(`events/${C.eid}`, (v) => { C.event = v; if (!v) return msg("<h2>找不到活動</h2>"); if (C.results) build(); });
  C.store.on(`results/${C.eid}`, (v) => {
    C.results = v;
    if (!v?.finalizedAt) return msg("<h2>尚未確認最終結果</h2><p>請先結束投票，並在「統計結果」按「確認最終結果」。</p>");
    if (C.event) build();
  });
  C.store.on(`awards/${C.eid}/stage`, (v) => { applyStage(v || "idle", true); });
}

// ---------------- 建立舞台 ----------------
let built = false;
function winnersOf(tier) {
  const rk = C.results?.ranking || [];
  return rk.filter((r) => r.award === tier);
}

function build() {
  if (built) { updateHead(); return; }
  built = true;
  const podium = (t) => {
    const ws = winnersOf(t);
    const names = ws.map((w) => w.name);
    const shown = names.slice(0, 3).join("、") + (names.length > 3 ? ` 等 ${names.length} 組` : "");
    const works = ws.map((w) => w.workTitle).filter(Boolean);
    return `<div class="podium ${t}" data-podium="${t}">
      <div class="top"></div>
      <div class="front">
        <span class="num">${RANKN[t]}</span>
        <div class="winner" data-winner="${t}">
          <div class="tier">${LABEL[t]}</div>
          ${ws.length ? `<div class="names">${esc(shown)}</div>
            ${works.length === 1 ? `<div class="work">${esc(works[0])}</div>` : ""}
            ${ws.length > 1 ? `<div class="multi">並列得獎</div>` : ""}
            <div class="votes">${ws[0].votes} 票</div>` : `<div class="vacant">從缺</div><div class="multi">（同票並列名次）</div>`}
        </div>
      </div>
    </div>`;
  };
  $app.innerHTML = `
    <div class="stage-viewport">
      <div class="stage" id="stage" data-stage="idle">
        <canvas class="layer" id="stars"></canvas>
        <div class="stage-head"><p class="en">Starlight Awards</p><h1 id="evTitle"></h1></div>
        <div class="caption" id="caption"></div>
        ${TIERS.map((t) => `<div class="beam ${t}" data-beam="${t}"></div><div class="beam-pool ${t}" data-pool="${t}"></div>`).join("")}
        <div class="podiums">${TIERS.map(podium).join("")}</div>
        ${TIERS.map((t) => `<div class="trophy-slot ${t}" data-trophy="${t}">${winnersOf(t).length ? trophySVG(t, { width: t === "gold" ? 210 : t === "silver" ? 180 : 170 }) : ""}</div>`).join("")}
        <div class="floor"></div>
        <div class="dimmer"></div>
        <canvas class="layer" id="confetti" style="z-index:12"></canvas>
        <div class="start-overlay" id="unlock"><div><div class="big">✦</div><h2>榮耀頒獎典禮</h2><p>點一下畫面，啟用音樂與音效</p></div></div>
      </div>
    </div>
    <div class="cer-controls" id="controls">
      ${Object.entries(STEP_BTN).map(([k, v]) => `<button class="btn btn-ghost" data-step="${k}">${v}</button>`).join("")}
      <span class="sep"></span>
      <button class="btn btn-ghost" data-act="replay">重新播放</button>
      <button class="btn btn-ghost" data-act="fs">全螢幕</button>
      <button class="btn btn-ghost" data-act="png">下載 PNG</button>
      <a class="btn btn-ghost" href="admin.html">返回統計</a>
      <span class="sep"></span>
      <label><input type="checkbox" data-a="bgm" ${audio.settings.bgm ? "checked" : ""}> 音樂</label>
      <label><input type="checkbox" data-a="sfx" ${audio.settings.sfx ? "checked" : ""}> 音效</label>
      <label>音量 <input type="range" min="0" max="1" step="0.05" value="${audio.settings.volume}" data-a="vol"></label>
      <button class="btn btn-ghost" data-act="hide" title="快捷鍵 H">隱藏</button>
    </div>
    <button class="btn btn-ghost btn-sm show-controls" data-act="show">控制列</button>`;
  updateHead();
  fit(); addEventListener("resize", fit);
  initStars();
  bindControls();
  applyStage(C.stage, false, true);
}

function updateHead() {
  const t = document.getElementById("evTitle");
  if (t && C.event) t.textContent = C.event.title;
  document.title = `${C.event?.title || ""}｜榮耀頒獎典禮`;
}

function fit() {
  const st = document.getElementById("stage");
  if (!st) return;
  const k = Math.min(innerWidth / 1600, innerHeight / 900);
  st.style.transform = `translate(-50%, -50%) scale(${k})`;
}

// ---------------- 星空 ----------------
function initStars() {
  const cv = document.getElementById("stars"), ctx = cv.getContext("2d");
  cv.width = 1600; cv.height = 900;
  const stars = Array.from({ length: 140 }, () => ({ x: Math.random() * 1600, y: Math.random() * 620, r: Math.random() * 1.6 + 0.3, p: Math.random() * 6.28, s: 0.5 + Math.random() }));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const draw = (t) => {
    ctx.clearRect(0, 0, 1600, 900);
    for (const s of stars) {
      const a = reduce ? 0.7 : 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(s.p + t * 0.0012 * s.s));
      ctx.fillStyle = `rgba(255,240,214,${a})`;
      if (s.r > 1.4) sparkle(ctx, s.x, s.y, s.r * 3.4);
      else { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill(); }
    }
    if (!reduce) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// ---------------- 彩帶 ----------------
function confettiBurst(sec = 6, amount = 220) {
  const cv = document.getElementById("confetti"); if (!cv) return;
  const ctx = cv.getContext("2d"); cv.width = 1600; cv.height = 900;
  const colors = ["#f6dc96", "#e2b75a", "#fff3d1", "#c99a3f", "#ffffff", "#f4cdd6", "#c9def0"];
  const until = performance.now() + sec * 1000;
  const parts = C.confetti?.parts || [];
  const spawn = (n) => { for (let i = 0; i < n; i++) parts.push({ x: Math.random() * 1600, y: -20 - Math.random() * 200, w: 6 + Math.random() * 8, h: 12 + Math.random() * 18, vy: 1.6 + Math.random() * 2.6, vx: -0.8 + Math.random() * 1.6, r: Math.random() * 6.28, vr: -0.12 + Math.random() * 0.24, c: colors[(Math.random() * colors.length) | 0], wob: Math.random() * 6.28 }); };
  spawn(amount);
  if (C.confetti) { C.confetti.until = Math.max(C.confetti.until, until); return; }
  C.confetti = { parts, until };
  const step = (now) => {
    ctx.clearRect(0, 0, 1600, 900);
    if (now < C.confetti.until && parts.length < 600) spawn(4);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.y += p.vy; p.x += p.vx + Math.sin(p.wob += 0.06) * 0.8; p.r += p.vr;
      if (p.y > 920) { parts.splice(i, 1); continue; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.abs(Math.cos(p.wob)) * 0.8 + 0.2);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (parts.length || now < C.confetti.until) requestAnimationFrame(step);
    else { C.confetti = null; ctx.clearRect(0, 0, 1600, 900); }
  };
  requestAnimationFrame(step);
}

// ---------------- 揭曉流程 ----------------
const later = (ms, fn) => C.timers.push(setTimeout(fn, ms));
function clearTimers() { C.timers.forEach(clearTimeout); C.timers = []; }

function caption(text, big = false) {
  const el = document.getElementById("caption"); if (!el) return;
  el.classList.remove("show");
  setTimeout(() => { el.textContent = text; el.classList.toggle("big", big); if (text) el.classList.add("show"); }, text ? 120 : 0);
}

function setTier(t, on) {
  document.querySelector(`[data-podium="${t}"]`)?.classList.toggle("up", on);
  document.querySelector(`[data-trophy="${t}"]`)?.classList.toggle("show", on);
  document.querySelector(`[data-winner="${t}"]`)?.classList.toggle("show", on);
}
function setBeam(t, on) {
  document.querySelector(`[data-beam="${t}"]`)?.classList.toggle("on", on);
  document.querySelector(`[data-pool="${t}"]`)?.classList.toggle("on", on);
}

/** 依進度設定畫面；animate=true 且為下一步時播放完整動畫與音效 */
function applyStage(stage, fromRemote, force = false) {
  if (!ORDER.includes(stage)) stage = "idle";
  const prev = C.stage;
  C.stage = stage;
  const root = document.getElementById("stage");
  if (!root) return;
  if (prev === stage && !force) return refreshButtons();
  clearTimers();
  root.dataset.stage = stage;
  const i = ORDER.indexOf(stage), pi = ORDER.indexOf(prev);
  const animate = !force && i === pi + 1;
  const reveal = { bronze: i >= 2, silver: i >= 3, gold: i >= 4 };

  if (!animate) {
    // 直接呈現（重新整理頁面、跳步或重新播放）
    for (const t of TIERS) { setTier(t, reveal[t]); setBeam(t, stage === "all" || (reveal[t] && ORDER[i] === t)); }
    caption(stage === "intro" ? "榮耀時刻，即將揭曉。" : stage === "gold" ? "冠軍誕生！" : stage === "all" ? "榮耀合照" : "", stage === "gold");
    if (C.unlocked) music(stage);
    return refreshButtons();
  }

  const tier = ["bronze", "silver", "gold"].includes(stage) ? stage : null;
  if (stage === "intro") {
    for (const t of TIERS) { setTier(t, false); setBeam(t, false); }
    caption("榮耀時刻，即將揭曉。");
    if (C.unlocked) { audio.intro(); music("intro"); }
  } else if (tier) {
    const wait = tier === "gold" ? 2600 : 1800;
    TIERS.forEach((t) => setBeam(t, false));
    caption(tier === "gold" ? "最高榮耀，金獎得主是…" : tier === "silver" ? "銀獎得主是…" : "銅獎得主是…");
    if (C.unlocked) audio.drumroll(wait / 1000);
    later(wait, () => {
      setBeam(tier, true);
      if (C.unlocked) audio.spotlight();
      later(250, () => { setTier(tier, true); if (C.unlocked) audio.rise(); });
      later(1300, () => {
        if (C.unlocked) { audio.reveal(tier); if (tier === "gold") audio.fanfare(); audio.applause(tier === "gold" ? 6 : 3.5); }
        if (tier === "gold") { caption("冠軍誕生！", true); confettiBurst(7, 260); if (C.unlocked) audio.confetti(); }
        else caption(`恭喜${LABEL[tier]}得主！`);
      });
    });
  } else if (stage === "all") {
    for (const t of TIERS) { setTier(t, true); setBeam(t, true); }
    caption("榮耀合照");
    confettiBurst(8, 300);
    if (C.unlocked) { music("all"); audio.applause(5); audio.confetti(); }
  }
  refreshButtons();
}

function music(stage) {
  if (!audio.settings.bgm && !audio.ctx) return;
  if (stage === "all") audio.playMarch();
  else if (stage === "idle") audio.stopBgm(1.5);
  else audio.playAmbient();
}

function refreshButtons() {
  const i = ORDER.indexOf(C.stage);
  document.querySelectorAll("[data-step]").forEach((b) => {
    const j = ORDER.indexOf(b.dataset.step);
    b.disabled = j !== i + 1;
    b.classList.toggle("btn-gold", j === i + 1);
    b.classList.toggle("btn-ghost", j !== i + 1);
    b.classList.toggle("next", j === i + 1);
  });
}

async function goStep(step) {
  const i = ORDER.indexOf(C.stage), j = ORDER.indexOf(step);
  if (j !== i + 1) return;
  if (!C.unlocked) unlock();
  const u = { [`awards/${C.eid}/stage`]: step, [`awards/${C.eid}/updatedAt`]: C.store.now() };
  if (step === "intro" && C.event?.status === "closed") u[`events/${C.eid}/status`] = "revealing";
  if (step === "all") u[`events/${C.eid}/status`] = "completed";
  try { await C.store.update(u); }
  catch (e) { console.error(e); toast("無法更新頒獎進度：" + e.message, "error"); }
}

function unlock() {
  if (C.unlocked) return;
  C.unlocked = true;
  audio.ensure();
  document.getElementById("unlock")?.remove();
  if (C.stage !== "idle") music(C.stage);
}

// ---------------- 控制 ----------------
function bindControls() {
  document.getElementById("unlock").addEventListener("click", () => { unlock(); audio.chime(); });
  const ctr = document.getElementById("controls");
  document.addEventListener("click", async (ev) => {
    const s = ev.target.closest("[data-step]");
    if (s && !s.disabled) return goStep(s.dataset.step);
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "replay") {
      if (!confirm("重新播放頒獎動畫？（不會修改投票結果）")) return;
      await C.store.update({ [`awards/${C.eid}/stage`]: "idle", [`awards/${C.eid}/updatedAt`]: C.store.now() });
      audio.stopBgm(1);
    }
    if (a === "fs") { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }
    if (a === "png") downloadPNG();
    if (a === "hide") ctr.classList.add("hidden");
    if (a === "show") ctr.classList.remove("hidden");
  });
  ctr.addEventListener("input", (ev) => {
    const a = ev.target.dataset.a;
    if (!a) return;
    audio.ensure();
    if (a === "bgm") { audio.setBgm(ev.target.checked); if (ev.target.checked && C.stage !== "idle") music(C.stage); }
    if (a === "sfx") audio.setSfx(ev.target.checked);
    if (a === "vol") audio.setVolume(Number(ev.target.value));
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.target.matches("input")) return;
    if (ev.key === "h" || ev.key === "H") ctr.classList.toggle("hidden");
    if (ev.key === "ArrowRight" || ev.key === " " || ev.key === "PageDown") {
      ev.preventDefault();
      const next = ORDER[ORDER.indexOf(C.stage) + 1];
      if (next) goStep(next);
    }
    if (ev.key === "f" || ev.key === "F") document.querySelector('[data-act="fs"]').click();
  });
}

// ---------------- 下載 PNG（完整獎台） ----------------
function svgToImage(svg) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
  });
}

async function downloadPNG() {
  const W = 1920, H = 1080, k = 1.2;
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const x = cv.getContext("2d");
  let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#060a22"); g.addColorStop(0.55, "#0c1438"); g.addColorStop(1, "#141b44");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  g = x.createRadialGradient(W / 2, 190, 10, W / 2, 190, 700); g.addColorStop(0, "rgba(110,96,190,.38)"); g.addColorStop(1, "rgba(110,96,190,0)");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 170; i++) { x.fillStyle = `rgba(255,240,214,${0.3 + Math.random() * 0.6})`; const r = Math.random() * 1.8 + 0.3; if (r > 1.6) sparkle(x, Math.random() * W, Math.random() * 720, r * 3.4); else { x.beginPath(); x.arc(Math.random() * W, Math.random() * 720, r, 0, 6.28); x.fill(); } }
  // 聚光燈
  const beams = { silver: [624, "220,235,255"], gold: [960, "255,228,150"], bronze: [1296, "255,190,130"] };
  for (const [, [cx, rgb]] of Object.entries(beams)) {
    const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, `rgba(${rgb},.55)`); bg.addColorStop(0.9, `rgba(${rgb},.04)`);
    x.fillStyle = bg; x.beginPath(); x.moveTo(cx - 35, -40); x.lineTo(cx + 35, -40); x.lineTo(cx + 320, H - 140); x.lineTo(cx - 320, H - 140); x.closePath(); x.fill();
  }
  // 地板
  const floorY = H - 110;
  x.fillStyle = "#0a0f2c"; x.fillRect(0, floorY, W, 110);
  x.strokeStyle = "rgba(236,207,140,.5)"; x.lineWidth = 2; x.beginPath(); x.moveTo(0, floorY); x.lineTo(W, floorY); x.stroke();
  // 標題
  x.textAlign = "center"; x.fillStyle = "#e6c98a"; x.font = "italic 600 32px 'Cormorant Garamond', Georgia, serif";
  x.fillText("Starlight Awards", W / 2, 70);
  x.fillStyle = "#fff6e2"; x.font = "700 56px 'Noto Serif TC', serif";
  x.fillText(C.event?.title || "", W / 2, 136);
  x.font = "900 46px 'Noto Serif TC', serif"; x.fillStyle = "#f0d08a"; x.fillText("榮耀合照", W / 2, 205);
  // 頒獎台
  const P = { silver: { cx: 624, h: 240, cols: ["#6c7482", "#eef2f7", "#cfd6e0"], ink: "#3c434f" }, gold: { cx: 960, h: 324, cols: ["#8d6620", "#f5dc9b", "#e3bf6c"], ink: "#4a330a" }, bronze: { cx: 1296, h: 186, cols: ["#6b3a16", "#e7ad80", "#c98451"], ink: "#3c1d06" } };
  const pw = 336;
  for (const t of TIERS) {
    const p = P[t], left = p.cx - pw / 2, top = floorY - p.h;
    const fg = x.createLinearGradient(left, 0, left + pw, 0); fg.addColorStop(0, p.cols[0]); fg.addColorStop(0.5, p.cols[1]); fg.addColorStop(1, p.cols[0]);
    x.fillStyle = fg; x.fillRect(left, top, pw, p.h);
    x.fillStyle = p.cols[2]; x.beginPath(); x.moveTo(left, top); x.lineTo(left + 24, top - 22); x.lineTo(left + pw - 24, top - 22); x.lineTo(left + pw, top); x.closePath(); x.fill();
    x.fillStyle = "rgba(0,0,0,.08)"; x.font = "italic 700 200px 'Cormorant Garamond', Georgia, serif"; x.fillText(RANKN[t], left + pw - 70, top + 170);
    const ws = winnersOf(t);
    x.fillStyle = p.ink;
    x.font = "700 20px 'Noto Sans TC', sans-serif"; x.fillText(LABEL[t], p.cx, top + 42);
    if (ws.length) {
      const names = ws.map((w) => w.name); const shown = names.slice(0, 3).join("、") + (names.length > 3 ? ` 等${names.length}組` : "");
      x.font = `900 ${t === "gold" ? 38 : 30}px 'Noto Serif TC', serif`; fitText(x, shown, p.cx, top + 92, pw - 30);
      const work = ws.length === 1 ? ws[0].workTitle : "並列得獎";
      if (work) { x.font = "500 18px 'Noto Sans TC', sans-serif"; fitText(x, work, p.cx, top + 124, pw - 30); }
      x.font = "italic 700 26px 'Cormorant Garamond', Georgia, serif"; x.fillText(`${ws[0].votes} 票`, p.cx, top + 158);
      const img = await svgToImage(trophySVG(t, { width: 200 }));
      const tw = t === "gold" ? 250 : t === "silver" ? 214 : 200, th = tw * 1.3;
      if (img) x.drawImage(img, p.cx - tw / 2, top - 22 - th + 6, tw, th);
    } else { x.font = "700 22px 'Noto Sans TC', sans-serif"; x.fillText("從缺（同票並列名次）", p.cx, top + 96); }
  }
  x.fillStyle = "rgba(236,207,140,.75)"; x.font = "500 18px 'Noto Sans TC', sans-serif";
  x.fillText(`${C.event?.organizer || ""}　${C.event?.date || fmtDate(Date.now())}`, W / 2, H - 40);
  cv.toBlob((b) => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(b), download: `星光榮耀_${C.event?.title || "頒獎"}_完整獎台.png` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });
}

function fitText(ctx, text, cx, y, maxW) {
  let size = parseInt(ctx.font.match(/(\d+)px/)[1], 10);
  while (ctx.measureText(text).width > maxW && size > 12) { size -= 2; ctx.font = ctx.font.replace(/\d+px/, `${size}px`); }
  ctx.fillText(text, cx, y);
}
