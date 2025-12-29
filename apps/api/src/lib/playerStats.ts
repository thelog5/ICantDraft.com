// Player-level stat extraction from ESPN player.meta

export type PlayerNineCatStats = {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  threes: number;
  fgPct: number; // 0..1
  ftPct: number; // 0..1
  tov: number;
};

export type PlayerStatsResult = {
  totals: PlayerNineCatStats & {
    fgm: number;
    fga: number;
    ftm: number;
    fta: number;
    gp: number; // games played
  };
  perGame: PlayerNineCatStats;
  hasStats: boolean;
  source?: {
    statSourceId: number;
    scoringPeriodId: number;
    statSplitTypeId: number | undefined;
  };
  statsSource: "CURRENT_SEASON" | "ESPN_PROJECTION" | "NONE";
};

export type StatsBlockCandidate = {
  block: any;
  statSourceId: number;
  scoringPeriodId: number;
  statSplitTypeId: number | undefined;
  score: number; // Higher = better match for season-to-date
};

/**
 * Selects ESPN projection stats block (statSourceId !== 0, typically 1)
 * Used as fallback when current season stats have 0 GP
 */
function selectProjectionStatsBlock(blocks: any[], seasonYear: number | null = null): StatsBlockCandidate | null {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null;
  }

  const candidates: StatsBlockCandidate[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    const statSourceId = typeof block.statSourceId === "number" ? block.statSourceId : -1;
    const scoringPeriodId = typeof block.scoringPeriodId === "number" ? block.scoringPeriodId : -1;
    const statSplitTypeId = typeof block.statSplitTypeId === "number" ? block.statSplitTypeId : undefined;
    const blockSeasonId = typeof block.seasonId === "number" ? block.seasonId : null;

    // Must be projections (statSourceId !== 0, typically 1)
    if (statSourceId === 0) continue;

    // Filter by seasonYear if provided
    if (seasonYear !== null && blockSeasonId !== null && blockSeasonId !== seasonYear) {
      continue;
    }

    // Must have stats object
    if (!block.stats || typeof block.stats !== "object") continue;

    // Score the candidate (higher = better)
    let score = 0;

    // Prefer scoringPeriodId === 0 (season projections)
    if (scoringPeriodId === 0) {
      score += 1000;
    } else if (scoringPeriodId > 0) {
      score += Math.max(0, 500 - scoringPeriodId);
    }

    // Prefer statSplitTypeId === 0 or undefined
    if (statSplitTypeId === 0 || statSplitTypeId === undefined) {
      score += 100;
    } else if (statSplitTypeId >= 1 && statSplitTypeId <= 10) {
      score -= 50 * statSplitTypeId;
    }

    candidates.push({
      block,
      statSourceId,
      scoringPeriodId,
      statSplitTypeId,
      score,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.scoringPeriodId - a.scoringPeriodId;
  });

  return candidates[0];
}

/**
 * Deterministic stats selector for season-to-date per-game numbers.
 * Selects from player.meta.stats[] the entry that matches:
 * - statSourceId === 0 (actuals, not projections)
 * - scoringPeriodId === 0 OR largest scoringPeriodId representing season-to-date totals
 * - statSplitTypeId corresponding to "season" (not last7, last15, matchup)
 * - seasonId matches the provided seasonYear (if seasonId field exists in block)
 * 
 * @param blocks - Array of stats blocks from player.meta.stats[]
 * @param seasonYear - The season year to filter by (e.g., 2026). If null, no season filtering is applied.
 */
