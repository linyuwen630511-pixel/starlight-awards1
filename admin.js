// ============================================================
// 管理者控制台（第一階段）
// 登入 → 活動列表 → 活動編輯（基本資料／投票規則／候選人／規則摘要與須知）
// ============================================================
import { getStore } from "./store.js";
import { APP_CONFIG } from "./config.js";
import {
  DEFAULT_RULES, RULE_OPTIONS, STATUS_LABEL, normalizeRules, validateRules, readinessCheck,
  generateNotice, describeRules, shortRules, selectionCounter, isCoreLocked, isActive, imageList,
  slotsFor, tallyBallots, labelOf
} from "./rules.js";
import { computeResults, resultSnapshot, dayNumToDate, TIER_LABEL } from "./results.js";
import { compressImage, imgTag, hydrateImages, isDbRef, dbId } from "./images.js";
import { audio } from "./audio.js";
import { csvToCandidates, toCSV, downloadText, CANDIDATE_TEMPLATE_HEADER } from "./csv.js";
import {
  initChrome, showModeBadge, toast, confirmDialog, openModal, esc, safeUrl, sfx,
  statusChip, noticeHTML, fmtDate, copyText
} from "./ui.js";

const $app = document.getElementById("app");
const S = {
  store: null, user: null, isAdmin: false,
  events: {}, cands: {},
  view: "list", eid: null, tab: "basic", filter: null, pendingNew: false,
  unsubEvents: null, unsubCands: null, lastStatus: null
};

// ---------------- 啟動 ----------------
initChrome();
init().catch((e) => {
  console.error(e);
  $app.innerHTML = `<div class="alert danger"><p>系統載入失敗：${esc(e.message)}</p><p>請確認 js/config.js 的 Firebase 設定是否正確。</p></div>`;
});

async function init() {
  const hash = location.hash.slice(1);
  if (hash === "stats" || hash === "ceremony") S.filter = hash;
  if (hash === "new") S.pendingNew = true;

  S.store = await getStore();
  showModeBadge(S.store.mode);

  S.store.onAuth(async (u) => {
    S.user = u;
    S.isAdmin = u && !u.isAnonymous ? await S.store.isAdmin(u.uid) : false;
    if (S.isAdmin) startAdmin();
    else { stopSubs(); render(); }
  });
}

function startAdmin() {
  stopSubs();
  S.unsubEvents = S.store.on("events", (v) => {
    S.events = v || {};
    if (S.view === "list") render();
    else if (S.view === "editor") onEditorEventChange();
  }, (err) => toast("無法讀取活動資料：" + err.message, "error"));
  if (S.pendingNew) { S.pendingNew = false; openEditor(null); }
  else render();
}

function stopSubs() {
  S.unsubEvents?.(); S.unsubEvents = null;
  S.unsubCands?.(); S.unsubCands = null;
}

