// tradeEngine.ts
import {
  type NineCatStats,
  type TeamTotals,
  type LeagueDistribution,
  zScore,
  rankTeams,
  teamScore,
  aggregateTeam,
  computeLeagueDistributions,
} from "./analytics.js";
import { extractNineCatFromPlayerMeta } from "./playerStats.js";
import { extractInjuryInfo, calculateProjectedGamesThisWeek, type InjuryInfo } from "./injuryHelpers.js";

// ============================================================================
// CONFIG
// ============================================================================
const CONFIG = {
  FAIRNESS_STRICT: 1.10,
  FAIRNESS_RELAXED: 1.18,
  FAIRNESS_FINAL: 1.30,

  DROP_COST_PERCENTILE: 30,

  MIN_GP_THRESHOLD: 10,
  LOW_GP_MULTIPLIER: 0.6,

  INJURY_PENALTIES: {
    IR: 0.25,
    OUT: 0.35,
    DTD: 0.70,
    SUSP: 0.20,
    HEALTHY: 1.0,
  },

  MAX_SUGGESTIONS_PER_PARTNER: 3,
  TARGET_TOTAL_SUGGESTIONS: 20,
  
  // Star player protection (top percentile)
  STAR_PLAYER_PERCENTILE: 85,
  STAR_TRADE_FAIRNESS_MULTIPLIER: 0.85, // More strict for star trades (15% tighter)
  
  // Minimum PTV threshold - reject trades with players below this
  MIN_PTV_THRESHOLD: -5.0, // Very low threshold, but filters out truly broken players
  
  // Lopsidedness thresholds
  PTV_ABS_MAX: 10, // Maximum absolute net PTV imbalance allowed
  PTV_RATIO_1FOR1: 1.15, // Max ratio for 1-for-1 trades
  PTV_RATIO_MULTI: 1.22, // Max ratio for multi-player trades
  CATEGORY_DELTA_EPSILON: 0.05, // Threshold for counting category wins/losses (5%)
  CORE_PLAYER_PTV_PERCENTILE: 90, // Percentile threshold for "star for role player" check
  ELITE_RECEIVER_PERCENTILE: 80, // When sending core player, must receive at least one player >= this
};

// IMPORTANT: ranks are only for 9 cats (NOT attempts)
export type NineCategory =
  | "pts"
  | "reb"
  | "ast"
  | "stl"
  | "blk"
  | "threes"
  | "fgPct"
  | "ftPct"
  | "tov";

export type CategoryRanks = Record<NineCategory, number>;

