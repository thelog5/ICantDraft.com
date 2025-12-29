// Player role calculation - TEAM-BUILD CENTRIC approach

export type PlayerRole = {
  label: string;
  color: "green" | "blue" | "yellow" | "red" | "gray";
  reason: string;
  score: number;
  hoverText?: string;
};

export type PlayerWithStats = {
  id: string;
  fullName: string;
  stats: {
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
    totals: {
      gp: number;
      fga: number;
      fta: number;
    };
  };
  derived?: {
    roleHint?: string | null;
  };
};

export type TeamProfile = {
  profile: {
    zScores: {
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
    categoryRank: {
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
  };
  leagueAverage: {
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
  leagueRanksSummary?: Array<{ teamId: string; teamName: string }>;
};

type CategoryKey = "pts" | "reb" | "ast" | "stl" | "blk" | "threes" | "fgPct" | "ftPct" | "tov";

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  pts: "PTS",
  reb: "REB",
  ast: "AST",
  stl: "STL",
  blk: "BLK",
  threes: "3PM",
  fgPct: "FG%",
  ftPct: "FT%",
  tov: "TO",
};

type PlayerScores = {
  player: PlayerWithStats;
  overallValueScore: number;
  teamFitScore: number;
  buildConflictScore: number;
};

/**
 * Calculates player role using team-build centric approach
 * Focuses on fit to team's build strategy, not just raw value
 */
export function getPlayerRole(
  player: PlayerWithStats,
  teamProfile: TeamProfile,
  leagueAverage: TeamProfile["leagueAverage"],
  allPlayers: PlayerWithStats[]
): PlayerRole {
  // Safety checks
  if (!player || !player.stats || !player.stats.totals) {
    return {
      label: "Low Impact",
      color: "gray",
      reason: "Missing stats",
      score: -100,
    };
  }

  if (!player.stats.totals.gp || player.stats.totals.gp < 3) {
    return {
      label: "Low Impact",
      color: "gray",
      reason: "Insufficient data",
      score: -100,
    };
  }

  if (!teamProfile || !teamProfile.profile || !teamProfile.profile.zScores || !teamProfile.profile.categoryRank) {
    return {
      label: "Roster Player",
      color: "blue",
      reason: "Profile data unavailable",
      score: 0,
    };
  }

  const leagueAvgPerGame = {
    pts: (leagueAverage.pts || 0) / 82,
    reb: (leagueAverage.reb || 0) / 82,
    ast: (leagueAverage.ast || 0) / 82,
    stl: (leagueAverage.stl || 0) / 82,
    blk: (leagueAverage.blk || 0) / 82,
    threes: (leagueAverage.threes || 0) / 82,
    tov: (leagueAverage.tov || 0) / 82,
    fgPct: leagueAverage.fgPct || 0,
    ftPct: leagueAverage.ftPct || 0,
  };

  // Identify team's focus categories (top 3-4 by z-score, excluding TOV)
  const teamFocusCategories: CategoryKey[] = Object.entries(teamProfile.profile.zScores)
    .map(([cat, zScore]) => ({ cat: cat as CategoryKey, zScore }))
    .filter(({ cat }) => cat !== "tov")
    .sort((a, b) => b.zScore - a.zScore)
    .slice(0, 4)
    .map(({ cat }) => cat);

  // Identify punt categories (bottom 2 by z-score, excluding TOV)
  const teamPuntCategories: CategoryKey[] = Object.entries(teamProfile.profile.zScores)
    .map(([cat, zScore]) => ({ cat: cat as CategoryKey, zScore }))
    .filter(({ cat }) => cat !== "tov")
    .sort((a, b) => a.zScore - b.zScore)
    .slice(0, 2)
    .map(({ cat }) => cat);

  // Calculate scores for all players
  const allPlayerScores: PlayerScores[] = allPlayers
    .filter((p) => p.stats.totals.gp >= 3)
    .map((p) => calculatePlayerScores(p, teamProfile, leagueAvgPerGame, teamFocusCategories, teamPuntCategories));

  const playerScores = calculatePlayerScores(player, teamProfile, leagueAvgPerGame, teamFocusCategories, teamPuntCategories);

  // Rank all players by each score
  const sortedByOverall = [...allPlayerScores].sort((a, b) => b.overallValueScore - a.overallValueScore);
  const sortedByFit = [...allPlayerScores].sort((a, b) => b.teamFitScore - a.teamFitScore);

  const totalRosterSize = allPlayerScores.length;

  // Calculate percentiles
  const top15Percentile = Math.max(1, Math.ceil(totalRosterSize * 0.15));
  const top25Percentile = Math.max(1, Math.ceil(totalRosterSize * 0.25));
  const top40Percentile = Math.max(1, Math.ceil(totalRosterSize * 0.4));
  const bottom30Percentile = Math.max(1, Math.floor(totalRosterSize * 0.7));
  const bottom40Percentile = Math.max(1, Math.floor(totalRosterSize * 0.6));

  // Get ranks for this player
  const overallRank = sortedByOverall.findIndex((s) => s.player.id === player.id) + 1;
  const fitRank = sortedByFit.findIndex((s) => s.player.id === player.id) + 1;

  // Check if player is top-3 contributor in any category
  const isTop3InAnyCategory = checkTop3InCategory(player, allPlayers, teamFocusCategories);

  // Classification rules (strict order)

  // 1. CORE PLAYER: Top 3 by teamFitScore OR Top 25% by teamFitScore OR (Top 15% overall AND low conflict)
  const coreCandidates = sortedByFit.slice(0, 3).map((s) => s.player.id);
  const top25Fit = sortedByFit.slice(0, top25Percentile).map((s) => s.player.id);
  const top15OverallLowConflict = sortedByOverall
    .slice(0, top15Percentile)
    .filter((s) => s.buildConflictScore < 0.2) // Low conflict threshold
    .map((s) => s.player.id);

  if (
    coreCandidates.includes(player.id) ||
    top25Fit.includes(player.id) ||
    (top15OverallLowConflict.includes(player.id) && playerScores.buildConflictScore < 0.2)
  ) {
    const focusLabels = teamFocusCategories.map((c) => CATEGORY_LABELS[c]).join("/");
    let reason = "";
    if (coreCandidates.includes(player.id)) {
      reason = `Top-3 fit to focus cats (${focusLabels})`;
    } else if (top25Fit.includes(player.id)) {
      reason = `Strong fit to ${focusLabels}`;
    } else {
      reason = "Elite value, low conflict";
    }

    return {
      label: "Core Player",
      color: "green",
      reason,
      score: playerScores.teamFitScore,
      hoverText: `Core contributor - excellent fit to team's build strategy`,
    };
  }

  // 2. TRADE CANDIDATE: Top 40% overall AND Bottom 40% fit AND high conflict
  // Cap to max 2 players
  const tradeCandidates = sortedByOverall
    .filter((s) => {
      const sOverallRank = sortedByOverall.findIndex((p) => p.player.id === s.player.id) + 1;
      const sFitRank = sortedByFit.findIndex((p) => p.player.id === s.player.id) + 1;
      return (
        sOverallRank <= top40Percentile &&
        sFitRank >= bottom40Percentile &&
        s.buildConflictScore > 0.3 // High conflict threshold
      );
    })
    .sort((a, b) => b.buildConflictScore - a.buildConflictScore)
    .slice(0, 2)
    .map((s) => s.player.id);

  if (tradeCandidates.includes(player.id)) {
    const focusLabels = teamFocusCategories.map((c) => CATEGORY_LABELS[c]).join("/");
    return {
      label: "Trade Candidate",
      color: "red",
      reason: `High value but conflicts with ${focusLabels}`,
      score: playerScores.overallValueScore,
      hoverText: `High-value player but weak fit to team's focus categories. Consider trading for better alignment.`,
    };
  }

  // 3. EXPENDABLE: Bottom 30% overall AND Bottom 30% fit AND not top-3 in any category
  const bottom30Overall = sortedByOverall.slice(bottom30Percentile - 1).map((s) => s.player.id);
  const bottom30Fit = sortedByFit.slice(bottom30Percentile - 1).map((s) => s.player.id);

  if (
    bottom30Overall.includes(player.id) &&
    bottom30Fit.includes(player.id) &&
    !isTop3InAnyCategory
  ) {
    return {
      label: "Expendable",
      color: "yellow",
      reason: "Low value and poor fit",
      score: playerScores.overallValueScore,
      hoverText: "Bottom tier in both overall value and team fit. Not a top contributor in any category.",
    };
  }

  // 4. ROSTER PLAYER: Default (everything else)
  // This is the protected bucket - most players should fall here
  const fitLabels = teamFocusCategories.map((c) => CATEGORY_LABELS[c]).join("/");
  let rosterReason = "Neutral fit";
  if (fitRank <= Math.ceil(totalRosterSize * 0.5)) {
    rosterReason = `Decent fit to ${fitLabels}`;
  } else if (overallRank <= Math.ceil(totalRosterSize * 0.5)) {
    rosterReason = "Solid overall value";
  }

  return {
    label: "Roster Player",
    color: "blue",
    reason: rosterReason,
    score: playerScores.teamFitScore,
    hoverText: `Balanced contributor - fits team needs adequately`,
  };
}

function calculatePlayerScores(
  player: PlayerWithStats,
  teamProfile: TeamProfile,
  leagueAvgPerGame: Record<CategoryKey, number>,
  teamFocusCategories: CategoryKey[],
  teamPuntCategories: CategoryKey[]
): PlayerScores {
  const perGame = player.stats.perGame;

  // 1. overallValueScore: Sum of all category impacts vs league average
  let overallValueScore = 0;
  for (const cat of Object.keys(perGame) as CategoryKey[]) {
    const playerValue = perGame[cat];
    const leagueAvg = leagueAvgPerGame[cat];

    if (cat === "tov") {
      const impact = (leagueAvg - playerValue) / Math.max(leagueAvg, 1);
      overallValueScore += impact;
    } else if (cat === "fgPct" || cat === "ftPct") {
      const attempts = cat === "fgPct" ? player.stats.totals.fga : player.stats.totals.fta;
      const impact = (playerValue - leagueAvg) * Math.min(attempts / 10, 2);
      overallValueScore += impact;
    } else {
      const impact = (playerValue - leagueAvg) / Math.max(leagueAvg, 1);
      overallValueScore += impact;
    }
  }

  // 2. teamFitScore: Weighted impact toward focus categories
  let teamFitScore = 0;
  for (const cat of teamFocusCategories) {
    const playerValue = perGame[cat];
    const leagueAvg = leagueAvgPerGame[cat];
    const teamZScore = teamProfile.profile.zScores[cat];
    const weight = Math.abs(teamZScore) + 1.0; // Higher weight for stronger team categories

    if (cat === "fgPct" || cat === "ftPct") {
      const attempts = cat === "fgPct" ? player.stats.totals.fga : player.stats.totals.fta;
      const impact = (playerValue - leagueAvg) * Math.min(attempts / 10, 2);
      teamFitScore += impact * weight;
    } else {
      const impact = (playerValue - leagueAvg) / Math.max(leagueAvg, 1);
      teamFitScore += impact * weight;
    }
  }

  // 3. buildConflictScore: Negative impact in focus categories (punt categories ignored)
  // Only counts when player is below team median in focus cats
  let buildConflictScore = 0;
  const teamMedians: Record<CategoryKey, number> = {} as Record<CategoryKey, number>;
  // Use league average as proxy for team median (could be improved)
  for (const cat of teamFocusCategories) {
    teamMedians[cat] = leagueAvgPerGame[cat];
  }

  for (const cat of teamFocusCategories) {
    // Skip punt categories - conflicts there don't matter
    if (teamPuntCategories.includes(cat)) continue;

    const playerValue = perGame[cat];
    const teamMedian = teamMedians[cat];
    const teamZScore = teamProfile.profile.zScores[cat];
    const weight = Math.abs(teamZScore) + 1.0;

    if (cat === "fgPct" || cat === "ftPct") {
      const attempts = cat === "fgPct" ? player.stats.totals.fga : player.stats.totals.fta;
      if (attempts > 0 && playerValue < teamMedian) {
        const conflict = (teamMedian - playerValue) * Math.min(attempts / 10, 2);
        buildConflictScore += conflict * weight;
      }
    } else {
      if (playerValue < teamMedian) {
        const conflict = (teamMedian - playerValue) / Math.max(teamMedian, 1);
        buildConflictScore += conflict * weight;
      }
    }
  }

  return {
    player,
    overallValueScore,
    teamFitScore,
    buildConflictScore,
  };
}

function checkTop3InCategory(
  player: PlayerWithStats,
  allPlayers: PlayerWithStats[],
  focusCategories: CategoryKey[]
): boolean {
  for (const cat of focusCategories) {
    const sorted = [...allPlayers]
      .filter((p) => p.stats.totals.gp >= 3)
      .map((p) => ({
        player: p,
        value: p.stats.perGame[cat],
      }))
      .sort((a, b) => b.value - a.value);

    const rank = sorted.findIndex((p) => p.player.id === player.id) + 1;
    if (rank <= 3) return true;
  }
  return false;
}
