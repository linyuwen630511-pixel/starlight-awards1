// ============================================================
// 第五階段：系統檢查與自動驗收測試
// 1. 環境檢查：設定、連線、伺服器時間、管理者權限、匿名登入、正式網址
// 2. 安全規則實測：在「真正的 Firebase」上建立臨時測試活動，
//    以多位虛擬投票者（各自獨立的匿名身分）同時投票與嘗試各種違規操作，
//    確認合法選票被接受、違規操作全部被伺服器拒絕，最後自動清除測試資料。
// ============================================================
import { getStore, isFirebaseConfigured } from "./store.js";
import { FIREBASE_CONFIG, APP_CONFIG } from "./config.js";
import { initChrome, showModeBadge, esc, sfx, toast } from "./ui.js";
import { DEFAULT_RULES, slotsFor, taipeiDayNum, tallyBallots } from "./rules.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const $app = document.getElementById("app");
let store, user, SDKS;

initChrome();
main().catch((e) => { console.error(e); $app.innerHTML = `<div class="alert danger"><p>${esc(e.message)}</p></div>`; });

async function main() {
  store = await getStore();
  showModeBadge(store.mode);
  if (!isFirebaseConfigured()) {
    $app.innerHTML = page(`<div class="alert warn"><p>尚未設定 Firebase（目前為本機示範模式）。請先依 README 填寫 <code>js/config.js</code>，部署後再回到此頁執行檢查。</p></div>`);
    return;
  }
  store.onAuth(async (u) => {
    user = u;
    if (!u || u.isAnonymous || !(await store.isAdmin(u.uid))) {
      $app.innerHTML = page(`<div class="alert warn"><p>請先以管理者帳號登入，再回到此頁。</p></div><a class="btn btn-gold" href="admin.html">前往管理者登入</a>`);
      return;
    }
    render();
  });
}

function page(inner) {
  return `<section class="page-head"><div><p class="eyebrow">Deployment check</p><h1>系統檢查與驗收測試</h1>
    <p>確認 Firebase 設定、安全規則與多人同時投票都正常運作。</p></div>
    <a class="btn btn-ghost" href="admin.html">← 返回控制台</a></section>${inner}`;
}

function render() {
  $app.innerHTML = page(`
    <div class="card" style="margin-bottom:20px">
      <h3 class="section-title">一、環境檢查</h3>
      <p class="muted">檢查設定、連線、伺服器時間、管理者權限、匿名登入與正式網址。約需 5 秒。</p>
      <button class="btn btn-gold" data-run="env">開始環境檢查</button>
      <div id="envOut" style="margin-top:14px"></div>
    </div>
    <div class="card">
      <h3 class="section-title">二、安全規則與多人投票實測</h3>
      <p class="muted">在你的 Firebase 上建立臨時「【系統測試】」活動，以虛擬投票者實際投票並嘗試違規操作（超額、重複、未投滿、暫停／結束後投票、偷看票數、竄改規則等），確認伺服器全部正確攔截。測試完成後自動刪除測試活動。</p>
      <div class="row" style="margin:10px 0">
        <label class="field" style="margin:0">同時投票的虛擬投票者人數
          <input id="nVoters" type="number" min="5" max="40" value="20" style="max-width:140px"></label>
      </div>
      <p class="hint">免費方案同時連線上限約 100，建議 20–40。每位虛擬投票者會在 Firebase「Authentication → 使用者」留下一筆匿名帳號，可於主控台刪除，不影響使用。</p>
      <button class="btn btn-gold" data-run="rules">開始實測</button>
      <div id="rulesOut" style="margin-top:14px"></div>
    </div>`);
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-run]");
  if (!b || b.disabled) return;
  b.disabled = true;
  try { b.dataset.run === "env" ? await runEnv() : await runRules(); }
  catch (e) { console.error(e); toast("測試中斷：" + e.message, "error", 6000); }
  finally { b.disabled = false; }
});