const CATEGORY_KEYS: NineCategory[] = [
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

export const CATEGORY_HIGHER_IS_BETTER: Partial<Record<NineCategory, boolean>> = {
  pts: true,
  reb: true,
  ast: true,
  stl: true,
  blk: true,
  threes: true,
  fgPct: true,
  ftPct: true,
  tov: false,
};

export type PlayerValue = {
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  status: string;
  injuryInfo: InjuryInfo;
  perGameStats: NineCatStats;
  weeklyProjectedStats: NineCatStats & { fgAttempts?: number; ftAttempts?: number };
  gp: number;
  statsSource: "CURRENT_SEASON" | "ESPN_PROJECTION" | "NONE";
  overallValue: number;
  categoryContributions: Partial<Record<NineCategory, number>>;
  ptv: number;
  ptvPercentile: number;
  isCore: boolean;
};

export type PlayerInTrade = {
  playerId: string;
  name: string;
  headshotUrl: string | null;
  status: string;
  perGameStats?: NineCatStats;
  weeklyProjectedStats?: NineCatStats & { fgAttempts?: number; ftAttempts?: number };
  gp?: number;
  statsSource?: string;
};

export type TradeCandidate = {
  send: Array<PlayerInTrade>;
  receive: Array<PlayerInTrade>;
  type: "1for1" | "2for1" | "2for2";
};

export type CategoryDetail = {
  category: string;
  totalBefore: number;
  totalAfter: number;
  deltaTotal?: number;
  deltaTotalPct?: number;
  rankBefore: number;
  rankAfter: number;
  rankDelta: number;
  percentileBefore?: number;
  percentileAfter?: number;
  percentileDelta?: number;
};

export type TradeSuggestion = {
  id: string;
  partnerTeam: { id: string; name: string; avatarUrl: string | null };
  trade: TradeCandidate;
  impact: {
    my: {
      teamScoreBefore: number;
      teamScoreAfter: number;
      teamScoreDelta: number;
      avgPlacementBefore: number;
      avgPlacementAfter: number;
      avgPlacementDelta: number;
      categoryPercentilesBefore: Record<string, number>;
      categoryPercentilesAfter: Record<string, number>;
      categoryPercentilesDelta: Record<string, number>;
      categoryDetails: CategoryDetail[];
      grade: string;
      probability: number;
      confidence: number;
    };
    opp: {
      teamScoreBefore: number;
      teamScoreAfter: number;
      teamScoreDelta: number;
      avgPlacementBefore: number;
      avgPlacementAfter: number;
      avgPlacementDelta: number;
      categoryPercentilesBefore: Record<string, number>;
      categoryPercentilesAfter: Record<string, number>;
      categoryPercentilesDelta: Record<string, number>;
      categoryDetails: CategoryDetail[];
      grade: string;
      probability: number;
      confidence: number;
    };
  };
  summary: {
    myTopGains: Array<{ category: string; delta: number }>;
    myTopLosses: Array<{ category: string; delta: number }>;
    oppTopGains: Array<{ category: string; delta: number }>;
    oppTopLosses: Array<{ category: string; delta: number }>;
  };
  rationaleBullets: string[];
};

export type TradeAnalysis = {
  myBefore: { teamScore0to9: number; ranks: CategoryRanks; zScores: NineCatStats; totals: TeamTotals };
  myAfter: { teamScore0to9: number; ranks: CategoryRanks; zScores: NineCatStats; totals: TeamTotals };
  themBefore: { teamScore0to9: number; ranks: CategoryRanks; zScores: NineCatStats; totals: TeamTotals };
  themAfter: { teamScore0to9: number; ranks: CategoryRanks; zScores: NineCatStats; totals: TeamTotals };
  deltas: {
    my: { teamScoreDelta: number; categoryDelta: Record<NineCategory, number> };
    them: { teamScoreDelta: number; categoryDelta: Record<NineCategory, number> };
  };
  fairnessRatio: number;
};

type ScoredTrade = {
  candidate: TradeCandidate;
  analysis: TradeAnalysis;
  score: number;
  myGrade: string;
  oppGrade: string;
  oppWeaknessGains: number;
};

export interface TradeEngineOptions {
  myTeamId: string;
  excludeUntouchables: boolean;
  minOpponentGrade: string;
  includeQuestionable: boolean;
  tradeSize?: "1for1" | "2for1" | "2for2";
  seasonYear: number | null;

  defaultGamesPerWeek?: number;
  scoringPeriodStartDate?: string;
  scoringPeriodEndDate?: string;

  untouchables?: string[];
}

// ============================================================================
// Core helpers
// ============================================================================
function createDefaultRanks(totalTeams: number): CategoryRanks {
  return {
    pts: totalTeams,
    reb: totalTeams,
    ast: totalTeams,
    stl: totalTeams,
    blk: totalTeams,
    threes: totalTeams,
    fgPct: totalTeams,
    ftPct: totalTeams,
    tov: totalTeams,
  };
}

export function calculateAvgPlacement(ranks: CategoryRanks): number {
  const sum = CATEGORY_KEYS.reduce((acc, cat) => acc + (ranks[cat] ?? 0), 0);
  return sum / CATEGORY_KEYS.length;
}

export function calculateCategoryPercentiles(ranks: CategoryRanks, totalTeams: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (totalTeams <= 1) {
    for (const cat of CATEGORY_KEYS) out[cat] = 100;
    return out;
  }
  for (const cat of CATEGORY_KEYS) {
    const r = ranks[cat] ?? totalTeams;
    // Percentile: 100 = best rank (rank 1), 0 = worst rank (rank = totalTeams)
    // Formula: percentile = (totalTeams - rank) / (totalTeams - 1) * 100
    const percentile = ((totalTeams - r) / (totalTeams - 1)) * 100;
    // Clamp to [0, 100]
    out[cat] = Math.max(0, Math.min(100, percentile));
  }
  return out;
}

export function gradeToScore(grade: string): number {
  const scores: Record<string, number> = {
    "A+": 10, "A": 9, "A-": 8,
    "B+": 7, "B": 6, "B-": 5,
    "C+": 4, "C": 3, "C-": 2,
    "D": 1, "F": 0,
  };
  return scores[grade] ?? 0;
}

export function calculateTradeGrade(
  teamScoreDelta: number, 
  avgPlacementDelta: number,
  categoryDeltas?: Record<NineCategory, number>
): string {
  const placementScore = -avgPlacementDelta;
  let adjustedTeamScoreDelta = teamScoreDelta;
  
  // If categoryDeltas provided, cap FG%/FT% contributions to prevent overweighting
  if (categoryDeltas) {
    const fgDelta = categoryDeltas.fgPct ?? 0;
    const ftDelta = categoryDeltas.ftPct ?? 0;
    
    // Cap FG%/FT% deltas at ±0.3 (roughly ±3 percentage points worth of Z-score impact)
    // This prevents single-category dominance from shooting percentages
    const fgCapped = Math.max(-0.3, Math.min(0.3, fgDelta));
    const ftCapped = Math.max(-0.3, Math.min(0.3, ftDelta));
    
    // If original had larger contribution, reduce team score delta proportionally
    const fgReduction = Math.abs(fgDelta) - Math.abs(fgCapped);
    const ftReduction = Math.abs(ftDelta) - Math.abs(ftCapped);
    const totalReduction = (fgReduction + ftReduction) / 9.0; // Divide by 9 categories
    
    adjustedTeamScoreDelta = teamScoreDelta - (Math.sign(teamScoreDelta) * totalReduction);
  }
  
  const score = 0.7 * adjustedTeamScoreDelta + 0.3 * placementScore;

  // Harsher penalties for negative outcomes
  if (score >= 0.35) return "A+";
  if (score >= 0.25) return "A";
  if (score >= 0.18) return "A-";
  if (score >= 0.12) return "B+";
  if (score >= 0.07) return "B";
  if (score >= 0.03) return "B-";
  if (score >= 0.0) return "C+";
  if (score >= -0.03) return "C";
  if (score >= -0.07) return "D";
  return "F";
}

export function calculateConfidence(trade: TradeCandidate, myPlayers: PlayerValue[], theirPlayers: PlayerValue[]): number {
  const ids = new Set([...trade.send, ...trade.receive].map((p) => p.playerId));
  const all = [
    ...myPlayers.filter((p) => ids.has(p.playerId)),
    ...theirPlayers.filter((p) => ids.has(p.playerId)),
  ];
  if (!all.length) return 50;

  let total = 0;
  for (const p of all) {
    let c = 85;
    if (p.injuryInfo.status === "IR" || p.injuryInfo.status === "OUT") c -= 25;
    else if (p.injuryInfo.status === "DTD") c -= 12;
    else if (p.injuryInfo.status === "SUSP") c -= 30;

    if (p.gp < 10) c -= 15;
    else if (p.gp < 20) c -= 8;

    if (p.statsSource === "ESPN_PROJECTION") c -= 8;
    else if (p.statsSource === "NONE") c -= 25;

    total += Math.max(10, Math.min(95, c));
  }
  return Math.round(total / all.length);
}

export function calculateProbability(
  fairnessRatio: number,
  myGrade: string,
  oppGrade: string,
  hasCorePlayer: boolean,
  oppTeamScoreDelta: number,
  myTeamScoreDelta: number = 0,
  myAvgPlacementDelta: number = 0
): number {
  // Fairness score: 1.0 when perfectly balanced, 0 when very lopsided
  const fairnessScore = Math.max(0, 1 - Math.abs(1 - fairnessRatio) * 2.5);
  
  // My improvement score: based on team score delta and avg placement delta
  // Normalize team score delta (typically ranges from -0.5 to +0.5, but we focus on positive)
  const teamScoreComponent = Math.max(0, Math.min(1, myTeamScoreDelta / 0.3));
  // Normalize avg placement delta (negative is good, typically ranges from -2 to +2)
  const placementComponent = Math.max(0, Math.min(1, -myAvgPlacementDelta / 2));
  const myDeltaScore = (teamScoreComponent * 0.7 + placementComponent * 0.3);
  
  // Opponent improvement score: penalize if they get worse, reward if they improve
  // Range from 0 (they lose badly) to 1 (they gain moderately)
  let oppDeltaScore = 0.5; // neutral default
  if (oppTeamScoreDelta < -0.12) {
    oppDeltaScore = Math.max(0, 0.5 + oppTeamScoreDelta * 3); // steep penalty
  } else if (oppTeamScoreDelta > 0) {
    oppDeltaScore = Math.min(1, 0.5 + oppTeamScoreDelta * 2); // moderate reward
  }
  
  // Composite deal score
  let dealScore = 100 * (
    0.55 * fairnessScore +
    0.25 * myDeltaScore +
    0.20 * oppDeltaScore
  );
  
  // Penalties for risky factors
  if (hasCorePlayer) dealScore -= 8;
  
  // Grade-based adjustments (small influence)
  dealScore += gradeToScore(myGrade) * 0.5;
  dealScore += gradeToScore(oppGrade) * 0.3;
  
  return Math.max(5, Math.min(95, Math.round(dealScore)));
}

function adjustDeltaForTO(category: NineCategory, delta: number): number {
  return category === "tov" ? -delta : delta;
}

// ============================================================================
// Player Value
// ============================================================================
export function computePlayerValue(
  player: { id: string; fullName: string; meta: any; headshotUrl?: string | null },
  leagueDist: LeagueDistribution,
  seasonYear: number | null,
  rosterSlotMeta?: any,
  defaultGamesPerWeek: number = 4,
  scoringPeriodStartDate?: string,
  scoringPeriodEndDate?: string
): PlayerValue | null {
  const statsResult = extractNineCatFromPlayerMeta(player.meta, seasonYear);
  if (!statsResult?.hasStats) return null;

  const perGame = statsResult.perGame;
  const gp = statsResult.totals.gp ?? 0;

  const lineupSlotId = rosterSlotMeta?.lineupSlotId ?? null;
  const injuryInfo = extractInjuryInfo(player.meta, lineupSlotId);
  const status = rosterSlotMeta?.status ?? injuryInfo.status;

  const projectedGames = calculateProjectedGamesThisWeek(
    defaultGamesPerWeek,
    injuryInfo,
    scoringPeriodStartDate,
    scoringPeriodEndDate
  );

  // Estimate attempts if not available (needed for proper FG%/FT% calculation in trades)
  let fgAttempts = ((perGame as any).fgAttempts || 0) * projectedGames;
  let ftAttempts = ((perGame as any).ftAttempts || 0) * projectedGames;
  
  // If attempts are missing, estimate them from points (typical NBA ratios)
  if (fgAttempts === 0 && perGame.pts > 0) {
    // Average NBA player takes ~1.2 points per FGA
    fgAttempts = (perGame.pts / 1.2) * projectedGames;
  }
  if (ftAttempts === 0 && perGame.pts > 0) {
    // Average NBA player takes ~0.35 FTA per point
    ftAttempts = (perGame.pts * 0.35) * projectedGames;
  }
  
  const weeklyProjectedStats: NineCatStats & { fgAttempts?: number; ftAttempts?: number } = {
    pts: perGame.pts * projectedGames,
    reb: perGame.reb * projectedGames,
    ast: perGame.ast * projectedGames,
    stl: perGame.stl * projectedGames,
    blk: perGame.blk * projectedGames,
    threes: perGame.threes * projectedGames,
    tov: perGame.tov * projectedGames,
    fgPct: perGame.fgPct,
    ftPct: perGame.ftPct,
    fgAttempts: fgAttempts > 0 ? fgAttempts : undefined,
    ftAttempts: ftAttempts > 0 ? ftAttempts : undefined,
  };

  const playerZ = zScore(perGame, leagueDist);

  const categoryContributions: Partial<Record<NineCategory, number>> = {
    pts: playerZ.pts,
    reb: playerZ.reb,
    ast: playerZ.ast,
    stl: playerZ.stl,
    blk: playerZ.blk,
    threes: playerZ.threes,
    fgPct: playerZ.fgPct,
    ftPct: playerZ.ftPct,
    tov: -playerZ.tov, // invert TO
  };

  const overallValue = Object.values(categoryContributions).reduce((s, v) => {
    const val = v ?? 0;
    return s + (isFinite(val) ? val : 0);
  }, 0);

  let availability = CONFIG.INJURY_PENALTIES.HEALTHY;
  if (injuryInfo.status === "IR") availability = CONFIG.INJURY_PENALTIES.IR;
  else if (injuryInfo.status === "OUT") availability = CONFIG.INJURY_PENALTIES.OUT;
  else if (injuryInfo.status === "DTD") availability = CONFIG.INJURY_PENALTIES.DTD;
  else if (injuryInfo.status === "SUSP") availability = CONFIG.INJURY_PENALTIES.SUSP;

  if (gp < CONFIG.MIN_GP_THRESHOLD) {
    availability *= Math.max(CONFIG.LOW_GP_MULTIPLIER, gp / CONFIG.MIN_GP_THRESHOLD);
  }

  const ptv = overallValue * availability;
  
  // Ensure PTV is finite and valid
  if (!isFinite(ptv) || isNaN(ptv)) {
    // If PTV is invalid, set to a very low value (but not zero to avoid division issues)
    return {
      playerId: player.id,
      playerName: player.fullName,
      headshotUrl: player.headshotUrl ?? null,
      status,
      injuryInfo,
      perGameStats: perGame,
      weeklyProjectedStats,
      gp,
      statsSource: statsResult.statsSource,
      overallValue: 0,
      categoryContributions,
      ptv: CONFIG.MIN_PTV_THRESHOLD,
      ptvPercentile: 0,
      isCore: false,
    };
  }

  return {
    playerId: player.id,
    playerName: player.fullName,
    headshotUrl: player.headshotUrl ?? null,
    status,
    injuryInfo,
    perGameStats: perGame,
    weeklyProjectedStats,
    gp,
    statsSource: statsResult.statsSource,
    overallValue,
    categoryContributions,
    ptv,
    ptvPercentile: 0,
    isCore: false,
  };
}

export function calculatePTVPercentiles(allPlayers: PlayerValue[]): void {
  if (!allPlayers.length) return;
  const sorted = [...allPlayers].sort((a, b) => b.ptv - a.ptv);

  const denom = Math.max(1, sorted.length - 1);
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].ptvPercentile = ((denom - i) / denom) * 100;
  }

  sorted.slice(0, 2).forEach((p) => (p.isCore = true));
  sorted.forEach((p) => {
    if (p.ptvPercentile >= 90) p.isCore = true;
  });
}

