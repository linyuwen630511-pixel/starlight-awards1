// ============================================================
// 投票者頁面（第二階段：可實際投票）
// 免費 Spark 方案：所有限制由 Firebase 安全規則在伺服器端驗證，
// 本頁只負責介面與預先檢查；成功畫面只在伺服器確認寫入後顯示。
// ============================================================
import { getStore } from "./store.js";
import {
  generateNotice, selectionCounter, normalizeRules, isActive, imageList,
  buildBallot, voteState, taipeiDayNum
} from "./rules.js";
import { initChrome, showModeBadge, esc, safeUrl, noticeHTML, sfx, toast, openModal } from "./ui.js";
import { imgTag, hydrateImages, resolveImage } from "./images.js";

const $app = document.getElementById("app");
const V = {
  store: null, eid: null, event: null, cands: {}, user: null,
  voterKey: null, state: undefined, phase: "loading", authMsg: "",
  selection: [], alloc: {}, submitting: false, pendingBid: null, lastStatus: null
};
const CODE_KEY = (eid) => `starlight-votecode-${eid}`;
const rules = () => normalizeRules(V.event?.rules);

initChrome();
start().catch((e) => { console.error(e); $app.innerHTML = `<div class="alert danger"><p>系統載入失敗：${esc(e.message)}</p></div>`; });

async function start() {
  V.store = await getStore();
  showModeBadge(V.store.mode);
  V.store.onAuth((u) => { V.user = u; if (V.event) refreshIdentity(); });
  const p = new URLSearchParams(location.search);
  const eid = p.get("e");
  const code = (p.get("c") || "").trim().toUpperCase();
  if (eid) return openEvent(eid);
  if (code) return resolveCode(code);
  renderCodeForm();
}

// ---------------- 活動代碼 ----------------
function renderCodeForm(err = "") {
  $app.innerHTML = `
    <div class="vote-head" style="margin-top:6vh">
      <p class="eyebrow">Scan to vote</p>
      <h1>進入投票</h1>
      <p class="muted">請掃描活動 QR Code，或輸入管理者提供的 6 碼活動代碼。</p>
    </div>
    <form class="card" id="codeForm" novalidate>
      <div class="field"><label for="code">活動代碼</label>
        <div class="code-form"><input id="code" name="code" type="text" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="ABC123" required>
          <button class="btn btn-gold" type="submit">進入 <span class="arrow">↗</span></button></div></div>
      ${err ? `<div class="alert danger"><p>${esc(err)}</p></div>` : ""}
    </form>`;
  document.getElementById("codeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = e.target.code.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(v)) { sfx.error(); return renderCodeForm("活動代碼為 6 碼英數字。"); }
    sfx.click();
    history.replaceState(null, "", `vote.html?c=${v}`);
    resolveCode(v);
  });
}

async function resolveCode(code) {
  try {
    const eid = await V.store.get(`codes/${code}`);
    if (!eid) return renderCodeForm(`找不到代碼「${code}」的活動，請確認後再輸入。`);
    openEvent(eid);
  } catch (e) { console.error(e); renderCodeForm("目前無法查詢活動，請稍後再試。"); }
}

function notFound() {
  $app.innerHTML = `
    <div class="card status-banner" style="margin-top:6vh">
      <span class="big">✦</span>找不到此活動，或活動尚未發布。
      <p class="muted" style="font-weight:400;font-size:15px;margin:8px 0 14px">請向管理者確認 QR Code 或活動代碼。</p>
      <a class="btn btn-ghost" href="vote.html">重新輸入代碼</a>
    </div>`;
}

// ---------------- 活動與即時狀態 ----------------
function openEvent(eid) {
  V.eid = eid;
  V.store.on(`events/${eid}`, (v) => {
    if (!v || v.status === "draft") { V.event = null; return notFound(); }
    const prev = V.lastStatus;
    V.event = v; V.lastStatus = v.status;
    if (prev && prev !== v.status) {
      sfx.soft();
      toast(v.status === "open" ? "投票已開放！" : v.status === "paused" ? "投票已暫停，請稍候。" : v.status === "closed" ? "投票已結束。" : "投票狀態已更新。");
    }
    if (v.status === "open" || v.status === "paused") refreshIdentity(); else render();
  }, () => notFound());
  V.store.on(`candidates/${eid}`, (v) => { V.cands = v || {}; pruneSelection(); if (V.event) render(); }, () => {});
}

