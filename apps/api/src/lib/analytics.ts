// Deterministic 9-cat fantasy basketball analytics (no LLM, pure math)

export type NineCatStats = {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threes: number; // 3PM
    fgPct: number; // 0..1
    ftPct: number; // 0..1
    tov: number; // lower is better
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
  
  export function extractPlayerStats(playerMeta: any): { stats: NineCatStats; missing: boolean } {
    // 1) Support simple shape if you ever store it
    const simple = playerMeta?.stats;
    if (simple && typeof simple === "object" && !Array.isArray(simple)) {
      const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  
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
        const fgm = num(simple.fgMade ?? simple.fgm);
        fgPct = fgm / fgAttempts;
      }
      if (!ftPct && ftAttempts > 0) {
        const ftm = num(simple.ftMade ?? simple.ftm);
        ftPct = ftm / ftAttempts;
      }
  
      const hasAny = pts || reb || ast || stl || blk || threes || tov;
      return {
        stats: {
          pts,
          reb,
          ast,
          stl,
          blk,
          threes,
          tov,
          fgPct: Math.max(0, Math.min(1, fgPct)),
          ftPct: Math.max(0, Math.min(1, ftPct)),
          fgAttempts: fgAttempts > 0 ? fgAttempts : undefined,
          ftAttempts: ftAttempts > 0 ? ftAttempts : undefined,
        },
        missing: !hasAny,
      };
    }
  
    // 2) ESPN shape: playerMeta.stats is an array of stat blocks
    const blocks: any[] = Array.isArray(playerMeta?.stats) ? playerMeta.stats : [];
    if (blocks.length === 0) {
      return {
        stats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, fgPct: 0, ftPct: 0, tov: 0 },
        missing: true,
      };
    }

    // Find season-total split: scoringPeriodId === 0, statSourceId === 0, statSplitTypeId === 0 (if present)
    const seasonTotal = blocks.find((b) => {
      if (b?.scoringPeriodId !== 0) return false;
      if (b?.statSourceId !== 0) return false;
      if (b?.statSplitTypeId !== undefined && b?.statSplitTypeId !== 0) return false;
      return true;
    });

    const st = seasonTotal?.stats;
    if (!st || typeof st !== "object") {
      return {
        stats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, fgPct: 0, ftPct: 0, tov: 0 },
        missing: true,
      };
    }

    const get = (k: string) => {
      const v = st[k];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };

    // ESPN key mapping to 9-cat
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

    // missing=true only if all counting stats are zero AND attempts are zero
    const hasAnyCountingStats = pts || reb || ast || stl || blk || threes || tov;
    const hasAnyAttempts = fga || fta;
    const missing = !hasAnyCountingStats && !hasAnyAttempts;

    return {
      stats: {
        pts,
        reb,
        ast,
        stl,
        blk,
        threes,
        tov,
        fgPct: Math.max(0, Math.min(1, fgPct)),
        ftPct: Math.max(0, Math.min(1, ftPct)),
        fgAttempts: fga > 0 ? fga : undefined,
        ftAttempts: fta > 0 ? fta : undefined,
      },
      missing,
    };
  }
  
  
  export function aggregateTeam(playersStats: NineCatStats[]): NineCatStats {
    if (playersStats.length === 0) return { ...ZERO_STATS };
  
    const sum = <K extends keyof NineCatStats>(k: K) =>
      playersStats.reduce((acc, p) => acc + (typeof p[k] === "number" ? (p[k] as number) : 0), 0);
  
    const pts = sum("pts");
    const reb = sum("reb");
    const ast = sum("ast");
    const stl = sum("stl");
    const blk = sum("blk");
    const threes = sum("threes");
    const tov = sum("tov");
  
    const totalFgAttempts = playersStats.reduce((acc, p) => acc + (p.fgAttempts ?? 0), 0);
    const totalFtAttempts = playersStats.reduce((acc, p) => acc + (p.ftAttempts ?? 0), 0);
  
    let fgPct = 0;
    let ftPct = 0;
  
    if (totalFgAttempts > 0) {
      const made = playersStats.reduce((acc, p) => acc + (p.fgPct * (p.fgAttempts ?? 0)), 0);
      fgPct = made / totalFgAttempts;
    }
    if (totalFtAttempts > 0) {
      const made = playersStats.reduce((acc, p) => acc + (p.ftPct * (p.ftAttempts ?? 0)), 0);
      ftPct = made / totalFtAttempts;
    }
  
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  
    return {
      pts,
      reb,
      ast,
      stl,
      blk,
      threes,
      fgPct: clamp01(fgPct),
      ftPct: clamp01(ftPct),
      tov,
      fgAttempts: totalFgAttempts > 0 ? totalFgAttempts : undefined,
      ftAttempts: totalFtAttempts > 0 ? totalFtAttempts : undefined,
    };
  }
  
  export function computeLeagueDistributions(teamsTotals: TeamTotals[]): LeagueDistribution {
    if (teamsTotals.length === 0) {
      return { mean: { ...ZERO_STATS }, std: { ...ZERO_STATS } };
    }
  
    const n = teamsTotals.length;
  
    const mean: NineCatStats = {
      pts: teamsTotals.reduce((a, t) => a + t.pts, 0) / n,
      reb: teamsTotals.reduce((a, t) => a + t.reb, 0) / n,
      ast: teamsTotals.reduce((a, t) => a + t.ast, 0) / n,
      stl: teamsTotals.reduce((a, t) => a + t.stl, 0) / n,
      blk: teamsTotals.reduce((a, t) => a + t.blk, 0) / n,
      threes: teamsTotals.reduce((a, t) => a + t.threes, 0) / n,
      fgPct: teamsTotals.reduce((a, t) => a + t.fgPct, 0) / n,
      ftPct: teamsTotals.reduce((a, t) => a + t.ftPct, 0) / n,
      tov: teamsTotals.reduce((a, t) => a + t.tov, 0) / n,
    };
  
    const sampleVar = (values: number[], m: number) => {
      if (values.length <= 1) return 0;
      const ss = values.reduce((acc, v) => acc + (v - m) * (v - m), 0);
      return ss / (values.length - 1);
    };
  
    const std: NineCatStats = {
      pts: Math.sqrt(sampleVar(teamsTotals.map((t) => t.pts), mean.pts)),
      reb: Math.sqrt(sampleVar(teamsTotals.map((t) => t.reb), mean.reb)),
      ast: Math.sqrt(sampleVar(teamsTotals.map((t) => t.ast), mean.ast)),
      stl: Math.sqrt(sampleVar(teamsTotals.map((t) => t.stl), mean.stl)),
      blk: Math.sqrt(sampleVar(teamsTotals.map((t) => t.blk), mean.blk)),
      threes: Math.sqrt(sampleVar(teamsTotals.map((t) => t.threes), mean.threes)),
      fgPct: Math.sqrt(sampleVar(teamsTotals.map((t) => t.fgPct), mean.fgPct)),
      ftPct: Math.sqrt(sampleVar(teamsTotals.map((t) => t.ftPct), mean.ftPct)),
      tov: Math.sqrt(sampleVar(teamsTotals.map((t) => t.tov), mean.tov)),
    };
  
    return { mean, std };
  }
  
  export function zScore(teamTotals: NineCatStats, dist: LeagueDistribution): NineCatStats {
    const safe = (val: number, mean: number, std: number) => (std === 0 ? 0 : (val - mean) / std);
  
    return {
      pts: safe(teamTotals.pts, dist.mean.pts, dist.std.pts),
      reb: safe(teamTotals.reb, dist.mean.reb, dist.std.reb),
      ast: safe(teamTotals.ast, dist.mean.ast, dist.std.ast),
      stl: safe(teamTotals.stl, dist.mean.stl, dist.std.stl),
      blk: safe(teamTotals.blk, dist.mean.blk, dist.std.blk),
      threes: safe(teamTotals.threes, dist.mean.threes, dist.std.threes),
      fgPct: safe(teamTotals.fgPct, dist.mean.fgPct, dist.std.fgPct),
      ftPct: safe(teamTotals.ftPct, dist.mean.ftPct, dist.std.ftPct),
      tov: safe(teamTotals.tov, dist.mean.tov, dist.std.tov),
    };
  }
  
  export function rankTeams(teamsTotals: TeamTotals[]): Map<string, CategoryRanks> {
    const ranks = new Map<string, CategoryRanks>();
    const cats: (keyof CategoryRanks)[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
  
    for (const cat of cats) {
      const inverted = cat === "tov";
      const sorted = [...teamsTotals].sort((a, b) => {
        const diff = (b as any)[cat] - (a as any)[cat];
        return inverted ? -diff : diff;
      });
  
      sorted.forEach((t, i) => {
        const existing =
          ranks.get(t.teamId) ??
          ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, fgPct: 0, ftPct: 0, tov: 0 } satisfies CategoryRanks);
        (existing as any)[cat] = i + 1;
        ranks.set(t.teamId, existing);
      });
    }
  
    return ranks;
  }
  
  function normalCdfApprox(z: number): number {
    const sign = z >= 0 ? 1 : -1;
    const absZ = Math.abs(z);
    const t = 1 / (1 + 0.2316419 * absZ);
    const d = 0.3989423 * Math.exp(-0.5 * absZ * absZ);
    const prob = 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return sign > 0 ? prob : 1 - prob;
  }
  
  export function teamScore(zScores: NineCatStats): number {
    const cats: (keyof CategoryRanks)[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
    const winProbs = cats.map((cat) => normalCdfApprox(cat === "tov" ? -(zScores as any)[cat] : (zScores as any)[cat]));
    return winProbs.reduce((a, p) => a + p, 0) * 9;
  }
  