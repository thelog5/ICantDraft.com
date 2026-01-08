// Weekly projections helper functions

import { extractNineCatFromPlayerMeta } from "./playerStats.js";
import { extractInjuryInfo, calculateProjectedGamesThisWeek, type InjuryInfo } from "./injuryHelpers.js";

export type NineCatKey = "pts" | "reb" | "ast" | "stl" | "blk" | "threes" | "fgPct" | "ftPct" | "tov";

export type NineCatTotals = {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  threes: number;
  fgPct: number;
  ftPct: number;
  tov: number;
};

export type NineCatTotalsWithAttempts = NineCatTotals & {
  fga: number;
  fgm: number;
  fta: number;
  ftm: number;
};

export type WeeklyPlayerProjection = {
  playerId: string;
  playerName: string;
  perGame: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    fgPct: number;
    ftPct: number;
    tov: number;
  };
  projectedGames: number;
  projTotals: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    tov: number;
    fga: number;
    fgm: number;
    fta: number;
    ftm: number;
    fgPct: number;
    ftPct: number;
  };
  hasStats: boolean;
  isIR: boolean;
  status: string;
  injuryStatus: string;
  injuryDescription: string | null;
  estimatedReturnDate: string | null;
  perGameStatsSource: "CURRENT_SEASON" | "ESPN_PROJECTION" | "NONE";
};

export type WeeklyTeamProjection = {
  teamId: string;
  teamName: string;
  avatarUrl: string | null;
  projectedTotals: NineCatTotals;
  players: WeeklyPlayerProjection[];
};

/**
 * Calculate projected weekly totals for a team's roster
 */
export async function calculateTeamWeeklyProjection(
  rosterSlots: Array<{
    meta: any;
    slotLabel: string | null;
    player: { id: string; fullName: string; meta: any; providerPlayerId?: string | null };
  }>,
  seasonYear: number | null,
  defaultGamesPerWeek: number,
  scoringPeriodStartDate?: string,
  scoringPeriodEndDate?: string
): Promise<{
  totals: NineCatTotals;
  totalsWithAttempts: NineCatTotalsWithAttempts;
  players: WeeklyPlayerProjection[];
}> {
  const playerProjections: WeeklyPlayerProjection[] = [];

  for (const slot of rosterSlots) {
    const player = slot.player;
    const meta = (player.meta as any) || {};
    const slotMeta = (slot.meta as any) || {};
    const playerStats = extractNineCatFromPlayerMeta(meta, seasonYear);

    // Extract injury info
    const lineupSlotId = typeof slotMeta.lineupSlotId === "number" ? slotMeta.lineupSlotId : null;
    const injuryInfo = extractInjuryInfo(meta, lineupSlotId);

    const finalStatus = slotMeta.status || injuryInfo.status;
    const finalInjuryInfo: InjuryInfo = {
      status: finalStatus as InjuryInfo["status"],
      description: injuryInfo.description,
      estimatedReturnDate: injuryInfo.estimatedReturnDate,
    };

    // Calculate projected games
    const projectedGames = calculateProjectedGamesThisWeek(
      defaultGamesPerWeek,
      finalInjuryInfo,
      scoringPeriodStartDate,
      scoringPeriodEndDate
    );

    // Calculate projected totals = per-game * projected games
    const projTotals = {
      pts: playerStats.perGame.pts * projectedGames,
      reb: playerStats.perGame.reb * projectedGames,
      ast: playerStats.perGame.ast * projectedGames,
      stl: playerStats.perGame.stl * projectedGames,
      blk: playerStats.perGame.blk * projectedGames,
      threes: playerStats.perGame.threes * projectedGames,
      tov: playerStats.perGame.tov * projectedGames,
      // For percentages, we need to track attempts
      fga: (playerStats.totals.fga / Math.max(1, playerStats.totals.gp)) * projectedGames,
      fgm: (playerStats.totals.fgm / Math.max(1, playerStats.totals.gp)) * projectedGames,
      fta: (playerStats.totals.fta / Math.max(1, playerStats.totals.gp)) * projectedGames,
      ftm: (playerStats.totals.ftm / Math.max(1, playerStats.totals.gp)) * projectedGames,
      fgPct: playerStats.perGame.fgPct,
      ftPct: playerStats.perGame.ftPct,
    };

    playerProjections.push({
      playerId: player.id,
      playerName: player.fullName,
      perGame: playerStats.perGame,
      projectedGames,
      projTotals,
      hasStats: playerStats.hasStats,
      isIR: finalInjuryInfo.status === "IR" || finalInjuryInfo.status === "OUT",
      status: finalStatus,
      injuryStatus: finalInjuryInfo.status,
      injuryDescription: finalInjuryInfo.description,
      estimatedReturnDate: finalInjuryInfo.estimatedReturnDate,
      perGameStatsSource: playerStats.statsSource,
    });
  }

  // Sum projected totals (excluding players with projectedGames=0)
  const totals: NineCatTotals = {
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    threes: 0,
    tov: 0,
    fgPct: 0,
    ftPct: 0,
  };

  let totalFga = 0;
  let totalFgm = 0;
  let totalFta = 0;
  let totalFtm = 0;

  for (const proj of playerProjections) {
    // Only include players with stats and projectedGames > 0
    if (proj.hasStats && proj.projectedGames > 0) {
      totals.pts += proj.projTotals.pts;
      totals.reb += proj.projTotals.reb;
      totals.ast += proj.projTotals.ast;
      totals.stl += proj.projTotals.stl;
      totals.blk += proj.projTotals.blk;
      totals.threes += proj.projTotals.threes;
      totals.tov += proj.projTotals.tov;

      totalFga += proj.projTotals.fga;
      totalFgm += proj.projTotals.fgm;
      totalFta += proj.projTotals.fta;
      totalFtm += proj.projTotals.ftm;
    }
  }

  // Calculate attempt-weighted percentages
  totals.fgPct = totalFga > 0 ? totalFgm / totalFga : 0;
  totals.ftPct = totalFta > 0 ? totalFtm / totalFta : 0;

  // Runtime validation: Verify AST calculation matches expected sum
  const expectedAst = playerProjections
    .filter(p => p.hasStats && p.projectedGames > 0)
    .reduce((sum, p) => sum + p.projTotals.ast, 0);
  
  if (Math.abs(totals.ast - expectedAst) > 0.01) {
    console.warn(`[AST Validation] Mismatch detected: totals.ast=${totals.ast}, expected=${expectedAst}`);
  }

  const totalsWithAttempts: NineCatTotalsWithAttempts = {
    ...totals,
    fga: totalFga,
    fgm: totalFgm,
    fta: totalFta,
    ftm: totalFtm,
  };

  return { totals, totalsWithAttempts, players: playerProjections };
}