function pruneSelection() {
  V.selection = V.selection.filter((id) => isActive(V.cands[id]));
  for (const id of Object.keys(V.alloc)) if (!isActive(V.cands[id])) delete V.alloc[id];
}

// ---------------- 投票者身分 ----------------
async function refreshIdentity() {
  if (V.phase === "done") return render();
  const r = rules();
  V.authMsg = "";
  try {
    if (r.identity === "anonymous") {
      if (!V.user) { V.phase = "auth-wait"; render(); await V.store.signInAnon(); return; }
      V.voterKey = V.user.uid;
    } else if (r.identity === "account") {
      if (!V.user || V.user.isAnonymous || !/google/.test(V.user.provider || "")) { V.voterKey = null; V.phase = "auth-google"; return render(); }
      V.voterKey = V.user.uid;
    } else if (r.identity === "code") {
      if (!V.user) { V.phase = "auth-wait"; render(); await V.store.signInAnon(); return; }
      const saved = sessionStorage.getItem(CODE_KEY(V.eid));
      if (!saved) { V.voterKey = null; V.phase = "auth-code"; return render(); }
      V.voterKey = saved;
    }
    await loadState();
  } catch (e) {
    console.error(e);
    V.phase = "error"; V.authMsg = authError(e); render();
  }
}

async function loadState() {
  try { V.state = await V.store.get(`voterState/${V.eid}/${V.voterKey}`); }
  catch (e) {
    if (rules().identity === "code") { sessionStorage.removeItem(CODE_KEY(V.eid)); V.phase = "auth-code"; V.authMsg = "投票代碼無效，請重新輸入。"; return render(); }
    throw e;
  }
  const today = taipeiDayNum(await V.store.serverNow());
  const vs = voteState(rules(), V.state, today);
  V.phase = vs.canVote ? "vote" : "voted";
  V.votedReason = vs.reason;
  render();
}

function authError(e) {
  const c = e?.code || "";
  if (/admin-restricted-operation|operation-not-allowed/.test(c)) return "管理者尚未在 Firebase 啟用此登入方式。";
  if (/popup-closed|cancelled-popup/.test(c)) return "已取消登入。";
  if (/network/.test(c)) return "網路連線異常，請稍後再試。";
  return "無法完成身分驗證，請重新整理後再試。";
}

async function submitCode(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) { V.authMsg = "投票代碼為 8 碼英數字。"; sfx.error(); return render(); }
  let ok = false;
  try {
    if (V.store.mode === "demo") ok = !!(await V.store.get(`voterCodes/${V.eid}/${code}`));
    else { await V.store.get(`voterState/${V.eid}/${code}`); ok = true; } // 無效代碼會被安全規則拒絕
  } catch { ok = false; }
  if (!ok) { V.authMsg = "投票代碼無效，請確認後再輸入。"; sfx.error(); return render(); }
  sessionStorage.setItem(CODE_KEY(V.eid), code);
  sfx.click();
  refreshIdentity();
}

// ---------------- 畫面 ----------------
function statusBanner(status) {
  if (status === "ready") return `<span class="big">⏳</span>投票尚未開始，請等待管理者開放。`;
  if (status === "paused") return `<span class="big">⏸</span>投票暫停中，請稍候管理者繼續開放。<p class="muted" style="font-weight:400;font-size:14px;margin:6px 0 0">您已選擇的內容會保留。</p>`;
  if (status === "open") return "";
  return `<span class="big">★</span>本次投票已結束，感謝您的參與。`;
}