export function identifyFocusCategories(teamZ: NineCatStats): { weaknesses: NineCategory[]; strengths: NineCategory[] } {
  const sorted = [...CATEGORY_KEYS].sort((a, b) => {
    let av = teamZ[a] ?? 0;
    let bv = teamZ[b] ?? 0;
    if (a === "tov") av = -av;
    if (b === "tov") bv = -bv;
    return av - bv;
  });

  return { weaknesses: sorted.slice(0, 3), strengths: sorted.slice(-3).reverse() };
}

export function identifyUntouchables(
  myPlayers: PlayerValue[],
  excludeUntouchables: boolean,
  explicitUntouchables?: string[]
): Set<string> {
  if (!excludeUntouchables) return new Set();
  const set = new Set<string>();
  (explicitUntouchables || []).forEach((id) => set.add(id));
  myPlayers.filter((p) => p.isCore).forEach((p) => set.add(p.playerId));
  return set;
}

// ============================================================================
// Candidate generation
// ============================================================================
function isQuestionableBlocked(includeQuestionable: boolean, status: string): boolean {
  if (includeQuestionable) return false;
  return ["IR", "OUT", "DTD", "SUSP"].includes(status);
}

function playerToTradePlayer(p: PlayerValue): PlayerInTrade {
  return {
    playerId: p.playerId,
    name: p.playerName,
    headshotUrl: p.headshotUrl,
    status: p.status,
    perGameStats: p.perGameStats,
    weeklyProjectedStats: p.weeklyProjectedStats,
    gp: p.gp,
    statsSource: p.statsSource,
  };
}

export function generate1For1Trades(
  myPlayers: PlayerValue[],
  theirPlayers: PlayerValue[],
  myUntouchables: Set<string>,
  theirUntouchables: Set<string>,
  includeQuestionable: boolean
): TradeCandidate[] {
  const out: TradeCandidate[] = [];
  for (const a of myPlayers) {
    if (myUntouchables.has(a.playerId)) continue;
    if (isQuestionableBlocked(includeQuestionable, a.injuryInfo.status)) continue;

    for (const b of theirPlayers) {
      if (theirUntouchables.has(b.playerId)) continue;
      if (isQuestionableBlocked(includeQuestionable, b.injuryInfo.status)) continue;

      out.push({
        send: [playerToTradePlayer(a)],
        receive: [playerToTradePlayer(b)],
        type: "1for1",
      });
    }
  }
  return out;
}

export function generate2For1Trades(
  myPlayers: PlayerValue[],
  theirPlayers: PlayerValue[],
  myUntouchables: Set<string>,
  theirUntouchables: Set<string>,
  includeQuestionable: boolean
): TradeCandidate[] {
  const out: TradeCandidate[] = [];

  const my = myPlayers
    .filter((p) => !myUntouchables.has(p.playerId))
    .filter((p) => !isQuestionableBlocked(includeQuestionable, p.injuryInfo.status))
    .sort((a, b) => b.ptv - a.ptv)
    .slice(0, 15);

  const them = theirPlayers
    .filter((p) => !theirUntouchables.has(p.playerId))
    .filter((p) => !isQuestionableBlocked(includeQuestionable, p.injuryInfo.status))
    .sort((a, b) => b.ptv - a.ptv)
    .slice(0, 15);

  for (let i = 0; i < my.length; i++) {
    for (let j = i + 1; j < my.length; j++) {
      for (const t of them) {
        out.push({
          send: [playerToTradePlayer(my[i]), playerToTradePlayer(my[j])],
          receive: [playerToTradePlayer(t)],
          type: "2for1",
        });
      }
    }
  }

  return out.slice(0, 70);
}

export function generate2For2Trades(
  myPlayers: PlayerValue[],
  theirPlayers: PlayerValue[],
  myUntouchables: Set<string>,
  theirUntouchables: Set<string>,
  includeQuestionable: boolean
): TradeCandidate[] {
  const out: TradeCandidate[] = [];

  const my = myPlayers
    .filter((p) => !myUntouchables.has(p.playerId))
    .filter((p) => !isQuestionableBlocked(includeQuestionable, p.injuryInfo.status))
    .sort((a, b) => b.ptv - a.ptv)
    .slice(0, 12);

  const them = theirPlayers
    .filter((p) => !theirUntouchables.has(p.playerId))
    .filter((p) => !isQuestionableBlocked(includeQuestionable, p.injuryInfo.status))
    .sort((a, b) => b.ptv - a.ptv)
    .slice(0, 12);

  for (let i = 0; i < my.length; i++) {
    for (let j = i + 1; j < my.length; j++) {
      for (let k = 0; k < them.length; k++) {
        for (let l = k + 1; l < them.length; l++) {
          out.push({
            send: [playerToTradePlayer(my[i]), playerToTradePlayer(my[j])],
            receive: [playerToTradePlayer(them[k]), playerToTradePlayer(them[l])],
            type: "2for2",
          });
        }
      }
    }
  }

  return out.slice(0, 90);
}

// ============================================================================
// Trade math
// ============================================================================
function createZeroStats(): NineCatStats & { fgAttempts?: number; ftAttempts?: number } {
  return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, tov: 0, fgPct: 0, ftPct: 0, fgAttempts: 0, ftAttempts: 0 };
}

function estimateReplacementPlayerStats(allRosteredPlayers: PlayerValue[]): NineCatStats & { fgAttempts?: number; ftAttempts?: number } {
  if (!allRosteredPlayers.length) return createZeroStats();

  const sorted = [...allRosteredPlayers].sort((a, b) => b.ptv - a.ptv);
  const idx = Math.floor(sorted.length * (1 - CONFIG.DROP_COST_PERCENTILE / 100));
  const p = sorted[Math.min(sorted.length - 1, Math.max(0, idx))];
  return p?.weeklyProjectedStats ?? createZeroStats();
}

function ensureTotalsHaveAttempts(
  totals: TeamTotals,
  players: PlayerValue[]
): TeamTotals {
  // Always recalculate from player stats to ensure accuracy
  // aggregateTeam calculates FG%/FT% correctly from attempt-weighted totals
  const agg = aggregateTeam(players.map(p => p.weeklyProjectedStats));
  
  // Use aggregated values (which are calculated from attempts)
  // This ensures FG%/FT% are always attempt-weighted
  return {
    ...totals,
    fgAttempts: agg.fgAttempts ?? 0,
    ftAttempts: agg.ftAttempts ?? 0,
    fgPct: agg.fgPct, // Use aggregated percentage (calculated from attempts)
    ftPct: agg.ftPct, // Use aggregated percentage (calculated from attempts)
  } as TeamTotals;
}

