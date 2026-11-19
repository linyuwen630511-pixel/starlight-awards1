import test from "node:test";
import assert from "node:assert/strict";
import { computeResults, dayNumToDate } from "../js/results.js";
import { DEFAULT_RULES } from "../js/rules.js";

const C = { a: { name: "A", code: "01" }, b: { name: "B", code: "02" }, c: { name: "C", code: "03" }, d: { name: "D", code: "04" }, e: { name: "E", code: "05" } };
const ballot = (...ids) => ({ dayNum: 1, slots: Object.fromEntries(ids.map((x, i) => [`s${i}`, x])) });
// a:3 b:2 c:2 d:1 e:0
const B = { u1: { x: ballot("a", "b", "c") }, u2: { x: ballot("a", "b", "d") }, u3: { x: ballot("a", "c") } };

test("排名與比例", () => {
  const r = computeResults({ rules: DEFAULT_RULES }, C, B);
  assert.deepEqual(r.ranking.map((x) => [x.cid, x.votes, x.rank]), [["a", 3, 1], ["b", 2, 2], ["c", 2, 2], ["d", 1, 4], ["e", 0, 5]]);
  assert.equal(r.stats.votes, 8); assert.equal(r.ranking[0].pct, 3 / 8);
});

test("同票並列：兩位銀獎、銅獎從缺", () => {
  const r = computeResults({ rules: DEFAULT_RULES }, C, B);
  assert.deepEqual(r.awards, { gold: ["a"], silver: ["b", "c"], bronze: [] });
  assert.equal(r.unresolved.length, 0);
});

test("評審分數決定同票名次", () => {
  const ev = { rules: { ...DEFAULT_RULES, tieRule: "judges" } };
  let r = computeResults(ev, C, B);
  assert.deepEqual(r.unresolved, [["b", "c"]], "缺分數需處理");
  r = computeResults(ev, C, B, { judgeScores: { b: 80, c: 90 } });
  assert.deepEqual(r.awards, { gold: ["a"], silver: ["c"], bronze: ["b"] });
  r = computeResults(ev, C, B, { judgeScores: { b: 85, c: 85 } });
  assert.deepEqual(r.awards.silver, ["b", "c"], "分數仍相同則並列，不隨機");
});

test("加賽票數決定同票名次", () => {
  const r = computeResults({ rules: { ...DEFAULT_RULES, tieRule: "runoff" } }, C, B, { runoffVotes: { b: 10, c: 4 } });
  assert.deepEqual(r.awards, { gold: ["a"], silver: ["b"], bronze: ["c"] });
});

test("0 票不得獎、不參與者不列入", () => {
  const r = computeResults({ rules: DEFAULT_RULES }, { ...C, d: { name: "D", active: false } }, { u: { x: ballot("a") } });
  assert.deepEqual(r.awards, { gold: ["a"], silver: [], bronze: [] });
  assert.equal(r.ranking.find((x) => x.cid === "d"), undefined);
});

test("日期轉換", () => { assert.equal(dayNumToDate(20776), "2026-11-19"); });
