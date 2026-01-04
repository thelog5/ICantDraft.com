// Deterministic 9-cat fantasy basketball analytics (no LLM, pure math)

export type NineCatStats = {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number;
    fgPct: number; // 0..1
    ftPct: number; // 0..1
    tov: number;   // lower is better
    fgAttempts?: number;
    ftAttempts?: number;
  };
  
  export type TeamTotals = NineCatStats & { teamId: string; teamName: string };
  
  export type LeagueDistribution = {
    mean: NineCatStats;
    std: NineCatStats;
  };
  
  export type CategoryRanks = {
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
  
  export type TeamProfile = {
    teamId: string;
    teamName: string;
    rawTotals: NineCatStats;
    zScores: NineCatStats;
    categoryRank: CategoryRanks;
    normalizedTeamScore0to9: number;
    meta: {
      leagueId: string;
      teamId: string;
      computedAt: string;
      stats_missing: boolean;
    };
  };
  
  const ZERO_STATS: NineCatStats = {
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
  
  export function extractPlayerStats(
    playerMeta: any,
    seasonYear: number | null = null
  ): { stats: NineCatStats; missing: boolean } {
  
    // ─────────────────────────────────────────────
    // 1️⃣ SIMPLE SHAPE (if you ever store normalized stats)
    // ─────────────────────────────────────────────
    const simple = playerMeta?.stats;
    if (simple && typeof simple === "object" && !Array.isArray(simple)) {
      const num = (v: any) =>
        typeof v === "number" && Number.isFinite(v) ? v : 0;
  
      const pts = num(simple.pts ?? simple.points);
      const reb = num(simple.reb ?? simple.rebounds);
      const ast = num(simple.ast ?? simple.assists);
      const stl = num(simple.stl ?? simple.steals);
      const blk = num(simple.blk ?? simple.blocks);
      const threes = num(simple.threes ?? simple["3pm"]);
      const tov = num(simple.tov ?? simple.turnovers);
  
      const fgAttempts = num(simple.fgAttempts ?? simple.fga);
      const ftAttempts = num(simple.ftAttempts ?? simple.fta);
  
      let fgPct = num(simple.fgPct);
      let ftPct = num(simple.ftPct);
  
      if (!fgPct && fgAttempts > 0) {
        fgPct = num(simple.fgMade ?? simple.fgm) / fgAttempts;
      }
      if (!ftPct && ftAttempts > 0) {
        ftPct = num(simple.ftMade ?? simple.ftm) / ftAttempts;
      }
  
      const hasAny = pts || reb || ast || stl || blk || threes || tov;
  
      const base: NineCatStats = {
        pts,
        reb,
        ast,
        stl,
        blk,
        threes,
        tov,
        fgPct: Math.max(0, Math.min(1, fgPct)),
        ftPct: Math.max(0, Math.min(1, ftPct)),
      };
  
      return {
        stats: {
          ...base,
          ...(fgAttempts > 0 ? { fgAttempts } : {}),
          ...(ftAttempts > 0 ? { ftAttempts } : {}),
        },
        missing: !hasAny,
      };
    }
  
    // ─────────────────────────────────────────────
    // 2️⃣ ESPN SHAPE (stats[] blocks)
    // ─────────────────────────────────────────────
    const blocks: any[] = Array.isArray(playerMeta?.stats)
      ? playerMeta.stats
      : [];
  
    if (blocks.length === 0) {
      return { stats: { ...ZERO_STATS }, missing: true };
    }
  
    // Season totals - filter by seasonYear if provided
    const seasonTotal = blocks.find(
      (b) => {
        // Must match basic criteria
        if (
          b?.scoringPeriodId !== 0 ||
          b?.statSourceId !== 0 ||
          (b?.statSplitTypeId !== 0 && b?.statSplitTypeId !== undefined)
        ) {
          return false;
        }
        
        // If seasonYear is provided, filter by seasonId if it exists in the block
        if (seasonYear !== null) {
          const blockSeasonId = typeof b?.seasonId === "number" ? b.seasonId : null;
          if (blockSeasonId !== null && blockSeasonId !== seasonYear) {
            return false;
          }
        }
        
        return true;
      }
    );
  
    const st = seasonTotal?.stats;
    if (!st || typeof st !== "object") {
      return { stats: { ...ZERO_STATS }, missing: true };
    }
  
    const get = (k: string) =>
      typeof st[k] === "number" && Number.isFinite(st[k]) ? st[k] : 0;
  
    // ESPN stat keys → 9-cat
    const pts = get("0");
    const stl = get("1");
    const blk = get("2");
    const threes = get("3");
    const ast = get("4");
    const reb = get("6");
    const tov = get("11");
  
    const fgm = get("13");
    const fga = get("14");
    const ftm = get("15");
    const fta = get("16");
  
    const fgPct = fga > 0 ? fgm / fga : 0;
    const ftPct = fta > 0 ? ftm / fta : 0;
  
    const hasCounting = pts || reb || ast || stl || blk || threes || tov;
    const hasAttempts = fga || fta;
  
    const base: NineCatStats = {
      pts,
      reb,
      ast,
      stl,
      blk,
      threes,
      tov,
      fgPct: Math.max(0, Math.min(1, fgPct)),
      ftPct: Math.max(0, Math.min(1, ftPct)),
    };
  
    return {
      stats: {
        ...base,
        ...(fga > 0 ? { fgAttempts: fga } : {}),
        ...(fta > 0 ? { ftAttempts: fta } : {}),
      },
      missing: !hasCounting && !hasAttempts,
    };
  }
  
  // ─────────────────────────────────────────────
  // TEAM AGGREGATION
  // ─────────────────────────────────────────────
  export function aggregateTeam(players: NineCatStats[]): NineCatStats {
    if (players.length === 0) return { ...ZERO_STATS };
  
    const sum = (k: keyof NineCatStats) =>
      players.reduce((a, p) => a + (p[k] ?? 0), 0);
  
    const pts = sum("pts");
    const reb = sum("reb");
    const ast = sum("ast");
    const stl = sum("stl");
    const blk = sum("blk");
    const threes = sum("threes");
    const tov = sum("tov");
  
    const fgAtt = players.reduce((a, p) => a + (p.fgAttempts ?? 0), 0);
    const ftAtt = players.reduce((a, p) => a + (p.ftAttempts ?? 0), 0);
  
    const fgPct =
      fgAtt > 0
        ? players.reduce((a, p) => a + p.fgPct * (p.fgAttempts ?? 0), 0) / fgAtt
        : 0;
  
    const ftPct =
      ftAtt > 0
        ? players.reduce((a, p) => a + p.ftPct * (p.ftAttempts ?? 0), 0) / ftAtt
        : 0;
  
    return {
      pts,
      reb,
      ast,
      stl,
      blk,
      threes,
      tov,
      fgPct,
      ftPct,
      fgAttempts: fgAtt,
      ftAttempts: ftAtt,
    };
  }
  
  // ─────────────────────────────────────────────
  // LEAGUE DISTRIBUTIONS
  // ─────────────────────────────────────────────
  export function computeLeagueDistributions(
    teams: TeamTotals[]
  ): LeagueDistribution {
    const n = teams.length;
    if (n === 0) return { mean: { ...ZERO_STATS }, std: { ...ZERO_STATS } };
  
    const mean = {
      pts: teams.reduce((a, t) => a + t.pts, 0) / n,
      reb: teams.reduce((a, t) => a + t.reb, 0) / n,
      ast: teams.reduce((a, t) => a + t.ast, 0) / n,
      stl: teams.reduce((a, t) => a + t.stl, 0) / n,
      blk: teams.reduce((a, t) => a + t.blk, 0) / n,
      threes: teams.reduce((a, t) => a + t.threes, 0) / n,
      fgPct: teams.reduce((a, t) => a + t.fgPct, 0) / n,
      ftPct: teams.reduce((a, t) => a + t.ftPct, 0) / n,
      tov: teams.reduce((a, t) => a + t.tov, 0) / n,
    };
  
    const variance = (vals: number[], m: number) =>
      vals.length <= 1
        ? 0
        : vals.reduce((a, v) => a + (v - m) ** 2, 0) / (vals.length - 1);
  
    const std = {
      pts: Math.sqrt(variance(teams.map((t) => t.pts), mean.pts)),
      reb: Math.sqrt(variance(teams.map((t) => t.reb), mean.reb)),
      ast: Math.sqrt(variance(teams.map((t) => t.ast), mean.ast)),
      stl: Math.sqrt(variance(teams.map((t) => t.stl), mean.stl)),
      blk: Math.sqrt(variance(teams.map((t) => t.blk), mean.blk)),
      threes: Math.sqrt(variance(teams.map((t) => t.threes), mean.threes)),
      fgPct: Math.sqrt(variance(teams.map((t) => t.fgPct), mean.fgPct)),
      ftPct: Math.sqrt(variance(teams.map((t) => t.ftPct), mean.ftPct)),
      tov: Math.sqrt(variance(teams.map((t) => t.tov), mean.tov)),
    };
  
    return { mean, std };
  }
  
  // ─────────────────────────────────────────────
  // Z-SCORES, RANKS, TEAM SCORE
  // ─────────────────────────────────────────────
  export function zScore(
    t: NineCatStats,
    d: LeagueDistribution
  ): NineCatStats {
    const z = (v: number, m: number, s: number) =>
      s === 0 ? 0 : (v - m) / s;
  
    return {
      pts: z(t.pts, d.mean.pts, d.std.pts),
      reb: z(t.reb, d.mean.reb, d.std.reb),
      ast: z(t.ast, d.mean.ast, d.std.ast),
      stl: z(t.stl, d.mean.stl, d.std.stl),
      blk: z(t.blk, d.mean.blk, d.std.blk),
      threes: z(t.threes, d.mean.threes, d.std.threes),
      fgPct: z(t.fgPct, d.mean.fgPct, d.std.fgPct),
      ftPct: z(t.ftPct, d.mean.ftPct, d.std.ftPct),
      tov: z(t.tov, d.mean.tov, d.std.tov),
    };
  }
  
  export function rankTeams(
    teams: TeamTotals[]
  ): Map<string, CategoryRanks> {
    const ranks = new Map<string, CategoryRanks>();
    const cats: (keyof CategoryRanks)[] = [
      "pts",
      "reb",
      "ast",
      "stl",
      "blk",
      "threes",
      "fgPct",
      "ftPct",
      "tov",
    ];
  
    for (const c of cats) {
      const inv = c === "tov";
      [...teams]
        .sort((a, b) => (inv ? a[c] - b[c] : b[c] - a[c]))
        .forEach((t, i) => {
          const r =
            ranks.get(t.teamId) ??
            { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, fgPct: 0, ftPct: 0, tov: 0 };
          r[c] = i + 1;
          ranks.set(t.teamId, r);
        });
    }
  
    return ranks;
  }
  
  function normalCdf(z: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-0.5 * z * z);
    const p =
      1 -
      d *
        t *
        (0.3193815 +
          t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z >= 0 ? p : 1 - p;
  }
  
  export function teamScore(zs: NineCatStats): number {
    const cats: (keyof CategoryRanks)[] = [
      "pts",
      "reb",
      "ast",
      "stl",
      "blk",
      "threes",
      "fgPct",
      "ftPct",
      "tov",
    ];
    return (
      cats.reduce((a, c) => a + normalCdf(c === "tov" ? -zs[c] : zs[c]), 0)
    );
  }
  