function calculateNewTotals(
  current: TeamTotals,
  sendAgg: NineCatStats & { fgAttempts?: number; ftAttempts?: number },
  receiveAgg: NineCatStats & { fgAttempts?: number; ftAttempts?: number },
  drop: (NineCatStats & { fgAttempts?: number; ftAttempts?: number }) | null
): TeamTotals {
  const dropStats = drop ?? createZeroStats();

  const out: any = {
    ...current,
    pts: current.pts - sendAgg.pts + receiveAgg.pts + dropStats.pts,
    reb: current.reb - sendAgg.reb + receiveAgg.reb + dropStats.reb,
    ast: current.ast - sendAgg.ast + receiveAgg.ast + dropStats.ast,
    stl: current.stl - sendAgg.stl + receiveAgg.stl + dropStats.stl,
    blk: current.blk - sendAgg.blk + receiveAgg.blk + dropStats.blk,
    threes: current.threes - sendAgg.threes + receiveAgg.threes + dropStats.threes,
    tov: current.tov - sendAgg.tov + receiveAgg.tov + dropStats.tov,
  };

  const curFga = (current as any).fgAttempts ?? 0;
  const curFgm = curFga > 0 ? curFga * (current.fgPct ?? 0) : 0;
  const sendFga = sendAgg.fgAttempts ?? 0;
  const sendFgm = sendFga > 0 ? sendFga * (sendAgg.fgPct ?? 0) : 0;
  const recvFga = receiveAgg.fgAttempts ?? 0;
  const recvFgm = recvFga > 0 ? recvFga * (receiveAgg.fgPct ?? 0) : 0;
  const dropFga = dropStats.fgAttempts ?? 0;
  const dropFgm = dropFga > 0 ? dropFga * (dropStats.fgPct ?? 0) : 0;

  const newFga = curFga - sendFga + recvFga + dropFga;
  const newFgm = curFgm - sendFgm + recvFgm + dropFgm;

  out.fgAttempts = newFga;
  out.fgPct = newFga > 0 ? newFgm / newFga : (current.fgPct ?? 0);

  const curFta = (current as any).ftAttempts ?? 0;
  const curFtm = curFta > 0 ? curFta * (current.ftPct ?? 0) : 0;
  const sendFta = sendAgg.ftAttempts ?? 0;
  const sendFtm = sendFta > 0 ? sendFta * (sendAgg.ftPct ?? 0) : 0;
  const recvFta = receiveAgg.ftAttempts ?? 0;
  const recvFtm = recvFta > 0 ? recvFta * (receiveAgg.ftPct ?? 0) : 0;
  const dropFta = dropStats.ftAttempts ?? 0;
  const dropFtm = dropFta > 0 ? dropFta * (dropStats.ftPct ?? 0) : 0;

  const newFta = curFta - sendFta + recvFta + dropFta;
  const newFtm = curFtm - sendFtm + recvFtm + dropFtm;

  out.ftAttempts = newFta;
  out.ftPct = newFta > 0 ? newFtm / newFta : (current.ftPct ?? 0);

  return out as TeamTotals;
}

export function analyzeTrade(
  trade: TradeCandidate,
  myTeamId: string,
  theirTeamId: string,
  myTotals: TeamTotals,
  theirTotals: TeamTotals,
  myPlayers: PlayerValue[],
  theirPlayers: PlayerValue[],
  leagueDistBefore: LeagueDistribution,
  allTeamsTotalsBefore: TeamTotals[],
  allRosteredPlayers: PlayerValue[]
): TradeAnalysis | null {
  const mySend = trade.send.map((p) => myPlayers.find((x) => x.playerId === p.playerId)).filter(Boolean) as PlayerValue[];
  const myRecv = trade.receive.map((p) => theirPlayers.find((x) => x.playerId === p.playerId)).filter(Boolean) as PlayerValue[];
  if (mySend.length !== trade.send.length || myRecv.length !== trade.receive.length) return null;

  const theirSend = myRecv;
  const theirRecv = mySend;
  
  // Ensure totals have FG/FT attempts for proper percentage calculation
  myTotals = ensureTotalsHaveAttempts(myTotals, myPlayers);
  theirTotals = ensureTotalsHaveAttempts(theirTotals, theirPlayers);

  const mySendAgg = aggregateTeam(mySend.map((p) => p.weeklyProjectedStats));
  const myRecvAgg = aggregateTeam(myRecv.map((p) => p.weeklyProjectedStats));
  const theirSendAgg = aggregateTeam(theirSend.map((p) => p.weeklyProjectedStats));
  const theirRecvAgg = aggregateTeam(theirRecv.map((p) => p.weeklyProjectedStats));

  let myDrop: any = null;
  let theirDrop: any = null;

  if (trade.type === "2for1") {
    if (trade.send.length === 2) myDrop = estimateReplacementPlayerStats(allRosteredPlayers);
    else theirDrop = estimateReplacementPlayerStats(allRosteredPlayers);
  }

  const myAfterTotals = calculateNewTotals(myTotals, mySendAgg as any, myRecvAgg as any, myDrop);
  const theirAfterTotals = calculateNewTotals(theirTotals, theirSendAgg as any, theirRecvAgg as any, theirDrop);

  // Ensure all teams have attempts before ranking (for proper FG%/FT% ranking)
  // calculateNewTotals already computes FG%/FT% correctly from attempts for the two teams being updated
  const updatedTotals = allTeamsTotalsBefore.map((t) => {
    if (t.teamId === myTeamId) return myAfterTotals;
    if (t.teamId === theirTeamId) return theirAfterTotals;
    // For other teams, ensure attempts exist (estimate if missing)
    if ((t as any).fgAttempts === undefined || (t as any).ftAttempts === undefined) {
      const estimatedFga = t.fgPct > 0 ? (t.pts / 1.2) : 0;
      const estimatedFta = t.ftPct > 0 ? (t.pts * 0.35) : 0;
      // Recalculate FG%/FT% from estimated attempts if we have makes
      const fgm = estimatedFga * t.fgPct;
      const ftm = estimatedFta * t.ftPct;
      return {
        ...t,
        fgAttempts: estimatedFga,
        ftAttempts: estimatedFta,
        fgPct: estimatedFga > 0 ? fgm / estimatedFga : t.fgPct,
        ftPct: estimatedFta > 0 ? ftm / estimatedFta : t.ftPct,
      } as TeamTotals;
    }
    return t;
  });

  const leagueDistAfter = computeLeagueDistributions(updatedTotals);

  // Ensure all teams in before totals have attempts too
  const allTeamsTotalsBeforeWithAttempts = allTeamsTotalsBefore.map((t) => {
    if ((t as any).fgAttempts === undefined || (t as any).ftAttempts === undefined) {
      const estimatedFga = t.fgPct > 0 ? (t.pts / 1.2) : 0;
      const estimatedFta = t.ftPct > 0 ? (t.pts * 0.35) : 0;
      const fgm = estimatedFga * t.fgPct;
      const ftm = estimatedFta * t.ftPct;
      return {
        ...t,
        fgAttempts: estimatedFga,
        ftAttempts: estimatedFta,
        fgPct: estimatedFga > 0 ? fgm / estimatedFga : t.fgPct,
        ftPct: estimatedFta > 0 ? ftm / estimatedFta : t.ftPct,
      } as TeamTotals;
    }
    return t;
  });

  const ranksBeforeMap = rankTeams(allTeamsTotalsBeforeWithAttempts);
  const ranksAfterMap = rankTeams(updatedTotals);

  const myRanksBefore = (ranksBeforeMap.get(myTeamId) as unknown as CategoryRanks) ?? createDefaultRanks(updatedTotals.length);
  const theirRanksBefore = (ranksBeforeMap.get(theirTeamId) as unknown as CategoryRanks) ?? createDefaultRanks(updatedTotals.length);
  const myRanksAfter = (ranksAfterMap.get(myTeamId) as unknown as CategoryRanks) ?? createDefaultRanks(updatedTotals.length);
  const theirRanksAfter = (ranksAfterMap.get(theirTeamId) as unknown as CategoryRanks) ?? createDefaultRanks(updatedTotals.length);

  const myZBefore = zScore(myTotals, leagueDistBefore);
  const theirZBefore = zScore(theirTotals, leagueDistBefore);
  const myZAfter = zScore(myAfterTotals, leagueDistAfter);
  const theirZAfter = zScore(theirAfterTotals, leagueDistAfter);

  const myScoreBefore = teamScore(myZBefore);
  const theirScoreBefore = teamScore(theirZBefore);
  const myScoreAfter = teamScore(myZAfter);
  const theirScoreAfter = teamScore(theirZAfter);

  const myCatDelta = {} as Record<NineCategory, number>;
  const theirCatDelta = {} as Record<NineCategory, number>;

  for (const cat of CATEGORY_KEYS) {
    const md = (myZAfter[cat] ?? 0) - (myZBefore[cat] ?? 0);
    const td = (theirZAfter[cat] ?? 0) - (theirZBefore[cat] ?? 0);
    myCatDelta[cat] = cat === "tov" ? -md : md;
    theirCatDelta[cat] = cat === "tov" ? -td : td;
  }

  const mySendPTV = mySend.reduce((s, p) => s + (p.ptv || 0), 0);
  const myRecvPTV = myRecv.reduce((s, p) => s + (p.ptv || 0), 0);
  const fairnessRatio = myRecvPTV / Math.max(0.001, mySendPTV);

  return {
    myBefore: { teamScore0to9: myScoreBefore, ranks: myRanksBefore, zScores: myZBefore, totals: myTotals },
    myAfter: { teamScore0to9: myScoreAfter, ranks: myRanksAfter, zScores: myZAfter, totals: myAfterTotals },
    themBefore: { teamScore0to9: theirScoreBefore, ranks: theirRanksBefore, zScores: theirZBefore, totals: theirTotals },
    themAfter: { teamScore0to9: theirScoreAfter, ranks: theirRanksAfter, zScores: theirZAfter, totals: theirAfterTotals },
    deltas: {
      my: { teamScoreDelta: myScoreAfter - myScoreBefore, categoryDelta: myCatDelta },
      them: { teamScoreDelta: theirScoreAfter - theirScoreBefore, categoryDelta: theirCatDelta },
    },
    fairnessRatio,
  };
}