/**
 * Determine category winner between two teams
 */
export function determineCategoryWinner(
  key: NineCatKey,
  teamTotal: number,
  opponentTotal: number
): "TEAM" | "OPPONENT" | "TIE" {
  const isLowerBetter = key === "tov";
  const tolerance = 0.0001; // For floating point comparison

  if (isLowerBetter) {
    if (Math.abs(teamTotal - opponentTotal) < tolerance) return "TIE";
    return teamTotal < opponentTotal ? "TEAM" : "OPPONENT";
  } else {
    if (Math.abs(teamTotal - opponentTotal) < tolerance) return "TIE";
    return teamTotal > opponentTotal ? "TEAM" : "OPPONENT";
  }
}

/**
 * Calculate matchup results from team and opponent totals
 */
export function calculateMatchupResults(
  teamTotals: NineCatTotals,
  opponentTotals: NineCatTotals
): {
  categories: Array<{
    key: NineCatKey;
    teamTotal: number;
    opponentTotal: number;
    winner: "TEAM" | "OPPONENT" | "TIE";
  }>;
  projectedScore: { teamCatsWon: number; opponentCatsWon: number; tied: number };
  projectedFinalTotals: { team: NineCatTotals; opponent: NineCatTotals };
} {
  const categoryKeys: NineCatKey[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];

  const categories = categoryKeys.map((key) => {
    const teamTotal = teamTotals[key];
    const opponentTotal = opponentTotals[key];
    const winner = determineCategoryWinner(key, teamTotal, opponentTotal);
    return { key, teamTotal, opponentTotal, winner };
  });

  let teamCatsWon = 0;
  let opponentCatsWon = 0;
  let tied = 0;

  for (const cat of categories) {
    if (cat.winner === "TEAM") teamCatsWon++;
    else if (cat.winner === "OPPONENT") opponentCatsWon++;
    else tied++;
  }

  return {
    categories,
    projectedScore: { teamCatsWon, opponentCatsWon, tied },
    projectedFinalTotals: { team: teamTotals, opponent: opponentTotals },
  };
}

