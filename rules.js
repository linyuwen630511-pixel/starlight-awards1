// ============================================================
// 投票規則：預設值、驗證、開始前檢查、投票須知自動產生
// 純函式，不依賴 DOM，可於瀏覽器與 Node 測試共用。
// ============================================================

export const STATUS_LABEL = {
  draft: "草稿",
  ready: "準備完成",
  open: "投票中",
  paused: "暫停",
  closed: "投票結束",
  revealing: "頒獎中",
  completed: "活動完成"
};

/** 只有在這些狀態下才能修改核心規則與候選人 */
export const EDITABLE_STATUSES = ["draft", "ready"];
export const isCoreLocked = (status) => !EDITABLE_STATUSES.includes(status || "draft");

export const DEFAULT_RULES = Object.freeze({
  votesPerVoter: 3,
  allowRepeat: false,
  frequency: "once",
  mustFill: true,
  showcase: "images",
  identity: "anonymous",
  tieRule: "shared",
  hidePublicRanking: true // 固定規則，不可關閉
});

export const RULE_OPTIONS = {
  allowRepeat: [
    { value: false, label: "不可重複", desc: "同一候選人每張選票最多 1 票，投票者以多選卡片選擇不同候選人。" },
    { value: true, label: "可以重複", desc: "同一候選人可獲得多票，投票者以票數分配器分配。" }
  ],
  frequency: [
    { value: "once", label: "整場只能提交一次", desc: "每位投票者在整場活動中只能成功提交一張選票。" },
    { value: "daily", label: "每日可提交一次", desc: "依 Asia/Taipei 日期計算，並以伺服端時間驗證。" }
  ],
  mustFill: [
    { value: true, label: "必須投滿", desc: "未達指定票數時，送出按鈕維持停用。" },
    { value: false, label: "可少於上限", desc: "至少 1 票即可送出。" }
  ],
  showcase: [
    { value: "images", label: "作品圖片投票", desc: "每位候選人 1–5 張作品圖，投票者可點擊放大。" },
    { value: "none", label: "一般候選人投票", desc: "只顯示編號、名稱、組別與作品名稱。" }
  ],
  identity: [
    { value: "anonymous", label: "匿名快速投票", desc: "適合課堂快速活動。更換瀏覽器、裝置或清除資料，可能繞過投票次數限制，無法完全防止一人多票。" },
    { value: "code", label: "一人一碼", desc: "管理者發放專屬投票代碼，每組代碼依投票頻率限制提交次數。正式競賽建議使用。" },
    { value: "account", label: "帳號登入", desc: "以指定帳號驗證投票資格。正式競賽建議使用。" }
  ],
  tieRule: [
    { value: "shared", label: "同票並列名次", desc: "同票者並列，頒獎畫面同時顯示多位得獎者。" },
    { value: "runoff", label: "同票加賽投票", desc: "同票候選人另行加賽投票決定名次。" },
    { value: "judges", label: "依評審分數決定", desc: "依事先設定的評審分數排定同票名次。" }
  ]
};

const ENUMS = {
  frequency: ["once", "daily"],
  showcase: ["images", "none"],
  identity: ["anonymous", "code", "account"],
  tieRule: ["shared", "runoff", "judges"]
};

const toBool = (v, fallback) => {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return fallback;
};

/** 將任意輸入整理為完整、型別正確的規則物件 */
export function normalizeRules(input = {}) {
  const r = { ...DEFAULT_RULES };
  const n = Number(input.votesPerVoter);
  r.votesPerVoter = Number.isFinite(n) ? n : DEFAULT_RULES.votesPerVoter;
  r.allowRepeat = toBool(input.allowRepeat, DEFAULT_RULES.allowRepeat);
  r.mustFill = toBool(input.mustFill, DEFAULT_RULES.mustFill);
  for (const k of Object.keys(ENUMS)) {
    r[k] = ENUMS[k].includes(input[k]) ? input[k] : DEFAULT_RULES[k];
  }
  r.hidePublicRanking = true;
  return r;
}

/**
 * 驗證規則設定。activeCount = 「參與投票」的候選人數（未知時傳 null）。
 * 回傳錯誤陣列：[{ field, msg }]
 */