const uid = () => S.user?.uid;
const now = () => S.store.now();
const curEvent = () => (S.eid ? S.events[S.eid] : null);
const activeCount = () => Object.values(S.cands).filter(isActive).length;
const sortedCands = () => Object.entries(S.cands).map(([id, c]) => ({ id, ...c })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const voteUrl = (code) => new URL(`vote.html?c=${encodeURIComponent(code)}`, APP_CONFIG.publicBaseUrl || location.href).href;

// ---------------- 主渲染 ----------------
function render() {
  if (!S.user || S.user.isAnonymous) return renderLogin();
  if (!S.isAdmin) return renderNotAdmin();
  if (S.view === "editor") return renderEditor();
  return renderList();
}

// ---------------- 登入 ----------------
function renderLogin() {
  const demo = S.store.mode === "demo";
  $app.innerHTML = `
    <div style="max-width:440px;margin:6vh auto 0">
      <div class="card">
        <h1 style="font-size:26px;text-align:center">管理者登入</h1>
        <p class="muted" style="text-align:center">登入後即可建立活動、設定規則與管理候選人。</p>
        ${demo ? `<div class="alert warn"><p><b>本機示範模式</b>：尚未設定 Firebase，資料只保存在此瀏覽器，僅供操作測試，<b>不具安全性</b>。</p><p>示範密碼：<b>starlight2026</b>（帳號可填任意 Email）</p></div>` : ""}
        <form data-form="login" novalidate>
          <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
          <div class="field"><label for="pw">密碼</label><input id="pw" name="pw" type="password" autocomplete="current-password" required></div>
          <div id="loginErr" class="errors"></div>
          <button class="btn btn-gold" style="width:100%" type="submit">登入</button>
        </form>
        ${demo ? "" : `<p style="text-align:center;margin:14px 0 0"><button class="btn btn-ghost btn-sm" data-act="reset-pw">忘記密碼</button></p>`}
      </div>
    </div>`;
}

function renderNotAdmin() {
  $app.innerHTML = `
    <div style="max-width:560px;margin:6vh auto 0" class="card">
      <h1 style="font-size:24px">此帳號尚未授權為管理者</h1>
      <p>您已登入為 <b>${esc(S.user.email)}</b>，但此帳號不在管理者名單中。</p>
      <div class="alert info">
        <p>請由 Firebase 專案擁有者於 Realtime Database 新增下列節點，再重新整理本頁：</p>
        <p><code>admins/${esc(S.user.uid)}</code> ＝ <code>{ "role": "owner" }</code></p>
      </div>
      <div class="row"><button class="btn btn-ghost" data-act="copy" data-text="${esc(S.user.uid)}">複製 UID</button><button class="btn btn-ghost" data-act="logout">登出</button></div>
    </div>`;
}

// ---------------- 活動列表 ----------------
function renderList() {
  const list = Object.entries(S.events)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const banner = S.filter === "stats"
    ? `<div class="alert info"><p><b>投票統計</b>：請在活動卡片按「統計結果」，查看排名、圖表並匯出 CSV／PDF。</p></div>`
    : S.filter === "ceremony"
      ? `<div class="alert info"><p><b>榮耀頒獎典禮</b>：活動結束投票並在「統計結果」確認最終結果後，按「頒獎典禮」進入星光舞台。</p></div>`
      : "";

  $app.innerHTML = `
    <section class="page-head">
      <div>
        <h1>投票活動控制台</h1>
        <p>${esc(S.user.email || "")}　·　共 ${list.length} 場活動</p>
      </div>
      <div class="row">
        <button class="btn btn-gold" data-act="new">＋ 建立投票活動</button>
        <a class="btn btn-ghost" href="check.html">系統檢查</a>
        <button class="btn btn-ghost" data-act="logout">登出</button>
      </div>
    </section>
    ${banner}
    ${list.length ? `<div class="event-grid">${list.map(eventCard).join("")}</div>` : `
      <div class="card empty">
        <div class="big">★</div>
        <h2>尚未建立任何投票活動</h2>
        <p class="muted">建立第一場活動，設定投票規則並加入候選人。</p>
        <button class="btn btn-gold" data-act="new">＋ 建立投票活動</button>
      </div>`}
  `;
}

function eventCard(e) {
  const cover = safeUrl(e.coverUrl);
  const meta = [e.date, e.organizer].filter(Boolean).map(esc).join("　·　");
  return `
    <article class="card event-card">
      <div class="event-cover ${cover ? "has-img" : ""}" ${cover ? `style="background-image:url('${esc(cover)}')"` : ""}></div>
      <div class="event-body">
        <div class="row">${statusChip(e.status)}<span class="spacer"></span><span class="muted" style="font-size:13px">代碼 <span class="code">${esc(e.code || "—")}</span></span></div>
        <h3>${esc(e.title || "未命名活動")}</h3>
        ${e.subtitle ? `<div class="muted">${esc(e.subtitle)}</div>` : ""}
        ${meta ? `<div class="event-meta">${meta}</div>` : ""}
        <div class="event-tags">${e.runoffFor ? `<span class="tag">加賽</span>` : ""}${shortRules(e.rules).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        <div class="event-meta">更新：${esc(fmtDate(e.updatedAt) || "—")}</div>
        <div class="event-actions">
          <button class="btn btn-gold btn-sm" data-act="edit" data-id="${esc(e.id)}">編輯</button>
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(e.id)}" data-tab="candidates">候選人</button>
          ${["open", "paused", "closed", "revealing", "completed"].includes(e.status) ? `<button class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(e.id)}" data-tab="stats">統計結果</button>` : ""}
          ${["closed", "revealing", "completed"].includes(e.status) ? `<a class="btn btn-gold btn-sm" href="ceremony.html?e=${encodeURIComponent(e.id)}">♕ 頒獎典禮</a>` : ""}
          <button class="btn btn-ghost btn-sm" data-act="duplicate" data-id="${esc(e.id)}">複製</button>
          <button class="btn btn-danger btn-sm" data-act="delete" data-id="${esc(e.id)}">刪除</button>
        </div>
      </div>
    </article>`;
}

// ---------------- 編輯器 ----------------
function openEditor(id, tab = "basic") {
  S.view = "editor";
  S.eid = id;
  S.tab = id ? tab : "basic";
  S.cands = {};
  S.unsubCands?.();
  S.unsubCands = null;
  S.lastStatus = curEvent()?.status || null;
  if (id) {
    S.unsubCands = S.store.on(`candidates/${id}`, (v) => {
      S.cands = v || {};
      if (S.view !== "editor") return;
      if (S.tab === "candidates" || S.tab === "summary") renderTab();
      if (S.tab === "rules") updateRulesPreview();
    });
  }
  history.replaceState(null, "", "admin.html");
  render();
  scrollTo({ top: 0, behavior: "smooth" });
}

function closeEditor() {
  S.unsubCands?.(); S.unsubCands = null;
  stopControlSubs();
  stopStatsSubs();
  S.view = "list"; S.eid = null; S.cands = {};
  render();
}

function onEditorEventChange() {
  if (S.eid && !S.events[S.eid]) { toast("此活動已被刪除。", "error"); return closeEditor(); }
  const e = curEvent();
  const head = document.getElementById("edHead");
  if (head && e) head.innerHTML = editorHeadInner(e);
  if (e && e.status !== S.lastStatus) {
    S.lastStatus = e.status;
    if (S.tab !== "basic") renderTab();
  } else if (S.tab === "summary" || S.tab === "control") renderTab();
}

function editorHeadInner(e) {
  return `<h1 style="margin:0">${esc(e?.title || "建立新活動")}</h1>${e ? statusChip(e.status) : ""}`;
}

function renderEditor() {
  const e = curEvent();
  const isNew = !S.eid;
  const tabs = [
    ["basic", "基本資料"],
    ["rules", "投票規則"],
    ["candidates", `候選人${isNew ? "" : `（${Object.keys(S.cands).length}）`}`],
    ["summary", "規則摘要與須知"],
    ["control", "投票控制與 QR Code"],
    ["stats", "統計結果"]
  ];
  $app.innerHTML = `
    <section class="page-head">
      <div>
        <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:10px">← 返回活動列表</button>
        <div id="edHead" class="row">${editorHeadInner(e)}</div>
        ${isNew ? `<p>先填寫基本資料並儲存，即可設定投票規則與候選人。</p>` : `<p>活動代碼 <span class="code">${esc(e?.code || "")}</span></p>`}
      </div>
    </section>
    <nav class="tabs" role="tablist">
      ${tabs.map(([k, label]) => `<button class="tab" role="tab" data-act="tab" data-tab="${k}" aria-selected="${S.tab === k}" ${isNew && k !== "basic" ? "disabled" : ""}>${label}</button>`).join("")}
    </nav>
    <div id="tabBody"></div>`;
  renderTab();
}

function renderTab() {
  const body = document.getElementById("tabBody");
  if (!body) return;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === S.tab)));
  const candTab = document.querySelector('.tab[data-tab="candidates"]');
  if (candTab && S.eid) candTab.textContent = `候選人（${Object.keys(S.cands).length}）`;
  if (S.tab !== "control") stopControlSubs();
  if (S.tab !== "stats") stopStatsSubs();
  ({ basic: tabBasic, rules: tabRules, candidates: tabCandidates, summary: tabSummary, control: tabControl, stats: tabStats })[S.tab](body);
}

// ---------- 基本資料 ----------
function tabBasic(body) {
  const e = curEvent() || {};
  body.innerHTML = `
    <form class="card" data-form="basic" novalidate>
      <h3 class="section-title">活動資訊</h3>
      <div class="field"><label for="f-title">活動名稱<span class="req">*</span></label>
        <input id="f-title" name="title" type="text" maxlength="80" required value="${esc(e.title || "")}" placeholder="例：最佳海報獎"></div>
      <div class="field"><label for="f-subtitle">活動副標題</label>
        <input id="f-subtitle" name="subtitle" type="text" maxlength="120" value="${esc(e.subtitle || "")}" placeholder="例：2026 護理實證海報競賽"></div>
      <div class="field"><label for="f-desc">活動說明</label>
        <textarea id="f-desc" name="description" maxlength="2000">${esc(e.description || "")}</textarea></div>
      <div class="grid-2">
        <div class="field"><label for="f-date">活動日期</label>
          <input id="f-date" name="date" type="date" value="${esc(e.date || "")}"></div>
        <div class="field"><label for="f-org">主辦單位</label>
          <input id="f-org" name="organizer" type="text" maxlength="80" value="${esc(e.organizer || "")}"></div>
      </div>
      <div class="field"><label for="f-cover">活動封面圖片網址</label>
        <input id="f-cover" name="coverUrl" type="url" maxlength="500" value="${esc(e.coverUrl || "")}" placeholder="https://…">
        <span class="hint">目前可填入圖片網址；第三階段將提供直接上傳至 Firebase Storage。</span></div>
      <div id="basicErr" class="errors"></div>
      <div class="row"><button class="btn btn-gold" type="submit">${S.eid ? "儲存基本資料" : "建立活動並繼續"}</button>
        ${S.eid ? "" : `<span class="muted">建立後將套用預設規則：每人 3 票、不可重複、整場一次、必須投滿、啟用作品圖片。</span>`}</div>
    </form>`;
}

async function saveBasic(form) {
  const fd = new FormData(form);
  const data = {
    title: String(fd.get("title") || "").trim(),
    subtitle: String(fd.get("subtitle") || "").trim(),
    description: String(fd.get("description") || "").trim(),
    date: String(fd.get("date") || ""),
    organizer: String(fd.get("organizer") || "").trim(),
    coverUrl: String(fd.get("coverUrl") || "").trim()
  };
  const errs = [];
  if (!data.title) errs.push("請填寫活動名稱。");
  if (data.coverUrl && !safeUrl(data.coverUrl)) errs.push("封面網址須以 http:// 或 https:// 開頭。");
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) errs.push("日期格式不正確。");
  const errBox = document.getElementById("basicErr");
  if (errs.length) { errBox.innerHTML = `<div class="alert danger">${errs.map((m) => `<p>${esc(m)}</p>`).join("")}</div>`; sfx.error(); return; }
  errBox.innerHTML = "";

  try {
    if (!S.eid) {
      const id = S.store.newKey("events");
      const code = await uniqueCode();
      await S.store.update({
        [`events/${id}`]: {
          ...data, status: "draft", rules: { ...DEFAULT_RULES }, ...slotsFor(DEFAULT_RULES.votesPerVoter), timezone: APP_CONFIG.timezone,
          code, createdAt: now(), updatedAt: now(), createdBy: uid()
        },
        [`codes/${code}`]: id
      });
      sfx.chime(); toast("活動已建立，請繼續設定投票規則。", "ok");
      S.events[id] = S.events[id] || { ...data, status: "draft", rules: { ...DEFAULT_RULES }, code };
      openEditor(id, "rules");
    } else {
      const u = { [`events/${S.eid}/updatedAt`]: now() };
      for (const [k, v] of Object.entries(data)) u[`events/${S.eid}/${k}`] = v;
      await S.store.update(u);
      sfx.soft(); toast("基本資料已儲存。", "ok");
    }
  } catch (e) { handleError(e); }
}

async function uniqueCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 12; i++) {
    const arr = crypto.getRandomValues(new Uint32Array(6));
    const code = Array.from(arr, (n) => chars[n % chars.length]).join("");
    if (!(await S.store.get(`codes/${code}`))) return code;
  }
  throw new Error("無法產生唯一活動代碼，請再試一次。");
}

// ---------- 投票規則 ----------
function optionGroup(field, current, name = field) {
  return `<div class="options">${RULE_OPTIONS[field].map((o) => `
    <label class="option"><input type="radio" name="${name}" value="${String(o.value)}" ${o.value === current ? "checked" : ""}>
      <b>${esc(o.label)}</b><small>${esc(o.desc)}</small></label>`).join("")}</div>`;
}

function tabRules(body) {
  const e = curEvent();
  const r = normalizeRules(e?.rules);
  const locked = isCoreLocked(e?.status);
  body.innerHTML = `
    <div class="split">
      <form class="card" data-form="rules" novalidate>
        ${locked ? `<div class="alert warn"><p>投票已開始（${esc(STATUS_LABEL[e.status])}），影響票數、公平性或投票資格的核心規則已鎖定，不可修改。</p></div>` : ""}
        ${e?.status === "ready" ? `<div class="alert info"><p>此活動已標記為「準備完成」。若修改規則，狀態會退回「草稿」，需重新確認。</p></div>` : ""}
        <fieldset ${locked ? "disabled" : ""}>
          <h3 class="section-title">票數</h3>
          <div class="field">
            <label for="r-votes">每人每次最多可投幾票？</label>
            <div class="stepper">
              <button type="button" data-act="step" data-d="-1" aria-label="減少">−</button>
              <input id="r-votes" name="votesPerVoter" type="number" inputmode="numeric" min="1" max="100" step="1" value="${r.votesPerVoter}">
              <button type="button" data-act="step" data-d="1" aria-label="增加">＋</button>
            </div>
            <span class="hint">預設 3 票。不可重複模式下，票數不得超過參與投票的候選人數（目前 <b id="activeN">${activeCount()}</b> 位）。</span>
          </div>

          <h3 class="section-title">是否允許重複投給同一候選人</h3>
          ${optionGroup("allowRepeat", r.allowRepeat)}

          <h3 class="section-title">投票頻率</h3>
          ${optionGroup("frequency", r.frequency)}

          <h3 class="section-title">是否必須投滿</h3>
          ${optionGroup("mustFill", r.mustFill)}

          <h3 class="section-title">作品展示模式</h3>
          ${optionGroup("showcase", r.showcase)}

          <h3 class="section-title">投票者驗證方式</h3>
          ${optionGroup("identity", r.identity)}
          <div id="identityWarn"></div>

          <h3 class="section-title">同票處理規則</h3>
          ${optionGroup("tieRule", r.tieRule)}
          <p class="hint muted" style="margin-top:8px">系統不會以隨機方式決定同票名次。</p>

          <h3 class="section-title">投票期間公開排名</h3>
          <div class="alert ok"><p>🔒 固定規則：投票期間一律隱藏即時票數與排名，僅管理者可於後台查看。</p></div>
        </fieldset>
        <div id="ruleErr" class="errors"></div>
        ${locked ? "" : `<div class="row" style="margin-top:8px"><button class="btn btn-gold" type="submit">儲存投票規則</button>
          <button class="btn btn-ghost" type="button" data-act="reset-rules">恢復預設規則</button></div>`}
      </form>
      <aside class="sticky">
        <div class="phone"><div class="phone-screen" id="noticePreview"></div></div>
        <p class="muted" style="text-align:center;font-size:13.5px;margin-top:10px">即時預覽：投票者掃碼後看到的須知</p>
      </aside>
    </div>`;
  updateRulesPreview();
}

function readRulesForm() {
  const f = document.querySelector('form[data-form="rules"]');
  if (!f) return null;
  // 鎖定時欄位為 disabled，FormData 不會包含，直接使用已儲存的規則
  if (f.querySelector("fieldset")?.disabled) return normalizeRules(curEvent()?.rules);
  const fd = new FormData(f);
  const raw = Object.fromEntries(fd.entries());
  raw.votesPerVoter = raw.votesPerVoter === "" ? NaN : Number(raw.votesPerVoter);
  const r = normalizeRules(raw);
  r.votesPerVoter = raw.votesPerVoter; // 保留原值以便驗證錯誤
  return r;
}

function updateRulesPreview() {
  const r = readRulesForm();
  if (!r) return;
  const preview = document.getElementById("noticePreview");
  const n = document.getElementById("activeN");
  if (n) n.textContent = activeCount();
  const errs = validateRules(r, activeCount());
  const shown = Number.isInteger(r.votesPerVoter) && r.votesPerVoter >= 1 ? r : { ...r, votesPerVoter: 1 };
  preview.innerHTML = noticeHTML(generateNotice(shown)) + `<p class="counter">${esc(selectionCounter(shown, 0))}</p>`;
  document.getElementById("ruleErr").innerHTML = errs.length ? `<div class="alert danger">${errs.map((x) => `<p>${esc(x.msg)}</p>`).join("")}</div>` : "";
  document.getElementById("identityWarn").innerHTML = r.identity === "anonymous"
    ? `<div class="alert warn" style="margin-top:10px"><p>匿名快速投票：更換瀏覽器、裝置或清除資料，可能繞過投票次數限制，系統<b>無法完全防止一人多票</b>。正式競賽建議使用「一人一碼」或「帳號登入」。</p></div>`
    : "";
}

async function saveRules() {
  const e = curEvent();
  if (!e || isCoreLocked(e.status)) return toast("核心規則已鎖定。", "error");
  const r = readRulesForm();
  const errs = validateRules(r, activeCount());
  if (errs.length) { sfx.error(); updateRulesPreview(); return toast("規則設定有誤，請修正後再儲存。", "error"); }
  const { slots, lastSlot } = slotsFor(r.votesPerVoter);
  const u = { [`events/${S.eid}/rules`]: r, [`events/${S.eid}/slots`]: slots, [`events/${S.eid}/lastSlot`]: lastSlot, [`events/${S.eid}/updatedAt`]: now() };
  if (e.status === "ready") u[`events/${S.eid}/status`] = "draft";
  try {
    await S.store.update(u);
    sfx.soft();
    toast(e.status === "ready" ? "規則已儲存，狀態已退回草稿，請重新確認。" : "投票規則已儲存，投票須知已同步更新。", "ok");
  } catch (err) { handleError(err); }
}

// ---------- 候選人 ----------
function tabCandidates(body) {
  const e = curEvent();
  const locked = isCoreLocked(e?.status);
  const list = sortedCands();
  const showImg = normalizeRules(e?.rules).showcase === "images";
  const n = activeCount();
  body.innerHTML = `
    ${locked ? `<div class="alert warn"><p>投票已開始，候選人名單已鎖定。</p></div>` : ""}
    <div class="page-head" style="margin-bottom:14px">
      <div><h2 style="font-size:20px;margin:0">候選人與參賽組別</h2>
        <p>參與投票 <b>${n}</b> 位　·　共 ${list.length} 位　·　建議 ${APP_CONFIG.minCandidates}–${APP_CONFIG.maxCandidates} 位</p></div>
      ${locked ? "" : `<div class="row">
        <button class="btn btn-gold" data-act="cand-add">＋ 新增候選人</button>
        <label class="btn btn-ghost" style="cursor:pointer">CSV 批次匯入<input type="file" accept=".csv,text/csv" data-csv hidden></label>
        <button class="btn btn-ghost" data-act="csv-template">下載 CSV 範本</button>
      </div>`}
    </div>
    ${list.length ? `<ol class="cand-list">${list.map((c, i) => candRow(c, i, list.length, locked, showImg)).join("")}</ol>` : `
      <div class="card empty"><div class="big">✦</div><h3>尚未加入候選人</h3>
        <p class="muted">可逐筆新增，或下載 CSV 範本後批次匯入。</p></div>`}`;
  hydrateImages(body, S.store, S.eid);
}

function candRow(c, i, total, locked, showImg) {
  const imgs = imageList(c);
  return `
    <li class="card cand-row ${isActive(c) ? "" : "inactive"}">
      <span class="cand-num">${esc(c.code || String(i + 1).padStart(2, "0"))}</span>
      <span class="thumb">${imgs[0] ? imgTag(imgs[0], c.id) : showImg ? "無圖片" : "—"}</span>
      <span class="cand-info">
        <b>${esc(c.name)}</b>
        ${c.workTitle ? `<em>${esc(c.workTitle)}</em>` : ""}
        ${c.members ? `<small>${esc(c.members)}</small>` : ""}
        ${showImg ? `<small>作品圖片 ${imgs.length} 張</small>` : ""}
      </span>
      <span class="chip ${isActive(c) ? "status-open" : "status-draft"}">${isActive(c) ? "參與投票" : "不參與"}</span>
      ${locked ? "<span></span>" : `<span class="row-actions">
        <button class="btn btn-ghost btn-icon" data-act="cand-move" data-id="${esc(c.id)}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="上移">↑</button>
        <button class="btn btn-ghost btn-icon" data-act="cand-move" data-id="${esc(c.id)}" data-d="1" ${i === total - 1 ? "disabled" : ""} aria-label="下移">↓</button>
        <button class="btn btn-ghost btn-sm" data-act="cand-edit" data-id="${esc(c.id)}">編輯</button>
        <button class="btn btn-danger btn-sm" data-act="cand-del" data-id="${esc(c.id)}">刪除</button>
      </span>`}
    </li>`;
}

function nextCode() {
  const nums = Object.values(S.cands).map((c) => parseInt(c.code, 10)).filter(Number.isFinite);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0");
}

function candidateModal(id = null) {
  const c = id ? S.cands[id] : { code: nextCode(), active: true };
  if (!id && Object.keys(S.cands).length >= APP_CONFIG.maxCandidates) return toast(`候選人最多 ${APP_CONFIG.maxCandidates} 位。`, "error");
  const showImg = normalizeRules(curEvent()?.rules).showcase === "images";
  const cid = id || S.store.newKey(`candidates/${S.eid}`);
  const MAX = APP_CONFIG.maxImagesPerCandidate;
  // 圖片清單：{ ref, preview?, upload? }
  const imgs = imageList(c).map((ref) => ({ ref }));
  const removedDb = [];

  const { modal, close } = openModal(`
    <h3 class="modal-title">${id ? "編輯候選人" : "新增候選人"}</h3>
    <form data-modal-form novalidate>
      <div class="grid-2">
        <div class="field"><label>候選人編號</label><input name="code" type="text" maxlength="12" value="${esc(c.code || "")}"></div>
        <div class="field"><label>姓名或組別名稱<span class="req">*</span></label><input name="name" type="text" maxlength="80" required value="${esc(c.name || "")}"></div>
      </div>
      <div class="field"><label>成員姓名</label><input name="members" type="text" maxlength="200" value="${esc(c.members || "")}" placeholder="以頓號或逗號分隔"></div>
      <div class="field"><label>作品名稱</label><input name="workTitle" type="text" maxlength="120" value="${esc(c.workTitle || "")}"></div>
      <div class="field"><label>作品介紹</label><textarea name="description" maxlength="2000">${esc(c.description || "")}</textarea></div>
      <div class="field">
        <span class="field-label">作品圖片（最多 ${MAX} 張）${showImg ? `<span class="req">*</span>` : ""}</span>
        <div class="img-manager" data-imgs></div>
        <div class="row" style="margin-top:8px">
          <label class="btn btn-gold btn-sm" style="cursor:pointer">上傳圖片<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload hidden></label>
          <input type="url" data-url placeholder="或貼上圖片網址 https://…" style="flex:1;min-width:180px;min-height:38px">
          <button type="button" class="btn btn-ghost btn-sm" data-addurl>加入網址</button>
        </div>
        <span class="hint">JPG／PNG／WebP，系統自動壓縮後免費存入資料庫（不需 Cloud Storage）。${showImg ? "本活動已啟用作品圖片，每位候選人至少 1 張。" : "本活動未啟用作品圖片，可留空。"}</span>
      </div>
      <label class="switch"><input type="checkbox" name="active" ${isActive(c) ? "checked" : ""}> 參與投票</label>
      <div class="errors" data-err style="margin-top:12px"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>取消</button>
        <button type="submit" class="btn btn-gold">儲存</button>
      </div>
    </form>`, { wide: true });

  const box = modal.querySelector("[data-imgs]");
  const drawImgs = () => {
    box.innerHTML = imgs.length ? imgs.map((im, i) => `
      <figure class="img-item">
        ${im.preview ? `<img src="${esc(im.preview)}" alt="">` : imgTag(im.ref, cid, { alt: "" })}
        <figcaption>${i === 0 ? "封面" : `第 ${i + 1} 張`}</figcaption>
        <button type="button" data-rm="${i}" aria-label="移除">✕</button>
        ${i > 0 ? `<button type="button" class="first" data-first="${i}" aria-label="設為封面">★</button>` : ""}
      </figure>`).join("") : `<p class="muted" style="margin:0">尚未加入圖片</p>`;
    hydrateImages(box, S.store, S.eid);
  };
  drawImgs();
  box.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"), first = e.target.closest("[data-first]");
    if (rm) { const [x] = imgs.splice(Number(rm.dataset.rm), 1); if (isDbRef(x.ref) && !x.upload) removedDb.push(x.ref); drawImgs(); }
    if (first) { const [x] = imgs.splice(Number(first.dataset.first), 1); imgs.unshift(x); drawImgs(); }
  });
  modal.querySelector("[data-upload]").addEventListener("change", async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    for (const f of files) {
      if (imgs.length >= MAX) { toast(`每位候選人最多 ${MAX} 張圖片。`, "error"); break; }
      try {
        const out = await compressImage(f);
        imgs.push({ ref: "db:" + S.store.newKey(`images/${S.eid}/${cid}`), preview: out.thumb, upload: out });
        drawImgs();
      } catch (err) { toast(err.message, "error"); }
    }
  });
  modal.querySelector("[data-addurl]").addEventListener("click", () => {
    const inp = modal.querySelector("[data-url]");
    const u = inp.value.trim();
    if (!safeUrl(u)) return toast("圖片網址須以 http:// 或 https:// 開頭。", "error");
    if (imgs.length >= MAX) return toast(`每位候選人最多 ${MAX} 張圖片。`, "error");
    imgs.push({ ref: u }); inp.value = ""; drawImgs();
  });

  modal.querySelector("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const errs = [];
    const name = String(fd.get("name") || "").trim();
    if (!name) errs.push("請填寫姓名或組別名稱。");
    const code = String(fd.get("code") || "").trim();
    if (code && Object.entries(S.cands).some(([k, x]) => k !== id && String(x.code) === code)) errs.push(`編號「${code}」已被使用。`);
    const errBox = modal.querySelector("[data-err]");
    if (errs.length) { errBox.innerHTML = `<div class="alert danger">${errs.map((m) => `<p>${esc(m)}</p>`).join("")}</div>`; sfx.error(); return; }
    const btn = ev.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "儲存中…";
    const maxOrder = Math.max(0, ...Object.values(S.cands).map((x) => x.order || 0));
    const data = {
      eventId: S.eid, code, name,
      members: String(fd.get("members") || "").trim(),
      workTitle: String(fd.get("workTitle") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      imageUrls: imgs.map((x) => x.ref),
      active: fd.get("active") === "on",
      order: id ? (c.order ?? maxOrder + 1) : maxOrder + 1,
      createdAt: id ? (c.createdAt || now()) : now(),
      updatedAt: now()
    };
    const u = { [`candidates/${S.eid}/${cid}`]: data, [`events/${S.eid}/updatedAt`]: now(), ...readyDowngrade() };
    for (const x of imgs) if (x.upload) u[`images/${S.eid}/${cid}/${dbId(x.ref)}`] = x.upload;
    for (const r of removedDb) u[`images/${S.eid}/${cid}/${dbId(r)}`] = null;
    try {
      await S.store.update(u);
      sfx.soft(); toast(id ? "候選人已更新。" : "候選人已新增。", "ok"); close();
    } catch (e) { handleError(e); btn.disabled = false; btn.textContent = "儲存"; }
  });
}

/** 準備完成後若再修改候選人，狀態退回草稿 */
function readyDowngrade() {
  return curEvent()?.status === "ready" ? { [`events/${S.eid}/status`]: "draft" } : {};
}

async function moveCandidate(id, d) {
  const list = sortedCands();
  const i = list.findIndex((c) => c.id === id);
  const j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const u = {};
  list.forEach((c, k) => { u[`candidates/${S.eid}/${c.id}/order`] = k + 1; });
  try { await S.store.update(u); sfx.click(); } catch (e) { handleError(e); }
}

async function deleteCandidate(id) {
  const c = S.cands[id];
  const ok = await confirmDialog({ title: "刪除候選人", message: `<p>確定要刪除「<b>${esc(c?.name)}</b>」嗎？此操作無法復原。</p>`, confirmText: "刪除", danger: true });
  if (!ok) return;
  try {
    await S.store.update({ [`candidates/${S.eid}/${id}`]: null, [`images/${S.eid}/${id}`]: null, [`events/${S.eid}/updatedAt`]: now(), ...readyDowngrade() });
    toast("已刪除候選人。", "ok");
  } catch (e) { handleError(e); }
}

async function importCSV(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast("CSV 檔案過大（上限 2MB）。", "error");
  const text = await file.text();
  const { items, errors } = csvToCandidates(text);
  if (!items.length) { sfx.error(); return toast(errors[0] || "CSV 沒有可匯入的資料。", "error"); }
  const existing = Object.keys(S.cands).length;
  const { modal, close } = openModal(`
    <h3 class="modal-title">CSV 批次匯入</h3>
    <p>讀取到 <b>${items.length}</b> 位候選人${errors.length ? `，另有 ${errors.length} 列略過` : ""}。</p>
    ${errors.length ? `<div class="alert warn">${errors.slice(0, 5).map((m) => `<p>${esc(m)}</p>`).join("")}</div>` : ""}
    <table class="preview-table"><thead><tr><th>編號</th><th>名稱</th><th>作品名稱</th><th>圖片</th><th>參與</th></tr></thead>
      <tbody>${items.slice(0, 6).map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(c.workTitle)}</td><td>${c.imageUrls.length}</td><td>${c.active ? "是" : "否"}</td></tr>`).join("")}
      ${items.length > 6 ? `<tr><td colspan="5" class="muted">…其餘 ${items.length - 6} 筆</td></tr>` : ""}</tbody></table>
    <div class="options" style="margin-top:12px">
      <label class="option"><input type="radio" name="mode" value="append" checked><b>加入現有名單</b><small>保留目前 ${existing} 位候選人</small></label>
      <label class="option"><input type="radio" name="mode" value="replace"><b>取代現有名單</b><small>刪除目前全部候選人後匯入</small></label>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-gold" data-go>確認匯入</button></div>`, { wide: true });

  modal.querySelector("[data-go]").addEventListener("click", async () => {
    const mode = modal.querySelector('input[name="mode"]:checked').value;
    const base = mode === "replace" ? 0 : existing;
    if (base + items.length > APP_CONFIG.maxCandidates) return toast(`匯入後將超過 ${APP_CONFIG.maxCandidates} 位上限。`, "error");
    const u = {};
    let order = mode === "replace" ? 0 : Math.max(0, ...Object.values(S.cands).map((x) => x.order || 0));
    if (mode === "replace") for (const k of Object.keys(S.cands)) { u[`candidates/${S.eid}/${k}`] = null; u[`images/${S.eid}/${k}`] = null; }
    const usedCodes = new Set(mode === "replace" ? [] : Object.values(S.cands).map((c) => String(c.code)));
    let auto = mode === "replace" ? 0 : Math.max(0, ...[...usedCodes].map((x) => parseInt(x, 10)).filter(Number.isFinite));
    for (const c of items) {
      let code = c.code;
      if (!code || usedCodes.has(code)) { do { auto++; code = String(auto).padStart(2, "0"); } while (usedCodes.has(code)); }
      usedCodes.add(code);
      const cid = S.store.newKey(`candidates/${S.eid}`);
      u[`candidates/${S.eid}/${cid}`] = { ...c, code, eventId: S.eid, order: ++order, createdAt: now(), updatedAt: now() };
    }
    u[`events/${S.eid}/updatedAt`] = now();
    Object.assign(u, readyDowngrade());
    try { await S.store.update(u); sfx.chime(); toast(`已匯入 ${items.length} 位候選人。`, "ok"); close(); }
    catch (e) { handleError(e); }
  });
}