function selectSeasonStatsBlock(blocks: any[], seasonYear: number | null = null): StatsBlockCandidate | null {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null;
  }

  const candidates: StatsBlockCandidate[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    const statSourceId = typeof block.statSourceId === "number" ? block.statSourceId : -1;
    const scoringPeriodId = typeof block.scoringPeriodId === "number" ? block.scoringPeriodId : -1;
    const statSplitTypeId = typeof block.statSplitTypeId === "number" ? block.statSplitTypeId : undefined;
    const blockSeasonId = typeof block.seasonId === "number" ? block.seasonId : null;

    // Must be actual stats (not projections)
    if (statSourceId !== 0) continue;

    // If seasonYear is provided, filter by seasonId if it exists in the block
    // ESPN's seasonId format: 2025 = 2024-25 season, 2026 = 2025-26 season, etc.
    // We need to match: if seasonYear is 2026, we want seasonId 2026
    if (seasonYear !== null) {
      if (blockSeasonId !== null) {
        // Block has seasonId, must match
        if (blockSeasonId !== seasonYear) {
          continue;
        }
      }
      // If block doesn't have seasonId, we can't filter by it, so we include it
      // (This handles cases where ESPN doesn't include seasonId in older data)
    }

    // Must have stats object
    if (!block.stats || typeof block.stats !== "object") continue;

    // Score the candidate (higher = better)
    let score = 0;

    // Prefer scoringPeriodId === 0 (season totals)
    if (scoringPeriodId === 0) {
      score += 1000;
    } else if (scoringPeriodId > 0) {
      // For non-zero, prefer larger IDs (likely season-to-date cumulative)
      // But penalize very large IDs (likely current matchup period)
      score += Math.max(0, 500 - scoringPeriodId);
    }

    // Prefer statSplitTypeId === 0 or undefined (overall/season, not splits)
    if (statSplitTypeId === 0 || statSplitTypeId === undefined) {
      score += 100;
    } else {
      // Penalize known split types (last7, last15, matchup)
      // Common split IDs: 1 = last7, 2 = last15, 3 = matchup, etc.
      if (statSplitTypeId >= 1 && statSplitTypeId <= 10) {
        score -= 50 * statSplitTypeId;
      }
    }

    candidates.push({
      block,
      statSourceId,
      scoringPeriodId,
      statSplitTypeId,
      score,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort by score (highest first), then by scoringPeriodId (largest first for non-zero)
  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // If scores are equal, prefer larger scoringPeriodId (more recent season-to-date)
    return b.scoringPeriodId - a.scoringPeriodId;
  });

  return candidates[0];
}

/**
 * Extracts games played from a stats block.
 * ESPN stores games played in various places:
 * - Field "42" in stats object
 * - averageStats object
 * - appliedTotal fields
 * - Can infer from minutes (field "28") if we have reasonable assumptions
 */
function extractGamesPlayed(block: any, stats: any): number {
  // Try explicit games played field (ESPN field "42")
  const gpFromStats = typeof stats?.["42"] === "number" && Number.isFinite(stats["42"]) ? stats["42"] : 0;
  if (gpFromStats > 0) {
    return gpFromStats;
  }

  // Try averageStats
  const avgStats = block?.averageStats;
  if (avgStats && typeof avgStats === "object") {
    const gpFromAvg = typeof avgStats["42"] === "number" && Number.isFinite(avgStats["42"]) ? avgStats["42"] : 0;
    if (gpFromAvg > 0) {
      return gpFromAvg;
    }
  }

  // Try appliedTotal (ESPN sometimes stores GP here)
  const appliedTotal = block?.appliedTotal;
  if (appliedTotal && typeof appliedTotal === "object") {
    const gpFromApplied = typeof appliedTotal["42"] === "number" && Number.isFinite(appliedTotal["42"]) ? appliedTotal["42"] : 0;
    if (gpFromApplied > 0) {
      return gpFromApplied;
    }
  }

  // Try statsApplied (array of stat applications)
  const statsApplied = block?.statsApplied;
  if (Array.isArray(statsApplied) && statsApplied.length > 0) {
    // Count unique periods or use length as proxy
    // This is less reliable but better than nothing
    return statsApplied.length;
  }

  // Last resort: infer from minutes if we have significant stats
  const minutes = typeof stats?.["28"] === "number" && Number.isFinite(stats["28"]) ? stats["28"] : 0;
  const hasSignificantStats = 
    (typeof stats?.["0"] === "number" && stats["0"] > 0) || // points
    (typeof stats?.["6"] === "number" && stats["6"] > 0) || // rebounds
    (typeof stats?.["4"] === "number" && stats["4"] > 0);   // assists

  if (hasSignificantStats && minutes > 0) {
    // Very rough estimate: assume average player plays ~25-30 MPG
    // This is a fallback and should be logged as uncertain
    const estimatedGP = Math.max(1, Math.round(minutes / 28));
    return estimatedGP;
  }

  // If we have any stats at all, assume at least 1 game
  if (hasSignificantStats) {
    return 1;
  }

  return 0;
}