export function validateRules(rules, activeCount = null) {
  const errors = [];
  const v = rules.votesPerVoter;
  if (!Number.isInteger(v) || v < 1) {
    errors.push({ field: "votesPerVoter", msg: "每人票數必須是正整數（至少 1 票）。" });
  } else if (v > 100) {
    errors.push({ field: "votesPerVoter", msg: "每人票數不得超過 100 票。" });
  } else if (!rules.allowRepeat && Number.isInteger(activeCount) && activeCount > 0 && v > activeCount) {
    errors.push({
      field: "votesPerVoter",
      msg: `不可重複模式下，每人票數（${v} 票）不得超過可投候選人數（${activeCount} 位）。`
    });
  }
  for (const k of Object.keys(ENUMS)) {
    if (!ENUMS[k].includes(rules[k])) errors.push({ field: k, msg: `「${k}」設定值不正確。` });
  }
  if (typeof rules.allowRepeat !== "boolean") errors.push({ field: "allowRepeat", msg: "請選擇是否允許重複投給同一候選人。" });
  if (typeof rules.mustFill !== "boolean") errors.push({ field: "mustFill", msg: "請選擇是否必須投滿。" });
  if (rules.hidePublicRanking !== true) errors.push({ field: "hidePublicRanking", msg: "投票期間必須隱藏公開排名。" });
  return errors;
}

export const isActive = (c) => c && c.active !== false;

/** 開始投票前檢查清單 */
export function readinessCheck(event, candidatesObj = {}, limits = { min: 2, max: 100, maxImages: 5 }) {
  const rules = normalizeRules(event?.rules);
  const all = Object.values(candidatesObj || {});
  const active = all.filter(isActive);
  const n = active.length;
  const items = [];

  items.push({
    key: "title",
    label: "活動名稱已填寫",
    ok: !!(event?.title && String(event.title).trim()),
    msg: event?.title && String(event.title).trim() ? String(event.title).trim() : "請於「基本資料」填寫活動名稱。"
  });

  let candMsg = "";
  if (n < limits.min) candMsg = `參與投票的候選人至少需要 ${limits.min} 位（目前 ${n} 位）。`;
  else if (n > limits.max) candMsg = `參與投票的候選人最多 ${limits.max} 位（目前 ${n} 位）。`;
  else if (!rules.allowRepeat && rules.votesPerVoter > n)
    candMsg = `不可重複模式下，候選人數（${n} 位）須不少於每人票數（${rules.votesPerVoter} 票）。`;
  items.push({ key: "candidates", label: "候選人數足夠", ok: !candMsg, msg: candMsg || `共 ${n} 位參與投票。` });

  const voteErrs = validateRules(rules, n).filter((e) => e.field === "votesPerVoter");
  items.push({
    key: "votes",
    label: "每人票數合法",
    ok: voteErrs.length === 0,
    msg: voteErrs[0]?.msg || `每人 ${rules.votesPerVoter} 票。`
  });

  items.push({
    key: "frequency",
    label: "投票頻率已設定",
    ok: ENUMS.frequency.includes(event?.rules?.frequency),
    msg: ENUMS.frequency.includes(event?.rules?.frequency) ? labelOf("frequency", rules.frequency) : "請於「投票規則」設定投票頻率。"
  });

  const missingName = active.filter((c) => !String(c.name || "").trim());
  let workMsg = "";
  if (missingName.length) workMsg = `有 ${missingName.length} 位候選人未填寫名稱。`;
  else if (rules.showcase === "images") {
    const noImg = active.filter((c) => imageList(c).length === 0);
    const tooMany = active.filter((c) => imageList(c).length > limits.maxImages);
    if (noImg.length) workMsg = `作品圖片模式：有 ${noImg.length} 位候選人尚未提供作品圖片（${noImg.map((c) => c.code || c.name).slice(0, 5).join("、")}${noImg.length > 5 ? "…" : ""}）。`;
    else if (tooMany.length) workMsg = `每位候選人最多 ${limits.maxImages} 張圖片。`;
  }
  items.push({ key: "works", label: "作品資料已完成", ok: !workMsg && n > 0, msg: workMsg || (n ? "候選人資料完整。" : "尚無候選人。") });

  items.push({
    key: "identity",
    label: "投票者驗證方式已設定",
    ok: ENUMS.identity.includes(event?.rules?.identity),
    msg: ENUMS.identity.includes(event?.rules?.identity) ? labelOf("identity", rules.identity) : "請於「投票規則」設定驗證方式。"
  });

  return { ok: items.every((i) => i.ok), items };
}