function render() {
  const e = V.event;
  if (!e) return;
  const r = rules();
  const st = e.status;
  const cover = safeUrl(e.coverUrl);
  const head = `
    ${cover ? `<img class="vote-cover" src="${esc(cover)}" alt="">` : ""}
    <div class="vote-head">
      <p class="eyebrow">Starlight Awards</p>
      <h1>${esc(e.title)}</h1>
      ${e.subtitle ? `<p style="font-size:17px;margin:0">${esc(e.subtitle)}</p>` : ""}
      <p class="muted" style="margin-top:6px">${[e.organizer, e.date].filter(Boolean).map(esc).join("　·　")}</p>
    </div>`;
  const banner = statusBanner(st) ? `<div class="card status-banner" style="margin-bottom:16px">${statusBanner(st)}</div>` : "";
  const notice = `<div class="card" style="margin-bottom:16px">${noticeHTML(generateNotice(r))}</div>`;
  let body = "";
  let bar = false;

  if (V.phase === "done") {
    body = `<div class="card success">
      <span class="big">✦</span>
      <h1>投票成功！</h1>
      <p style="font-size:17px">感謝您的參與。</p>
      <p class="muted">${r.frequency === "daily" ? "您今天的選票已送出，明天（台灣時間）可再投一次。" : "您的選票已送出，本次活動不可再次投票。"}<br>投票結束後，將由管理者統一揭曉前三名。</p>
    </div>`;
    $app.innerHTML = head + body;
    return;
  }

  if (st === "open" || st === "paused") {
    if (V.phase === "auth-wait" || V.phase === "loading") body = `<p class="muted" style="text-align:center">驗證身分中…</p>`;
    else if (V.phase === "error") body = `<div class="alert danger"><p>${esc(V.authMsg)}</p></div><button class="btn btn-ghost" data-act="retry">重新嘗試</button>`;
    else if (V.phase === "auth-code") body = `
      <form class="card" id="voterCodeForm" novalidate>
        <h3 class="section-title">輸入您的專屬投票代碼</h3>
        <div class="code-form"><input name="vcode" type="text" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="8 碼代碼" required>
          <button class="btn btn-gold" type="submit">確認</button></div>
        ${V.authMsg ? `<div class="alert danger" style="margin-top:12px"><p>${esc(V.authMsg)}</p></div>` : ""}
      </form>`;
    else if (V.phase === "auth-google") body = `
      <div class="card" style="text-align:center">
        <h3>請以 Google 帳號登入後投票</h3>
        <p class="muted">本活動採帳號驗證，每個帳號依規則限制投票次數。</p>
        <button class="btn btn-gold btn-lg" data-act="google">使用 Google 帳號登入</button>
        ${V.authMsg ? `<div class="alert danger" style="margin-top:12px"><p>${esc(V.authMsg)}</p></div>` : ""}
      </div>`;
    else if (V.phase === "voted") body = `
      <div class="card success">
        <span class="big">✓</span>
        <h1>${V.votedReason === "today" ? "今天已完成投票" : "您已完成投票"}</h1>
        <p class="muted">${V.votedReason === "today" ? "每日可投一次，請於明天（台灣時間）再回來投票。" : "本次活動每人僅能提交一次，感謝您的參與。"}</p>
      </div>`;
    else if (V.phase === "vote") {
      body = `
        ${V.user?.email && r.identity === "account" ? `<p class="muted" style="text-align:center;font-size:14px">登入帳號：${esc(V.user.email)}　<button class="btn btn-ghost btn-sm" data-act="signout">切換帳號</button></p>` : ""}
        ${r.identity === "code" ? `<p class="muted" style="text-align:center;font-size:14px">投票代碼：<span class="code">${esc(V.voterKey)}</span></p>` : ""}
        <h2 style="font-size:21px;margin:22px 0 12px">${r.allowRepeat ? "分配您的選票" : "選出您支持的作品"}</h2>
        <div id="candArea">${candidatesHTML(true)}</div>`;
      bar = true;
    }
  } else if (st === "ready") {
    body = `<h2 style="font-size:21px;margin:22px 0 12px">參賽名單</h2><div id="candArea">${candidatesHTML(false)}</div>`;
  }

  $app.innerHTML = head + banner + (V.phase === "voted" ? "" : notice) + body + (bar ? voteBarHTML() : "");
  hydrateImages($app, V.store, V.eid);
}