/**
 * Extracts 9-category stats from ESPN player meta
 * Returns both totals and per-game averages with source metadata
 * 
 * @param meta - Player meta object from database
 * @param seasonYear - The season year to filter stats by (e.g., 2026). If null, no season filtering is applied.
 */
export function extractNineCatFromPlayerMeta(meta: any, seasonYear: number | null = null): PlayerStatsResult {
  const ZERO: PlayerNineCatStats = {
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    threes: 0,
    fgPct: 0,
    ftPct: 0,
    tov: 0,
  };

  // Try ESPN stats[] array format
  const blocks: any[] = Array.isArray(meta?.stats) ? meta.stats : [];

  if (blocks.length === 0) {
    return {
      totals: { ...ZERO, fgm: 0, fga: 0, ftm: 0, fta: 0, gp: 0 },
      perGame: { ...ZERO },
      hasStats: false,
      statsSource: "NONE",
    };
  }

  // Use deterministic selector to find the best season-to-date stats block
  // Filter by seasonYear if provided
  let selectedCandidate = selectSeasonStatsBlock(blocks, seasonYear);
  let statsSource: "CURRENT_SEASON" | "ESPN_PROJECTION" | "NONE" = "CURRENT_SEASON";

  // If no current season stats found, try to use ESPN projections
  if (!selectedCandidate) {
    selectedCandidate = selectProjectionStatsBlock(blocks, seasonYear);
    if (selectedCandidate) {
      statsSource = "ESPN_PROJECTION";
    } else {
      return {
        totals: { ...ZERO, fgm: 0, fga: 0, ftm: 0, fta: 0, gp: 0 },
        perGame: { ...ZERO },
        hasStats: false,
        statsSource: "NONE",
      };
    }
  }

  let selectedBlock = selectedCandidate.block;
  let st = selectedBlock?.stats;

  if (!st || typeof st !== "object") {
    return {
      totals: { ...ZERO, fgm: 0, fga: 0, ftm: 0, fta: 0, gp: 0 },
      perGame: { ...ZERO },
      hasStats: false,
      statsSource: "NONE",
    };
  }

  const get = (k: string): number => {
    const v = st[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };

  // ESPN stat key mapping (from analytics.ts)
  let pts = get("0");
  let stl = get("1");
  let blk = get("2");
  let threes = get("3");
  let ast = get("4");
  let reb = get("6");
  let tov = get("11");
  let fgm = get("13");
  let fga = get("14");
  let ftm = get("15");
  let fta = get("16");

  // Extract games played using comprehensive method
  let gp = extractGamesPlayed(selectedBlock, st);
  
  // If current season stats have 0 GP, fall back to ESPN projections
  if (statsSource === "CURRENT_SEASON" && gp === 0) {
    const projectionCandidate = selectProjectionStatsBlock(blocks, seasonYear);
    if (projectionCandidate) {
      // Switch to using projections
      selectedCandidate = projectionCandidate;
      statsSource = "ESPN_PROJECTION";
      selectedBlock = projectionCandidate.block;
      st = selectedBlock?.stats;
      
      if (st && typeof st === "object") {
        // Re-extract stats from projection block
        const getProj = (k: string): number => {
          const v = st[k];
          return typeof v === "number" && Number.isFinite(v) ? v : 0;
        };
        
        pts = getProj("0");
        stl = getProj("1");
        blk = getProj("2");
        threes = getProj("3");
        ast = getProj("4");
        reb = getProj("6");
        tov = getProj("11");
        fgm = getProj("13");
        fga = getProj("14");
        ftm = getProj("15");
        fta = getProj("16");
        
        // Try to extract GP from projections
        gp = extractGamesPlayed(selectedBlock, st);
      }
    }
  }
  
  // Calculate percentages (guard divide-by-zero)
  const fgPct = fga > 0 ? fgm / fga : 0;
  const ftPct = fta > 0 ? ftm / fta : 0;
  
  // If using projections and GP is still 0, check if projections provide per-game stats directly
  if (statsSource === "ESPN_PROJECTION" && gp === 0) {
    const avgStats = selectedBlock?.averageStats;
    if (avgStats && typeof avgStats === "object") {
      // If we have per-game projections, we can use them directly
      // Set GP to 1 so we don't divide by zero, but mark as projection source
      gp = 1;
    }
  }

  const totals: PlayerNineCatStats & { fgm: number; fga: number; ftm: number; fta: number; gp: number } = {
    pts,
    reb,
    ast,
    stl,
    blk,
    threes,
    tov,
    fgPct: Math.max(0, Math.min(1, fgPct)),
    ftPct: Math.max(0, Math.min(1, ftPct)),
    fgm,
    fga,
    ftm,
    fta,
    gp: Math.max(1, gp), // At least 1 to avoid divide-by-zero
  };

  // For projections with 0 GP, check if averageStats has per-game values
  let perGame: PlayerNineCatStats;
  if (statsSource === "ESPN_PROJECTION" && gp === 1 && totals.gp === 1) {
    const avgStats = selectedBlock?.averageStats;
    if (avgStats && typeof avgStats === "object") {
      const getAvg = (k: string): number => {
        const v = avgStats[k];
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      };
      
      // Try to get per-game stats directly from averageStats
      const avgPts = getAvg("0");
      const avgReb = getAvg("6");
      const avgAst = getAvg("4");
      const avgStl = getAvg("1");
      const avgBlk = getAvg("2");
      const avgThrees = getAvg("3");
      const avgTov = getAvg("11");
      
      // If we have per-game stats in averageStats, use them
      if (avgPts > 0 || avgReb > 0 || avgAst > 0) {
        const avgFgm = getAvg("13");
        const avgFga = getAvg("14");
        const avgFtm = getAvg("15");
        const avgFta = getAvg("16");
        const avgFgPct = avgFga > 0 ? avgFgm / avgFga : 0;
        const avgFtPct = avgFta > 0 ? avgFtm / avgFta : 0;
        
        perGame = {
          pts: avgPts,
          reb: avgReb,
          ast: avgAst,
          stl: avgStl,
          blk: avgBlk,
          threes: avgThrees,
          tov: avgTov,
          fgPct: Math.max(0, Math.min(1, avgFgPct)),
          ftPct: Math.max(0, Math.min(1, avgFtPct)),
        };
      } else {
        // Fall back to dividing totals by GP
        perGame = {
          pts: totals.gp > 0 ? pts / totals.gp : 0,
          reb: totals.gp > 0 ? reb / totals.gp : 0,
          ast: totals.gp > 0 ? ast / totals.gp : 0,
          stl: totals.gp > 0 ? stl / totals.gp : 0,
          blk: totals.gp > 0 ? blk / totals.gp : 0,
          threes: totals.gp > 0 ? threes / totals.gp : 0,
          tov: totals.gp > 0 ? tov / totals.gp : 0,
          fgPct: totals.fgPct,
          ftPct: totals.ftPct,
        };
      }
    } else {
      // No averageStats, divide totals by GP
      perGame = {
        pts: totals.gp > 0 ? pts / totals.gp : 0,
        reb: totals.gp > 0 ? reb / totals.gp : 0,
        ast: totals.gp > 0 ? ast / totals.gp : 0,
        stl: totals.gp > 0 ? stl / totals.gp : 0,
        blk: totals.gp > 0 ? blk / totals.gp : 0,
        threes: totals.gp > 0 ? threes / totals.gp : 0,
        tov: totals.gp > 0 ? tov / totals.gp : 0,
        fgPct: totals.fgPct,
        ftPct: totals.ftPct,
      };
    }
  } else {
    // Calculate per-game averages (totals / games played)
    // Note: percentages don't need division
    perGame = {
      pts: totals.gp > 0 ? pts / totals.gp : 0,
      reb: totals.gp > 0 ? reb / totals.gp : 0,
      ast: totals.gp > 0 ? ast / totals.gp : 0,
      stl: totals.gp > 0 ? stl / totals.gp : 0,
      blk: totals.gp > 0 ? blk / totals.gp : 0,
      threes: totals.gp > 0 ? threes / totals.gp : 0,
      tov: totals.gp > 0 ? tov / totals.gp : 0,
      fgPct: totals.fgPct, // Percentage doesn't change per-game
      ftPct: totals.ftPct,
    };
  }

  const hasStats = pts || reb || ast || stl || blk || threes || tov || fga || fta;

  return {
    totals,
    perGame,
    hasStats: !!hasStats,
    source: {
      statSourceId: selectedCandidate.statSourceId,
      scoringPeriodId: selectedCandidate.scoringPeriodId,
      statSplitTypeId: selectedCandidate.statSplitTypeId,
    },
    statsSource,
  };
}

/**
 * Returns debug information about stats selection for a player
 * 
 * @param meta - Player meta object from database
 * @param seasonYear - The season year to filter stats by (e.g., 2026). If null, no season filtering is applied.
 */
export function getStatsDebugInfo(meta: any, seasonYear: number | null = null): {
  selected: StatsBlockCandidate | null;
  candidates: StatsBlockCandidate[];
  allBlocks: Array<{
    statSourceId: number;
    scoringPeriodId: number;
    statSplitTypeId: number | undefined;
    hasStats: boolean;
  }>;
} {
  const blocks: any[] = Array.isArray(meta?.stats) ? meta.stats : [];

  const allBlocks = blocks.map((block) => ({
    statSourceId: typeof block?.statSourceId === "number" ? block.statSourceId : -1,
    scoringPeriodId: typeof block?.scoringPeriodId === "number" ? block.scoringPeriodId : -1,
    statSplitTypeId: typeof block?.statSplitTypeId === "number" ? block.statSplitTypeId : undefined,
    hasStats: !!(block?.stats && typeof block.stats === "object"),
  }));

  const selectedCandidate = selectSeasonStatsBlock(blocks, seasonYear);
  const candidates = blocks
    .map((block) => {
      if (!block || typeof block !== "object") return null;
      const statSourceId = typeof block.statSourceId === "number" ? block.statSourceId : -1;
      const scoringPeriodId = typeof block.scoringPeriodId === "number" ? block.scoringPeriodId : -1;
      const statSplitTypeId = typeof block.statSplitTypeId === "number" ? block.statSplitTypeId : undefined;
      const blockSeasonId = typeof block.seasonId === "number" ? block.seasonId : null;
      
      // Must be actual stats (not projections)
      if (statSourceId !== 0 || !block.stats || typeof block.stats !== "object") return null;
      
      // Filter by seasonYear if provided
      if (seasonYear !== null && blockSeasonId !== null && blockSeasonId !== seasonYear) {
        return null;
      }

      let score = 0;
      if (scoringPeriodId === 0) {
        score += 1000;
      } else if (scoringPeriodId > 0) {
        score += Math.max(0, 500 - scoringPeriodId);
      }
      if (statSplitTypeId === 0 || statSplitTypeId === undefined) {
        score += 100;
      } else if (statSplitTypeId >= 1 && statSplitTypeId <= 10) {
        score -= 50 * statSplitTypeId;
      }

      return {
        block,
        statSourceId,
        scoringPeriodId,
        statSplitTypeId,
        score,
      };
    })
    .filter((c): c is StatsBlockCandidate => c !== null)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.scoringPeriodId - a.scoringPeriodId;
    })
    .slice(0, 3); // Top 3 candidates

  return {
    selected: selectedCandidate,
    candidates,
    allBlocks,
  };
}