function downloadTemplate() {
  const rows = [
    CANDIDATE_TEMPLATE_HEADER,
    ["01", "第一組", "王小明、李小華", "安全給藥新流程", "以實證介入降低給藥錯誤", "https://example.com/poster1.jpg", "是"],
    ["02", "第二組", "陳美玲、林志明", "跌倒預防海報", "", "", "是"]
  ];
  downloadText("星光榮耀_候選人範本.csv", toCSV(rows));
}

// ---------- 規則摘要與須知 ----------
function tabSummary(body) {
  const e = curEvent();
  if (!e) return;
  const check = readinessCheck(e, S.cands, { min: APP_CONFIG.minCandidates, max: APP_CONFIG.maxCandidates, maxImages: APP_CONFIG.maxImagesPerCandidate });
  const url = voteUrl(e.code);
  let actions = "";
  if (e.status === "draft") {
    actions = `<button class="btn btn-gold" data-act="mark-ready" ${check.ok ? "" : "disabled"}>確認規則並標記為「準備完成」</button>
      ${check.ok ? "" : `<span class="muted">請先完成所有檢查項目。</span>`}`;
  } else if (e.status === "ready") {
    actions = `<span class="chip status-ready">已準備完成，等待開始投票</span>
      <button class="btn btn-ghost" data-act="back-draft">退回草稿以修改</button>`;
  } else {
    actions = `<span class="chip status-${esc(e.status)}">${esc(STATUS_LABEL[e.status])}</span>`;
  }
  body.innerHTML = `
    <div class="split">
      <div class="card">
        <h3 class="section-title">規則摘要</h3>
        <dl class="summary">${describeRules(e.rules).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>

        <h3 class="section-title">開始投票前檢查</h3>
        <ul class="checklist">${check.items.map((i) => `
          <li class="${i.ok ? "ok" : "no"}"><span class="mark">${i.ok ? "✓" : "!"}</span>
            <span><b>${esc(i.label)}</b><small>${esc(i.msg)}</small></span></li>`).join("")}</ul>

        <div class="row" style="margin-top:18px">${actions}</div>
        <p class="muted" style="font-size:13.5px;margin-top:12px">投票正式開始後，每人票數、重複規則、投票頻率、是否投滿、驗證方式、同票規則與候選人名單將鎖定。請到「投票控制與 QR Code」開始投票。</p>

        <h3 class="section-title">投票入口</h3>
        <div class="link-box"><span style="flex:1">${esc(url)}</span>
          <button class="btn btn-ghost btn-sm" data-act="copy" data-text="${esc(url)}">複製網址</button></div>
        <p style="margin-top:10px">活動代碼：<span class="code" style="font-size:20px">${esc(e.code)}</span></p>
        ${S.store.mode === "demo" ? `<div class="alert warn"><p>本機示範模式下，投票網址只能在同一台電腦、同一瀏覽器開啟。設定 Firebase 並部署至 GitHub Pages 後，手機即可掃碼進入。</p></div>` : ""}
      </div>
      <aside class="sticky">
        <div class="phone"><div class="phone-screen">${noticeHTML(generateNotice(e.rules))}
          <p class="counter">${esc(selectionCounter(e.rules, 0))}</p></div></div>
      </aside>
    </div>`;
}

