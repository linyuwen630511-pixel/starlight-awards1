// 執行：node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RULES, normalizeRules, validateRules, readinessCheck, generateNotice,
  selectionCounter, taipeiDateKey, describeRules
} from "../js/rules.js";
import { parseCSV, toCSV, safeCell, csvToCandidates } from "../js/csv.js";

test("本次活動預設規則", () => {
  assert.deepEqual({ ...DEFAULT_RULES }, {
    votesPerVoter: 3, allowRepeat: false, frequency: "once", mustFill: true,
    showcase: "images", identity: "anonymous", tieRule: "shared", hidePublicRanking: true
  });
});

test("預設投票須知與規格文字完全一致（6 條）", () => {
  const n = generateNotice(DEFAULT_RULES);
  assert.equal(n.title, "星光榮耀｜投票須知");
  assert.deepEqual(n.items, [
    "每位投票者須選出**3位不同候選人（或組別）**，同一候選人不得重複投票。",
    "**必須選滿3位**，才能送出選票。",
    "每人於本次活動**僅能提交一次**，送出後不得修改或再次投票。",
    "可點擊作品圖片，放大觀看參賽作品。",
    "投票期間不公開即時票數及排名。",
    "投票結束後，由管理者統一揭曉前三名。"
  ]);
  assert.equal(n.footer, "請確認選擇後，再按下「確認送出」。");
});

test("須知依規則自動更新", () => {
  const five = generateNotice({ ...DEFAULT_RULES, votesPerVoter: 5 }).items.join("|");
  assert.match(five, /5位不同候選人/); assert.match(five, /必須選滿5位/); assert.doesNotMatch(five, /3位/);

  const rep = generateNotice({ ...DEFAULT_RULES, allowRepeat: true }).items.join("|");
  assert.match(rep, /共有\*\*3票\*\*，可自由分配/); assert.match(rep, /必須分配完3票/); assert.doesNotMatch(rep, /不得重複/);

  const daily = generateNotice({ ...DEFAULT_RULES, frequency: "daily" }).items.join("|");
  assert.match(daily, /每天僅能提交一次/); assert.doesNotMatch(daily, /僅能提交一次\*\*，送出後不得修改或再次投票/);

  const noImg = generateNotice({ ...DEFAULT_RULES, showcase: "none" }).items.join("|");
  assert.doesNotMatch(noImg, /作品圖片/);

  const notFull = generateNotice({ ...DEFAULT_RULES, mustFill: false }).items.join("|");
  assert.doesNotMatch(notFull, /必須選滿/); assert.match(notFull, /不必選滿3位/);

  const code = generateNotice({ ...DEFAULT_RULES, identity: "code" }).items.join("|");
  assert.match(code, /專屬投票代碼/);
});

test("票數驗證", () => {
  assert.equal(validateRules(DEFAULT_RULES, 10).length, 0);
  assert.ok(validateRules({ ...DEFAULT_RULES, votesPerVoter: 0 }).length);
  assert.ok(validateRules({ ...DEFAULT_RULES, votesPerVoter: 2.5 }).length);
  assert.ok(validateRules({ ...DEFAULT_RULES, votesPerVoter: 101 }).length);
  // 不可重複：票數不得超過候選人數
  assert.ok(validateRules({ ...DEFAULT_RULES, votesPerVoter: 5 }, 4).some((e) => e.field === "votesPerVoter"));
  // 可重複：不受候選人數限制
  assert.equal(validateRules({ ...DEFAULT_RULES, votesPerVoter: 5, allowRepeat: true }, 2).length, 0);
});

test("normalizeRules 型別轉換且固定隱藏排名", () => {
  const r = normalizeRules({ votesPerVoter: "4", allowRepeat: "true", mustFill: "false", frequency: "x", hidePublicRanking: false });
  assert.equal(r.votesPerVoter, 4); assert.equal(r.allowRepeat, true); assert.equal(r.mustFill, false);
  assert.equal(r.frequency, "once"); assert.equal(r.hidePublicRanking, true);
});

test("開始投票前檢查", () => {
  const ev = { title: "最佳海報獎", rules: { ...DEFAULT_RULES } };
  const img = ["https://x/a.jpg"];
  let res = readinessCheck(ev, { a: { name: "A", active: true, imageUrls: img }, b: { name: "B", active: true, imageUrls: img } });
  assert.equal(res.ok, false, "2 位候選人不足 3 票不可重複");
  res = readinessCheck(ev, { a: { name: "A", imageUrls: img }, b: { name: "B", imageUrls: img }, c: { name: "C", imageUrls: img } });
  assert.equal(res.ok, true);
  res = readinessCheck(ev, { a: { name: "A", imageUrls: img }, b: { name: "B" }, c: { name: "C", imageUrls: img } });
  assert.equal(res.items.find((i) => i.key === "works").ok, false, "圖片模式缺圖");
  res = readinessCheck({ ...ev, rules: { ...DEFAULT_RULES, showcase: "none" } }, { a: { name: "A" }, b: { name: "B" }, c: { name: "C" }, d: { name: "D", active: false } });
  assert.equal(res.ok, true);
});