export function imageList(c) {
  const v = c?.imageUrls;
  if (!v) return [];
  return (Array.isArray(v) ? v : Object.values(v)).filter((u) => typeof u === "string" && u);
}

export function labelOf(field, value) {
  return RULE_OPTIONS[field]?.find((o) => o.value === value)?.label ?? String(value);
}

/** 規則摘要（給管理者看） */
export function describeRules(input) {
  const r = normalizeRules(input);
  return [
    ["每人每次最多票數", `${r.votesPerVoter} 票`],
    ["同一候選人重複得票", labelOf("allowRepeat", r.allowRepeat)],
    ["投票頻率", labelOf("frequency", r.frequency)],
    ["是否必須投滿", labelOf("mustFill", r.mustFill)],
    ["作品展示模式", labelOf("showcase", r.showcase)],
    ["投票者驗證方式", labelOf("identity", r.identity)],
    ["同票處理", labelOf("tieRule", r.tieRule)],
    ["投票期間公開排名", "隱藏（固定規則）"]
  ];
}

/** 簡短規則標籤（列表卡片用） */
export function shortRules(input) {
  const r = normalizeRules(input);
  return [
    `每人 ${r.votesPerVoter} 票`,
    r.allowRepeat ? "可重複" : "不可重複",
    r.frequency === "daily" ? "每日一次" : "整場一次",
    r.mustFill ? "必須投滿" : "可少投",
    r.showcase === "images" ? "作品圖片" : "一般投票"
  ];
}

/**
 * 依規則自動產生投票須知。
 * 文字中 **粗體** 由畫面渲染層轉換（先跳脫再轉換，安全）。
 */
export function generateNotice(input) {
  const r = normalizeRules(input);
  const N = r.votesPerVoter;
  const items = [];

  // 1. 選擇方式
  if (!r.allowRepeat) {
    if (N === 1) items.push("每位投票者須選出**1位候選人（或組別）**。");
    else if (r.mustFill) items.push(`每位投票者須選出**${N}位不同候選人（或組別）**，同一候選人不得重複投票。`);
    else items.push(`每位投票者最多可選出**${N}位不同候選人（或組別）**，同一候選人不得重複投票。`);
  } else {
    items.push(`每位投票者共有**${N}票**，可自由分配給候選人（或組別），同一候選人可獲得多票。`);
  }

  // 2. 投滿規則
  if (!r.allowRepeat) {
    if (r.mustFill) items.push(N === 1 ? "**必須選擇1位**，才能送出選票。" : `**必須選滿${N}位**，才能送出選票。`);
    else if (N > 1) items.push(`至少選擇1位即可送出，**不必選滿${N}位**。`);
  } else {
    if (r.mustFill) items.push(`**必須分配完${N}票**，才能送出選票。`);
    else if (N > 1) items.push(`至少分配1票即可送出，**不必分配完${N}票**。`);
  }

  // 3. 投票頻率
  if (r.frequency === "once") {
    items.push("每人於本次活動**僅能提交一次**，送出後不得修改或再次投票。");
  } else {
    items.push("每人**每天僅能提交一次**（依台灣時間計算），當日送出後不得修改；隔日可再次投票，也可再次選擇前一天投過的候選人。");
  }

  // 4. 驗證方式（匿名模式不需額外說明）
  if (r.identity === "code") items.push("請使用管理者發給您的**專屬投票代碼**進入投票。");
  if (r.identity === "account") items.push("請以**指定帳號登入**後再進行投票。");

  // 5. 作品圖片
  if (r.showcase === "images") items.push("可點擊作品圖片，放大觀看參賽作品。");

  // 6. 固定規則
  items.push("投票期間不公開即時票數及排名。");
  items.push("投票結束後，由管理者統一揭曉前三名。");

  return {
    title: "星光榮耀｜投票須知",
    items,
    footer: "請確認選擇後，再按下「確認送出」。"
  };
}