async function markReady() {
  const e = curEvent();
  const check = readinessCheck(e, S.cands, { min: APP_CONFIG.minCandidates, max: APP_CONFIG.maxCandidates, maxImages: APP_CONFIG.maxImagesPerCandidate });
  if (!check.ok) return toast("尚有檢查項目未完成。", "error");
  const ok = await confirmDialog({
    title: "確認投票規則",
    message: `<dl class="summary">${describeRules(e.rules).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <p style="margin-top:12px">參與投票候選人：<b>${activeCount()}</b> 位。確認後活動狀態將改為「準備完成」。</p>`,
    confirmText: "確認規則"
  });
  if (!ok) return;
  try { await S.store.update({ [`events/${S.eid}/status`]: "ready", [`events/${S.eid}/updatedAt`]: now() }); sfx.chime(); toast("活動已標記為準備完成。", "ok"); }
  catch (err) { handleError(err); }
}

async function backToDraft() {
  try { await S.store.update({ [`events/${S.eid}/status`]: "draft", [`events/${S.eid}/updatedAt`]: now() }); toast("已退回草稿。", "ok"); }
  catch (err) { handleError(err); }
}

// ---------------- 活動層級操作 ----------------
async function duplicateEvent(id) {
  const src = S.events[id];
  if (!src) return;
  const ok = await confirmDialog({ title: "複製活動", message: `<p>將複製「<b>${esc(src.title)}</b>」的基本資料、投票規則與候選人，建立一場新的草稿活動（不含任何選票與結果）。</p>`, confirmText: "複製" });
  if (!ok) return;
  try {
    const nid = S.store.newKey("events");
    const code = await uniqueCode();
    const { title, subtitle = "", description = "", date = "", organizer = "", coverUrl = "", rules } = src;
    const u = {
      [`events/${nid}`]: {
        title: `${title}（複本）`.slice(0, 80), subtitle, description, date, organizer, coverUrl,
        rules: normalizeRules(rules), ...slotsFor(normalizeRules(rules).votesPerVoter), status: "draft", timezone: APP_CONFIG.timezone, code,
        createdAt: now(), updatedAt: now(), createdBy: uid()
      },
      [`codes/${code}`]: nid
    };
    await copyCandidates(id, nid, null, u);
    await S.store.update(u);
    sfx.chime(); toast("活動已複製。", "ok");
  } catch (e) { handleError(e); }
}

async function deleteEvent(id) {
  const e = S.events[id];
  if (!e) return;
  const running = ["open", "paused"].includes(e.status);
  const ok = await confirmDialog({
    title: "刪除活動",
    message: `<p>確定要刪除「<b>${esc(e.title)}</b>」嗎？</p>
      <p>活動設定、候選人、選票、統計與頒獎資料將<b>全部刪除且無法復原</b>。</p>
      ${running ? `<div class="alert danger"><p>此活動目前「${esc(STATUS_LABEL[e.status])}」，刪除會中斷進行中的投票。</p></div>` : ""}`,
    confirmText: "永久刪除", danger: true
  });
  if (!ok) return;
  try {
    const u = {
      [`events/${id}`]: null, [`candidates/${id}`]: null,
      [`ballots/${id}`]: null, [`results/${id}`]: null, [`awards/${id}`]: null,
      [`voterState/${id}`]: null, [`voterCodes/${id}`]: null, [`eligible/${id}`]: null,
      [`images/${id}`]: null, [`tiebreak/${id}`]: null
    };
    if (e.code) u[`codes/${e.code}`] = null;
    await S.store.update(u);
    toast("活動已刪除。", "ok");
  } catch (err) { handleError(err); }
}

