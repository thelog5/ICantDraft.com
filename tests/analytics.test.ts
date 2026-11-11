import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateTeam,
  rankTeams,
  zScore,
  teamScore,
  computeLeagueDistributions,
} from "../apps/api/src/lib/analytics";
import { calculateTradeGrade } from "../apps/api/src/lib/tradeEngine";
const stats = {
  pts: 20,
  reb: 5,
  ast: 4,
  stl: 1,
  blk: 1,
  threes: 2,
  tov: 2,
  fgPct: 0.5,
  ftPct: 0.8,
};
test("shooting percentages are weighted by attempts, not player percentages", () => {
  const total = aggregateTeam([
    { ...stats, fgPct: 0.9, fgAttempts: 1, ftAttempts: 0 },
    { ...stats, fgPct: 0.4, fgAttempts: 9, ftPct: 0.75, ftAttempts: 4 },
  ]);
  assert.equal(total.fgPct, 0.45);
  assert.equal(total.ftPct, 0.75);
});
test("tied ranks are averaged and invariant to team order", () => {
  const teams = ["a", "b", "c"].map((teamId) => ({
    ...stats,
    teamId,
    teamName: teamId,
  }));
  for (const order of [teams, [...teams].reverse()])
    for (const rank of rankTeams(order).values()) assert.equal(rank.pts, 2);
});
test("zero variance is neutral; lower turnovers improve score", () => {
  const teams = [
    { ...stats, teamId: "a", teamName: "A" },
    { ...stats, tov: 4, teamId: "b", teamName: "B" },
  ];
  const d = computeLeagueDistributions(teams);
  assert.equal(zScore(teams[0], d).pts, 0);
  assert.ok(teamScore(zScore(teams[0], d)) > teamScore(zScore(teams[1], d)));
  assert.ok(
    Math.abs(teamScore(zScore(stats, computeLeagueDistributions([]))) - 4.5) <
      0.00001,
  );
});
test("trade grade uses category score without counting rank gain twice", () => {
  assert.equal(calculateTradeGrade(0.1, -8), calculateTradeGrade(0.1, 0));
  assert.equal(calculateTradeGrade(-0.1, -8), "F");
});

test('player fit is invariant to season length and unrelated team-total units', async () => {
  const { getPlayerRole } = await import('../apps/web/src/lib/playerRole');
  const roster = [1,2,3,4,5].map((id) => ({id:String(id),fullName:`Player ${id}`,stats:{perGame:{...stats,pts:10+id},totals:{gp:10,fga:100,fta:40}}}));
  const baseline = {...stats};
  const profile = {profile:{zScores:{...stats},categoryRank:{...stats}},leagueAverage:baseline,leagueRanksSummary:[]};
  const before = getPlayerRole(roster[0],profile,baseline,roster);
  const longer = roster.map(p=>({...p,stats:{...p.stats,totals:{gp:20,fga:200,fta:80}}}));
  const after = getPlayerRole(longer[0],profile,{...baseline,pts:10000},longer);
  assert.equal(before.score,after.score);
  assert.equal(before.label,after.label);
});