// Helper to cap FG%/FT% delta contributions
function capPercentageDelta(delta: number): number {
  // Cap at ±0.3 (roughly ±3 percentage points worth of Z-score impact)
  return Math.max(-0.3, Math.min(0.3, delta));
}

// Check if a trade is lopsided (one side clearly dominates)
function isLopsidedTrade(
  analysis: TradeAnalysis,
  mySendPlayers: PlayerValue[],
  myRecvPlayers: PlayerValue[],
  theirSendPlayers: PlayerValue[],
  theirRecvPlayers: PlayerValue[],
  tradeType: "1for1" | "2for1" | "2for2",
  enableDebugLog: boolean = false
): { isLopsided: boolean; reason?: string } {
  // Calculate net PTV for both sides
  const mySendPTV = mySendPlayers.reduce((s, p) => s + (p.ptv || 0), 0);
  const myRecvPTV = myRecvPlayers.reduce((s, p) => s + (p.ptv || 0), 0);
  const theirSendPTV = theirSendPlayers.reduce((s, p) => s + (p.ptv || 0), 0);
  const theirRecvPTV = theirRecvPlayers.reduce((s, p) => s + (p.ptv || 0), 0);
  
  const myNetPTV = myRecvPTV - mySendPTV;
  const theirNetPTV = theirSendPTV - theirRecvPTV; // Their perspective (they send to me, receive from me)
  
  // 1) PTV imbalance check - absolute
  const maxAbsPTV = CONFIG.PTV_ABS_MAX;
  if (Math.abs(myNetPTV) > maxAbsPTV && Math.sign(myNetPTV) !== Math.sign(theirNetPTV)) {
    if (enableDebugLog) {
      console.log(`[LOPSIDED] Extreme PTV imbalance: myNet=${myNetPTV.toFixed(1)}, theirNet=${theirNetPTV.toFixed(1)}`);
    }
    return { isLopsided: true, reason: `Extreme PTV imbalance: ${myNetPTV.toFixed(1)} vs ${theirNetPTV.toFixed(1)}` };
  }
  
  // 2) PTV ratio check
  const maxRatio = tradeType === "1for1" ? CONFIG.PTV_RATIO_1FOR1 : CONFIG.PTV_RATIO_MULTI;
  if (mySendPTV > 0) {
    const myRatio = myRecvPTV / mySendPTV;
    if (myRatio > maxRatio) {
      if (enableDebugLog) {
        console.log(`[LOPSIDED] My PTV ratio too high: ${myRatio.toFixed(2)} > ${maxRatio}`);
      }
      return { isLopsided: true, reason: `Receiving ${((myRatio - 1) * 100).toFixed(0)}% more value than sending` };
    }
  }
  if (theirSendPTV > 0) {
    const theirRatio = theirRecvPTV / theirSendPTV;
    if (theirRatio > maxRatio) {
      if (enableDebugLog) {
        console.log(`[LOPSIDED] Their PTV ratio too high: ${theirRatio.toFixed(2)} > ${maxRatio}`);
      }
      return { isLopsided: true, reason: `Opponent receiving ${((theirRatio - 1) * 100).toFixed(0)}% more value` };
    }
  }
  
  // 3) Category win/loss count
  const eps = CONFIG.CATEGORY_DELTA_EPSILON;
  let myWins = 0, myLosses = 0;
  let theirWins = 0, theirLosses = 0;
  
  for (const cat of CATEGORY_KEYS) {
    const myDelta = analysis.deltas.my.categoryDelta[cat] ?? 0;
    const theirDelta = analysis.deltas.them.categoryDelta[cat] ?? 0;
    
    // Cap FG%/FT% to prevent them from masking losses
    const myCappedDelta = (cat === 'fgPct' || cat === 'ftPct') ? capPercentageDelta(myDelta) : myDelta;
    const theirCappedDelta = (cat === 'fgPct' || cat === 'ftPct') ? capPercentageDelta(theirDelta) : theirDelta;
    
    if (myCappedDelta > eps) myWins++;
    if (myCappedDelta < -eps) myLosses++;
    if (theirCappedDelta > eps) theirWins++;
    if (theirCappedDelta < -eps) theirLosses++;
  }
  
  const myNetCats = myWins - myLosses;
  const theirNetCats = theirWins - theirLosses;
  
  // 4) Category crush check
  if (myNetCats >= 4 && analysis.deltas.them.teamScoreDelta < 0) {
    if (enableDebugLog) {
      console.log(`[LOPSIDED] I win ${myNetCats} net categories while opponent loses overall (teamDelta=${analysis.deltas.them.teamScoreDelta.toFixed(3)})`);
    }
    return { isLopsided: true, reason: `Win ${myWins}/${CATEGORY_KEYS.length} categories while opponent gets worse` };
  }
  
  if (theirLosses >= 6 && theirWins <= 2) {
    if (enableDebugLog) {
      console.log(`[LOPSIDED] Opponent loses ${theirLosses} categories, wins only ${theirWins}`);
    }
    return { isLopsided: true, reason: `Opponent loses ${theirLosses}/${CATEGORY_KEYS.length} categories` };
  }
  
  // 5) "Star for role player" check
  const mySendingCore = mySendPlayers.some(p => p.isCore || (p.ptvPercentile >= CONFIG.CORE_PLAYER_PTV_PERCENTILE));
  const myReceivingElite = myRecvPlayers.some(p => p.ptvPercentile >= CONFIG.ELITE_RECEIVER_PERCENTILE);
  
  if (mySendingCore && !myReceivingElite) {
    // Check if multi-player trade with reasonable total PTV
    const ptvRatioTolerance = 0.15; // 15% tolerance
    if (myRecvPlayers.length === 1 || myRecvPTV < mySendPTV * (1 - ptvRatioTolerance)) {
      if (enableDebugLog) {
        console.log(`[LOPSIDED] Sending core/star player without receiving elite player (sendPTV=${mySendPTV.toFixed(1)}, recvPTV=${myRecvPTV.toFixed(1)})`);
      }
      return { isLopsided: true, reason: `Trading star player for role players without fair value` };
    }
  }
  
  const theirSendingCore = theirSendPlayers.some(p => p.isCore || (p.ptvPercentile >= CONFIG.CORE_PLAYER_PTV_PERCENTILE));
  const theirReceivingElite = theirRecvPlayers.some(p => p.ptvPercentile >= CONFIG.ELITE_RECEIVER_PERCENTILE);
  
  if (theirSendingCore && !theirReceivingElite) {
    const ptvRatioTolerance = 0.15;
    if (theirRecvPlayers.length === 1 || theirRecvPTV < theirSendPTV * (1 - ptvRatioTolerance)) {
      if (enableDebugLog) {
        console.log(`[LOPSIDED] Opponent sending core/star without receiving elite player (sendPTV=${theirSendPTV.toFixed(1)}, recvPTV=${theirRecvPTV.toFixed(1)})`);
      }
      return { isLopsided: true, reason: `Opponent trading star for role players without fair value` };
    }
  }
  
  return { isLopsided: false };
}

export function scoreTrade(
  analysis: TradeAnalysis,
  myWeaknesses: NineCategory[],
  oppWeaknesses: NineCategory[],
  myStrengths: NineCategory[]
): number {
  let s = 0;

  s += analysis.deltas.my.teamScoreDelta * 18;

  for (const c of myWeaknesses) {
    let d = analysis.deltas.my.categoryDelta[c] ?? 0;
    // Cap FG%/FT% contributions to prevent overweighting
    if (c === 'fgPct' || c === 'ftPct') {
      d = capPercentageDelta(d);
    }
    if (d > 0) s += d * 7;
  }

  for (const c of myStrengths) {
    let d = analysis.deltas.my.categoryDelta[c] ?? 0;
    // Cap FG%/FT% contributions
    if (c === 'fgPct' || c === 'ftPct') {
      d = capPercentageDelta(d);
    }
    if (d < -0.25) s -= Math.abs(d) * 5;
  }

  // Harsher penalty for opponent losing badly
  if (analysis.deltas.them.teamScoreDelta < -0.08) s -= Math.abs(analysis.deltas.them.teamScoreDelta) * 15;
  else if (analysis.deltas.them.teamScoreDelta < -0.05) s -= Math.abs(analysis.deltas.them.teamScoreDelta) * 12;
  
  if (analysis.deltas.them.teamScoreDelta > 0.02) s += 5;

  for (const c of oppWeaknesses) {
    let d = analysis.deltas.them.categoryDelta[c] ?? 0;
    // Cap FG%/FT% contributions
    if (c === 'fgPct' || c === 'ftPct') {
      d = capPercentageDelta(d);
    }
    if (d > 0) s += d * 2.5;
  }

  s += Math.max(0, 1 - Math.abs(1 - analysis.fairnessRatio)) * 3;
  return s;
}