// ---------------- 錯誤處理 ----------------
function handleError(e) {
  console.error(e);
  sfx.error();
  const msg = /permission|PERMISSION_DENIED/i.test(e?.message || e?.code || "")
    ? "權限不足：此操作被安全規則拒絕（可能是活動已開始而規則已鎖定，或帳號非管理者）。"
    : `操作失敗：${e?.message || e}`;
  toast(msg, "error", 5000);
}

function authErrorMsg(code = "") {
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return "帳號或密碼錯誤。";
  if (/too-many-requests/.test(code)) return "嘗試次數過多，請稍後再試。";
  if (/network/.test(code)) return "網路連線異常，請稍後再試。";
  return "登入失敗，請稍後再試。";
}

// ---------------- 事件委派 ----------------
$app.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const { act, id } = b.dataset;
  switch (act) {
    case "new": sfx.click(); return openEditor(null);
    case "edit": sfx.click(); return openEditor(id, b.dataset.tab || "basic");
    case "back": sfx.click(); return closeEditor();
    case "tab": sfx.click(); S.tab = b.dataset.tab; return renderTab();
    case "duplicate": return duplicateEvent(id);
    case "delete": return deleteEvent(id);
    case "logout": stopSubs(); S.view = "list"; return S.store.signOut();
    case "copy": if (await copyText(b.dataset.text)) { sfx.click(); toast("已複製。", "ok"); } return;
    case "reset-pw": {
      const email = document.getElementById("email")?.value.trim();
      if (!email) return toast("請先輸入 Email。", "error");
      try { await S.store.sendReset(email); toast("若此 Email 已註冊，將收到重設密碼信。", "ok"); } catch { toast("無法寄送重設信，請確認 Email。", "error"); }
      return;
    }
    case "step": {
      const inp = document.getElementById("r-votes");
      const v = Math.min(100, Math.max(1, (parseInt(inp.value, 10) || 0) + Number(b.dataset.d)));
      inp.value = v; sfx.click(); return updateRulesPreview();
    }
    case "reset-rules": {
      const f = document.querySelector('form[data-form="rules"]');
      f.votesPerVoter.value = DEFAULT_RULES.votesPerVoter;
      for (const k of ["allowRepeat", "frequency", "mustFill", "showcase", "identity", "tieRule"]) {
        const r = f.querySelector(`input[name="${k}"][value="${String(DEFAULT_RULES[k])}"]`); if (r) r.checked = true;
      }
      sfx.click(); updateRulesPreview(); return toast("已套用預設值，請按「儲存投票規則」生效。");
    }
    case "cand-add": sfx.click(); return candidateModal();
    case "cand-edit": sfx.click(); return candidateModal(id);
    case "cand-del": return deleteCandidate(id);
    case "cand-move": return moveCandidate(id, Number(b.dataset.d));
    case "csv-template": return downloadTemplate();
    case "mark-ready": return markReady();
    case "back-draft": return backToDraft();
    case "status": return changeStatus(b.dataset.to);
    case "qr-full": return qrFullscreen();
    case "qr-png": return qrDownload();
    case "gen-codes": return generateCodes();
    case "codes-csv": return downloadCodes();
    case "save-emails": return saveEmails();
    case "clear-votes": return clearVotes();
    case "finalize": return finalizeResults();
    case "export-csv": return exportCSV();
    case "export-pdf": return exportPDF();
    case "save-tb": return saveTieBreak(b.dataset.key);
    case "make-runoff": return makeRunoff();
    case "apply-runoff": return applyRunoff();
  }
});

$app.addEventListener("submit", async (ev) => {
  const f = ev.target.closest("form[data-form]");
  if (!f) return;
  ev.preventDefault();
  const btn = f.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    if (f.dataset.form === "login") {
      const email = f.email.value.trim(), pw = f.pw.value;
      const box = document.getElementById("loginErr");
      if (!email || !pw) { box.innerHTML = `<div class="alert danger"><p>請輸入 Email 與密碼。</p></div>`; return; }
      try { await S.store.signIn(email, pw); sfx.chime(); }
      catch (e) { sfx.error(); box.innerHTML = `<div class="alert danger"><p>${esc(authErrorMsg(e.code))}</p></div>`; }
    }
    if (f.dataset.form === "basic") await saveBasic(f);
    if (f.dataset.form === "rules") await saveRules();
  } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});

$app.addEventListener("input", (ev) => { if (ev.target.closest('form[data-form="rules"]')) updateRulesPreview(); });
$app.addEventListener("change", (ev) => {
  if (ev.target.closest('form[data-form="rules"]')) { updateRulesPreview(); if (ev.target.type === "radio") sfx.click(); }
  if (ev.target.matches("input[data-csv]")) { importCSV(ev.target.files[0]); ev.target.value = ""; }
});


// ============================================================
// 第二階段：投票控制、QR Code、投票資格、進度
// ============================================================
const CTRL = { unsubs: [], state: {}, ballots: {}, codes: {}, eligible: {} };
function stopControlSubs() {
  CTRL.unsubs.forEach((u) => u && u());
  Object.assign(CTRL, { unsubs: [], state: {}, ballots: {}, codes: {}, eligible: {} });
}

function tabControl(body) {
  const e = curEvent();
  if (!e) return;
  if (!CTRL.unsubs.length) {
    const rerender = () => { if (S.tab === "control") renderControlInner(); };
    CTRL.unsubs.push(
      S.store.on(`voterState/${S.eid}`, (v) => { CTRL.state = v || {}; rerender(); }, () => {}),
      S.store.on(`ballots/${S.eid}`, (v) => { CTRL.ballots = v || {}; rerender(); }, () => {}),
      S.store.on(`voterCodes/${S.eid}`, (v) => { CTRL.codes = v || {}; rerender(); }, () => {}),
      S.store.on(`eligible/${S.eid}`, (v) => { CTRL.eligible = v || {}; rerender(); }, () => {})
    );
  }
  body.innerHTML = `<div id="ctrlInner"></div>`;
  renderControlInner();
}