test("進度文字", () => {
  assert.equal(selectionCounter(DEFAULT_RULES, 0), "已選擇 0 / 3 位");
  assert.equal(selectionCounter({ ...DEFAULT_RULES, allowRepeat: true }, 2), "已分配 2 / 3 票");
});

test("台北日期計算（跨 UTC 午夜）", () => {
  assert.equal(taipeiDateKey(Date.UTC(2026, 10, 18, 16, 30)), "2026-11-19"); // UTC 16:30 = 台北 00:30
  assert.equal(taipeiDateKey(Date.UTC(2026, 10, 18, 15, 59)), "2026-11-18");
});

test("規則摘要", () => {
  assert.equal(describeRules(DEFAULT_RULES).length, 8);
});

test("CSV：解析引號與換行、BOM、防公式注入", () => {
  const rows = parseCSV('﻿名稱,作品介紹\n"王,小明","第一行\n第二行"\n');
  assert.deepEqual(rows, [["名稱", "作品介紹"], ["王,小明", "第一行\n第二行"]]);
  assert.equal(safeCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(safeCell("+886"), "'+886");
  assert.ok(toCSV([["a"]]).startsWith("﻿"));
});

test("CSV 匯入候選人", () => {
  const { items, errors } = csvToCandidates("編號,名稱,作品名稱,圖片網址,是否參與\n01,第一組,海報A,https://x/1.jpg|javascript:alert(1),是\n02,,缺名,,是\n03,第三組,,,否\n");
  assert.equal(items.length, 2); assert.equal(errors.length, 1);
  assert.deepEqual(items[0].imageUrls, ["https://x/1.jpg"]);
  assert.equal(items[1].active, false);
});

import { slotsFor, taipeiDayNum, buildBallot, voteState, tallyBallots } from "../js/rules.js";

test("票位設定", () => {
  assert.deepEqual(slotsFor(3), { slots: { s0: "-", s1: "s0", s2: "s1" }, lastSlot: "s2" });
});

test("台北日序號跨午夜", () => {
  const a = taipeiDayNum(Date.UTC(2026, 10, 18, 15, 59)), b = taipeiDayNum(Date.UTC(2026, 10, 18, 16, 0));
  assert.equal(b - a, 1);
});

const C = { a: { name: "A" }, b: { name: "B" }, c: { name: "C" }, d: { name: "D", active: false } };
test("建立選票：不可重複、必須投滿", () => {
  assert.equal(buildBallot(DEFAULT_RULES, ["a", "b"], C, 1).ok, false);
  assert.equal(buildBallot(DEFAULT_RULES, ["a", "a", "b"], C, 1).ok, false);
  assert.equal(buildBallot(DEFAULT_RULES, ["a", "b", "d"], C, 1).ok, false, "不參與者");
  assert.equal(buildBallot(DEFAULT_RULES, ["a", "b", "c", "a"], C, 1).ok, false, "超額");
  const r = buildBallot(DEFAULT_RULES, ["c", "a", "b"], C, 7);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ballot, { dayNum: 7, slots: { s0: "c", s1: "a", s2: "b" }, picks: { c: "s0", a: "s1", b: "s2" } });
});

test("建立選票：可重複、可少投", () => {
  const R = { ...DEFAULT_RULES, allowRepeat: true, mustFill: false };
  const r = buildBallot(R, { a: 2 }, C, 1);
  assert.equal(r.ok, true); assert.deepEqual(r.ballot.slots, { s0: "a", s1: "a" }); assert.equal(r.ballot.picks, undefined);
  assert.equal(buildBallot({ ...R, mustFill: true }, { a: 2 }, C, 1).ok, false);
  assert.equal(buildBallot({ ...R, mustFill: true }, { a: 3 }, C, 1).ok, true);
});

test("投票次數判斷", () => {
  assert.equal(voteState(DEFAULT_RULES, null, 5).canVote, true);
  assert.equal(voteState(DEFAULT_RULES, { lastDay: 3 }, 5).canVote, false);
  const D = { ...DEFAULT_RULES, frequency: "daily" };
  assert.equal(voteState(D, { lastDay: 5 }, 5).canVote, false);
  assert.equal(voteState(D, { lastDay: 4 }, 5).canVote, true);
});

test("計票", () => {
  const t = tallyBallots({ u1: { b1: { dayNum: 1, slots: { s0: "a", s1: "b" } } }, u2: { b2: { dayNum: 1, slots: { s0: "a" } }, b3: { dayNum: 2, slots: { s0: "c" } } } });
  assert.equal(t.voters, 2); assert.equal(t.ballots, 3); assert.equal(t.votes, 4); assert.equal(t.totals.a, 2);
});