function filterTrades(
  trades: ScoredTrade[],
  maxFairness: number,
  minOppGradeScore: number,
  minMyDelta: number,
  minOppDelta: number,
  myPlayers: PlayerValue[],
  theirPlayers: PlayerValue[],
  enableDebugLog: boolean = false,
  failCounts?: { lopsided?: number }
): ScoredTrade[] {
  return trades.filter((t) => {
    const r = t.analysis.fairnessRatio;
    
    // Reject invalid fairness ratios
    if (!isFinite(r) || r <= 0) {
      if (enableDebugLog) {
        console.log(`[REJECTED] Invalid fairness ratio: ${r}`);
      }
      return false;
    }
    
    // NEW: Check for lopsided trades FIRST (hard gate)
    const mySendIds = t.candidate.send.map(p => p.playerId);
    const myRecvIds = t.candidate.receive.map(p => p.playerId);
    const mySendPlayers = myPlayers.filter(p => mySendIds.includes(p.playerId));
    const myRecvPlayers = theirPlayers.filter(p => myRecvIds.includes(p.playerId));
    const theirSendPlayers = myRecvPlayers; // They send to me
    const theirRecvPlayers = mySendPlayers; // They receive from me
    
    const lopsidedCheck = isLopsidedTrade(
      t.analysis,
      mySendPlayers,
      myRecvPlayers,
      theirSendPlayers,
      theirRecvPlayers,
      t.candidate.type,
      enableDebugLog
    );
    
    if (lopsidedCheck.isLopsided) {
      if (failCounts && failCounts.lopsided !== undefined) {
        failCounts.lopsided++;
      }
      if (enableDebugLog) {
        const sendNames = t.candidate.send.map(p => p.name).join(", ");
        const recvNames = t.candidate.receive.map(p => p.name).join(", ");
        console.log(`[REJECTED - LOPSIDED] ${sendNames} for ${recvNames}: ${lopsidedCheck.reason}`);
      }
      return false;
    }
    
    // Check if trade involves star players (top percentile)
    // Note: mySendPlayers and myRecvPlayers already defined above for lopsided check
    
    // Calculate actual PTV values for validation (allow negative PTV for struggling players)
    const mySendPTV = mySendPlayers.reduce((s, p) => s + (p.ptv || 0), 0);
    const myRecvPTV = myRecvPlayers.reduce((s, p) => s + (p.ptv || 0), 0);
    
    // Only reject if PTV values are invalid (NaN/Infinity) or if both are zero
    if (!isFinite(mySendPTV) || !isFinite(myRecvPTV) || (mySendPTV === 0 && myRecvPTV === 0)) {
      if (enableDebugLog) {
        console.log(`[REJECTED] Invalid PTV: send=${mySendPTV}, recv=${myRecvPTV}`);
      }
      return false;
    }
    
    // Reject if we're sending positive value and receiving negative (or vice versa with large disparity)
    if (mySendPTV > 0 && myRecvPTV < 0 && Math.abs(myRecvPTV) > mySendPTV * 0.5) {
      if (enableDebugLog) {
        console.log(`[REJECTED] Sending positive value for negative value: send=${mySendPTV.toFixed(2)}, recv=${myRecvPTV.toFixed(2)}`);
      }
      return false;
    }
    
    // Note: We don't reject trades based on individual player MIN_PTV_THRESHOLD here
    // because that check is too restrictive and would filter out potentially valid trades
    // with struggling players. The fairness ratio check is sufficient.
    
    const hasStarSend = mySendPlayers.some(p => p.ptvPercentile >= CONFIG.STAR_PLAYER_PERCENTILE);
    const hasStarRecv = myRecvPlayers.some(p => p.ptvPercentile >= CONFIG.STAR_PLAYER_PERCENTILE);
    
    // Apply stricter fairness for star player trades
    let effectiveMaxFairness = maxFairness;
    if (hasStarSend || hasStarRecv) {
      effectiveMaxFairness = maxFairness * CONFIG.STAR_TRADE_FAIRNESS_MULTIPLIER;
    }
    
    // Additional check: if sending a star player, require even stricter fairness
    // Only apply if we're sending positive value
    if (hasStarSend && mySendPTV > 0) {
      // If I'm sending a star, I need to get at least 85% of their value back
      const minRecvRatio = 0.85;
      if (r < minRecvRatio) {
        if (enableDebugLog) {
          console.log(`[REJECTED] Star player trade too lopsided: ratio ${r.toFixed(3)} < ${minRecvRatio}`);
        }
        return false;
      }
    }
    
    // Additional check: reject extremely lopsided trades regardless of other factors
    // Only apply if both sides have positive PTV (avoid issues with negative PTV)
    if (mySendPTV > 0 && myRecvPTV > 0) {
      if (r < 0.5 || r > 2.0) {
        if (enableDebugLog) {
          console.log(`[REJECTED] Extremely lopsided trade: ratio ${r.toFixed(3)} outside [0.5, 2.0]`);
        }
        return false;
      }
    }
    
    // NEW: Enhanced fairness checks to prevent FG%/FT% from masking bad trades
    // Check if opponent is getting crushed despite FG%/FT% gains
    const theirDelta = t.analysis.deltas.them.teamScoreDelta;
    const theirCatDeltas = t.analysis.deltas.them.categoryDelta;
    
    // Count how many categories they lose vs gain (with capped FG%/FT%)
    let categoriesLost = 0;
    let categoriesGained = 0;
    for (const cat of CATEGORY_KEYS) {
      let delta = theirCatDeltas[cat] ?? 0;
      // Cap FG%/FT% to prevent them from hiding massive losses
      if (cat === 'fgPct' || cat === 'ftPct') {
        delta = capPercentageDelta(delta);
      }
      if (delta < -0.05) categoriesLost++;
      if (delta > 0.05) categoriesGained++;
    }
    
    // Reject if opponent loses badly in most categories AND has negative team score delta
    if (categoriesLost >= 6 && theirDelta < -0.05) {
      if (enableDebugLog) {
        console.log(`[REJECTED] Opponent crushed: loses ${categoriesLost}/9 categories, teamDelta=${theirDelta.toFixed(3)}`);
      }
      return false;
    }
    
    // Reject if opponent has very negative team score delta (beyond tolerance)
    if (theirDelta < -0.10) {
      if (enableDebugLog) {
        console.log(`[REJECTED] Opponent teamScoreDelta too negative: ${theirDelta.toFixed(3)}`);
      }
      return false;
    }
    
    // Calculate PTV-based fairness ratio (both sides of the trade)
    const theirSendPTV = mySendPlayers.reduce((s, p) => s + (p.ptv || 0), 0);  // Actually their players
    const theirRecvPTV = myRecvPlayers.reduce((s, p) => s + (p.ptv || 0), 0);  // Actually my players
    const theirNetPTV = theirSendPTV - theirRecvPTV;  // Their send minus their receive (opposite of mine)
    const myNetPTV = myRecvPTV - mySendPTV;
    
    // Both sides must have reasonable net PTV (not crushing one side)
    // Allow some asymmetry for roster needs, but not too much
    if (Math.abs(myNetPTV) > 15 || Math.abs(theirNetPTV) > 15) {
      if (enableDebugLog) {
        console.log(`[REJECTED] Extreme PTV imbalance: myNet=${myNetPTV.toFixed(1)}, theirNet=${theirNetPTV.toFixed(1)}`);
      }
      return false;
    }
    
    // Roster spot tax for 2-for-1 trades
    let adjustedFairnessRatio = r;
    if (t.candidate.type === "2for1") {
      if (t.candidate.send.length === 2) {
        // I'm giving 2, getting 1: require I receive more value
        adjustedFairnessRatio = r * 0.95; // Apply 5% penalty to received value
      } else {
        // I'm giving 1, getting 2: I can accept slightly less per player
        adjustedFairnessRatio = r * 1.05; // Apply 5% bonus to received value
      }
    }
    
    const minRatio = 1 / effectiveMaxFairness;
    const maxRatio = effectiveMaxFairness;
    const fairnessOK = adjustedFairnessRatio >= minRatio && adjustedFairnessRatio <= maxRatio;
    const oppOK = gradeToScore(t.oppGrade) >= minOppGradeScore;
    const myOK = t.analysis.deltas.my.teamScoreDelta >= minMyDelta;
    
    // Enhanced opponent benefit constraint: stricter in first passes
    // Ensure opponent doesn't get crushed (prevent "robbery" trades)
    const strictOppDelta = minOppDelta === -0.03 ? -0.01 : minOppDelta; // Stricter for first pass
    const themOK = t.analysis.deltas.them.teamScoreDelta >= strictOppDelta;
    
    const passes = fairnessOK && oppOK && myOK && themOK;
    
    // Debug logging for rejected trades
    if (enableDebugLog && !passes) {
      const sendNames = t.candidate.send.map(p => p.name).join(", ");
      const recvNames = t.candidate.receive.map(p => p.name).join(", ");
      
      // Calculate FG%/FT% pp changes for debug
      const myFgDelta = t.analysis.deltas.my.categoryDelta.fgPct ?? 0;
      const myFtDelta = t.analysis.deltas.my.categoryDelta.ftPct ?? 0;
      const theirFgDelta = t.analysis.deltas.them.categoryDelta.fgPct ?? 0;
      const theirFtDelta = t.analysis.deltas.them.categoryDelta.ftPct ?? 0;
      
      console.log(`[REJECTED] ${sendNames} for ${recvNames}`);
      console.log(`  PTV: mySend=${mySendPTV.toFixed(1)}, myRecv=${myRecvPTV.toFixed(1)}, myNet=${myNetPTV.toFixed(1)}`);
      console.log(`  PTV: theirSend=${theirSendPTV.toFixed(1)}, theirRecv=${theirRecvPTV.toFixed(1)}, theirNet=${theirNetPTV.toFixed(1)}`);
      console.log(`  Fairness Ratio: ${r.toFixed(3)}, Adjusted: ${adjustedFairnessRatio.toFixed(3)}, Range: [${minRatio.toFixed(3)}, ${maxRatio.toFixed(3)}]`);
      console.log(`  FG%/FT% deltas (raw): my FG=${myFgDelta.toFixed(3)}, FT=${myFtDelta.toFixed(3)} | their FG=${theirFgDelta.toFixed(3)}, FT=${theirFtDelta.toFixed(3)}`);
      console.log(`  FG%/FT% deltas (capped): my FG=${capPercentageDelta(myFgDelta).toFixed(3)}, FT=${capPercentageDelta(myFtDelta).toFixed(3)} | their FG=${capPercentageDelta(theirFgDelta).toFixed(3)}, FT=${capPercentageDelta(theirFtDelta).toFixed(3)}`);
      console.log(`  Team Score: my=${t.analysis.deltas.my.teamScoreDelta.toFixed(3)}, their=${t.analysis.deltas.them.teamScoreDelta.toFixed(3)}`);
      console.log(`  Categories: theyLose=${categoriesLost}, theyGain=${categoriesGained}`);
      console.log(`  Fairness: ${fairnessOK ? "✓" : "✗"} | My Delta: ${myOK ? "✓" : "✗"} | Opp Grade: ${oppOK ? "✓" : "✗"} (${t.oppGrade}) | Opp Delta: ${themOK ? "✓" : "✗"}`);
      if (hasStarSend) console.log(`  ⚠️  Sending star player - stricter rules applied`);
      if (hasStarRecv) console.log(`  ⚠️  Receiving star player - stricter rules applied`);
    }
    
    return passes;
  });
}