/** 手機投票頁的進度文字 */
export function selectionCounter(input, n = 0) {
  const r = normalizeRules(input);
  return r.allowRepeat ? `已分配 ${n} / ${r.votesPerVoter} 票` : `已選擇 ${n} / ${r.votesPerVoter} 位`;
}

/** 以 Asia/Taipei 計算日期鍵（YYYY-MM-DD），供每日一次模式使用 */
export function taipeiDateKey(ms = Date.now(), tz = "Asia/Taipei") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

// ============================================================
// 第二階段：免費方案（Spark）選票結構
// 選票以「票位」s0…s(N-1) 表示，每個票位放一個候選人 ID。
// 安全規則只允許活動設定中存在的票位，因此票數不可能超過上限；
// 不可重複模式另加 picks（候選人→票位）雙向對應，保證候選人不重複。
// ============================================================

/** 依票數產生票位設定：{ s0:"-", s1:"s0", s2:"s1" }（值為前一票位，"-" 表示第一個） */
export function slotsFor(votes) {
  const n = Math.max(1, Math.min(100, Number(votes) || 1));
  const slots = {};
  for (let i = 0; i < n; i++) slots[`s${i}`] = i === 0 ? "-" : `s${i - 1}`;
  return { slots, lastSlot: `s${n - 1}` };
}

const DAY = 86400000, TPE = 8 * 3600000;
/** 台北日序號（自 1970-01-01 起算的天數），安全規則以伺服器 now 驗證同一數值 */
export const taipeiDayNum = (ms) => Math.floor((ms + TPE) / DAY);

/**
 * 建立選票。selection：
 *  - 不可重複：候選人 ID 陣列
 *  - 可重複：{ 候選人ID: 票數 }
 * 回傳 { ok, error, ballot }，ballot 不含 ts（由寫入端加入伺服器時間）。
 */
export function buildBallot(input, selection, candidatesObj, dayNum) {
  const r = normalizeRules(input);
  const N = r.votesPerVoter;
  const list = r.allowRepeat
    ? Object.entries(selection || {}).flatMap(([cid, k]) => Array(Math.max(0, k | 0)).fill(cid))
    : [...(selection || [])];
  const total = list.length;
  const fail = (error) => ({ ok: false, error });
  if (total < 1) return fail("請至少選擇 1 票。");
  if (total > N) return fail(`最多只能投 ${N} 票。`);
  if (r.mustFill && total !== N) return fail(r.allowRepeat ? `必須分配完 ${N} 票。` : `必須選滿 ${N} 位。`);
  for (const cid of list) {
    const c = candidatesObj?.[cid];
    if (!c || !isActive(c)) return fail("選票包含無效的候選人，請重新整理後再投票。");
  }
  if (!r.allowRepeat && new Set(list).size !== list.length) return fail("同一候選人不得重複投票。");
  const slots = {}, picks = {};
  list.forEach((cid, i) => { slots[`s${i}`] = cid; if (!r.allowRepeat) picks[cid] = `s${i}`; });
  const ballot = { dayNum, slots };
  if (!r.allowRepeat) ballot.picks = picks;
  return { ok: true, ballot, total };
}

/** 判斷投票者是否已達本次可投次數 */
export function voteState(input, state, todayNum) {
  const r = normalizeRules(input);
  if (!state) return { canVote: true };
  if (r.frequency === "once") return { canVote: false, reason: "once" };
  if (state.lastDay >= todayNum) return { canVote: false, reason: "today" };
  return { canVote: true };
}

/** 從選票資料計算統計（僅管理者端使用） */
export function tallyBallots(ballotsObj = {}) {
  const totals = {};
  let voters = 0, ballots = 0, votes = 0;
  const byDay = {};
  for (const perVoter of Object.values(ballotsObj || {})) {
    voters++;
    for (const b of Object.values(perVoter || {})) {
      ballots++;
      const d = byDay[b.dayNum] || (byDay[b.dayNum] = { ballots: 0, votes: 0 });
      d.ballots++;
      for (const cid of Object.values(b.slots || {})) { totals[cid] = (totals[cid] || 0) + 1; votes++; d.votes++; }
    }
  }
  return { voters, ballots, votes, totals, byDay };
}