function qrSvg(text) {
  if (typeof window.qrcode !== "function") return `<p class="muted">QR Code 元件載入失敗</p>`;
  const qr = window.qrcode(0, "M");
  qr.addData(text); qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

function renderControlInner() {
  const box = document.getElementById("ctrlInner");
  const e = curEvent();
  if (!box || !e) return;
  // 保留使用者正在輸入的欄位
  const keep = { codeN: document.getElementById("codeN")?.value, emails: document.getElementById("emails")?.value };
  const r = normalizeRules(e.rules);
  const url = voteUrl(e.code);
  const t = tallyBallots(CTRL.ballots);
  const check = readinessCheck(e, S.cands, { min: APP_CONFIG.minCandidates, max: APP_CONFIG.maxCandidates, maxImages: APP_CONFIG.maxImagesPerCandidate });
  const st = e.status;
  let buttons = "";
  if (st === "draft") buttons = `<div class="alert info"><p>請先到「規則摘要與須知」完成檢查並標記為「準備完成」，才能開始投票。</p></div>`;
  if (st === "ready") buttons = `<button class="btn btn-gold btn-lg" data-act="status" data-to="open" ${check.ok ? "" : "disabled"}>▶ 開始投票</button>`;
  if (st === "open") buttons = `<button class="btn btn-ghost btn-lg" data-act="status" data-to="paused">⏸ 暫停投票</button>
      <button class="btn btn-danger btn-lg" data-act="status" data-to="closed">■ 結束投票</button>`;
  if (st === "paused") buttons = `<button class="btn btn-gold btn-lg" data-act="status" data-to="open">▶ 繼續投票</button>
      <button class="btn btn-danger btn-lg" data-act="status" data-to="closed">■ 結束投票</button>`;
  if (["closed", "revealing", "completed"].includes(st)) buttons = `<div class="alert ok"><p>投票已結束，系統不再接受新選票。統計排名（第三階段）與頒獎舞台（第四階段）開發中。</p></div>`;

  const codeCount = Object.keys(CTRL.codes).length;
  const usedCodes = Object.keys(CTRL.codes).filter((c) => CTRL.state[c]).length;
  const emails = Object.keys(CTRL.eligible).map((k) => k.replace(/,/g, "."));

  box.innerHTML = `
    <div class="split">
      <div style="display:grid;gap:20px">
        <div class="card">
          <h3 class="section-title">投票狀態</h3>
          <div class="row" style="margin-bottom:14px">${statusChip(st)}
            ${e.startedAt ? `<span class="muted" style="font-size:13.5px">開始：${esc(fmtDate(e.startedAt))}</span>` : ""}
            ${e.closedAt ? `<span class="muted" style="font-size:13.5px">結束：${esc(fmtDate(e.closedAt))}</span>` : ""}</div>
          <div class="row">${buttons}</div>
        </div>

        <div class="card">
          <h3 class="section-title">投票進度 <span class="muted" style="font-size:13px;font-family:var(--font-sans);font-weight:400">（僅管理者可見）</span></h3>
          <div class="stat-grid">
            <div class="stat"><b>${t.voters}</b><span>已投票人數</span></div>
            <div class="stat"><b>${t.ballots}</b><span>有效選票數</span></div>
            <div class="stat"><b>${t.votes}</b><span>有效票數</span></div>
          </div>
          <p class="muted" style="font-size:13.5px;margin:12px 0 0">各候選人得票、排名與圖表將於第三階段「投票統計」提供；投票者端完全看不到票數。</p>
        </div>

        ${r.identity === "code" ? `
        <div class="card">
          <h3 class="section-title">一人一碼：投票資格代碼</h3>
          <p>已產生 <b>${codeCount}</b> 組　·　已使用 <b>${usedCodes}</b> 組</p>
          <div class="row">
            <input id="codeN" type="number" min="1" max="500" value="${esc(keep.codeN || Math.max(10, activeCount() * 3))}" style="max-width:140px" aria-label="產生數量">
            <button class="btn btn-gold" data-act="gen-codes">產生代碼</button>
            <button class="btn btn-ghost" data-act="codes-csv" ${codeCount ? "" : "disabled"}>下載代碼 CSV</button>
          </div>
          <p class="hint" style="margin-top:10px">代碼為 8 碼英數字。${r.frequency === "daily" ? "每日一次模式：同一組代碼每天可投一次。" : "整場一次模式：每組代碼只能成功提交一次。"}可列印後剪下發給投票者。</p>
        </div>` : ""}

        ${r.identity === "account" ? `
        <div class="card">
          <h3 class="section-title">帳號登入：投票名單</h3>
          <p class="muted">投票者以 Google 帳號登入。可選擇只允許名單內的 Email 投票。</p>
          <label class="switch" style="margin-bottom:12px"><input type="checkbox" id="restrict" ${e.restrictEmails ? "checked" : ""} ${isCoreLocked(st) ? "disabled" : ""}> 只允許名單內的 Email</label>
          <div class="field"><label for="emails">允許投票的 Email（每行一個，目前 ${emails.length} 個）</label>
            <textarea id="emails" rows="6" placeholder="student01@school.edu.tw">${esc(keep.emails ?? emails.join("\n"))}</textarea></div>
          <button class="btn btn-gold" data-act="save-emails">儲存名單</button>
          ${isCoreLocked(st) ? `<p class="hint">投票開始後仍可新增 Email，但「只允許名單」開關已鎖定。</p>` : ""}
        </div>` : ""}

        ${r.identity === "anonymous" ? `<div class="alert warn"><p>目前為匿名快速投票：同一手機瀏覽器只能投一次，但更換瀏覽器、裝置或清除資料仍可能重複投票。正式競賽建議改用「一人一碼」或「帳號登入」。</p></div>` : ""}

        <div class="card">
          <h3 class="section-title">測試資料</h3>
          <p class="muted">正式投票前，可清除測試時產生的所有選票與投票紀錄（活動設定與候選人保留）。</p>
          <button class="btn btn-danger" data-act="clear-votes" ${t.ballots || Object.keys(CTRL.state).length ? "" : "disabled"}>清除全部選票</button>
        </div>
      </div>

      <aside class="card sticky" style="text-align:center">
        <h3 class="section-title" style="justify-content:center">投票 QR Code</h3>
        <div class="qr-box" id="qrBox">${qrSvg(url)}</div>
        <p style="margin:14px 0 4px">活動代碼</p>
        <p class="code" style="font-size:30px;margin:0 0 12px">${esc(e.code)}</p>
        <div class="row" style="justify-content:center">
          <button class="btn btn-gold" data-act="qr-full">全螢幕顯示</button>
          <button class="btn btn-ghost" data-act="qr-png">下載 PNG</button>
          <button class="btn btn-ghost" data-act="copy" data-text="${esc(url)}">複製網址</button>
        </div>
        <div class="link-box" style="margin-top:14px;text-align:left">${esc(url)}</div>
        ${/localhost|127\.0\.0\.1/.test(url) ? `<div class="alert warn" style="margin-top:12px;text-align:left"><p>目前網址是本機位址，手機掃描無法連線。部署到 GitHub Pages 後，QR Code 會自動變成正式網址（或在 js/config.js 設定 publicBaseUrl）。</p></div>` : ""}
      </aside>
    </div>`;
}

async function changeStatus(to) {
  const e = curEvent();
  const labels = { open: e.status === "paused" ? "繼續投票" : "開始投票", paused: "暫停投票", closed: "結束投票" };
  const msgs = {
    open: e.status === "paused" ? "<p>投票者將可繼續提交選票。</p>" : `<p>開始後，核心規則與候選人名單將<b>鎖定</b>，無法再修改。</p><p>參與投票候選人：<b>${activeCount()}</b> 位。</p>`,
    paused: "<p>暫停期間投票者無法提交選票，已選擇的內容會保留在手機上。</p>",
    closed: "<p>結束後<b>不再接受任何新選票</b>，且無法重新開放。</p>"
  };
  if (to === "open" && e.status === "ready") {
    const check = readinessCheck(e, S.cands, { min: APP_CONFIG.minCandidates, max: APP_CONFIG.maxCandidates, maxImages: APP_CONFIG.maxImagesPerCandidate });
    if (!check.ok) return toast("尚有檢查項目未完成。", "error");
  }
  const ok = await confirmDialog({ title: labels[to], message: msgs[to], confirmText: labels[to], danger: to === "closed" });
  if (!ok) return;
  const u = { [`events/${S.eid}/status`]: to, [`events/${S.eid}/updatedAt`]: now() };
  if (to === "open" && e.status === "ready") {
    const sl = slotsFor(normalizeRules(e.rules).votesPerVoter);
    u[`events/${S.eid}/slots`] = sl.slots;
    u[`events/${S.eid}/lastSlot`] = sl.lastSlot;
    u[`events/${S.eid}/startedAt`] = now();
  }
  if (to === "closed") u[`events/${S.eid}/closedAt`] = now();
  try { await S.store.update(u); to === "open" ? sfx.chime() : sfx.soft(); toast(`已${labels[to]}。`, "ok"); }
  catch (err) { handleError(err); }
}

function qrFullscreen() {
  const e = curEvent();
  const el = document.createElement("div");
  el.className = "qr-full";
  el.innerHTML = `<div class="inner">
      <p class="eyebrow">Scan to vote</p>
      <h2>${esc(e.title)}</h2>
      <div class="qr-box">${qrSvg(voteUrl(e.code))}</div>
      <p style="margin:0;font-size:clamp(16px,1.8vw,22px)">掃描 QR Code，或至投票頁輸入代碼 <span class="code">${esc(e.code)}</span></p>
      <div class="row" style="justify-content:center"><button class="btn btn-ghost" data-music>♫ 播放輕柔背景音樂</button><button class="btn btn-ghost" data-closeqr>關閉（Esc）</button></div></div>`;
  document.body.appendChild(el);
  el.requestFullscreen?.().catch(() => {});
  const close = () => { audio.stopBgm(1); el.remove(); document.removeEventListener("keydown", onKey); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const onKey = (ev) => { if (ev.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.querySelector("[data-closeqr]").addEventListener("click", close);
  const mb = el.querySelector("[data-music]");
  mb.addEventListener("click", () => {
    if (audio.loop) { audio.stopBgm(1.2); mb.textContent = "♫ 播放輕柔背景音樂"; }
    else { audio.ensure(); audio.setBgm(true); audio.playAmbient(); mb.textContent = "■ 停止音樂"; }
  });
}

function qrDownload() {
  const e = curEvent();
  const qr = window.qrcode(0, "M");
  qr.addData(voteUrl(e.code)); qr.make();
  const n = qr.getModuleCount(), cell = 16, margin = 4, size = (n + margin * 2) * cell, pad = 70;
  const c = Object.assign(document.createElement("canvas"), { width: size, height: size + pad * 2 });
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#2f2a24"; ctx.textAlign = "center"; ctx.font = "bold 34px 'Noto Serif TC', serif";
  ctx.fillText(e.title.slice(0, 24), size / 2, 48);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect((x + margin) * cell, (y + margin) * cell + pad, cell, cell);
  ctx.fillStyle = "#a87a2c"; ctx.font = "600 30px Georgia, serif";
  ctx.fillText(`活動代碼 ${e.code}`, size / 2, size + pad + 46);
  c.toBlob((b) => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(b), download: `星光榮耀_QR_${e.code}.png` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

async function generateCodes() {
  const n = Math.min(500, Math.max(1, parseInt(document.getElementById("codeN").value, 10) || 0));
  if (Object.keys(CTRL.codes).length + n > 2000) return toast("每場活動最多 2000 組代碼。", "error");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const u = {};
  const existing = new Set(Object.keys(CTRL.codes));
  let made = 0;
  while (made < n) {
    const code = Array.from(crypto.getRandomValues(new Uint32Array(8)), (x) => chars[x % chars.length]).join("");
    if (existing.has(code)) continue;
    existing.add(code); u[`voterCodes/${S.eid}/${code}`] = true; made++;
  }
  try { await S.store.update(u); sfx.chime(); toast(`已產生 ${n} 組投票代碼。`, "ok"); } catch (e) { handleError(e); }
}

function downloadCodes() {
  const e = curEvent();
  const rows = [["序號", "投票代碼", "投票網址", "狀態"]];
  Object.keys(CTRL.codes).sort().forEach((c, i) => rows.push([i + 1, c, voteUrl(e.code), CTRL.state[c] ? "已使用" : "未使用"]));
  downloadText(`星光榮耀_投票代碼_${e.code}.csv`, toCSV(rows));
}

async function saveEmails() {
  const e = curEvent();
  const list = [...new Set(document.getElementById("emails").value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const bad = list.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if (bad.length) return toast(`Email 格式錯誤：${bad.slice(0, 3).join("、")}`, "error");
  const restrict = document.getElementById("restrict").checked;
  if (restrict && !list.length) return toast("已開啟「只允許名單」，請至少輸入一個 Email。", "error");
  const u = {};
  for (const k of Object.keys(CTRL.eligible)) u[`eligible/${S.eid}/${k}`] = null;
  for (const m of list) u[`eligible/${S.eid}/${m.replace(/\./g, ",")}`] = true;
  if (!isCoreLocked(e.status)) u[`events/${S.eid}/restrictEmails`] = restrict;
  try { await S.store.update(u); document.getElementById("emails").value = list.join("\n"); sfx.soft(); toast(`已儲存 ${list.length} 個 Email。`, "ok"); } catch (err) { handleError(err); }
}

async function clearVotes() {
  const ok = await confirmDialog({ title: "清除全部選票", message: "<p>將永久刪除本活動所有選票與投票紀錄，所有投票者可重新投票。此操作無法復原。</p>", confirmText: "永久清除", danger: true });
  if (!ok) return;
  try { await S.store.update({ [`ballots/${S.eid}`]: null, [`voterState/${S.eid}`]: null }); toast("已清除全部選票。", "ok"); }
  catch (e) { handleError(e); }
}

// 頁內導覽（例如從控制台再點「建立活動」）
window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (!S.isAdmin) return;
  if (h === "new") openEditor(null);
  else if (h === "stats" || h === "ceremony") { S.filter = h; closeEditor(); }
});


// ============================================================
// 第三階段：統計結果、同票處理、匯出
// ============================================================
const STAT = { unsubs: [], ballots: {}, results: null, tiebreak: {}, runoffs: [] };
function stopStatsSubs() {
  STAT.unsubs.forEach((u) => u && u());
  Object.assign(STAT, { unsubs: [], ballots: {}, results: null, tiebreak: {}, runoffs: [] });
}

function tabStats(body) {
  if (!STAT.unsubs.length) {
    const rr = () => { if (S.tab === "stats") renderStatsInner(); };
    STAT.unsubs.push(
      S.store.on(`ballots/${S.eid}`, (v) => { STAT.ballots = v || {}; rr(); }, () => {}),
      S.store.on(`results/${S.eid}`, (v) => { STAT.results = v; rr(); }, () => {}),
      S.store.on(`tiebreak/${S.eid}`, (v) => { STAT.tiebreak = v || {}; rr(); }, () => {})
    );
  }
  body.innerHTML = `<div id="statsInner"></div><div class="chart-tip" id="chartTip" hidden></div>`;
  renderStatsInner();
}

const pctText = (p) => `${(p * 100).toFixed(1)}%`;
const awardBadge = (a) => a ? `<span class="medal medal-${a}">${esc(TIER_LABEL[a])}</span>` : "";

function currentResults() {
  const e = curEvent();
  return computeResults(e, S.cands, STAT.ballots, STAT.tiebreak);
}

function renderStatsInner() {
  const box = document.getElementById("statsInner");
  const e = curEvent();
  if (!box || !e) return;
  const keep = {};
  box.querySelectorAll("input[data-tb]").forEach((i) => { keep[i.dataset.tb] = i.value; });
  const res = currentResults();
  const st = e.status;
  const closed = ["closed", "revealing", "completed"].includes(st);
  const final = STAT.results?.finalizedAt ? STAT.results : null;
  const lockedFinal = ["revealing", "completed"].includes(st);
  const s = res.stats;
  const maxVotes = Math.max(1, ...res.ranking.map((r) => r.votes));

  let finalizeBox = "";
  if (!closed) finalizeBox = `<div class="alert info"><p>投票${st === "open" ? "進行中" : st === "paused" ? "暫停中" : "尚未開始"}，以下為即時數據（僅管理者可見）。結束投票後即可確認最終結果並進入頒獎典禮。</p></div>`;
  else if (res.unresolved.length) finalizeBox = `<div class="alert warn"><p>影響前三名的同票尚未處理，請先於下方「同票處理」完成設定。</p></div>`;
  else if (final) finalizeBox = `<div class="alert ok"><p>✓ 最終結果已確認（${esc(fmtDate(final.finalizedAt))}）。${lockedFinal ? "頒獎已開始，結果已鎖定。" : ""}</p></div>`;

  const tieBox = closed && res.tieRule !== "shared" ? tieResolutionHTML(res, keep, lockedFinal) : "";

  const awardsSummary = ["gold", "silver", "bronze"].map((t) => {
    const ids = res.awards[t];
    const names = ids.map((cid) => res.ranking.find((r) => r.cid === cid)).map((r) => `${r.code ? "No." + r.code + " " : ""}${r.name}`);
    return `<div class="award-card award-${t}">${trophySVG(t, 46)}<div><b>${TIER_LABEL[t]}</b><span>${names.length ? esc(names.join("、")) : "從缺"}${ids.length > 1 ? "（並列）" : ""}</span></div></div>`;
  }).join("");

  const days = Object.entries(s.byDay || {}).sort(([a], [b]) => a - b);

  box.innerHTML = `
    ${finalizeBox}
    <div class="row" style="margin-bottom:18px">
      ${closed && !lockedFinal ? `<button class="btn btn-gold" data-act="finalize" ${res.unresolved.length || !s.votes ? "disabled" : ""}>${final ? "重新確認結果" : "確認最終結果"}</button>` : ""}
      ${final ? `<a class="btn btn-gold" href="ceremony.html?e=${encodeURIComponent(S.eid)}">♕ 進入頒獎典禮 <span class="arrow">↗</span></a>` : ""}
      <span class="spacer"></span>
      <button class="btn btn-ghost" data-act="export-csv" ${s.ballots ? "" : "disabled"}>匯出 CSV</button>
      <button class="btn btn-ghost" data-act="export-pdf" ${s.ballots ? "" : "disabled"}>匯出 PDF</button>
    </div>

    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat"><b>${s.voters}</b><span>有效投票人數</span></div>
      <div class="stat"><b>${s.ballots}</b><span>有效選票數</span></div>
      <div class="stat"><b>${s.votes}</b><span>總有效票數</span></div>
    </div>

    ${s.votes ? `<div class="award-row">${awardsSummary}</div>` : ""}
    ${tieBox}

    <div class="split" style="margin-top:20px">
      <div class="card">
        <h3 class="section-title">排名表</h3>
        ${res.ranking.length ? `<div class="table-wrap"><table class="rank-table">
          <thead><tr><th>名次</th><th>編號</th><th>候選人</th><th>作品名稱</th><th class="num">得票</th><th class="num">比例</th><th>獎項</th></tr></thead>
          <tbody>${res.ranking.map((r) => `<tr class="${r.award ? "is-" + r.award : ""}">
            <td><b>${r.votes ? r.rank : "—"}</b>${(res.tiedRanks[r.rank] || []).length > 1 && r.votes ? `<small class="muted"> 並列</small>` : ""}</td>
            <td>${esc(r.code)}</td><td><b>${esc(r.name)}</b>${r.members ? `<br><small class="muted">${esc(r.members)}</small>` : ""}</td>
            <td>${esc(r.workTitle)}</td><td class="num">${r.votes}</td><td class="num">${pctText(r.pct)}</td><td>${awardBadge(r.award)}</td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">尚無候選人。</p>`}
      </div>
      <div style="display:grid;gap:20px">
        <div class="card">
          <h3 class="section-title">得票長條圖</h3>
          ${s.votes ? `<div class="bars" role="img" aria-label="各候選人得票數長條圖">${res.ranking.map((r) => `
            <div class="bar-row" data-tip="${esc(`${r.code ? "No." + r.code + " " : ""}${r.name}｜${r.votes} 票｜${pctText(r.pct)}`)}">
              <span class="bar-label">${esc(r.code ? r.code + " " : "")}${esc(r.name)}</span>
              <span class="bar-track"><span class="bar-fill ${r.award ? "fill-" + r.award : ""}" style="width:${(r.votes / maxVotes) * 100}%"></span></span>
              <span class="bar-value">${r.votes}</span>
            </div>`).join("")}</div>` : `<p class="muted">尚無選票。</p>`}
        </div>
        <div class="card">
          <h3 class="section-title">得票比例</h3>
          ${s.votes ? shareChartHTML(res) : `<p class="muted">尚無選票。</p>`}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <h3 class="section-title">每日投票統計</h3>
      ${days.length ? `<table class="rank-table"><thead><tr><th>日期</th><th class="num">有效選票數（投票人次）</th><th class="num">有效票數</th></tr></thead>
        <tbody>${days.map(([d, v]) => `<tr><td>${dayNumToDate(d)}</td><td class="num">${v.ballots}</td><td class="num">${v.votes}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">尚無選票。</p>`}
    </div>`;
}

/** 得票比例：前三名獎項各一段＋其他，100% 橫條（加圖例） */
function shareChartHTML(res) {
  const total = res.stats.votes;
  const segs = [];
  for (const t of ["gold", "silver", "bronze"]) {
    const v = res.ranking.filter((r) => r.award === t).reduce((a, r) => a + r.votes, 0);
    if (v) segs.push({ key: t, label: `${TIER_LABEL[t]}（${res.ranking.filter((r) => r.award === t).map((r) => r.name).join("、")}）`, v });
  }
  const other = res.ranking.filter((r) => !r.award).reduce((a, r) => a + r.votes, 0);
  if (other) segs.push({ key: "other", label: "其他候選人", v: other });
  return `
    <div class="share-bar" role="img" aria-label="得票比例">${segs.map((sg) => `<span class="seg seg-${sg.key}" style="flex:${sg.v}" data-tip="${esc(`${sg.label}｜${sg.v} 票｜${pctText(sg.v / total)}`)}"></span>`).join("")}</div>
    <ul class="legend">${segs.map((sg) => `<li><span class="sw seg-${sg.key}"></span>${esc(sg.label)}<b>${pctText(sg.v / total)}</b></li>`).join("")}</ul>`;
}

function tieResolutionHTML(res, keep, locked) {
  const key = res.tieRule === "judges" ? "judgeScores" : "runoffVotes";
  const label = res.tieRule === "judges" ? "評審分數" : "加賽得票";
  const byVotes = {};
  res.ranking.forEach((r) => { if (r.votes > 0) (byVotes[r.votes] ||= []).push(r); });
  const groups = Object.values(byVotes).filter((g) => g.length > 1 && 1 + res.ranking.filter((o) => o.votes > g[0].votes).length <= 3);
  if (!groups.length) return `<div class="card" style="margin-top:20px"><h3 class="section-title">同票處理（${esc(labelOf("tieRule", res.tieRule))}）</h3><p class="muted" style="margin:0">前三名沒有同票，不需處理。</p></div>`;
  const vals = STAT.tiebreak?.[key] || {};
  return `<div class="card" style="margin-top:20px">
    <h3 class="section-title">同票處理（${esc(labelOf("tieRule", res.tieRule))}）</h3>
    <p class="muted">以下候選人票數相同且影響前三名。請輸入${label}，數值高者名次較前；數值仍相同則並列，系統不會隨機決定。</p>
    ${groups.map((g) => `<div class="tie-group"><b>${g[0].votes} 票同票</b>
      ${g.map((r) => `<label class="tie-item"><span>${esc(r.code ? "No." + r.code + " " : "")}${esc(r.name)}</span>
        <input type="number" step="any" data-tb="${esc(r.cid)}" value="${esc(keep[r.cid] ?? vals[r.cid] ?? "")}" ${locked ? "disabled" : ""} placeholder="${label}"></label>`).join("")}</div>`).join("")}
    ${locked ? "" : `<div class="row" style="margin-top:12px">
      <button class="btn btn-gold" data-act="save-tb" data-key="${key}">儲存${label}</button>
      ${res.tieRule === "runoff" ? `<button class="btn btn-ghost" data-act="make-runoff">建立加賽投票活動</button>
        <button class="btn btn-ghost" data-act="apply-runoff">讀取加賽結果</button>` : ""}
    </div>
    ${res.tieRule === "runoff" ? `<p class="hint" style="margin-top:8px">「建立加賽投票活動」會複製同票候選人為新活動（每人 1 票）。加賽結束後按「讀取加賽結果」自動帶入票數，也可手動輸入。</p>` : ""}`}
  </div>`;
}

async function saveTieBreak(key) {
  const vals = {};
  for (const inp of document.querySelectorAll("input[data-tb]")) {
    if (inp.value === "") continue;
    const n = Number(inp.value);
    if (!Number.isFinite(n)) return toast("請輸入數字。", "error");
    vals[inp.dataset.tb] = n;
  }
  try { await S.store.update({ [`tiebreak/${S.eid}/${key}`]: Object.keys(vals).length ? { ...(STAT.tiebreak?.[key] || {}), ...vals } : null }); sfx.soft(); toast("已儲存。", "ok"); }
  catch (e) { handleError(e); }
}

async function makeRunoff() {
  const e = curEvent();
  const res = currentResults();
  const ids = [...new Set(res.unresolved.flat().concat(
    Object.values(res.tiedRanks).filter((g) => g.length > 1).flat().filter((cid) => { const r = res.ranking.find((x) => x.cid === cid); return r.votes > 0 && r.rank <= 3; })
  ))];
  if (ids.length < 2) return toast("沒有需要加賽的同票候選人。", "error");
  const names = ids.map((cid) => S.cands[cid]?.name).join("、");
  const ok = await confirmDialog({ title: "建立加賽投票活動", message: `<p>將以「${esc(names)}」建立一場新的加賽活動（每人 1 票、整場一次、驗證方式相同）。</p>`, confirmText: "建立" });
  if (!ok) return;
  try {
    const nid = S.store.newKey("events");
    const code = await uniqueCode();
    const r = { ...normalizeRules(e.rules), votesPerVoter: 1, allowRepeat: false, frequency: "once", mustFill: true, tieRule: "shared" };
    const u = {
      [`events/${nid}`]: {
        title: `${e.title}｜加賽`.slice(0, 80), subtitle: e.subtitle || "", description: "同票加賽投票", date: e.date || "", organizer: e.organizer || "", coverUrl: e.coverUrl || "",
        rules: r, ...slotsFor(1), status: "draft", timezone: APP_CONFIG.timezone, code, runoffFor: S.eid,
        createdAt: now(), updatedAt: now(), createdBy: uid()
      },
      [`codes/${code}`]: nid
    };
    await copyCandidates(S.eid, nid, ids, u);
    await S.store.update(u);
    sfx.chime(); toast(`已建立加賽活動（代碼 ${code}），請到活動列表開啟並開始投票。`, "ok", 6000);
  } catch (err) { handleError(err); }
}

async function applyRunoff() {
  const all = (await S.store.get("events")) || {};
  const runs = Object.entries(all).filter(([, ev]) => ev.runoffFor === S.eid);
  if (!runs.length) return toast("找不到此活動的加賽活動。", "error");
  const [rid, rev] = runs.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))[0];
  if (!["closed", "revealing", "completed"].includes(rev.status)) return toast("加賽活動尚未結束投票。", "error");
  const [rc, rb] = await Promise.all([S.store.get(`candidates/${rid}`), S.store.get(`ballots/${rid}`)]);
  const t = tallyBallots(rb || {});
  const vals = {};
  for (const [cid, c] of Object.entries(rc || {})) if (c.sourceId) vals[c.sourceId] = t.totals[cid] || 0;
  try { await S.store.update({ [`tiebreak/${S.eid}/runoffVotes`]: vals }); sfx.chime(); toast("已帶入加賽結果。", "ok"); }
  catch (e) { handleError(e); }
}

async function finalizeResults() {
  const e = curEvent();
  const res = currentResults();
  if (res.unresolved.length) return toast("請先完成同票處理。", "error");
  const names = ["gold", "silver", "bronze"].map((t) => `<li>${TIER_LABEL[t]}：${res.awards[t].length ? esc(res.awards[t].map((cid) => S.cands[cid]?.name).join("、")) : "從缺"}</li>`).join("");
  const ok = await confirmDialog({ title: "確認最終結果", message: `<ul>${names}</ul><p>確認後即可進入頒獎典禮。頒獎開始後結果將鎖定。</p>`, confirmText: "確認結果" });
  if (!ok) return;
  try {
    await S.store.update({ [`results/${S.eid}`]: { ...resultSnapshot(res, STAT.tiebreak), finalizedAt: now(), finalizedBy: uid() } });
    sfx.chime(); toast("最終結果已確認。", "ok");
  } catch (err) { handleError(err); }
}

// ---------- 匯出 ----------
function exportRows() {
  const e = curEvent();
  const res = currentResults();
  const rows = [];
  rows.push(["【活動資料】"]);
  rows.push(["活動名稱", e.title], ["副標題", e.subtitle || ""], ["活動日期", e.date || ""], ["主辦單位", e.organizer || ""], ["活動代碼", e.code]);
  rows.push(["投票開始時間", fmtDate(e.startedAt) || ""], ["投票結束時間", fmtDate(e.closedAt) || ""]);
  rows.push([]);
  rows.push(["【投票規則】"]);
  describeRules(e.rules).forEach(([k, v]) => rows.push([k, v]));
  rows.push([]);
  rows.push(["【投票統計】"]);
  rows.push(["有效投票人數", res.stats.voters], ["有效選票數", res.stats.ballots], ["總有效票數", res.stats.votes]);
  rows.push([]);
  rows.push(["【每日投票統計】"], ["日期", "每日投票人次（選票數）", "每日有效票數"]);
  Object.entries(res.stats.byDay || {}).sort(([a], [b]) => a - b).forEach(([d, v]) => rows.push([dayNumToDate(d), v.ballots, v.votes]));
  rows.push([]);
  rows.push(["【候選人結果】"], ["排名", "候選人編號", "候選人名稱", "成員", "作品名稱", "得票數", "得票比例", "獎項"]);
  res.ranking.forEach((r) => rows.push([r.votes ? r.rank : "", r.code, r.name, r.members, r.workTitle, r.votes, pctText(r.pct), r.award ? TIER_LABEL[r.award] : ""]));
  return { rows, res, e };
}

function exportCSV() {
  const { rows, e } = exportRows();
  downloadText(`星光榮耀_${e.title}_投票結果.csv`, toCSV(rows));
}

async function exportPDF() {
  if (!window.jspdf || !window.html2canvas) return toast("PDF 元件載入失敗。", "error");
  const { e, res } = exportRows();
  toast("正在產生 PDF…");
  const wrap = document.createElement("div");
  wrap.className = "pdf-report";
  const trophyCells = ["gold", "silver", "bronze"].map((t) => `<td>${trophySVG(t, 40)}<div><b>${TIER_LABEL[t]}</b><br>${esc(res.awards[t].map((cid) => res.ranking.find((r) => r.cid === cid).name).join("、") || "從缺")}</div></td>`).join("");
  wrap.innerHTML = `
    <h1>${esc(e.title)}</h1>
    <p class="sub">${esc([e.subtitle, e.organizer, e.date].filter(Boolean).join("　·　"))}</p>
    <p class="sub">投票期間：${esc(fmtDate(e.startedAt) || "—")} ～ ${esc(fmtDate(e.closedAt) || "—")}　活動代碼 ${esc(e.code)}</p>
    <table class="awards"><tr>${trophyCells}</tr></table>
    <h2>投票統計</h2>
    <table><tr><th>有效投票人數</th><th>有效選票數</th><th>總有效票數</th></tr><tr><td>${res.stats.voters}</td><td>${res.stats.ballots}</td><td>${res.stats.votes}</td></tr></table>
    <h2>候選人結果</h2>
    <table><thead><tr><th>排名</th><th>編號</th><th>候選人</th><th>作品名稱</th><th>得票</th><th>比例</th><th>獎項</th></tr></thead>
      <tbody>${res.ranking.map((r) => `<tr><td>${r.votes ? r.rank : "—"}</td><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.workTitle)}</td><td>${r.votes}</td><td>${pctText(r.pct)}</td><td>${r.award ? TIER_LABEL[r.award] : ""}</td></tr>`).join("")}</tbody></table>
    <h2>每日投票統計</h2>
    <table><thead><tr><th>日期</th><th>投票人次</th><th>有效票數</th></tr></thead>
      <tbody>${Object.entries(res.stats.byDay || {}).sort(([a], [b]) => a - b).map(([d, v]) => `<tr><td>${dayNumToDate(d)}</td><td>${v.ballots}</td><td>${v.votes}</td></tr>`).join("")}</tbody></table>
    <h2>投票規則</h2>
    <table>${describeRules(e.rules).map(([k, v]) => `<tr><th style="width:38%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
    <p class="foot">星光榮耀 Starlight Awards　·　產生時間 ${esc(fmtDate(Date.now()))}</p>`;
  document.body.appendChild(wrap);
  try {
    const canvas = await window.html2canvas(wrap, { scale: 2, backgroundColor: "#ffffff" });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pw = 210, ph = 297, m = 12;
    const imgW = pw - m * 2;
    const pxPerMm = canvas.width / imgW;
    const pageHpx = Math.floor((ph - m * 2) * pxPerMm);
    let y = 0, page = 0;
    while (y < canvas.height) {
      const h = Math.min(pageHpx, canvas.height - y);
      const slice = document.createElement("canvas");
      slice.width = canvas.width; slice.height = h;
      slice.getContext("2d").drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (page) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", m, m, imgW, h / pxPerMm);
      y += h; page++;
    }
    pdf.save(`星光榮耀_${e.title}_投票結果.pdf`);
    sfx.soft();
  } catch (err) { console.error(err); toast("PDF 產生失敗。", "error"); }
  finally { wrap.remove(); }
}

// 圖表提示（滑鼠／觸控）
document.addEventListener("pointerover", (ev) => {
  const t = ev.target.closest("[data-tip]");
  const tip = document.getElementById("chartTip");
  if (!tip) return;
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip; tip.hidden = false;
  const r = t.getBoundingClientRect();
  tip.style.left = `${Math.min(innerWidth - 260, Math.max(8, ev.clientX + 12))}px`;
  tip.style.top = `${r.top - 40}px`;
});

/** 金銀銅獎盃（SVG） */
function trophySVG(tier, size = 48) {
  const g = { gold: ["#fff4cf", "#e6c06a", "#a87a24"], silver: ["#ffffff", "#c9d0db", "#7d8796"], bronze: ["#ffe2c8", "#d39463", "#8a4f25"] }[tier];
  const id = `tr-${tier}-${Math.random().toString(36).slice(2, 7)}`;
  return `<svg class="trophy" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g[0]}"/><stop offset=".5" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/></linearGradient></defs>
    <path d="M18 8h28v12c0 11-6 18-14 20-8-2-14-9-14-20z" fill="url(#${id})"/>
    <path d="M18 12H9c0 9 5 14 11 15M46 12h9c0 9-5 14-11 15" fill="none" stroke="url(#${id})" stroke-width="3.5" stroke-linecap="round"/>
    <rect x="28" y="39" width="8" height="9" fill="url(#${id})"/><path d="M20 48h24l3 9H17z" fill="url(#${id})"/>
    <path d="M32 14l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" fill="#fff" opacity=".85"/></svg>`;
}

/** 複製候選人（含資料庫圖片）到另一活動；ids 為 null 時全部複製 */
async function copyCandidates(srcEid, dstEid, ids, u) {
  const [cands, imgs] = await Promise.all([S.store.get(`candidates/${srcEid}`), S.store.get(`images/${srcEid}`)]);
  let order = 0;
  for (const [cid, c] of Object.entries(cands || {}).sort((a, b) => (a[1].order || 0) - (b[1].order || 0))) {
    if (ids && !ids.includes(cid)) continue;
    const ncid = S.store.newKey(`candidates/${dstEid}`);
    u[`candidates/${dstEid}/${ncid}`] = { ...c, eventId: dstEid, sourceId: cid, order: ++order, imageUrls: imageList(c), createdAt: now(), updatedAt: now() };
    if (imgs?.[cid]) u[`images/${dstEid}/${ncid}`] = imgs[cid];
  }
}