// ---------------- 共用 ----------------
async function sdk() {
  if (!SDKS) {
    const [A, U, D] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-database.js`)]);
    SDKS = { A, U, D };
  }
  return SDKS;
}

/** 建立一位獨立的虛擬投票者（獨立 Firebase App 與匿名身分） */
async function virtualVoter(tag) {
  const { A, U, D } = await sdk();
  const app = A.initializeApp(FIREBASE_CONFIG, `vv-${tag}-${Math.random().toString(36).slice(2, 8)}`);
  const auth = U.getAuth(app);
  const cred = await U.signInAnonymously(auth);
  const db = D.getDatabase(app);
  return {
    uid: cred.user.uid, db,
    update: (u) => D.update(D.ref(db), u),
    get: async (p) => { const s = await D.get(D.ref(db, p)); return s.val(); },
    set: (p, v) => D.set(D.ref(db, p), v),
    key: () => D.push(D.ref(db, "x")).key,
    ts: () => D.serverTimestamp(),
    close: () => A.deleteApp(app).catch(() => {})
  };
}

function rowHTML(r) {
  return `<tr><td>${r.ok ? "✅" : "❌"}</td><td>${esc(r.label)}</td><td>${esc(r.expect)}</td><td>${esc(r.actual)}</td></tr>`;
}
function table(rows) {
  const pass = rows.filter((r) => r.ok).length;
  return `<div class="alert ${pass === rows.length ? "ok" : "danger"}"><p><b>${pass} / ${rows.length} 項通過</b>${pass === rows.length ? "　系統可以正式使用。" : "　請依失敗項目檢查設定。"}</p></div>
    <div class="table-wrap"><table class="rank-table"><thead><tr><th></th><th>檢查項目</th><th>預期</th><th>實際</th></tr></thead><tbody>${rows.map(rowHTML).join("")}</tbody></table></div>`;
}
const isDenied = (e) => /permission|PERMISSION_DENIED/i.test(e?.message || e?.code || "");

/** 執行並判斷：shouldPass=true 預期成功；false 預期被拒絕 */
async function expectOp(rows, label, shouldPass, fn, render) {
  let actual, ok;
  try { await fn(); actual = "成功寫入／讀取"; ok = shouldPass; }
  catch (e) { actual = isDenied(e) ? "被安全規則拒絕" : `錯誤：${e.code || e.message}`; ok = !shouldPass && isDenied(e); }
  rows.push({ label, expect: shouldPass ? "應成功" : "應被拒絕", actual, ok });
  render && render();
  return ok;
}

// ---------------- 一、環境檢查 ----------------
async function runEnv() {
  const out = document.getElementById("envOut");
  const rows = [];
  const draw = () => { out.innerHTML = table(rows); };
  const push = (label, ok, actual, expect = "正常") => { rows.push({ label, ok, actual, expect }); draw(); };

  push("Firebase 設定已填寫", true, FIREBASE_CONFIG.projectId);
  const { D } = await sdk();
  // 連線與伺服器時間
  const offset = await store.serverNow().then((t) => t - Date.now());
  push("伺服器時間同步", Math.abs(offset) < 5 * 60 * 1000, `本機與伺服器相差 ${Math.round(offset / 1000)} 秒`, "相差 5 分鐘內");
  push("台灣日期計算", true, new Date(taipeiDayNum(Date.now() + offset) * 86400000).toISOString().slice(0, 10));
  push("管理者權限", true, user.email);

  // 匿名登入（投票者使用）
  let vv = null;
  try { vv = await virtualVoter("env"); push("匿名登入已啟用（匿名投票、一人一碼）", true, "可登入"); }
  catch (e) { push("匿名登入已啟用（匿名投票、一人一碼）", false, /operation-not-allowed|admin-restricted/.test(e.code) ? "未啟用：請到 Authentication → 登入方式 開啟「匿名」" : e.code || e.message); }

  if (vv) {
    const r2 = [];
    await expectOp(r2, "一般使用者不可列出全部活動", false, () => vv.get("events"));
    await expectOp(r2, "一般使用者不可讀取管理者名單", false, () => vv.get("admins"));
    await expectOp(r2, "一般使用者不可自行成為管理者", false, () => vv.set(`admins/${vv.uid}`, { role: "owner" }));
    r2.forEach((r) => rows.push({ ...r, label: "安全規則已發布：" + r.label }));
    draw();
    await vv.close();
  }

  // 正式網址
  const base = APP_CONFIG.publicBaseUrl;
  const here = location.origin + location.pathname.replace(/[^/]*$/, "");
  if (!base) push("正式網址 publicBaseUrl", !/localhost|127\.0\.0\.1/.test(here), `未設定，使用目前網址 ${here}`, "已設定或使用公開網址");
  else push("正式網址 publicBaseUrl", here.startsWith(base) || base.startsWith(here), base, "與目前網址一致");
  push("HTTPS（手機相機掃碼與登入需要）", location.protocol === "https:" || /localhost|127\.0\.0\.1/.test(location.hostname), location.protocol);
  push("Google 登入網域", true, `若使用「帳號登入」，請確認 ${location.hostname} 已加入 Authentication → 設定 → 已授權網域`, "人工確認");
  sfx.chime();
}

// ---------------- 二、安全規則與多人投票實測 ----------------
async function runRules() {
  const out = document.getElementById("rulesOut");
  const rows = [];
  const log = [];
  const draw = () => { out.innerHTML = `${log.length ? `<p class="muted">${esc(log[log.length - 1])}</p>` : ""}${rows.length ? table(rows) : ""}`; };
  const say = (m) => { log.push(m); draw(); };
  const N = Math.min(40, Math.max(5, parseInt(document.getElementById("nVoters").value, 10) || 20));
  const created = [];
  const voters = [];
  const newVoter = async (t) => { const v = await virtualVoter(t); voters.push(v); return v; };

  try {
    // ---- 建立測試活動（每人 3 票、不可重複、整場一次、必須投滿、匿名） ----
    say("建立測試活動…");
    const E = await createTestEvent({ ...DEFAULT_RULES, showcase: "none" }, created);
    const [a, b, c, d] = E.cids;
    const day = taipeiDayNum(await store.serverNow());
    const ballot = (vv, ids, { bid = vv.key(), dayNum = day, picks = true, state = true, voterKey = vv.uid } = {}) => {
      const slots = Object.fromEntries(ids.map((x, i) => [`s${i}`, x]));
      const bal = { dayNum, ts: vv.ts(), slots };
      if (picks) bal.picks = Object.fromEntries(ids.map((x, i) => [x, `s${i}`]));
      const u = { [`ballots/${E.id}/${voterKey}/${bid}`]: bal };
      if (state) u[`voterState/${E.id}/${voterKey}`] = { lastDay: dayNum, lastBallot: bid, ts: vv.ts() };
      return u;
    };

    // 尚未開始
    const early = await newVoter("early");
    await expectOp(rows, "投票開始前提交選票", false, () => early.update(ballot(early, [a, b, c])), draw);

    await setStatus(E.id, "open", E);
    say(`投票已開始，建立 ${N} 位虛擬投票者…`);

    // ---- 多人同時投票 ----
    const crowd = await Promise.all(Array.from({ length: N }, (_, i) => newVoter(`c${i}`)));
    const picksOf = (i) => [[a, b, c], [a, b, d], [a, c, d], [b, c, d]][i % 4];
    const t0 = performance.now();
    const res = await Promise.allSettled(crowd.map((v, i) => v.update(ballot(v, picksOf(i)))));
    const okN = res.filter((r) => r.status === "fulfilled").length;
    rows.push({ label: `${N} 位投票者同時送出合法選票`, expect: `${N} 張全部接受`, actual: `${okN} 張接受（${Math.round(performance.now() - t0)} ms）`, ok: okN === N });
    draw();

    // ---- 違規操作 ----
    const v1 = crowd[0];
    await expectOp(rows, "同一人第二次投票（整場一次）", false, () => v1.update(ballot(v1, [b, c, d])), draw);
    const dbl = await newVoter("dbl");
    const same = ballot(dbl, [a, b, c]);
    const both = await Promise.allSettled([dbl.update(same), dbl.update(same)]);
    rows.push({ label: "重複點擊／網路重送（同一張選票送兩次）", expect: "只計 1 張", actual: `${both.filter((r) => r.status === "fulfilled").length} 次成功`, ok: both.filter((r) => r.status === "fulfilled").length === 1 });
    draw();
    const x = await newVoter("x");
    await expectOp(rows, "超過票數上限（投 4 票）", false, () => x.update(ballot(x, [a, b, c, d])), draw);
    await expectOp(rows, "同一候選人重複投票（不可重複模式）", false, () => {
      const u = ballot(x, [a, a, b], { picks: false });
      u[`ballots/${E.id}/${x.uid}/${Object.keys(u)[0].split("/").pop()}`].picks = { [a]: "s0", [b]: "s2" };
      return x.update(u);
    }, draw);
    await expectOp(rows, "未投滿（必須投滿 3 票卻只投 2 票）", false, () => x.update(ballot(x, [a, b])), draw);
    await expectOp(rows, "投給不存在的候選人", false, () => x.update(ballot(x, [a, b, "fake-candidate"])), draw);
    await expectOp(rows, "投給「不參與投票」的候選人", false, () => x.update(ballot(x, [a, b, E.inactive])), draw);
    await expectOp(rows, "只寫選票、不寫投票紀錄（繞過次數限制）", false, () => x.update(ballot(x, [a, b, c], { state: false })), draw);
    await expectOp(rows, "偽造日期（以昨天的日期投票）", false, () => x.update(ballot(x, [a, b, c], { dayNum: day - 1 })), draw);
    await expectOp(rows, "冒用他人身分投票", false, () => x.update(ballot(x, [a, b, c], { voterKey: crowd[1].uid })), draw);
    await expectOp(rows, "修改自己已送出的選票", false, async () => {
      const st = await v1.get(`voterState/${E.id}/${v1.uid}`);
      return v1.set(`ballots/${E.id}/${v1.uid}/${st.lastBallot}/slots/s0`, d);
    }, draw);
    await expectOp(rows, "刪除自己的投票紀錄以便重投", false, () => v1.set(`voterState/${E.id}/${v1.uid}`, null), draw);
    await expectOp(rows, "投票期間偷看全部選票", false, () => x.get(`ballots/${E.id}`), draw);
    await expectOp(rows, "投票期間偷看投票紀錄", false, () => x.get(`voterState/${E.id}`), draw);
    await expectOp(rows, "讀取尚未公開的結果", false, () => x.get(`results/${E.id}`), draw);
    await expectOp(rows, "學生修改活動狀態", false, () => x.set(`events/${E.id}/status`, "closed"), draw);
    await expectOp(rows, "學生修改投票規則（每人改成 99 票）", false, () => x.set(`events/${E.id}/rules/votesPerVoter`, 99), draw);
    await expectOp(rows, "學生修改候選人資料", false, () => x.set(`candidates/${E.id}/${a}/name`, "竄改"), draw);
    await expectOp(rows, "管理者在投票開始後修改核心規則", false, () => store.update({ [`events/${E.id}/rules/votesPerVoter`]: 5 }), draw);
    await expectOp(rows, "管理者在投票開始後刪除候選人", false, () => store.update({ [`candidates/${E.id}/${b}`]: null }), draw);
    await expectOp(rows, "合法的新投票者（對照組）", true, () => x.update(ballot(x, [b, c, d])), draw);

    // 暫停與結束
    await setStatus(E.id, "paused", E);
    const p = await newVoter("paused");
    await expectOp(rows, "暫停期間提交選票", false, () => p.update(ballot(p, [a, b, c])), draw);
    await setStatus(E.id, "open", E);
    await expectOp(rows, "繼續投票後提交選票", true, () => p.update(ballot(p, [a, b, c])), draw);
    await setStatus(E.id, "closed", E);
    const late = await newVoter("late");
    await expectOp(rows, "投票結束後提交選票", false, () => late.update(ballot(late, [a, b, c])), draw);

    // 計票核對
    const all = await store.get(`ballots/${E.id}`);
    const t = tallyBallots(all || {});
    const expVoters = N + 3; // crowd + dbl + x + p
    rows.push({ label: "統計結果正確（有效投票人數）", expect: `${expVoters} 人`, actual: `${t.voters} 人`, ok: t.voters === expVoters });
    rows.push({ label: "統計結果正確（每人恰好 3 票）", expect: `${expVoters * 3} 票`, actual: `${t.votes} 票`, ok: t.votes === expVoters * 3 && t.ballots === expVoters });
    draw();

    // ---- 一人一碼 ----
    say("測試一人一碼…");
    const E2 = await createTestEvent({ ...DEFAULT_RULES, showcase: "none", identity: "code", votesPerVoter: 1 }, created);
    await store.update({ [`voterCodes/${E2.id}/TESTAAAA`]: true });
    await setStatus(E2.id, "open", E2);
    const k1 = await newVoter("k1"), k2 = await newVoter("k2");
    const codeBallot = (vv, code, cid) => {
      const bid = vv.key();
      return { [`ballots/${E2.id}/${code}/${bid}`]: { dayNum: day, ts: vv.ts(), slots: { s0: cid }, picks: { [cid]: "s0" } }, [`voterState/${E2.id}/${code}`]: { lastDay: day, lastBallot: bid, ts: vv.ts() } };
    };
    await expectOp(rows, "一人一碼：無效代碼投票", false, () => k1.update(codeBallot(k1, "ZZZZZZZZ", E2.cids[0])), draw);
    await expectOp(rows, "一人一碼：有效代碼投票", true, () => k1.update(codeBallot(k1, "TESTAAAA", E2.cids[0])), draw);
    await expectOp(rows, "一人一碼：同一代碼換手機再投", false, () => k2.update(codeBallot(k2, "TESTAAAA", E2.cids[1])), draw);

    // ---- 可重複模式 ----
    say("測試可重複投給同一候選人…");
    const E3 = await createTestEvent({ ...DEFAULT_RULES, showcase: "none", allowRepeat: true }, created);
    await setStatus(E3.id, "open", E3);
    const r1 = await newVoter("r1"), r2 = await newVoter("r2");
    const repBallot = (vv, ids) => { const bid = vv.key(); return { [`ballots/${E3.id}/${vv.uid}/${bid}`]: { dayNum: day, ts: vv.ts(), slots: Object.fromEntries(ids.map((x2, i) => [`s${i}`, x2])) }, [`voterState/${E3.id}/${vv.uid}`]: { lastDay: day, lastBallot: bid, ts: vv.ts() } }; };
    await expectOp(rows, "可重複模式：同一候選人 3 票", true, () => r1.update(repBallot(r1, [E3.cids[0], E3.cids[0], E3.cids[0]])), draw);
    await expectOp(rows, "可重複模式：超過票數上限", false, () => r2.update(repBallot(r2, [E3.cids[0], E3.cids[0], E3.cids[0], E3.cids[1]])), draw);

    say("測試完成，清除測試資料…");
  } finally {
    await Promise.all(voters.map((v) => v.close()));
    for (const id of created) {
      await store.update({
        [`events/${id.id}`]: null, [`candidates/${id.id}`]: null, [`ballots/${id.id}`]: null, [`voterState/${id.id}`]: null,
        [`voterCodes/${id.id}`]: null, [`codes/${id.code}`]: null
      }).catch((e) => console.warn("cleanup", e));
    }
    log.push(`已清除 ${created.length} 個測試活動。`);
    draw();
    const allOk = rows.length && rows.every((r) => r.ok);
    allOk ? sfx.chime() : sfx.error();
  }
}

async function createTestEvent(rules, created) {
  const id = store.newKey("events");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(crypto.getRandomValues(new Uint32Array(6)), (n) => chars[n % chars.length]).join("");
  const u = {
    [`events/${id}`]: {
      title: "【系統測試】請勿使用", subtitle: "", description: "自動驗收測試，完成後自動刪除", date: "", organizer: "", coverUrl: "",
      status: "draft", rules, ...slotsFor(rules.votesPerVoter), timezone: "Asia/Taipei", code,
      createdAt: store.now(), updatedAt: store.now(), createdBy: user.uid
    },
    [`codes/${code}`]: id
  };
  const cids = [];
  ["測試甲", "測試乙", "測試丙", "測試丁"].forEach((name, i) => {
    const cid = store.newKey(`candidates/${id}`); cids.push(cid);
    u[`candidates/${id}/${cid}`] = { eventId: id, code: String(i + 1).padStart(2, "0"), name, members: "", workTitle: "", description: "", order: i + 1, active: true, createdAt: store.now(), updatedAt: store.now() };
  });
  const inactive = store.newKey(`candidates/${id}`);
  u[`candidates/${id}/${inactive}`] = { eventId: id, code: "99", name: "不參與", order: 99, active: false };
  created.push({ id, code });
  await store.update(u);
  await store.update({ [`events/${id}/status`]: "ready" });
  return { id, code, cids, inactive };
}

async function setStatus(id, status) {
  await store.update({ [`events/${id}/status`]: status, [`events/${id}/updatedAt`]: store.now() });
}
