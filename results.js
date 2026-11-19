// ============================================================
// 結果計算：排名、同票處理、前三名（金銀銅）
// 純函式，可於 Node 測試。
// 名次採「標準競賽排名」：並列者同名次，下一名次跳號（1,1,3）。
// ============================================================
import { normalizeRules, isActive, tallyBallots } from "./rules.js";

export const TIER = { 1: "gold", 2: "silver", 3: "bronze" };
export const TIER_LABEL = { gold: "金獎", silver: "銀獎", bronze: "銅獎" };
export const RANK_LABEL = { 1: "第一名", 2: "第二名", 3: "第三名" };

/** 依台北日序號轉為 YYYY-MM-DD */
export const dayNumToDate = (n) => new Date(Number(n) * 86400000).toISOString().slice(0, 10);

/**
 * @param event        活動資料（含 rules）
 * @param candidatesObj { cid: candidate }
 * @param ballotsObj   ballots/{eventId}
 * @param tieBreak     { judgeScores?: {cid:number}, runoffVotes?: {cid:number} }
 */
export function computeResults(event, candidatesObj = {}, ballotsObj = {}, tieBreak = {}) {
  const rules = normalizeRules(event?.rules);
  const tally = tallyBallots(ballotsObj);
  const secondaryKey = rules.tieRule === "judges" ? "judgeScores" : rules.tieRule === "runoff" ? "runoffVotes" : null;
  const secondary = (secondaryKey && tieBreak?.[secondaryKey]) || {};

  const rows = Object.entries(candidatesObj || {})
    .filter(([, c]) => isActive(c))
    .map(([cid, c]) => ({
      cid, code: c.code || "", name: c.name || "", members: c.members || "", workTitle: c.workTitle || "",
      votes: tally.totals[cid] || 0,
      secondary: Number.isFinite(Number(secondary[cid])) && secondary[cid] !== "" && secondary[cid] != null ? Number(secondary[cid]) : null
    }));

  // 比較：先比票數，再比次要依據（只在同票時使用）
  const cmp = (a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    if (secondaryKey && a.secondary != null && b.secondary != null && a.secondary !== b.secondary) return b.secondary - a.secondary;
    return 0;
  };
  rows.sort((a, b) => cmp(a, b) || String(a.code).localeCompare(String(b.code), "zh-Hant", { numeric: true }));

  const total = tally.votes;
  rows.forEach((r) => {
    r.rank = 1 + rows.filter((o) => cmp(o, r) < 0).length;
    r.pct = total ? r.votes / total : 0;
  });

  // 名次相同（並列）的群組
  const tiedRanks = {};
  rows.forEach((r) => { (tiedRanks[r.rank] ||= []).push(r.cid); });

  // 需要處理的同票：只看影響前三名的同票群組（票數相同且排名 ≤ 3）
  const unresolved = [];
  if (secondaryKey) {
    const byVotes = {};
    rows.forEach((r) => { if (r.votes > 0) (byVotes[r.votes] ||= []).push(r); });
    for (const group of Object.values(byVotes)) {
      if (group.length < 2) continue;
      const best = Math.min(...group.map((g) => 1 + rows.filter((o) => o.votes > g.votes).length));
      if (best > 3) continue;
      if (group.some((g) => g.secondary == null)) unresolved.push(group.map((g) => g.cid));
    }
  }

  // 前三名：得票 > 0 且名次 1–3
  const awards = { gold: [], silver: [], bronze: [] };
  rows.forEach((r) => { if (r.votes > 0 && r.rank <= 3) { r.award = TIER[r.rank]; awards[r.award].push(r.cid); } });

  return {
    rules, tieRule: rules.tieRule, ranking: rows, awards, tiedRanks, unresolved,
    stats: { voters: tally.voters, ballots: tally.ballots, votes: total, byDay: tally.byDay },
    totals: tally.totals
  };
}

/** 寫入 results/{eventId} 的資料（快照） */
export function resultSnapshot(res, tieBreak = {}) {
  return {
    ranking: res.ranking.map(({ cid, code, name, members, workTitle, votes, pct, rank, award, secondary }) =>
      ({ cid, code, name, members, workTitle, votes, pct: Math.round(pct * 10000) / 10000, rank, award: award || "", secondary: secondary ?? null })),
    awards: res.awards,
    stats: res.stats,
    tieRule: res.tieRule,
    tieBreak: tieBreak || {}
  };
}
