import {
  aggregateTeam,
  rankTeams,
  teamScore,
  zScore,
  computeLeagueDistributions,
} from "../../../api/src/lib/analytics";

type Snapshot = {
  capturedAt: string;
  info: {
    leagueId: string;
    teamId: string;
    leagueName: string;
    teamName: string;
  };
  responses: Record<string, any>;
};
let snapshotPromise: Promise<Snapshot> | undefined;
export function loadDemoSnapshot(): Promise<Snapshot> {
  return (snapshotPromise ??= fetch("/demo/snapshot.json", {
    signal: AbortSignal.timeout(15000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Sample unavailable");
      return response.json();
    })
    .catch((error) => {
      snapshotPromise = undefined;
      throw error;
    }));
}
const cats = [
  "pts",
  "reb",
  "ast",
  "stl",
  "blk",
  "threes",
  "fgPct",
  "ftPct",
  "tov",
] as const;
export async function demoResponse(
  url: string,
  options?: RequestInit,
): Promise<unknown> {
  const snapshot = await loadDemoSnapshot();
  const parsed = new URL(url, window.location.origin);
  const root = `/leagues/${snapshot.info.leagueId}`;
  const responses = snapshot.responses;
  if (parsed.pathname === "/ingest/espn") return { ok: true };
  if (!parsed.pathname.startsWith(root))
    throw new Error("Connect your league to use live data.");
  if (parsed.pathname.endsWith("/streaming/impact")) {
    const body = JSON.parse(String(options?.body || "{}"));
    const overview =
      responses[`${root}/streaming/overview?teamId=${snapshot.info.teamId}`];
    const add = overview.freeAgents.find(
      (p: any) => p.playerId === body.addPlayerId,
    );
    const drop = overview.roster.find(
      (p: any) => p.playerId === body.dropPlayerId,
    );
    if (!add || !drop)
      throw new Error("Select an available player and a roster player.");
    const roster =
      responses[`${root}/teams/${snapshot.info.teamId}/roster/stats`].roster;
    const stats = (p: any) => {
      const own = roster.find((r: any) => r.id === p.playerId);
      const pg = p.projectedPerGame || p.perGame;
      const games = p.gamesThisWeek ?? p.gamesRemaining;
      const gp = Math.max(1, own?.stats.totals.gp || 1);
      return {
        ...p.projectedTotals,
        fgAttempts: own ? (own.stats.totals.fga / gp) * games : undefined,
        ftAttempts: own ? (own.stats.totals.fta / gp) * games : undefined,
        fgPct: pg.fgPct,
        ftPct: pg.ftPct,
      };
    };
    const before = aggregateTeam(overview.roster.map(stats));
    const after = aggregateTeam(
      [
        ...overview.roster.filter((p: any) => p.playerId !== drop.playerId),
        add,
      ].map(stats),
    );
    // Snapshot free agents have no attempts. Do not invent a percentage impact.
    after.fgPct = before.fgPct;
    after.ftPct = before.ftPct;
    return {
      status: "ok",
      before,
      after,
      deltas: Object.fromEntries(cats.map((c) => [c, after[c] - before[c]])),
      message:
        "Sample counting-stat impact. Shooting impact unavailable without free-agent attempt data.",
      matchupResultBefore: null,
      matchupResultAfter: null,
    };
  }
  const teamId = parsed.searchParams.get("teamId");
  const key = parsed.pathname + (teamId ? `?teamId=${teamId}` : "");
  if (parsed.pathname.endsWith("/trade-suggestions")) {
    const data = structuredClone(responses[parsed.pathname]);
    const untouchables = parsed.searchParams.getAll("untouchables");
    const size = parsed.searchParams.get("tradeSize");
    const grades = ["F", "D", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
    const minimum = grades.indexOf(
      parsed.searchParams.get("minOppGrade") || "F",
    );
    data.suggestions = data.suggestions.filter(
      (s: any) =>
        (!size || s.trade.type === size) &&
        grades.indexOf(s.impact.opp.grade) >= minimum &&
        !s.trade.send.some((p: any) => untouchables.includes(p.playerId)),
    );
    data.warning =
      "Archived sample proposals; connect a league for newly calculated trade grades.";
    return data;
  }
  if (parsed.pathname.endsWith("/profile")) {
    const data = structuredClone(responses[key]);
    const totals = Object.entries(responses)
      .filter(([k]) => k.endsWith("/profile"))
      .map(([, d]) => ({
        ...d.profile.rawTotals,
        teamId: d.profile.teamId,
        teamName: d.profile.teamName,
      }));
    const ranks = rankTeams(totals);
    const distribution = computeLeagueDistributions(totals);
    data.profile.categoryRank = ranks.get(data.profile.teamId);
    data.profile.zScores = zScore(data.profile.rawTotals, distribution);
    data.profile.normalizedTeamScore0to9 = teamScore(data.profile.zScores);
    data.leagueRanksSummary = totals.map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      ranks: ranks.get(t.teamId),
      teamScore: teamScore(zScore(t, distribution)),
    }));
    return data;
  }
  if (key in responses) return structuredClone(responses[key]);
  throw new Error(
    "This view is not included in the sample. Connect your league for live data.",
  );
}