function candidatesHTML(interactive) {
  const r = rules();
  const showImg = r.showcase === "images";
  const list = Object.entries(V.cands).map(([id, c]) => ({ id, ...c })).filter(isActive).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!list.length) return `<p class="muted">參賽名單準備中。</p>`;
  const N = r.votesPerVoter;
  const used = r.allowRepeat ? sumAlloc() : V.selection.length;
  return `<div class="cand-cards">${list.map((c) => {
    const img = imageList(c)[0];
    const nImg = imageList(c).length;
    const sel = !r.allowRepeat && V.selection.includes(c.id);
    const cnt = V.alloc[c.id] || 0;
    const locked = interactive && !r.allowRepeat && !sel && used >= N;
    const pickBadge = interactive && !r.allowRepeat ? `<span class="pick" aria-hidden="true">${sel ? V.selection.indexOf(c.id) + 1 : ""}</span>` : "";
    return `<article class="card cand-card ${sel || cnt ? "selected" : ""} ${locked ? "locked" : ""} ${interactive && !r.allowRepeat ? "" : "disabled"}"
        ${interactive && !r.allowRepeat ? `data-act="toggle" data-id="${esc(c.id)}" role="button" tabindex="0" aria-pressed="${sel}"` : ""}>
      ${showImg ? `<div class="img">${pickBadge}${img ? `${imgTag(img, c.id, { alt: c.workTitle || c.name, attrs: `data-act="zoom" data-id="${esc(c.id)}" style="cursor:zoom-in"` })}
          <button type="button" class="zoom" data-act="zoom" data-id="${esc(c.id)}">放大${nImg > 1 ? `（${nImg}）` : ""}</button>` : "作品圖片準備中"}</div>` : ""}
      <div class="body ${!showImg && pickBadge ? "body-only" : ""}">
        ${!showImg ? pickBadge : ""}
        <div class="no">No. ${esc(c.code)}</div>
        <div class="name">${esc(c.name)}</div>
        ${c.workTitle ? `<div>${esc(c.workTitle)}</div>` : ""}
        ${c.members ? `<div class="muted" style="font-size:13.5px">${esc(c.members)}</div>` : ""}
        ${c.description && showImg && img ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="zoom" data-id="${esc(c.id)}">作品說明</button>` : c.description ? `<p class="muted" style="font-size:13.5px;margin:6px 0 0">${esc(c.description)}</p>` : ""}
        ${interactive && !r.allowRepeat ? `<div class="btn ${sel ? "btn-gold" : "btn-ghost"} btn-sm" style="margin-top:10px;width:100%">${sel ? "✓ 已選擇" : locked ? "已選滿" : "＋ 選擇"}</div>` : ""}
        ${interactive && r.allowRepeat ? `<div class="alloc">
            <button type="button" data-act="dec" data-id="${esc(c.id)}" ${cnt ? "" : "disabled"} aria-label="減少一票">−</button>
            <b>${cnt}</b>
            <button type="button" data-act="inc" data-id="${esc(c.id)}" ${used >= N ? "disabled" : ""} aria-label="增加一票">＋</button></div>` : ""}
      </div>
    </article>`;
  }).join("")}</div>`;
}

const sumAlloc = () => Object.values(V.alloc).reduce((a, b) => a + b, 0);

function canSubmit() {
  const r = rules();
  const n = r.allowRepeat ? sumAlloc() : V.selection.length;
  return V.event?.status === "open" && !V.submitting && (r.mustFill ? n === r.votesPerVoter : n >= 1);
}

function voteBarHTML() {
  const r = rules();
  const n = r.allowRepeat ? sumAlloc() : V.selection.length;
  const hint = V.event.status === "paused" ? "投票暫停中" : r.mustFill ? (n < r.votesPerVoter ? `還需${r.allowRepeat ? "分配" : "選擇"} ${r.votesPerVoter - n} ${r.allowRepeat ? "票" : "位"}` : "已完成，可送出") : "至少 1 票即可送出";
  return `<div class="vote-bar"><div class="inner">
      <div class="count">${esc(selectionCounter(r, n))}<small>${esc(hint)}</small></div>
      <button class="btn btn-gold btn-lg" data-act="submit" ${canSubmit() ? "" : "disabled"}>${V.submitting ? "傳送中…" : "確認送出"}</button>
    </div></div>`;
}

function refreshVoting() {
  const area = document.getElementById("candArea");
  if (area) { area.innerHTML = candidatesHTML(true); hydrateImages(area, V.store, V.eid); }
  const bar = document.querySelector(".vote-bar");
  if (bar) bar.outerHTML = voteBarHTML();
}

// ---------------- 操作 ----------------
function toggle(id) {
  const r = rules();
  const i = V.selection.indexOf(id);
  if (i >= 0) { V.selection.splice(i, 1); sfx.click(); }
  else if (V.selection.length >= r.votesPerVoter) { sfx.error(); toast(`已選滿 ${r.votesPerVoter} 位，請先取消其中一位再選擇。`); return; }
  else { V.selection.push(id); sfx.click(); }
  refreshVoting();
}

function changeAlloc(id, d) {
  const r = rules();
  const cur = V.alloc[id] || 0;
  if (d > 0 && sumAlloc() >= r.votesPerVoter) return;
  const next = Math.max(0, cur + d);
  if (next) V.alloc[id] = next; else delete V.alloc[id];
  sfx.click();
  refreshVoting();
}

async function confirmSubmit() {
  if (!canSubmit()) return;
  const r = rules();
  const names = r.allowRepeat
    ? Object.entries(V.alloc).map(([id, k]) => `${V.cands[id]?.code ? "No." + V.cands[id].code + " " : ""}${V.cands[id]?.name}　× ${k} 票`)
    : V.selection.map((id, i) => `${i + 1}. ${V.cands[id]?.code ? "No." + V.cands[id].code + " " : ""}${V.cands[id]?.name}`);
  const n = r.allowRepeat ? sumAlloc() : V.selection.length;
  const q = r.allowRepeat ? `您已分配${n}票，確認送出選票嗎？` : `您已選擇${n}位候選人，確認送出選票嗎？`;
  const { modal, close } = openModal(`
    <h3 class="modal-title">${esc(q)}</h3>
    <ul style="padding-left:1.2em;margin:8px 0 6px">${names.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <p class="muted" style="font-size:14px">${r.frequency === "daily" ? "送出後今天不得修改。" : "送出後不得修改或再次投票。"}</p>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>返回修改</button><button class="btn btn-gold" data-go>確認送出</button></div>`);
  modal.querySelector("[data-go]").addEventListener("click", () => { close(); submit(); }, { once: true });
}

async function submit() {
  if (V.submitting) return;
  V.submitting = true; refreshVoting();
  const r = rules();
  const voter = V.voterKey;
  try {
    // 送出前再確認一次狀態（防止重複點擊、多分頁）
    const serverNow = await V.store.serverNow();
    const day = taipeiDayNum(serverNow);
    const state = await V.store.get(`voterState/${V.eid}/${voter}`);
    if (V.pendingBid && state?.lastBallot === V.pendingBid) return succeed();
    if (!voteState(r, state, day).canVote) { V.state = state; V.phase = "voted"; V.votedReason = voteState(r, state, day).reason; return render(); }
    if (V.store.mode === "demo" && V.event.status !== "open") throw Object.assign(new Error("closed"), { code: "PERMISSION_DENIED" });

    const built = buildBallot(r, r.allowRepeat ? V.alloc : V.selection, V.cands, day);
    if (!built.ok) { toast(built.error, "error"); sfx.error(); return; }
    V.pendingBid = V.pendingBid || V.store.newKey(`ballots/${V.eid}/${voter}`);
    await V.store.update({
      [`ballots/${V.eid}/${voter}/${V.pendingBid}`]: { ...built.ballot, ts: V.store.now() },
      [`voterState/${V.eid}/${voter}`]: { lastDay: day, lastBallot: V.pendingBid, ts: V.store.now() }
    });
    succeed();
  } catch (e) {
    console.error(e);
    // 網路重試或重複點擊：若伺服器已記錄這張選票，視為成功
    try {
      const state = await V.store.get(`voterState/${V.eid}/${voter}`);
      if (V.pendingBid && state?.lastBallot === V.pendingBid) return succeed();
    } catch {}
    sfx.error();
    let msg = "送出失敗，請確認網路後再試一次。";
    if (/permission|PERMISSION_DENIED/i.test(e?.message || e?.code || "")) {
      msg = V.event.status !== "open" ? "投票目前未開放，選票未送出。"
        : r.identity === "account" && V.event.restrictEmails ? "此帳號不在本活動的投票名單中，選票未送出。"
        : "選票未被系統接受（可能已投過票、跨日或規則不符），請重新整理後再試。";
      V.pendingBid = null;
    }
    toast(msg, "error", 6000);
  } finally {
    V.submitting = false;
    if (V.phase === "vote") refreshVoting();
  }
}

function succeed() {
  V.phase = "done";
  V.selection = []; V.alloc = {}; V.pendingBid = null;
  sfx.chime();
  render();
  scrollTo({ top: 0, behavior: "smooth" });
  // 投票完成後中斷連線，釋放免費方案的同時連線名額
  setTimeout(() => V.store.goOffline(), 1500);
}

// ---------------- 作品放大 ----------------
function lightbox(id) {
  const c = V.cands[id];
  const imgs = imageList(c).filter((u) => u.startsWith("db:") || safeUrl(u));
  let i = 0;
  const el = document.createElement("div");
  el.className = "lightbox";
  el.setAttribute("role", "dialog");
  let draw = () => {
    el.innerHTML = `
      <header><div><b>No. ${esc(c.code)}　${esc(c.name)}</b>${c.workTitle ? `<div style="opacity:.8;font-size:14px">${esc(c.workTitle)}</div>` : ""}</div>
        <button data-x aria-label="關閉">✕</button></header>
      <div class="stage">${imgs.length ? `<img alt="${esc(c.workTitle || c.name)}" data-full>` : ""}</div>
      <footer>
        <button data-p ${imgs.length > 1 ? "" : "hidden"} aria-label="上一張">‹</button>
        <div style="flex:1;text-align:center;font-size:14px;max-height:30vh;overflow:auto">
          ${imgs.length > 1 ? `<div>${i + 1} / ${imgs.length}　·　雙擊可放大</div>` : imgs.length ? "<div>雙擊或雙指可放大</div>" : ""}
          ${c.description ? `<p style="margin:6px 0 0;opacity:.9;white-space:pre-line;text-align:left">${esc(c.description)}</p>` : ""}
        </div>
        <button data-n ${imgs.length > 1 ? "" : "hidden"} aria-label="下一張">›</button>
      </footer>`;
  };
  const fill = async () => {
    const im = el.querySelector("img[data-full]");
    if (!im) return;
    const want = i;
    const thumb = await resolveImage(V.store, V.eid, id, imgs[want], "thumb");
    if (want === i && thumb) im.src = thumb;
    const full = await resolveImage(V.store, V.eid, id, imgs[want], "full");
    if (want === i && full) im.src = full;
  };
  const draw0 = draw;
  draw = () => { draw0(); fill(); };
  const go = (d) => { if (imgs.length > 1) { i = (i + d + imgs.length) % imgs.length; draw(); } };
  const close = () => { el.remove(); document.body.classList.remove("no-scroll"); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); };
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-x]")) close();
    else if (e.target.closest("[data-p]")) go(-1);
    else if (e.target.closest("[data-n]")) go(1);
  });
  el.addEventListener("dblclick", (e) => { if (e.target.tagName === "IMG") e.target.parentElement.classList.toggle("zoom"); });
  let sx = null;
  el.addEventListener("touchstart", (e) => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  el.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60 && !el.querySelector(".zoom")) go(dx < 0 ? 1 : -1); sx = null; });
  draw();
  document.body.appendChild(el);
  document.body.classList.add("no-scroll");
  document.addEventListener("keydown", onKey);
}

// ---------------- 事件委派 ----------------
$app.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === "zoom") { ev.stopPropagation(); return lightbox(id); }
  if (act === "toggle") return toggle(id);
  if (act === "inc") return changeAlloc(id, 1);
  if (act === "dec") return changeAlloc(id, -1);
  if (act === "submit") return confirmSubmit();
  if (act === "retry") return refreshIdentity();
  if (act === "signout") { await V.store.signOut(); return; }
  if (act === "google") {
    try { await V.store.signInGoogle(); }
    catch (e) { V.authMsg = authError(e); render(); }
  }
});
$app.addEventListener("keydown", (ev) => {
  const card = ev.target.closest('[data-act="toggle"]');
  if (card && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); toggle(card.dataset.id); }
});
$app.addEventListener("submit", (ev) => {
  if (ev.target.id === "voterCodeForm") { ev.preventDefault(); submitCode(ev.target.vcode.value); }
});