export function generateRationale(analysis: TradeAnalysis, myGrade: string, oppGrade: string): string[] {
  const bullets: string[] = [];
  if (analysis.deltas.my.teamScoreDelta > 0.08) bullets.push(`Improves your team score by +${analysis.deltas.my.teamScoreDelta.toFixed(2)}.`);
  if (analysis.deltas.them.teamScoreDelta > 0.04) bullets.push(`Also helps opponent (+${analysis.deltas.them.teamScoreDelta.toFixed(2)}), making it realistic.`);
  bullets.push(`Grades: you ${myGrade}, them ${oppGrade}.`);

  const swings = CATEGORY_KEYS
    .map((c) => ({ c, v: adjustDeltaForTO(c, analysis.deltas.my.categoryDelta[c] ?? 0) }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 2);

  for (const x of swings) {
    if (Math.abs(x.v) < 0.12) continue;
    bullets.push(`${x.v > 0 ? "Boosts" : "Costs"} ${x.c.toUpperCase()} (${x.v > 0 ? "+" : ""}${x.v.toFixed(2)} z).`);
  }
  return bullets;
}

function convertToSuggestion(
  trade: ScoredTrade,
  oppTeam: any,
  myPlayers: PlayerValue[],
  oppPlayers: PlayerValue[],
  totalTeams: number
): TradeSuggestion {
  const a = trade.analysis;

  const myAvgBefore = calculateAvgPlacement(a.myBefore.ranks);
  const myAvgAfter = calculateAvgPlacement(a.myAfter.ranks);
  const oppAvgBefore = calculateAvgPlacement(a.themBefore.ranks);
  const oppAvgAfter = calculateAvgPlacement(a.themAfter.ranks);

  const myPercentBefore = calculateCategoryPercentiles(a.myBefore.ranks, totalTeams);
  const myPercentAfter = calculateCategoryPercentiles(a.myAfter.ranks, totalTeams);
  const myPercentDelta: Record<string, number> = {};
  for (const c of CATEGORY_KEYS) myPercentDelta[c] = myPercentAfter[c] - myPercentBefore[c];

  const oppPercentBefore = calculateCategoryPercentiles(a.themBefore.ranks, totalTeams);
  const oppPercentAfter = calculateCategoryPercentiles(a.themAfter.ranks, totalTeams);
  const oppPercentDelta: Record<string, number> = {};
  for (const c of CATEGORY_KEYS) oppPercentDelta[c] = oppPercentAfter[c] - oppPercentBefore[c];

  const myCategoryDetails: CategoryDetail[] = CATEGORY_KEYS.map((cat) => {
    const totalBefore = (a.myBefore.totals as any)[cat] ?? 0;
    const totalAfter = (a.myAfter.totals as any)[cat] ?? 0;
    const isPct = cat === "fgPct" || cat === "ftPct";
    const deltaTotal = totalAfter - totalBefore;
    
    // For percentages, deltaTotalPct is in percentage points (pp)
    // For counting stats, it's the percent change
    const deltaTotalPct = isPct 
      ? deltaTotal * 100 // Convert decimal to percentage points
      : (totalBefore !== 0 ? (deltaTotal / totalBefore) * 100 : 0);
    
    const percentileBefore = myPercentBefore[cat] ?? 0;
    const percentileAfter = myPercentAfter[cat] ?? 0;
    const percentileDelta = percentileAfter - percentileBefore;
    
    return {
      category: cat,
      totalBefore,
      totalAfter,
      deltaTotal,
      deltaTotalPct,
      rankBefore: a.myBefore.ranks[cat] ?? totalTeams,
      rankAfter: a.myAfter.ranks[cat] ?? totalTeams,
      rankDelta: (a.myAfter.ranks[cat] ?? totalTeams) - (a.myBefore.ranks[cat] ?? totalTeams),
      percentileBefore,
      percentileAfter,
      percentileDelta,
    };
  });

  const oppCategoryDetails: CategoryDetail[] = CATEGORY_KEYS.map((cat) => {
    const totalBefore = (a.themBefore.totals as any)[cat] ?? 0;
    const totalAfter = (a.themAfter.totals as any)[cat] ?? 0;
    const isPct = cat === "fgPct" || cat === "ftPct";
    const deltaTotal = totalAfter - totalBefore;
    
    const deltaTotalPct = isPct 
      ? deltaTotal * 100 
      : (totalBefore !== 0 ? (deltaTotal / totalBefore) * 100 : 0);
    
    const percentileBefore = oppPercentBefore[cat] ?? 0;
    const percentileAfter = oppPercentAfter[cat] ?? 0;
    const percentileDelta = percentileAfter - percentileBefore;
    
    return {
      category: cat,
      totalBefore,
      totalAfter,
      deltaTotal,
      deltaTotalPct,
      rankBefore: a.themBefore.ranks[cat] ?? totalTeams,
      rankAfter: a.themAfter.ranks[cat] ?? totalTeams,
      rankDelta: (a.themAfter.ranks[cat] ?? totalTeams) - (a.themBefore.ranks[cat] ?? totalTeams),
      percentileBefore,
      percentileAfter,
      percentileDelta,
    };
  });

  const myTopGains = CATEGORY_KEYS
    .map((c) => ({ category: c, delta: adjustDeltaForTO(c, a.deltas.my.categoryDelta[c] ?? 0) }))
    .filter((x) => x.delta > 0.12)
    .sort((x, y) => y.delta - x.delta)
    .slice(0, 3);

  const myTopLosses = CATEGORY_KEYS
    .map((c) => ({ category: c, delta: adjustDeltaForTO(c, a.deltas.my.categoryDelta[c] ?? 0) }))
    .filter((x) => x.delta < -0.12)
    .sort((x, y) => x.delta - y.delta)
    .slice(0, 3);

  const oppTopGains = CATEGORY_KEYS
    .map((c) => ({ category: c, delta: adjustDeltaForTO(c, a.deltas.them.categoryDelta[c] ?? 0) }))
    .filter((x) => x.delta > 0.12)
    .sort((x, y) => y.delta - x.delta)
    .slice(0, 3);

  const oppTopLosses = CATEGORY_KEYS
    .map((c) => ({ category: c, delta: adjustDeltaForTO(c, a.deltas.them.categoryDelta[c] ?? 0) }))
    .filter((x) => x.delta < -0.12)
    .sort((x, y) => x.delta - y.delta)
    .slice(0, 3);

  const ids = new Set([...trade.candidate.send, ...trade.candidate.receive].map((p) => p.playerId));
  const hasCorePlayer = [...myPlayers, ...oppPlayers].some((p) => ids.has(p.playerId) && p.isCore);

  const probability = calculateProbability(
    a.fairnessRatio, 
    trade.myGrade, 
    trade.oppGrade, 
    hasCorePlayer, 
    a.deltas.them.teamScoreDelta,
    a.deltas.my.teamScoreDelta,
    myAvgAfter - myAvgBefore
  );
  const confidence = calculateConfidence(trade.candidate, myPlayers, oppPlayers);

  return {
    id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    partnerTeam: {
      id: oppTeam.id,
      name: oppTeam.name,
      avatarUrl: oppTeam.logoUrl || oppTeam.avatarUrl || null,
    },
    trade: trade.candidate,
    impact: {
      my: {
        teamScoreBefore: a.myBefore.teamScore0to9,
        teamScoreAfter: a.myAfter.teamScore0to9,
        teamScoreDelta: a.deltas.my.teamScoreDelta,
        avgPlacementBefore: myAvgBefore,
        avgPlacementAfter: myAvgAfter,
        avgPlacementDelta: myAvgAfter - myAvgBefore,
        categoryPercentilesBefore: myPercentBefore,
        categoryPercentilesAfter: myPercentAfter,
        categoryPercentilesDelta: myPercentDelta,
        categoryDetails: myCategoryDetails,
        grade: trade.myGrade,
        probability,
        confidence,
      },
      opp: {
        teamScoreBefore: a.themBefore.teamScore0to9,
        teamScoreAfter: a.themAfter.teamScore0to9,
        teamScoreDelta: a.deltas.them.teamScoreDelta,
        avgPlacementBefore: oppAvgBefore,
        avgPlacementAfter: oppAvgAfter,
        avgPlacementDelta: oppAvgAfter - oppAvgBefore,
        categoryPercentilesBefore: oppPercentBefore,
        categoryPercentilesAfter: oppPercentAfter,
        categoryPercentilesDelta: oppPercentDelta,
        categoryDetails: oppCategoryDetails,
        grade: trade.oppGrade,
        probability,
        confidence,
      },
    },
    summary: { myTopGains, myTopLosses, oppTopGains, oppTopLosses },
    rationaleBullets: generateRationale(a, trade.myGrade, trade.oppGrade),
  };
}

// ============================================================================
// MAIN ENTRY
// ============================================================================
export async function generateTradeSuggestions(
  myTeam: any,
  allTeams: any[],
  allTeamsTotals: TeamTotals[],
  leagueDist: LeagueDistribution,
  options: TradeEngineOptions
): Promise<{ suggestions: TradeSuggestion[]; debug?: any; ok?: boolean; reason?: string }> {
  const totalTeams = allTeamsTotals.length;

  const allRosteredPlayers: PlayerValue[] = [];
  const teamPlayerMaps = new Map<string, PlayerValue[]>();

  for (const team of allTeams) {
    const teamPlayers: PlayerValue[] = [];
    for (const rosterEntry of team.roster || []) {
      const player = rosterEntry.player;
      if (!player) continue;

      const pv = computePlayerValue(
        player,
        leagueDist,
        options.seasonYear,
        rosterEntry,
        options.defaultGamesPerWeek ?? 4,
        options.scoringPeriodStartDate,
        options.scoringPeriodEndDate
      );
      if (pv) {
        teamPlayers.push(pv);
        allRosteredPlayers.push(pv);
      }
    }
    teamPlayerMaps.set(team.id, teamPlayers);
  }

  calculatePTVPercentiles(allRosteredPlayers);

  const myPlayers = teamPlayerMaps.get(options.myTeamId) || [];
  const myTotals = allTeamsTotals.find((t) => t.teamId === options.myTeamId);
  if (!myTotals) {
    return { suggestions: [], ok: false, reason: "My team totals not found", debug: { teamId: options.myTeamId } };
  }

  const myZ = zScore(myTotals, leagueDist);
  const myFocus = identifyFocusCategories(myZ);

  const myUntouchables = identifyUntouchables(myPlayers, options.excludeUntouchables, options.untouchables);
  const minOppGradeScore = gradeToScore(options.minOpponentGrade);

  const allSuggestions: TradeSuggestion[] = [];
  const debug: any = { partners: [], summary: { candidatesGenerated: 0, final: 0 } };

  for (const oppTeam of allTeams) {
    if (oppTeam.id === options.myTeamId) continue;

    const oppPlayers = teamPlayerMaps.get(oppTeam.id) || [];
    const oppTotals = allTeamsTotals.find((t) => t.teamId === oppTeam.id);
    if (!oppTotals) continue;

    const oppZ = zScore(oppTotals, leagueDist);
    const oppFocus = identifyFocusCategories(oppZ);

    const oppUntouchables = identifyUntouchables(oppPlayers, options.excludeUntouchables, undefined);

    let candidates: TradeCandidate[] = [];
    const size = options.tradeSize;

    if (!size || size === "1for1") candidates.push(...generate1For1Trades(myPlayers, oppPlayers, myUntouchables, oppUntouchables, options.includeQuestionable));
    if (!size || size === "2for1") candidates.push(...generate2For1Trades(myPlayers, oppPlayers, myUntouchables, oppUntouchables, options.includeQuestionable));
    if (!size || size === "2for2") candidates.push(...generate2For2Trades(myPlayers, oppPlayers, myUntouchables, oppUntouchables, options.includeQuestionable));

    debug.summary.candidatesGenerated += candidates.length;

    const scored: ScoredTrade[] = [];
    for (const cand of candidates) {
      const analysis = analyzeTrade(
        cand,
        options.myTeamId,
        oppTeam.id,
        myTotals,
        oppTotals,
        myPlayers,
        oppPlayers,
        leagueDist,
        allTeamsTotals,
        allRosteredPlayers
      );
      if (!analysis) continue;

      const myAvgBefore = calculateAvgPlacement(analysis.myBefore.ranks);
      const myAvgAfter = calculateAvgPlacement(analysis.myAfter.ranks);
      const oppAvgBefore = calculateAvgPlacement(analysis.themBefore.ranks);
      const oppAvgAfter = calculateAvgPlacement(analysis.themAfter.ranks);

      const myGrade = calculateTradeGrade(analysis.deltas.my.teamScoreDelta, myAvgAfter - myAvgBefore, analysis.deltas.my.categoryDelta);
      const oppGrade = calculateTradeGrade(analysis.deltas.them.teamScoreDelta, oppAvgAfter - oppAvgBefore, analysis.deltas.them.categoryDelta);

      const oppWeaknessGains =
        oppFocus.weaknesses
          .map((c) => analysis.deltas.them.categoryDelta[c] ?? 0)
          .filter((d) => d > 0)
          .reduce((s, d) => s + d, 0);

      const score = scoreTrade(analysis, myFocus.weaknesses, oppFocus.weaknesses, myFocus.strengths);
      scored.push({ candidate: cand, analysis, score, myGrade, oppGrade, oppWeaknessGains });
    }

    const enableDebug = process.env.NODE_ENV === "development";
    
    let filtered = filterTrades(scored, CONFIG.FAIRNESS_STRICT, minOppGradeScore, 0.03, -0.03, myPlayers, oppPlayers, enableDebug);
    if (!filtered.length) filtered = filterTrades(scored, CONFIG.FAIRNESS_RELAXED, minOppGradeScore - 1, 0.01, -0.08, myPlayers, oppPlayers, enableDebug);
    if (!filtered.length) filtered = filterTrades(scored, CONFIG.FAIRNESS_FINAL, Math.max(0, minOppGradeScore - 2), 0.0, -0.15, myPlayers, oppPlayers, enableDebug);

    const top = filtered.sort((a, b) => b.score - a.score).slice(0, CONFIG.MAX_SUGGESTIONS_PER_PARTNER);

    debug.partners.push({
      team: oppTeam.name,
      candidatesGenerated: candidates.length,
      afterFilters: filtered.length,
      finalReturned: top.length,
    });

    for (const t of top) {
      allSuggestions.push(convertToSuggestion(t, oppTeam, myPlayers, oppPlayers, totalTeams));
    }
  }

  const finalSuggestions = allSuggestions
    .sort((a, b) => {
      const aS = gradeToScore(a.impact.my.grade) + gradeToScore(a.impact.opp.grade) + a.impact.my.teamScoreDelta * 5;
      const bS = gradeToScore(b.impact.my.grade) + gradeToScore(b.impact.opp.grade) + b.impact.my.teamScoreDelta * 5;
      return bS - aS;
    })
    .slice(0, CONFIG.TARGET_TOTAL_SUGGESTIONS);

  debug.summary.final = finalSuggestions.length;

  if (!finalSuggestions.length) {
    return { suggestions: [], ok: false, reason: "No trades passed quality filters.", debug };
  }

  return { suggestions: finalSuggestions, ok: true, debug };
}
