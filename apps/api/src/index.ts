import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { PrismaClient } from "@prisma/client";
import {
  extractPlayerStats,
  aggregateTeam,
  computeLeagueDistributions,
  zScore,
  rankTeams,
  teamScore,
  type TeamTotals,
  type TeamProfile,
} from "./lib/analytics.js";
import { extractNineCatFromPlayerMeta, getStatsDebugInfo } from "./lib/playerStats.js";
import { extractInjuryInfo, calculateProjectedGamesThisWeek, type InjuryInfo } from "./lib/injuryHelpers.js";
import {
  calculateTeamWeeklyProjection,
  calculateMatchupResults,
  type NineCatTotals,
  type WeeklyTeamProjection,
  type NineCatKey,
} from "./lib/weeklyProjections.js";
import {
  computePlayerValue,
  calculatePTVPercentiles,
  identifyFocusCategories,
  identifyUntouchables,
  generate1For1Trades,
  generate2For1Trades,
  generate2For2Trades,
  analyzeTrade,
  scoreTrade,
  generateRationale,
  calculateAvgPlacement,
  calculateCategoryPercentiles,
  calculateTradeGrade,
  calculateProbability,
  calculateConfidence,
  gradeToScore as gradeToScoreFn,
  type PlayerValue,
  type TradeCandidate,
  type TradeSuggestion,
  type TradeAnalysis,
  type CategoryDetail,
  type NineCategory as CategoryKey,
} from "./lib/tradeEngine.js";

// ---------- ENV LOADING ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load repo-root .env
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

console.log("ENV LOADED", {
  league: process.env.ESPN_LEAGUE_ID,
  season: process.env.ESPN_SEASON_ID,
  s2: !!process.env.ESPN_S2,
  swid: !!process.env.ESPN_SWID,
});

// ---------- APP ----------
const app = express();
console.log("SERVER BUILD ID:", Date.now());

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const prisma = new PrismaClient();

// ---------- HELPERS (AVATARS / IMAGE PROXY) ----------
function normalizeEspnUrl(url: string | null): string | null {
  if (!url || typeof url !== "string") return null;

  // ESPN sometimes returns http logos; normalize to https
  if (url.startsWith("http://")) return "https://" + url.slice("http://".length);

  return url;
}

function proxiedImage(req: express.Request, url: string | null) {
  const fixed = normalizeEspnUrl(url);
  if (!fixed) return null;
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/proxy/image?url=${encodeURIComponent(fixed)}`;
}

async function getTeamAvatarUrl(req: express.Request, teamDbId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamDbId },
    select: { meta: true },
  });

  const meta = (team?.meta as any) || {};

  // ESPN logo fields vary a lot; try them all
  const logo =
    meta.logo ||
    meta.logoUrl ||
    meta.teamLogo ||
    meta?.logos?.[0]?.href ||
    meta?.logos?.[0]?.url ||
    meta?.logoUrls?.[0] ||
    null;

  // 1) Always prefer the team logo if ESPN provides it
  const proxiedLogo = proxiedImage(req, logo);
  if (proxiedLogo) return proxiedLogo;

  // 2) Fallback: first roster player's headshot
  const firstRoster = await prisma.rosterSlot.findFirst({
    where: { teamId: teamDbId, endAt: null },
    select: { player: { select: { providerPlayerId: true } } },
    orderBy: { createdAt: "asc" },
  });

  const pid = firstRoster?.player?.providerPlayerId;
  if (pid) {
    const headshot = `https://a.espncdn.com/i/headshots/nba/players/full/${pid}.png`;
    return proxiedImage(req, headshot);
  }

  return null;
}

// ---------- ROUTES ----------

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Resolve league key (UUID or providerLeagueId) to internal league ID
app.get("/resolve/league/:leagueKey", async (req, res) => {
  const leagueKey = req.params.leagueKey;

  try {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (uuidRegex.test(leagueKey)) {
      const league = await prisma.league.findUnique({
        where: { id: leagueKey },
        select: { id: true, name: true },
      });
      if (league) return res.json({ leagueId: league.id, leagueName: league.name });
      return res.status(404).json({ error: "League not found" });
    }

    const league = await prisma.league.findFirst({
      where: { provider: "ESPN", providerLeagueId: leagueKey },
      select: { id: true, name: true },
    });

    if (!league) {
      return res.status(404).json({
        error: `League with ESPN ID "${leagueKey}" not found. Please run ingestion first.`,
      });
    }

    return res.json({ leagueId: league.id, leagueName: league.name });
  } catch (err) {
    console.error("Error resolving league:", err);
    return res.status(500).json({ error: "Failed to resolve league" });
  }
});

// Resolve team key (UUID, providerTeamId, or name) to internal team ID
app.get("/resolve/team/:leagueId/:teamKey", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamKey = req.params.teamKey;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (uuidRegex.test(teamKey)) {
      const team = await prisma.team.findFirst({
        where: { id: teamKey, leagueId },
        select: { id: true, name: true, providerTeamId: true },
      });
      if (team) {
        return res.json({ teamId: team.id, teamName: team.name, providerTeamId: team.providerTeamId });
      }
      return res.status(404).json({ error: "Team not found" });
    }

    if (/^\d+$/.test(teamKey)) {
      const team = await prisma.team.findFirst({
        where: { leagueId, providerTeamId: teamKey },
        select: { id: true, name: true, providerTeamId: true },
      });
      if (team) {
        return res.json({ teamId: team.id, teamName: team.name, providerTeamId: team.providerTeamId });
      }
    }

    const team = await prisma.team.findFirst({
      where: {
        leagueId,
        name: { equals: teamKey, mode: "insensitive" },
      },
      select: { id: true, name: true, providerTeamId: true },
    });

    if (!team) return res.status(404).json({ error: `Team "${teamKey}" not found in league` });

    return res.json({ teamId: team.id, teamName: team.name, providerTeamId: team.providerTeamId });
  } catch (err) {
    console.error("Error resolving team:", err);
    return res.status(500).json({ error: "Failed to resolve team" });
  }
});

// Image proxy endpoint to bypass CORS + handle ESPN "mystique" images that may require cookies
app.get("/proxy/image", async (req, res) => {
  const raw = String(req.query.url ?? "");
  if (!raw) return res.status(400).json({ error: "Missing url parameter" });

  const imageUrl = raw.trim();

  let u: URL;
  try {
    u = new URL(imageUrl);
  } catch {
    return res.status(400).json({ error: "Invalid url" });
  }

  const allowedHosts = new Set([
    "a.espncdn.com",
    "cdn.espn.com",
    "fantasy.espn.com",
    "mystique-api.fantasy.espn.com",
  ]);

  const hostOk = allowedHosts.has(u.hostname) || u.hostname.endsWith(".espncdn.com");
  if (!hostOk) return res.status(400).json({ error: "Host not allowed" });

  // ONLY attach cookies for mystique (these come from your .env on the server)
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://fantasy.espn.com/",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  };

  if (u.hostname === "mystique-api.fantasy.espn.com") {
    const espn_s2 = process.env.ESPN_S2;
    const swid = process.env.ESPN_SWID;
    if (espn_s2 && swid) {
      headers["Cookie"] = `espn_s2=${espn_s2.trim()}; SWID=${swid.trim()}; swid=${swid.trim()};`;
    }
  }

  try {
    const r = await fetch(u.toString(), { redirect: "follow", headers });

    if (!r.ok) {
      // log upstream so you can see if it’s 403 vs 404
      console.error("proxy/image upstream failed", {
        url: u.toString(),
        status: r.status,
        contentType: r.headers.get("content-type"),
      });
      return res.status(404).json({ error: "Image not found", status: r.status });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    let contentType = (r.headers.get("content-type") || "").trim();

    // If ESPN doesn't send a content-type, sniff
    if (!contentType) {
      const head = buf.slice(0, 200).toString("utf8").toLowerCase();
      if (head.includes("<svg")) contentType = "image/svg+xml";
      else if (buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a") contentType = "image/png";
      else if (buf.slice(0, 3).toString("hex") === "ffd8ff") contentType = "image/jpeg";
      else contentType = "application/octet-stream";
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(buf);
  } catch (err) {
    console.error("Image proxy error:", err);
    return res.status(500).json({ error: "Failed to fetch image" });
  }
});



// Get team roster with player headshots
app.get("/leagues/:leagueId/teams/:teamId/roster", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.params.teamId;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true },
    });
    if (!team) return res.status(404).json({ error: "Team not found or not in league" });

    const rosterSlots = await prisma.rosterSlot.findMany({
      where: { teamId, endAt: null },
      select: {
        player: { select: { id: true, fullName: true, providerPlayerId: true, meta: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const roster = rosterSlots.map((slot) => {
      const player = slot.player;
      const meta = (player.meta as any) || {};
      const positions = meta.positions || [];

      let headshotUrl: string | null = null;
      if (player.providerPlayerId) {
        headshotUrl = proxiedImage(
          req,
          `https://a.espncdn.com/i/headshots/nba/players/full/${player.providerPlayerId}.png`
        );
      }

      return {
        id: player.id,
        fullName: player.fullName,
        providerPlayerId: player.providerPlayerId,
        positions,
        headshotUrl,
      };
    });

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({ teamId: team.id, teamName: team.name, roster });
  } catch (err) {
    console.error("Error fetching roster:", err);
    return res.status(500).json({ error: "Failed to fetch roster" });
  }
});

// Get team roster with player stats
app.get("/leagues/:leagueId/teams/:teamId/roster/stats", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.params.teamId;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, seasonYear: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true },
    });
    if (!team) return res.status(404).json({ error: "Team not found or not in league" });

    const rosterSlots = await prisma.rosterSlot.findMany({
      where: { teamId, endAt: null },
      select: {
        meta: true,
        slotLabel: true,
        player: { select: { id: true, fullName: true, providerPlayerId: true, meta: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const roster = rosterSlots.map((slot) => {
      const player = slot.player;
      const meta = (player.meta as any) || {};
      const positions = meta.positions || [];
      const slotMeta = (slot.meta as any) || {};

      let headshotUrl: string | null = null;
      if (player.providerPlayerId) {
        headshotUrl = proxiedImage(
          req,
          `https://a.espncdn.com/i/headshots/nba/players/full/${player.providerPlayerId}.png`
        );
      }

      // Extract player stats with normalized source metadata, filtered by league seasonYear
      const playerStats = extractNineCatFromPlayerMeta(meta, league.seasonYear);

      // Extract injury info from player meta and lineup slot
      const lineupSlotId = typeof slotMeta.lineupSlotId === "number" ? slotMeta.lineupSlotId : null;
      const injuryInfo = extractInjuryInfo(meta, lineupSlotId);
      
      // Also check rosterSlot.meta for stored status (from ingestion)
      const storedStatus = slotMeta.status;
      const storedIsIR = slotMeta.isIR === true;
      
      // Use stored status if available, otherwise use extracted injury info
      const finalStatus = storedStatus || injuryInfo.status;
      const isIR = storedIsIR || injuryInfo.status === "IR" || injuryInfo.status === "OUT";
      const lineupSlot = slotMeta.lineupSlot || slot.slotLabel || null;

      return {
        id: player.id,
        fullName: player.fullName,
        providerPlayerId: player.providerPlayerId,
        positions,
        headshotUrl,
        isIR,
        status: finalStatus,
        lineupSlot,
        injuryStatus: injuryInfo.status,
        injuryDescription: injuryInfo.description,
        estimatedReturnDate: injuryInfo.estimatedReturnDate,
        stats: {
          perGame: playerStats.perGame,
          totals: playerStats.totals,
          source: playerStats.source,
          statsSource: playerStats.statsSource, // CURRENT_SEASON, ESPN_PROJECTION, or NONE
        },
        derived: playerStats.hasStats ? {
          roleHint: null, // Will be computed on frontend
        } : undefined,
      };
    });

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({ teamId: team.id, teamName: team.name, roster });
  } catch (err) {
    console.error("Error fetching roster stats:", err);
    return res.status(500).json({ error: "Failed to fetch roster stats" });
  }
});

// Get unified weekly projections with league averages and matchup
app.get("/leagues/:leagueId/weekly-projections", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.query.teamId as string | undefined;

  if (!teamId) {
    return res.status(400).json({ error: "teamId query parameter required" });
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, seasonYear: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    // Get all teams for league averages calculation
    const allTeams = await prisma.team.findMany({
      where: { leagueId },
      select: {
        id: true,
        name: true,
        meta: true,
        providerTeamId: true,
        rosterSlots: {
          where: { endAt: null },
          select: {
            meta: true,
            slotLabel: true,
            player: { select: { id: true, fullName: true, meta: true } },
          },
        },
      },
    });

    // Get scoring period info from first team's meta (schedule is stored in team meta during ingestion)
    const firstTeamMeta = (allTeams[0]?.meta as any) || {};
    const currentMatchupPeriod = firstTeamMeta.matchup?.matchupPeriodId || 1;
    // Schedule is stored in league settings or we can get it from team matchups
    const defaultGamesPerWeek = 4;
    const scoringPeriodStartDate = firstTeamMeta.scoringPeriodStartDate || null;
    const scoringPeriodEndDate = firstTeamMeta.scoringPeriodEndDate || null;

    // Calculate projections for ALL teams (for league averages)
    const teamProjections: Array<{ teamId: string; totals: NineCatTotals; totalsWithAttempts: any }> = [];

    for (const team of allTeams) {
      const { totals, totalsWithAttempts } = await calculateTeamWeeklyProjection(
        team.rosterSlots,
        league.seasonYear,
        defaultGamesPerWeek,
        scoringPeriodStartDate || undefined,
        scoringPeriodEndDate || undefined
      );
      teamProjections.push({ teamId: team.id, totals, totalsWithAttempts });
    }

    // Calculate league averages (MUST be constant regardless of teamId)
    // Use attempt-weighted approach for percentages
    const leagueAverages: NineCatTotals = {
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

    for (const proj of teamProjections) {
      leagueAverages.pts += proj.totals.pts;
      leagueAverages.reb += proj.totals.reb;
      leagueAverages.ast += proj.totals.ast;
      leagueAverages.stl += proj.totals.stl;
      leagueAverages.blk += proj.totals.blk;
      leagueAverages.threes += proj.totals.threes;
      leagueAverages.tov += proj.totals.tov;

      // Use actual attempts from totalsWithAttempts
      totalFga += proj.totalsWithAttempts.fga || 0;
      totalFgm += proj.totalsWithAttempts.fgm || 0;
      totalFta += proj.totalsWithAttempts.fta || 0;
      totalFtm += proj.totalsWithAttempts.ftm || 0;
    }

    const teamCount = teamProjections.length;
    if (teamCount > 0) {
      leagueAverages.pts /= teamCount;
      leagueAverages.reb /= teamCount;
      leagueAverages.ast /= teamCount;
      leagueAverages.stl /= teamCount;
      leagueAverages.blk /= teamCount;
      leagueAverages.threes /= teamCount;
      leagueAverages.tov /= teamCount;
      // Attempt-weighted percentages
      leagueAverages.fgPct = totalFga > 0 ? totalFgm / totalFga : 0;
      leagueAverages.ftPct = totalFta > 0 ? totalFtm / totalFta : 0;
    }

    // Get the selected team
    const selectedTeam = allTeams.find((t) => t.id === teamId);
    if (!selectedTeam) {
      return res.status(404).json({ error: "Team not found" });
    }

    // Calculate selected team's projection
    const { totals: teamTotals, players: teamPlayers } = await calculateTeamWeeklyProjection(
      selectedTeam.rosterSlots,
      league.seasonYear,
      defaultGamesPerWeek,
      scoringPeriodStartDate || undefined,
      scoringPeriodEndDate || undefined
    );

    // Get team avatar
    const teamAvatarUrl = await getTeamAvatarUrl(req, selectedTeam.id);

    const teamProjection: WeeklyTeamProjection = {
      teamId: selectedTeam.id,
      teamName: selectedTeam.name,
      avatarUrl: teamAvatarUrl,
      projectedTotals: teamTotals,
      players: teamPlayers,
    };

    // Find opponent from schedule
    const teamMeta = (selectedTeam.meta as any) || {};
    const matchupData = teamMeta.matchup || null;
    let opponentProjection: WeeklyTeamProjection | null = null;
    let matchupResults: ReturnType<typeof calculateMatchupResults> | null = null;

    if (matchupData && matchupData.opponentTeamId) {
      // Find opponent team by providerTeamId (it's a direct field, not in meta)
      const opponentProviderId = String(matchupData.opponentTeamId);
      const opponent = allTeams.find(
        (t) => t.providerTeamId === opponentProviderId
      );

      if (opponent) {
        // Calculate opponent's projection
        const { totals: opponentTotals, players: opponentPlayers } = await calculateTeamWeeklyProjection(
          opponent.rosterSlots,
          league.seasonYear,
          defaultGamesPerWeek,
          scoringPeriodStartDate || undefined,
          scoringPeriodEndDate || undefined
        );

        const opponentAvatarUrl = await getTeamAvatarUrl(req, opponent.id);

        opponentProjection = {
          teamId: opponent.id,
          teamName: opponent.name,
          avatarUrl: opponentAvatarUrl,
          projectedTotals: opponentTotals,
          players: opponentPlayers,
        };

        // Calculate matchup results
        matchupResults = calculateMatchupResults(teamTotals, opponentTotals);
      } else {
        console.warn(`Opponent not found: providerTeamId=${opponentProviderId}. Available teams:`, 
          allTeams.map(t => ({ id: t.id, name: t.name, providerTeamId: t.providerTeamId }))
        );
      }
    } else {
      console.warn(`No matchup data found for team ${selectedTeam.id}. Team meta:`, teamMeta);
    }

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({
      league: {
        id: league.id,
        name: league.name,
        seasonYear: league.seasonYear,
      },
      scoringPeriod: {
        id: currentMatchupPeriod,
        startAt: scoringPeriodStartDate || new Date().toISOString(),
        endAt: scoringPeriodEndDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      leagueAverages,
      leagueTeamsCount: teamCount,
      team: teamProjection,
      opponent: opponentProjection,
      matchup: matchupResults,
    });
  } catch (err) {
    console.error("Error fetching weekly projections:", err);
    return res.status(500).json({ error: "Failed to fetch weekly projections" });
  }
});

// Get weekly projection for team (legacy endpoint - keep for backward compatibility)
app.get("/leagues/:leagueId/teams/:teamId/weekly-projection", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.params.teamId;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, seasonYear: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true, meta: true },
    });
    if (!team) return res.status(404).json({ error: "Team not found or not in league" });

    const rosterSlots = await prisma.rosterSlot.findMany({
      where: { teamId, endAt: null },
      select: {
        meta: true,
        slotLabel: true,
        player: { select: { id: true, fullName: true, meta: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Get current matchup period from team meta (if available)
    const teamMeta = (team.meta as any) || {};
    
    // Try to get scoring period dates from league/team meta
    // For now, default to 4 games per week (typical NBA week)
    // TODO: Extract actual team schedule from ESPN API
    const defaultGamesPerWeek = 4;
    const scoringPeriodStartDate = teamMeta.scoringPeriodStartDate || null;
    const scoringPeriodEndDate = teamMeta.scoringPeriodEndDate || null;

    // Extract per-game stats and calculate projected games for all players
    const playerProjections = rosterSlots.map((slot) => {
      const player = slot.player;
      const meta = (player.meta as any) || {};
      const slotMeta = (slot.meta as any) || {};
      const playerStats = extractNineCatFromPlayerMeta(meta, league.seasonYear);
      
      // Extract injury info using helper function
      const lineupSlotId = typeof slotMeta.lineupSlotId === "number" ? slotMeta.lineupSlotId : null;
      const injuryInfo = extractInjuryInfo(meta, lineupSlotId);
      
      // Use stored status from slotMeta if available, otherwise use extracted
      const finalStatus = slotMeta.status || injuryInfo.status;
      const finalInjuryInfo: InjuryInfo = {
        status: finalStatus as InjuryInfo["status"],
        description: injuryInfo.description,
        estimatedReturnDate: injuryInfo.estimatedReturnDate,
      };
      
      // Calculate projected games using helper function
      const projectedGames = calculateProjectedGamesThisWeek(
        defaultGamesPerWeek,
        finalInjuryInfo,
        scoringPeriodStartDate || undefined,
        scoringPeriodEndDate || undefined
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
        fgPct: playerStats.perGame.fgPct, // Percentage doesn't change
        ftPct: playerStats.perGame.ftPct,
      };
      
      return {
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
        perGameStatsSource: playerStats.statsSource, // CURRENT_SEASON or ESPN_PROJECTION
      };
    });

    // Sum projected totals (excluding players with projectedGames=0)
    const cats = {
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
        cats.pts += proj.projTotals.pts;
        cats.reb += proj.projTotals.reb;
        cats.ast += proj.projTotals.ast;
        cats.stl += proj.projTotals.stl;
        cats.blk += proj.projTotals.blk;
        cats.threes += proj.projTotals.threes;
        cats.tov += proj.projTotals.tov;
        
        totalFga += proj.projTotals.fga;
        totalFgm += proj.projTotals.fgm;
        totalFta += proj.projTotals.fta;
        totalFtm += proj.projTotals.ftm;
      }
    }

    cats.fgPct = totalFga > 0 ? totalFgm / totalFga : 0;
    cats.ftPct = totalFta > 0 ? totalFtm / totalFta : 0;

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({
      projectionType: "projected_games",
      note: `Projection using per-game averages × projected games played. IR/OUT players excluded. Default: ${defaultGamesPerWeek} games/week.`,
      scoringPeriodStartDate: scoringPeriodStartDate,
      scoringPeriodEndDate: scoringPeriodEndDate,
      cats,
      byPlayer: playerProjections.map((p) => ({
        playerId: p.playerId,
        playerName: p.playerName,
        perGame: p.perGame,
        projectedGames: p.projectedGames,
        projTotals: p.projTotals,
        isIR: p.isIR,
        status: p.status,
        injuryStatus: p.injuryStatus,
        injuryDescription: p.injuryDescription,
        estimatedReturnDate: p.estimatedReturnDate,
        perGameStatsSource: p.perGameStatsSource,
      })),
    });
  } catch (err) {
    console.error("Error fetching weekly projection:", err);
    return res.status(500).json({ error: "Failed to fetch weekly projection" });
  }
});

// Get team header data (for ESPN-style header)
app.get("/leagues/:leagueId/teams/:teamId/header", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.params.teamId;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, updatedAt: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true, meta: true, updatedAt: true },
    });
    if (!team) return res.status(404).json({ error: "Team not found or not in league" });

    const teamMeta = (team.meta as any) || {};
    const standings = teamMeta.standings || null;
    const matchup = teamMeta.matchup || null;

    // Opponent name
    let opponentName: string | null = null;
    let opponentDbId: string | null = null;

    if (matchup?.opponentTeamId) {
      const opponent = await prisma.team.findFirst({
        where: { leagueId, providerTeamId: String(matchup.opponentTeamId) },
        select: { id: true, name: true },
      });
      opponentName = opponent?.name || null;
      opponentDbId = opponent?.id || null;
    }

    // Team avatar = ESPN logo (proxied), fallback to player headshot
    const myAvatarUrl = await getTeamAvatarUrl(req, team.id);
    const oppAvatarUrl = opponentDbId ? await getTeamAvatarUrl(req, opponentDbId) : null;

    return res.json({
      league: { id: league.id, name: league.name },
      team: { id: team.id, name: team.name, avatarUrl: myAvatarUrl },
      standings: standings
        ? {
            rank: standings.rank,
            wins: standings.wins,
            losses: standings.losses,
            ties: standings.ties || 0,
          }
        : null,
      matchup: matchup
        ? {
            opponentName,
            myCatsWon: matchup.myCatsWon,
            myCatsLost: matchup.myCatsLost,
            myCatsTied: matchup.myCatsTied || 0,
            oppCatsWon: matchup.oppCatsWon ?? matchup.myCatsLost,
            oppCatsLost: matchup.oppCatsLost ?? matchup.myCatsWon,
            oppCatsTied: matchup.oppCatsTied ?? matchup.myCatsTied ?? 0,
            opponentAvatarUrl: oppAvatarUrl,
          }
        : null,
      updatedAt: team.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("Failed to fetch team header:", err);
    return res.status(500).json({ error: "Failed to fetch team header" });
  }
});

// Get league standings
app.get("/leagues/:leagueId/standings", async (req, res) => {
  const leagueId = req.params.leagueId;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const teams = await prisma.team.findMany({
      where: { leagueId },
      select: { id: true, name: true, meta: true },
      orderBy: { name: "asc" },
    });

    const standings = teams
      .map((team) => {
        const meta = (team.meta as any) || {};
        const standingsData = meta.standings || {};
        return {
          teamId: team.id,
          teamName: team.name,
          rank: typeof standingsData.rank === "number" ? standingsData.rank : 999,
          wins: standingsData.wins || 0,
          losses: standingsData.losses || 0,
          ties: standingsData.ties || 0,
        };
      })
      .sort((a, b) => a.rank - b.rank);

    return res.json({ league: { id: league.id, name: league.name }, standings });
  } catch (err) {
    console.error("Failed to fetch standings:", err);
    return res.status(500).json({ error: "Failed to fetch standings" });
  }
});

// Get current matchup for a team (uses stored meta)
app.get("/leagues/:leagueId/matchup/current", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.query.teamId as string;

  if (!teamId) return res.status(400).json({ error: "teamId query parameter required" });

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true, meta: true },
    });
    if (!team) return res.status(404).json({ error: "Team not found" });

    const teamMeta = (team.meta as any) || {};
    const matchupData = teamMeta.matchup || null;

    if (!matchupData || !matchupData.opponentTeamId) {
      return res.json({ ok: false, reason: "No current matchup data available. Run ESPN data sync." });
    }

    const opponent = await prisma.team.findFirst({
      where: { leagueId, providerTeamId: String(matchupData.opponentTeamId) },
      select: { id: true, name: true },
    });

    if (!opponent) return res.json({ ok: false, reason: "Opponent team not found" });

    const teamAvatar = await getTeamAvatarUrl(req, team.id);
    const oppAvatar = await getTeamAvatarUrl(req, opponent.id);

    const teamScore = `${matchupData.myCatsWon || 0}-${matchupData.myCatsLost || 0}-${matchupData.myCatsTied || 0}`;
    const opponentScore = `${matchupData.oppCatsWon || 0}-${matchupData.oppCatsLost || 0}-${matchupData.oppCatsTied || 0}`;

    return res.json({
      ok: true,
      league: { id: league.id, name: league.name },
      team: { teamId: team.id, teamName: team.name, avatarUrl: teamAvatar },
      opponent: { teamId: opponent.id, teamName: opponent.name, avatarUrl: oppAvatar },
      score: { team: teamScore, opponent: opponentScore },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to fetch matchup:", err);
    return res.status(500).json({ error: "Failed to fetch matchup" });
  }
});

// ESPN debug endpoint
app.get("/debug/espn", async (_req, res) => {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const seasonId = Number(process.env.ESPN_SEASON_ID);
  const espn_s2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;

  if (!leagueId || !Number.isInteger(seasonId) || !espn_s2 || !swid) {
    return res.status(400).json({ error: "Missing ESPN env vars" });
  }

  const url = new URL(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${seasonId}/segments/0/leagues/${leagueId}`
  );
  url.searchParams.append("view", "mLiveScoring");
  url.searchParams.append("view", "mMatchupScore");
  url.searchParams.append("view", "mRoster");
  url.searchParams.append("view", "mSettings");
  url.searchParams.append("view", "mStandings");
  url.searchParams.append("view", "mStatus");
  url.searchParams.append("view", "mTeam");
  url.searchParams.append("view", "modular");
  url.searchParams.append("view", "mNav");
  url.searchParams.set("platformVersion", "ec4491ff98dc3a672229031f460410e0746d6ecc");

  const r = await fetch(url.toString(), {
    method: "GET",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
      Origin: "https://fantasy.espn.com",
      Referer: `https://fantasy.espn.com/basketball/league?leagueId=${leagueId}`,
      Cookie: `espn_s2=${espn_s2.trim()}; SWID=${swid.trim()}; swid=${swid.trim()};`,
    },
  });

  const contentType = r.headers.get("content-type") ?? "";
  const location = r.headers.get("location") ?? "";
  const text = await r.text();

  return res.status(200).json({
    requestedUrl: url.toString(),
    status: r.status,
    redirected: r.status >= 300 && r.status < 400,
    location,
    contentType,
    snippet: text.slice(0, 500),
  });
});

app.get("/debug/espn-player", async (_req, res) => {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const seasonId = Number(process.env.ESPN_SEASON_ID);
  const espn_s2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;

  const baseUrl = process.env.ESPN_BASE_URL ?? "https://lm-api-reads.fantasy.espn.com";
  const platformVersion = process.env.ESPN_PLATFORM_VERSION;

  if (!leagueId || !Number.isInteger(seasonId) || !espn_s2 || !swid || !platformVersion) {
    return res.status(400).json({ error: "Missing ESPN env vars" });
  }

  const url = new URL(`${baseUrl}/apis/v3/games/fba/seasons/${seasonId}/segments/0/leagues/${leagueId}`);
  url.searchParams.append("view", "mRoster");
  url.searchParams.append("view", "mTeam");
  url.searchParams.set("platformVersion", platformVersion);

  const r = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
      Origin: "https://fantasy.espn.com",
      Referer: `https://fantasy.espn.com/basketball/league?leagueId=${leagueId}`,
      Cookie: `espn_s2=${espn_s2.trim()}; SWID=${swid.trim()}; swid=${swid.trim()};`,
    },
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return res.status(502).json({ error: "ESPN fetch failed", status: r.status, snippet: text.slice(0, 300) });
  }

  const data: any = await r.json();
  const player = data?.teams?.[0]?.roster?.entries?.[0]?.playerPoolEntry?.player ?? null;

  return res.status(200).json({ ok: true, player });
});

// Debug endpoint for player stats selection
app.get("/debug/player/:providerPlayerId/stats", async (req, res) => {
  const providerPlayerId = req.params.providerPlayerId;
  const leagueId = req.query.leagueId as string | undefined;

  try {
    const player = await prisma.player.findFirst({
      where: { providerPlayerId },
      select: { id: true, fullName: true, providerPlayerId: true, meta: true },
    });

    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    // Get seasonYear from league if leagueId is provided
    let seasonYear: number | null = null;
    if (leagueId) {
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { seasonYear: true },
      });
      if (league) {
        seasonYear = league.seasonYear;
      }
    }

    const meta = (player.meta as any) || {};
    const statsResult = extractNineCatFromPlayerMeta(meta, seasonYear);
    const debugInfo = getStatsDebugInfo(meta, seasonYear);

    // Format candidate info for response
    const candidates = debugInfo.candidates.map((c) => ({
      statSourceId: c.statSourceId,
      scoringPeriodId: c.scoringPeriodId,
      statSplitTypeId: c.statSplitTypeId,
      score: c.score,
      sampleStats: {
        pts: typeof c.block?.stats?.["0"] === "number" ? c.block.stats["0"] : null,
        reb: typeof c.block?.stats?.["6"] === "number" ? c.block.stats["6"] : null,
        ast: typeof c.block?.stats?.["4"] === "number" ? c.block.stats["4"] : null,
      },
    }));

    const selected = debugInfo.selected
      ? {
          statSourceId: debugInfo.selected.statSourceId,
          scoringPeriodId: debugInfo.selected.scoringPeriodId,
          statSplitTypeId: debugInfo.selected.statSplitTypeId,
          score: debugInfo.selected.score,
        }
      : null;

    return res.json({
      player: {
        id: player.id,
        fullName: player.fullName,
        providerPlayerId: player.providerPlayerId,
      },
      seasonYear: seasonYear,
      selected,
      candidates,
      allBlocks: debugInfo.allBlocks,
      computedStats: {
        perGame: statsResult.perGame,
        totals: statsResult.totals,
        gamesPlayed: statsResult.totals.gp,
        source: statsResult.source,
      },
    });
  } catch (err) {
    console.error("Error in debug/player/stats:", err);
    return res.status(500).json({ error: "Failed to fetch player stats debug info" });
  }
});

// Debug endpoint for player season selection
app.get("/debug/player/:providerPlayerId/season", async (req, res) => {
  const providerPlayerId = req.params.providerPlayerId;
  const leagueId = req.query.leagueId as string | undefined;

  try {
    const player = await prisma.player.findFirst({
      where: { providerPlayerId },
      select: { id: true, fullName: true, providerPlayerId: true, meta: true },
    });

    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }

    // Get seasonYear from league if leagueId is provided
    let resolvedSeasonYear: number | null = null;
    let leagueInfo: { id: string; name: string; seasonYear: number } | null = null;
    
    if (leagueId) {
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { id: true, name: true, seasonYear: true },
      });
      if (league) {
        resolvedSeasonYear = league.seasonYear;
        leagueInfo = league;
      }
    } else {
      // Try to find a league from the player's roster slots
      const rosterSlot = await prisma.rosterSlot.findFirst({
        where: { playerId: player.id, endAt: null },
        select: {
          league: {
            select: { id: true, name: true, seasonYear: true },
          },
        },
      });
      if (rosterSlot?.league) {
        resolvedSeasonYear = rosterSlot.league.seasonYear;
        leagueInfo = rosterSlot.league;
      }
    }

    const meta = (player.meta as any) || {};
    const blocks: any[] = Array.isArray(meta?.stats) ? meta.stats : [];

    // Analyze all blocks to see which seasons are present
    const seasonIdsInBlocks = new Set<number>();
    blocks.forEach((block) => {
      if (block?.seasonId && typeof block.seasonId === "number") {
        seasonIdsInBlocks.add(block.seasonId);
      }
    });

    const statsResult = extractNineCatFromPlayerMeta(meta, resolvedSeasonYear);
    const debugInfo = getStatsDebugInfo(meta, resolvedSeasonYear);

    const selected = debugInfo.selected
      ? {
          statSourceId: debugInfo.selected.statSourceId,
          scoringPeriodId: debugInfo.selected.scoringPeriodId,
          statSplitTypeId: debugInfo.selected.statSplitTypeId,
          seasonId: typeof debugInfo.selected.block?.seasonId === "number" ? debugInfo.selected.block.seasonId : null,
          score: debugInfo.selected.score,
          reason: resolvedSeasonYear
            ? `Selected because seasonId ${debugInfo.selected.block?.seasonId || "N/A"} matches league seasonYear ${resolvedSeasonYear}`
            : "No seasonYear filter applied (no leagueId provided)",
        }
      : null;

    return res.json({
      player: {
        id: player.id,
        fullName: player.fullName,
        providerPlayerId: player.providerPlayerId,
      },
      league: leagueInfo,
      resolvedSeasonYear: resolvedSeasonYear,
      seasonIdsInBlocks: Array.from(seasonIdsInBlocks).sort((a, b) => b - a),
      selected,
      allBlocks: debugInfo.allBlocks.map((b) => ({
        ...b,
        seasonId: blocks.find((bl) => 
          bl?.statSourceId === b.statSourceId &&
          bl?.scoringPeriodId === b.scoringPeriodId &&
          bl?.statSplitTypeId === b.statSplitTypeId
        )?.seasonId || null,
      })),
      computedStats: {
        perGame: statsResult.perGame,
        totals: statsResult.totals,
        gamesPlayed: statsResult.totals.gp,
        source: statsResult.source,
      },
    });
  } catch (err) {
    console.error("Error in debug/player/season:", err);
    return res.status(500).json({ error: "Failed to fetch player season debug info" });
  }
});

app.post("/ingest/espn", async (_req, res) => {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const seasonId = Number(process.env.ESPN_SEASON_ID);
  const espn_s2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;

  const baseUrl = process.env.ESPN_BASE_URL ?? "https://lm-api-reads.fantasy.espn.com";
  const platformVersion = process.env.ESPN_PLATFORM_VERSION;

  if (!leagueId || !Number.isInteger(seasonId) || !espn_s2 || !swid) {
    return res.status(400).json({ error: "Missing ESPN env vars" });
  }
  if (!platformVersion) {
    return res.status(400).json({ error: "Missing ESPN_PLATFORM_VERSION" });
  }

  const url = new URL(`${baseUrl}/apis/v3/games/fba/seasons/${seasonId}/segments/0/leagues/${leagueId}`);
  url.searchParams.append("view", "mSettings");
  url.searchParams.append("view", "mTeam");
  url.searchParams.append("view", "mRoster");
  url.searchParams.append("view", "mStandings");
  url.searchParams.append("view", "mMatchupScore");
  url.searchParams.append("view", "mLiveScoring");
  url.searchParams.append("view", "mStatus");
  url.searchParams.set("platformVersion", platformVersion);

  const r = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
      Origin: "https://fantasy.espn.com",
      Referer: `https://fantasy.espn.com/basketball/league?leagueId=${leagueId}`,
      Cookie: `espn_s2=${espn_s2.trim()}; SWID=${swid.trim()}; swid=${swid.trim()};`,
    },
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return res.status(502).json({ error: "ESPN fetch failed", status: r.status, snippet: text.slice(0, 300) });
  }

  const data: any = await r.json();

  const provider = "ESPN" as const;
  const providerLeagueId = String(data?.id);
  const name = String(data?.settings?.name ?? `ESPN League ${providerLeagueId}`);
  const seasonYear = Number(data?.seasonId ?? seasonId);
  if (!Number.isInteger(seasonYear)) return res.status(500).json({ error: "Missing/invalid league seasonId" });

  const league = await prisma.league.upsert({
    where: {
      provider_providerLeagueId_seasonYear: {
        provider,
        providerLeagueId,
        seasonYear,
      },
    },
    create: {
      provider,
      sport: "NBA",
      providerLeagueId,
      name,
      seasonYear,
      commissionerUserId: null,
      settings: data?.settings ?? null,
    },
    update: {
      name,
      settings: data?.settings ?? null,
    },
  });

  // Build matchup map from schedule (current matchup period)
  const schedule: any[] = Array.isArray(data?.schedule) ? data.schedule : [];
  const currentMatchupPeriod =
    typeof data?.status?.currentMatchupPeriod === "number" ? data.status.currentMatchupPeriod : null;

  const matchupMap = new Map<string, any>();

  for (const matchup of schedule) {
    if (matchup?.matchupPeriodId !== currentMatchupPeriod) continue;

    const homeId = String(matchup?.home?.teamId);
    const awayId = String(matchup?.away?.teamId);

    if (homeId && matchup?.home) {
      const homeCumScore = matchup.home.cumulativeScore || {};
      const awayCumScore = matchup.away?.cumulativeScore || {};

      matchupMap.set(homeId, {
        opponentTeamId: awayId,
        myCatsWon: homeCumScore.wins || 0,
        myCatsLost: homeCumScore.losses || 0,
        myCatsTied: homeCumScore.ties || 0,
        oppCatsWon: awayCumScore.wins || 0,
        oppCatsLost: awayCumScore.losses || 0,
        oppCatsTied: awayCumScore.ties || 0,
        isHome: true,
      });
    }

    if (awayId && matchup?.away) {
      const homeCumScore = matchup.home?.cumulativeScore || {};
      const awayCumScore = matchup.away.cumulativeScore || {};

      matchupMap.set(awayId, {
        opponentTeamId: homeId,
        myCatsWon: awayCumScore.wins || 0,
        myCatsLost: awayCumScore.losses || 0,
        myCatsTied: awayCumScore.ties || 0,
        oppCatsWon: homeCumScore.wins || 0,
        oppCatsLost: homeCumScore.losses || 0,
        oppCatsTied: homeCumScore.ties || 0,
        isHome: false,
      });
    }
  }

  // Teams + rosters
  const teamsRaw: any[] = Array.isArray(data?.teams) ? data.teams : [];
  let playersUpserted = 0;
  let teamsUpserted = 0;
  let rosterSlotsCreated = 0;
  let rosterSlotsEnded = 0;

  for (const t of teamsRaw) {
    const providerTeamId = String(t?.id);
    const teamName = String(t?.name ?? `Team ${providerTeamId}`);

    // Standings extraction
    const standingsRank =
      typeof t?.playoffSeed === "number" && t.playoffSeed > 0
        ? t.playoffSeed
        : typeof t?.rankCalculatedFinal === "number" && t.rankCalculatedFinal > 0
        ? t.rankCalculatedFinal
        : typeof t?.standings?.rank === "number" && t.standings.rank > 0
        ? t.standings.rank
        : null;

    const standingsWins = typeof t?.record?.overall?.wins === "number" ? t.record.overall.wins : null;
    const standingsLosses = typeof t?.record?.overall?.losses === "number" ? t.record.overall.losses : null;
    const standingsTies = typeof t?.record?.overall?.ties === "number" ? t.record.overall.ties : null;

    // Logo extraction (try multiple ESPN formats)
    const teamLogo =
      t?.logo ||
      t?.logoUrl ||
      t?.logos?.[0]?.href ||
      t?.logos?.[0]?.url ||
      null;

    const matchupData = matchupMap.get(providerTeamId) || null;

    const enhancedMeta = {
      ...(t ?? {}),
      standings:
        standingsRank !== null
          ? { rank: standingsRank, wins: standingsWins, losses: standingsLosses, ties: standingsTies }
          : null,
      matchup: matchupData,
      logo: normalizeEspnUrl(teamLogo),
      logoUrl: normalizeEspnUrl(t?.logoUrl ?? null),
    };

    const team = await prisma.team.upsert({
      where: {
        leagueId_provider_providerTeamId: {
          leagueId: league.id,
          provider,
          providerTeamId,
        },
      },
      create: {
        leagueId: league.id,
        provider,
        providerTeamId,
        name: teamName,
        managerName: null,
        meta: enhancedMeta,
      },
      update: {
        name: teamName,
        meta: enhancedMeta,
      },
    });

    teamsUpserted++;

    // Build set of current providerPlayerIds from ESPN response
    const entries: any[] = Array.isArray(t?.roster?.entries) ? t.roster.entries : [];
    const currentProviderPlayerIds = new Set<string>();
    for (const e of entries) {
      const p = e?.playerPoolEntry?.player;
      if (p?.id) {
        currentProviderPlayerIds.add(String(p.id));
      }
    }

    // End roster slots for players no longer on the team
    const activeRosterSlots = await prisma.rosterSlot.findMany({
      where: {
        leagueId: league.id,
        teamId: team.id,
        endAt: null,
      },
      include: {
        player: {
          select: {
            providerPlayerId: true,
          },
        },
      },
    });

    const now = new Date();
    for (const slot of activeRosterSlots) {
      const playerProviderId = slot.player.providerPlayerId;
      if (!currentProviderPlayerIds.has(playerProviderId)) {
        // Player is no longer on the roster, end the slot
        const slotMeta = (slot.meta as any) || {};
        await prisma.rosterSlot.update({
          where: { id: slot.id },
          data: {
            endAt: now,
            meta: {
              ...slotMeta,
              endedBy: "ingest_roster_diff",
            },
          },
        });
        rosterSlotsEnded++;
      }
    }

    // Process current roster players
    for (const e of entries) {
      const p = e?.playerPoolEntry?.player;
      if (!p) continue;

      const providerPlayerId = String(p?.id);
      const fullName = String(p?.fullName ?? `Player ${providerPlayerId}`);

      const eligibleSlots: any[] = Array.isArray(p?.eligibleSlots) ? p.eligibleSlots : [];
      const positions = eligibleSlots.map((x) => String(x)).filter(Boolean);

      const player = await prisma.player.upsert({
        where: { provider_providerPlayerId: { provider, providerPlayerId } },
        create: {
          provider,
          providerPlayerId,
          fullName,
          firstName: typeof p?.firstName === "string" ? p.firstName : null,
          lastName: typeof p?.lastName === "string" ? p.lastName : null,
          nbaTeamAbbr: typeof p?.proTeamId === "number" ? String(p.proTeamId) : null,
          positions,
          isActive: true,
          meta: p ?? null,
          leagues: { connect: { id: league.id } },
        },
        update: {
          fullName,
          firstName: typeof p?.firstName === "string" ? p.firstName : null,
          lastName: typeof p?.lastName === "string" ? p.lastName : null,
          nbaTeamAbbr: typeof p?.proTeamId === "number" ? String(p.proTeamId) : null,
          positions,
          meta: p ?? null,
          leagues: { connect: { id: league.id } },
        },
      });

      playersUpserted++;

      // Extract lineup slot and injury status
      const lineupSlotId = typeof e?.lineupSlotId === "number" ? e.lineupSlotId : null;
      
      // ESPN lineupSlotId mapping:
      // 0=PG, 1=SG, 2=SF, 3=PF, 4=C, 5=G, 6=F, 7=UTIL, 20=BE (bench), 21=IL (injured list)
      const lineupSlotMap: Record<number, string> = {
        0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C",
        5: "G", 6: "F", 7: "UTIL", 20: "BE", 21: "IL"
      };
      const lineupSlot = lineupSlotId !== null && lineupSlotId in lineupSlotMap 
        ? lineupSlotMap[lineupSlotId] 
        : lineupSlotId !== null ? String(lineupSlotId) : null;
      
      // Extract injury info using helper function
      const injuryInfo = extractInjuryInfo(p, lineupSlotId);
      
      // Determine if player is on IR/IL
      const isIR = lineupSlotId === 21 || 
        injuryInfo.status === "IR" || 
        injuryInfo.status === "OUT";

      const existingActive = await prisma.rosterSlot.findFirst({
        where: { leagueId: league.id, teamId: team.id, playerId: player.id, endAt: null },
        select: { id: true },
      });

      if (!existingActive) {
        await prisma.rosterSlot.create({
          data: {
            leagueId: league.id,
            teamId: team.id,
            playerId: player.id,
            providerRosterSlotId: null,
            startAt: new Date(),
            endAt: null,
            slotLabel: lineupSlot,
            meta: {
              timingSource: "ingestion_time_fallback",
              source: "espn_lm-api-reads",
              lineupSlotId,
              lineupSlot,
              injuryStatus: injuryInfo.status,
              injuryDescription: injuryInfo.description,
              estimatedReturnDate: injuryInfo.estimatedReturnDate,
              isIR,
              status: injuryInfo.status,
            },
          },
        });
        rosterSlotsCreated++;
      } else {
        // Update existing roster slot with latest injury/lineup info
        await prisma.rosterSlot.update({
          where: { id: existingActive.id },
          data: {
            slotLabel: lineupSlot,
            meta: {
              timingSource: "ingestion_time_fallback",
              source: "espn_lm-api-reads",
              lineupSlotId,
              lineupSlot,
              injuryStatus: injuryInfo.status,
              injuryDescription: injuryInfo.description,
              estimatedReturnDate: injuryInfo.estimatedReturnDate,
              isIR,
              status: injuryInfo.status,
            },
          },
        });
      }
    }
  }

  return res.status(200).json({
    ok: true,
    league: { id: league.id, providerLeagueId, seasonYear, name },
    teamsUpserted,
    playersUpserted,
    rosterSlotsCreated,
    rosterSlotsEnded,
  });
});

// Debug endpoint for roster diff
app.get("/debug/team/:leagueId/:teamId/roster-diff", async (req, res) => {
  const { leagueId, teamId } = req.params;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, providerLeagueId: true, seasonYear: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        providerTeamId: true,
        leagueId: true,
      },
    });
    if (!team) return res.status(404).json({ error: "Team not found" });
    if (team.leagueId !== leagueId) {
      return res.status(400).json({ error: "Team does not belong to this league" });
    }

    // Get active roster slots from DB
    const activeRosterSlots = await prisma.rosterSlot.findMany({
      where: {
        leagueId: league.id,
        teamId: team.id,
        endAt: null,
      },
      include: {
        player: {
          select: {
            id: true,
            providerPlayerId: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const dbProviderPlayerIds = new Set(
      activeRosterSlots.map((slot) => slot.player.providerPlayerId)
    );

    // Try to fetch current ESPN roster
    let espnProviderPlayerIds = new Set<string>();
    let espnRosterEntries: Array<{ providerPlayerId: string; fullName: string }> = [];
    let espnFetchError: string | null = null;

    try {
      const seasonId = league.seasonYear;
      const providerLeagueId = league.providerLeagueId;
      const espn_s2 = process.env.ESPN_S2;
      const swid = process.env.ESPN_SWID;
      const baseUrl = process.env.ESPN_BASE_URL ?? "https://lm-api-reads.fantasy.espn.com";
      const platformVersion = process.env.ESPN_PLATFORM_VERSION;

      if (espn_s2 && swid && platformVersion) {
        const url = new URL(
          `${baseUrl}/apis/v3/games/fba/seasons/${seasonId}/segments/0/leagues/${providerLeagueId}`
        );
        url.searchParams.append("view", "mRoster");
        url.searchParams.set("platformVersion", platformVersion);

        const r = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0",
            Origin: "https://fantasy.espn.com",
            Referer: `https://fantasy.espn.com/basketball/league?leagueId=${providerLeagueId}`,
            Cookie: `espn_s2=${espn_s2.trim()}; SWID=${swid.trim()}; swid=${swid.trim()};`,
          },
        });

        if (r.ok) {
          const data: any = await r.json();
          const teamsRaw: any[] = Array.isArray(data?.teams) ? data.teams : [];
          const targetTeam = teamsRaw.find(
            (t) => String(t?.id) === team.providerTeamId
          );

          if (targetTeam) {
            const entries: any[] = Array.isArray(targetTeam?.roster?.entries)
              ? targetTeam.roster.entries
              : [];
            for (const e of entries) {
              const p = e?.playerPoolEntry?.player;
              if (p?.id) {
                const providerPlayerId = String(p.id);
                espnProviderPlayerIds.add(providerPlayerId);
                espnRosterEntries.push({
                  providerPlayerId,
                  fullName: String(p?.fullName ?? `Player ${providerPlayerId}`),
                });
              }
            }
          }
        } else {
          espnFetchError = `ESPN API returned status ${r.status}`;
        }
      } else {
        espnFetchError = "Missing ESPN credentials in environment";
      }
    } catch (err) {
      espnFetchError = err instanceof Error ? err.message : "Unknown error fetching ESPN data";
    }

    // Calculate diff
    const wouldBeEnded = activeRosterSlots
      .filter((slot) => !espnProviderPlayerIds.has(slot.player.providerPlayerId))
      .map((slot) => ({
        rosterSlotId: slot.id,
        providerPlayerId: slot.player.providerPlayerId,
        fullName: slot.player.fullName,
        createdAt: slot.createdAt,
      }));

    const wouldBeCreated = espnRosterEntries
      .filter((entry) => !dbProviderPlayerIds.has(entry.providerPlayerId))
      .map((entry) => ({
        providerPlayerId: entry.providerPlayerId,
        fullName: entry.fullName,
      }));

    return res.json({
      league: { id: league.id, name: league.name },
      team: { id: team.id, name: team.name, providerTeamId: team.providerTeamId },
      espnFetchError,
      dbActiveRoster: activeRosterSlots.map((slot) => ({
        rosterSlotId: slot.id,
        providerPlayerId: slot.player.providerPlayerId,
        fullName: slot.player.fullName,
        createdAt: slot.createdAt,
      })),
      espnCurrentRoster: espnRosterEntries,
      diff: {
        wouldBeEnded,
        wouldBeCreated,
        wouldBeEndedCount: wouldBeEnded.length,
        wouldBeCreatedCount: wouldBeCreated.length,
      },
    });
  } catch (err) {
    console.error("Error in roster-diff debug endpoint:", err);
    return res.status(500).json({
      error: "Failed to compute roster diff",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// Debug endpoint for weekly projections
app.get("/debug/weekly-projections/:leagueId", async (req, res) => {
  const leagueId = req.params.leagueId;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true },
    });
    if (!league) return res.status(404).json({ error: "League not found" });

    const allTeams = await prisma.team.findMany({
      where: { leagueId },
      select: {
        id: true,
        name: true,
        providerTeamId: true,
        meta: true,
      },
    });

    // Extract matchup mappings
    const matchupMappings: Array<{ teamId: string; teamName: string; opponentTeamId: string | null; opponentTeamName: string | null }> = [];

    for (const team of allTeams) {
      const teamMeta = (team.meta as any) || {};
      const matchupData = teamMeta.matchup || null;
      const opponentProviderId = matchupData?.opponentTeamId ? String(matchupData.opponentTeamId) : null;

      let opponentTeamName: string | null = null;
      if (opponentProviderId) {
        const opponent = allTeams.find((t) => t.providerTeamId === opponentProviderId);
        opponentTeamName = opponent?.name || null;
      }

      matchupMappings.push({
        teamId: team.id,
        teamName: team.name,
        opponentTeamId: opponentProviderId,
        opponentTeamName,
      });
    }

    // Get scoring period info
    const firstTeamMeta = (allTeams[0]?.meta as any) || {};
    const currentMatchupPeriod = firstTeamMeta.matchup?.matchupPeriodId || 1;
    const scoringPeriodStartDate = firstTeamMeta.scoringPeriodStartDate || null;
    const scoringPeriodEndDate = firstTeamMeta.scoringPeriodEndDate || null;

    return res.json({
      league: { id: league.id, name: league.name },
      scoringPeriod: {
        id: currentMatchupPeriod,
        startAt: scoringPeriodStartDate,
        endAt: scoringPeriodEndDate,
      },
      matchupMappings,
      teamsCount: allTeams.length,
      teamsWithOpponents: matchupMappings.filter((m) => m.opponentTeamId !== null).length,
    });
  } catch (err) {
    console.error("Error in debug endpoint:", err);
    return res.status(500).json({ error: "Failed to fetch debug info" });
  }
});

// Helper: List teams in a league
app.get("/leagues/:leagueId/teams", async (req, res) => {
  const leagueId = req.params.leagueId;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true },
  });

  if (!league) return res.status(404).json({ error: "League not found" });

  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: { id: true, name: true, providerTeamId: true },
    orderBy: { name: "asc" },
  });

  return res.status(200).json({
    league: { id: league.id, name: league.name },
    teams: teams.map((t) => ({ id: t.id, name: t.name, providerTeamId: t.providerTeamId })),
  });
});

// List leagues
app.get("/leagues", async (_req, res) => {
  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, seasonYear: true, provider: true, providerLeagueId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ leagues });
});

// Team profile (9-cat ranks)
app.get("/leagues/:leagueId/teams/:teamId/profile", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.params.teamId;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, seasonYear: true },
  });
  if (!league) return res.status(404).json({ error: "League not found" });

  const team = await prisma.team.findFirst({
    where: { id: teamId, leagueId },
    select: { id: true, name: true },
  });
  if (!team) return res.status(404).json({ error: "Team not found or not in league" });

  const allTeams = await prisma.team.findMany({
    where: { leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: {
        where: { endAt: null },
        select: {
          meta: true,
          player: { select: { id: true, meta: true } },
        },
      },
    },
  });

  const teamsTotals: TeamTotals[] = [];

  for (const t of allTeams) {
    // Filter out IR players from team totals
    const activeRosterSlots = t.rosterSlots.filter((slot) => {
      const slotMeta = (slot.meta as any) || {};
      const isIR = slotMeta.isIR === true || 
        slotMeta.status === "IR" || 
        slotMeta.status === "IL" || 
        slotMeta.status === "OUT";
      return !isIR;
    });
    
    const playerStats = activeRosterSlots.map((slot) => extractPlayerStats(slot.player.meta, league.seasonYear).stats);
    const totals = aggregateTeam(playerStats);
    teamsTotals.push({ ...totals, teamId: t.id, teamName: t.name });
  }

  if (teamsTotals.length === 0) return res.status(400).json({ error: "No teams with active rosters found" });

  const dist = computeLeagueDistributions(teamsTotals);
  const ranksMap = rankTeams(teamsTotals);

  const targetTeamTotals = teamsTotals.find((t) => t.teamId === teamId);
  if (!targetTeamTotals) return res.status(500).json({ error: "Target team totals not found" });

  const zScores = zScore(targetTeamTotals, dist);
  const normalizedTeamScore0to9 = teamScore(zScores);

  const targetRoster = allTeams.find((t) => t.id === teamId);
  // Check stats missing only for active (non-IR) players
  const activeTargetSlots = targetRoster?.rosterSlots.filter((slot) => {
    const slotMeta = (slot.meta as any) || {};
    const isIR = slotMeta.isIR === true || 
      slotMeta.status === "IR" || 
      slotMeta.status === "IL" || 
      slotMeta.status === "OUT";
    return !isIR;
  }) || [];
  const statsMissing =
    activeTargetSlots.some((slot) => extractPlayerStats(slot.player.meta, league.seasonYear).missing) ?? false;

  const profile: TeamProfile = {
    teamId: team.id,
    teamName: team.name,
    rawTotals: {
      pts: targetTeamTotals.pts,
      reb: targetTeamTotals.reb,
      ast: targetTeamTotals.ast,
      stl: targetTeamTotals.stl,
      blk: targetTeamTotals.blk,
      threes: targetTeamTotals.threes,
      fgPct: targetTeamTotals.fgPct,
      ftPct: targetTeamTotals.ftPct,
      tov: targetTeamTotals.tov,
    },
    zScores,
    categoryRank:
      ranksMap.get(teamId) ?? { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, fgPct: 0, ftPct: 0, tov: 0 },
    normalizedTeamScore0to9,
    meta: {
      leagueId,
      teamId,
      computedAt: new Date().toISOString(),
      stats_missing: statsMissing,
    },
  };

  const leagueAverage = dist.mean;
  const leagueRanksSummary = teamsTotals
    .map((tt) => {
      const z = zScore(tt, dist);
      return { teamId: tt.teamId, teamName: tt.teamName, ranks: ranksMap.get(tt.teamId)!, teamScore: teamScore(z) };
    })
    .sort((a, b) => b.teamScore - a.teamScore);

  return res.status(200).json({ profile, leagueAverage, leagueRanksSummary });
});

// Power rankings
app.get("/leagues/:leagueId/power-rankings", async (req, res) => {
  const leagueId = req.params.leagueId;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, seasonYear: true },
  });
  if (!league) return res.status(404).json({ error: "League not found" });

  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: { 
        where: { endAt: null }, 
        select: { 
          meta: true,
          player: { select: { meta: true } } 
        } 
      },
    },
  });

  const teamTotals: TeamTotals[] = teams.map((t) => {
    // Filter out IR players from team totals
    const activeRosterSlots = t.rosterSlots.filter((slot) => {
      const slotMeta = (slot.meta as any) || {};
      const isIR = slotMeta.isIR === true || 
        slotMeta.status === "IR" || 
        slotMeta.status === "IL" || 
        slotMeta.status === "OUT";
      return !isIR;
    });
    const stats = activeRosterSlots.map((s) => extractPlayerStats(s.player.meta, league.seasonYear).stats);
    const totals = aggregateTeam(stats);
    return { ...totals, teamId: t.id, teamName: t.name };
  });

  const dist = computeLeagueDistributions(teamTotals);
  const ranks = rankTeams(teamTotals);

  const powerRankings = teamTotals
    .map((t) => {
      const z = zScore(t, dist);
      return { teamId: t.teamId, teamName: t.teamName, score0to9: teamScore(z), ranks: ranks.get(t.teamId) };
    })
    .sort((a, b) => b.score0to9 - a.score0to9);

  return res.json({ league: { id: league.id, name: league.name }, powerRankings });
});

// Overview
app.get("/leagues/:leagueId/overview", async (req, res) => {
  const leagueId = req.params.leagueId;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, seasonYear: true },
  });
  if (!league) return res.status(404).json({ error: "League not found" });

  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: { 
        where: { endAt: null }, 
        select: { 
          meta: true,
          player: { select: { meta: true } } 
        } 
      },
    },
  });

  const teamTotals: TeamTotals[] = teams.map((t) => {
    // Filter out IR players from team totals
    const activeRosterSlots = t.rosterSlots.filter((slot) => {
      const slotMeta = (slot.meta as any) || {};
      const isIR = slotMeta.isIR === true || 
        slotMeta.status === "IR" || 
        slotMeta.status === "IL" || 
        slotMeta.status === "OUT";
      return !isIR;
    });
    const stats = activeRosterSlots.map((s) => extractPlayerStats(s.player.meta, league.seasonYear).stats);
    const totals = aggregateTeam(stats);
    return { ...totals, teamId: t.id, teamName: t.name };
  });

  const dist = computeLeagueDistributions(teamTotals);
  const ranksMap = rankTeams(teamTotals);

  const powerRankings = teamTotals
    .map((t) => {
      const z = zScore(t, dist);
      return { teamId: t.teamId, teamName: t.teamName, score0to9: teamScore(z), ranks: ranksMap.get(t.teamId) };
    })
    .sort((a, b) => b.score0to9 - a.score0to9);

  return res.status(200).json({ league, leagueAverage: dist.mean, powerRankings });
});

// Trade suggestions
app.get("/leagues/:leagueId/teams/:teamId/trade-suggestions", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.params.teamId;
  const tradeSize = req.query.tradeSize as string | undefined; // "1for1" | "2for2" | undefined (both)
  const excludeUntouchables = req.query.excludeUntouchables !== "false"; // Default true
  const showQuestionable = req.query.showQuestionable === "true";
  const untouchablePlayerIds = req.query.untouchables 
    ? (Array.isArray(req.query.untouchables) ? req.query.untouchables : [req.query.untouchables]).map(String)
    : [];

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, seasonYear: true },
  });
  if (!league) return res.status(404).json({ error: "League not found" });

  // Get scoring period info (for weekly projections)
  const myTeamMeta = await prisma.team.findFirst({
    where: { id: teamId, leagueId },
    select: { meta: true },
  });
  const teamMeta = (myTeamMeta?.meta as any) || {};
  const defaultGamesPerWeek = 4;
  const scoringPeriodStartDate = teamMeta.scoringPeriodStartDate || undefined;
  const scoringPeriodEndDate = teamMeta.scoringPeriodEndDate || undefined;

  const myTeam = await prisma.team.findFirst({
    where: { id: teamId, leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: {
        where: { endAt: null },
        select: {
          meta: true,
          player: {
            select: {
              id: true,
              fullName: true,
              meta: true,
              providerPlayerId: true,
            },
          },
        },
      },
    },
  });
  if (!myTeam) return res.status(404).json({ error: "Team not found or not in league" });

  const allTeams = await prisma.team.findMany({
    where: { leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: {
        where: { endAt: null },
        select: {
          meta: true,
          player: {
            select: {
              id: true,
              fullName: true,
              meta: true,
              providerPlayerId: true,
            },
          },
        },
      },
    },
  });

  // Compute team totals for all teams (for league distribution)
  const teamsTotals: TeamTotals[] = [];
  for (const t of allTeams) {
    const activeRosterSlots = t.rosterSlots.filter((slot) => {
      const slotMeta = (slot.meta as any) || {};
      const isIR = slotMeta.isIR === true || 
        slotMeta.status === "IR" || 
        slotMeta.status === "IL" || 
        slotMeta.status === "OUT";
      return !isIR;
    });
    
    const playerStats = activeRosterSlots.map((slot) => extractPlayerStats(slot.player.meta, league.seasonYear).stats);
    const totals = aggregateTeam(playerStats);
    teamsTotals.push({ ...totals, teamId: t.id, teamName: t.name });
  }

  if (teamsTotals.length === 0) return res.status(400).json({ error: "No teams with active rosters found" });

  const leagueDist = computeLeagueDistributions(teamsTotals);
  const ranksMap = rankTeams(teamsTotals);

  const myTeamTotals = teamsTotals.find((t) => t.teamId === teamId);
  if (!myTeamTotals) return res.status(500).json({ error: "My team totals not found" });

  const myZ = zScore(myTeamTotals, leagueDist);
  const myRanks = ranksMap.get(teamId) ?? { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, fgPct: 0, ftPct: 0, tov: 0 };

  // Identify focus categories
  const { weaknesses: myWeaknesses, strengths: myStrengths } = identifyFocusCategories(myZ);

  // Compute player values for ALL teams first (needed for PTV percentiles)
  const allPlayersList: PlayerValue[] = [];
  const teamPlayersMap = new Map<string, PlayerValue[]>();
  
  // My team players
  const myPlayers: PlayerValue[] = [];
  for (const slot of myTeam.rosterSlots) {
    const slotMeta = (slot.meta as any) || {};
    const headshotUrl = slot.player.providerPlayerId
      ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${slot.player.providerPlayerId}.png`)
      : null;
    const playerValue = computePlayerValue(
      {
        id: slot.player.id,
        fullName: slot.player.fullName,
        meta: slot.player.meta,
        headshotUrl,
      },
      leagueDist,
      league.seasonYear,
      slotMeta
    );
    if (playerValue) {
      myPlayers.push(playerValue);
      allPlayersList.push(playerValue);
    }
  }
  teamPlayersMap.set(teamId, myPlayers);

  // Collect all opponent team players
  for (const opponentTeam of allTeams) {
    if (opponentTeam.id === teamId) continue; // Skip self

    const theirTeamTotals = teamsTotals.find((t) => t.teamId === opponentTeam.id);
    if (!theirTeamTotals) continue;

    const theirPlayers: PlayerValue[] = [];
    for (const slot of opponentTeam.rosterSlots) {
      const slotMeta = (slot.meta as any) || {};
      const headshotUrl = slot.player.providerPlayerId
        ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${slot.player.providerPlayerId}.png`)
        : null;
      const playerValue = computePlayerValue(
        {
          id: slot.player.id,
          fullName: slot.player.fullName,
          meta: slot.player.meta,
          headshotUrl,
        },
        leagueDist,
        league.seasonYear,
        slotMeta
      );
      if (playerValue) {
        theirPlayers.push(playerValue);
        allPlayersList.push(playerValue);
      }
    }
    teamPlayersMap.set(opponentTeam.id, theirPlayers);
  }

  // Calculate PTV percentiles for ALL players at once
  calculatePTVPercentiles(allPlayersList);

  // Build untouchables set from request + core players
  const myUntouchables = new Set<string>();
  if (excludeUntouchables) {
    // Add user-specified untouchables
    untouchablePlayerIds.forEach((id) => myUntouchables.add(id));
    // Add core players (top 2 by PTV or top 10 percentile)
    myPlayers.forEach((p) => {
      if (p.isCore) {
        myUntouchables.add(p.playerId);
      }
    });
  }

  // Generate trade suggestions for each opponent team
  const allSuggestions: TradeSuggestion[] = [];
  let globalPassWarning: string | null = null;
  
  // Debug counters (aggregated across all opponents)
  const debug = {
    rostersLoaded: {
      my: myPlayers.length,
      otherTeams: allTeams.length - 1,
      otherPlayersTotal: 0,
    },
    candidatesGenerated: 0,
    afterEligibility: 0,
    afterNoUntouchables: 0,
    afterScoringValid: 0,
    afterQualityFilters: 0,
    afterAutoRelaxation: 0,
    final: 0,
    failCounts: {
      missingStats: 0,
      nanOrInfinity: 0,
      fairnessTooHigh: 0,
      probTooLow: 0,
      confTooLow: 0,
      myDeltaTooLow: 0,
      theirDeltaTooLow: 0,
      untouchableInTrade: 0,
      injuredRule: 0,
      duplicatePlayers: 0,
      other: 0,
    },
  };

  for (const opponentTeam of allTeams) {
    if (opponentTeam.id === teamId) continue; // Skip self

    const theirTeamTotals = teamsTotals.find((t) => t.teamId === opponentTeam.id);
    if (!theirTeamTotals) continue;

    const theirZ = zScore(theirTeamTotals, leagueDist);
    const theirRanks = ranksMap.get(opponentTeam.id) ?? { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, fgPct: 0, ftPct: 0, tov: 0 };
    const { weaknesses: theirWeaknesses } = identifyFocusCategories(theirZ);

    // Get their players from map
    const theirPlayers = teamPlayersMap.get(opponentTeam.id) ?? [];
    debug.rostersLoaded.otherPlayersTotal += theirPlayers.length;

    // Build their untouchables set (core players only, no user-specified for opponent)
    const theirUntouchables = new Set<string>();
    if (excludeUntouchables) {
      theirPlayers.forEach((p) => {
        if (p.isCore) {
          theirUntouchables.add(p.playerId);
        }
      });
    }

    // Generate wider candidate pool
    const candidates: TradeCandidate[] = [];
    
    if (!tradeSize || tradeSize === "1for1") {
      candidates.push(...generate1For1Trades(myPlayers, theirPlayers, myUntouchables, theirUntouchables, showQuestionable));
    }
    
    if (!tradeSize || tradeSize === "2for1") {
      candidates.push(...generate2For1Trades(myPlayers, theirPlayers, myUntouchables, theirUntouchables, showQuestionable));
    }
    
    if (!tradeSize || tradeSize === "2for2") {
      candidates.push(...generate2For2Trades(myPlayers, theirPlayers, myUntouchables, theirUntouchables, showQuestionable));
    }
    
    debug.candidatesGenerated += candidates.length;

    // Analyze and score all candidates (no hard filtering yet)
    const scoredTrades: Array<{
      candidate: TradeCandidate;
      analysis: TradeAnalysis;
      fairness: { fair: boolean; ratio: number; reason?: string };
      myGrade: string;
      oppGrade: string;
      probability: number;
      confidence: number;
      score: number; // Combined score for ranking
      plausibilityScore?: number; // For pass selection
      myWeaknessGains: number;
      theirWeaknessGains: number;
      myAvgPlacementDelta: number;
      theirAvgPlacementDelta: number;
    }> = [];

    debug.afterEligibility += candidates.length;
    
    // Per-opponent failure counters
    const failCounts = {
      missingStats: 0,
      nanOrInfinity: 0,
      fairnessTooHigh: 0,
      probTooLow: 0,
      confTooLow: 0,
      myDeltaTooLow: 0,
      theirDeltaTooLow: 0,
      untouchableInTrade: 0,
      injuredRule: 0,
      duplicatePlayers: 0,
      lopsided: 0,
      other: 0,
    };

    // Helper to check if value is valid (finite, not NaN)
    const isValidNumber = (val: number): boolean => {
      return typeof val === "number" && isFinite(val) && !isNaN(val);
    };

    // Helper to clamp and validate numbers
    const clamp = (val: number, min: number, max: number): number => {
      if (!isValidNumber(val)) return min;
      return Math.max(min, Math.min(max, val));
    };

    for (const candidate of candidates) {
      // PASS 0: Sanity checks
      // Check for duplicate players
      const allPlayerIds = [...candidate.send.map(p => p.playerId), ...candidate.receive.map(p => p.playerId)];
      const uniqueIds = new Set(allPlayerIds);
      if (allPlayerIds.length !== uniqueIds.size) {
        failCounts.duplicatePlayers++;
        continue;
      }

      // Check for untouchables (if excludeUntouchables is on)
      if (excludeUntouchables) {
        const hasUntouchable = candidate.send.some(p => myUntouchables.has(p.playerId)) ||
                               candidate.receive.some(p => theirUntouchables.has(p.playerId));
        if (hasUntouchable) {
          failCounts.untouchableInTrade++;
          continue;
        }
      }
      
      debug.afterNoUntouchables += 1;

      // Calculate fairness ratio (simple check - will be validated in analyzeTrade)
      const mySendPTV = candidate.send.reduce((sum, p) => {
        const player = myPlayers.find((mp) => mp.playerId === p.playerId);
        const ptv = player?.ptv ?? 0;
        return sum + (isValidNumber(ptv) ? ptv : 0);
      }, 0);
      const theirSendPTV = candidate.receive.reduce((sum, p) => {
        const player = theirPlayers.find((tp) => tp.playerId === p.playerId);
        const ptv = player?.ptv ?? 0;
        return sum + (isValidNumber(ptv) ? ptv : 0);
      }, 0);
      
      // Simple fairness check - reject if one side has 0 PTV or ratio is way off
      if (mySendPTV === 0 || theirSendPTV === 0 || !isValidNumber(mySendPTV) || !isValidNumber(theirSendPTV)) {
        failCounts.fairnessTooHigh++;
        continue;
      }
      
      const fairnessRatio = theirSendPTV / mySendPTV;
      if (!isValidNumber(fairnessRatio) || fairnessRatio <= 0 || fairnessRatio > 2.0 || fairnessRatio < 0.5) {
        failCounts.fairnessTooHigh++;
        continue;
      }
      
      // NOTE: Injured/questionable players are excluded during candidate generation if showQuestionable is off
      // At scoring phase, we allow all candidates through (they'll just have lower confidence)
      
      const analysis = analyzeTrade(
        candidate,
        teamId,
        opponentTeam.id,
        myTeamTotals,
        theirTeamTotals,
        myPlayers,
        theirPlayers,
        leagueDist,
        teamsTotals,
        allPlayersList
      );

      if (!analysis) {
        failCounts.missingStats++;
        continue;
      }

      // Validate analysis values
      if (!isValidNumber(analysis.deltas.my.teamScoreDelta) || 
          !isValidNumber(analysis.deltas.them.teamScoreDelta)) {
        failCounts.nanOrInfinity++;
        continue;
      }

      // Calculate metrics
      const myAvgPlacementBefore = calculateAvgPlacement(analysis.myBefore.ranks);
      const myAvgPlacementAfter = calculateAvgPlacement(analysis.myAfter.ranks);
      const theirAvgPlacementBefore = calculateAvgPlacement(analysis.themBefore.ranks);
      const theirAvgPlacementAfter = calculateAvgPlacement(analysis.themAfter.ranks);

      const myWeaknessGains = myWeaknesses.reduce((sum: number, cat: CategoryKey) => {
        const delta = analysis.deltas.my.categoryDelta[cat] ?? 0;
        return sum + Math.max(0, delta);
      }, 0);
      const myStrengthLosses = myStrengths.reduce((sum: number, cat: CategoryKey) => {
        const delta = analysis.deltas.my.categoryDelta[cat] ?? 0;
        return sum + Math.max(0, -delta);
      }, 0);

      const theirWeaknessGains = theirWeaknesses.reduce((sum: number, cat: CategoryKey) => {
        const delta = analysis.deltas.them.categoryDelta[cat] ?? 0;
        return sum + Math.max(0, delta);
      }, 0);

      // Calculate grades with category deltas to cap FG%/FT% contributions
      const myGrade = calculateTradeGrade(
        analysis.deltas.my.teamScoreDelta,
        myAvgPlacementAfter - myAvgPlacementBefore,
        analysis.deltas.my.categoryDelta
      );
      const oppGrade = calculateTradeGrade(
        analysis.deltas.them.teamScoreDelta,
        theirAvgPlacementAfter - theirAvgPlacementBefore,
        analysis.deltas.them.categoryDelta
      );

      // Hard rejections (always enforce)
      if (myGrade === "F" || oppGrade === "F") continue;
      if (analysis.deltas.my.teamScoreDelta < -0.15 || analysis.deltas.them.teamScoreDelta < -0.15) continue;

      // Check for core players
      const hasCorePlayer = [
        ...candidate.send.map((p) => myPlayers.find((mp) => mp.playerId === p.playerId)?.isCore ?? false),
        ...candidate.receive.map((p) => theirPlayers.find((tp) => tp.playerId === p.playerId)?.isCore ?? false),
      ].some((isCore) => isCore);

      // Use fairness ratio from analysis (already calculated)
      const fairnessRatioFromAnalysis = analysis.fairnessRatio;

      // Calculate probability and confidence with safety checks
      let probability = calculateProbability(
        fairnessRatioFromAnalysis,
        myGrade,
        oppGrade,
        hasCorePlayer,
        analysis.deltas.them.teamScoreDelta
      );
      probability = clamp(probability / 100, 0.01, 0.99); // Normalize to 0..1 and clamp
      
      let confidence = calculateConfidence(candidate, myPlayers, theirPlayers);
      confidence = clamp(confidence / 100, 0.05, 0.95); // Normalize to 0..1 and clamp
      
      // Validate probability and confidence
      if (!isValidNumber(probability) || !isValidNumber(confidence)) {
        failCounts.nanOrInfinity++;
        continue;
      }

      // Normalize fairness ratio to 0..1
      const FAIRNESS_SCALE = 0.5; // Typical equal-value trades have ratio around 0.2-0.4
      let normalizedFairnessRatio = 1.0;
      if (isValidNumber(fairnessRatioFromAnalysis) && fairnessRatioFromAnalysis > 0) {
        const rawRatio = Math.abs(fairnessRatioFromAnalysis - 1);
        normalizedFairnessRatio = clamp(rawRatio / FAIRNESS_SCALE, 0, 1);
      }

      // Validate fairness ratio
      if (!isValidNumber(normalizedFairnessRatio)) {
        failCounts.nanOrInfinity++;
        continue;
      }

      // Calculate category fit gain
      const categoryFitGain = isValidNumber(myWeaknessGains) ? myWeaknessGains : 0;

      // Calculate plausibility and rank scores
      const fairnessNorm = 1 - normalizedFairnessRatio; // Invert so lower is better
      const plausibilityScore = (fairnessNorm * 0.45) + (probability * 0.35) + (confidence * 0.20);
      
      const myDelta = clamp(analysis.deltas.my.teamScoreDelta, -1, 1);
      const theirDelta = clamp(analysis.deltas.them.teamScoreDelta, -1, 1);
      const rankScore = (myDelta * 0.50) + (theirDelta * 0.20) + (fairnessNorm * 0.20) + (probability * 0.10);
      
      // Validate scores
      if (!isValidNumber(plausibilityScore) || !isValidNumber(rankScore)) {
        failCounts.nanOrInfinity++;
        continue;
      }

      scoredTrades.push({
        candidate,
        analysis,
        fairness: { fair: true, ratio: normalizedFairnessRatio }, // Use normalized ratio
        myGrade,
        oppGrade,
        probability: probability * 100, // Convert back to 0-100 for display
        confidence: confidence * 100, // Convert back to 0-100 for display
        score: rankScore, // Use rankScore for sorting
        plausibilityScore, // Store for pass selection
        myWeaknessGains,
        theirWeaknessGains,
        myAvgPlacementDelta: myAvgPlacementAfter - myAvgPlacementBefore,
        theirAvgPlacementDelta: theirAvgPlacementAfter - theirAvgPlacementBefore,
      });
    }
    
    // Count valid scored trades
    debug.afterScoringValid += scoredTrades.length;
    
    // Aggregate failure counts
    Object.keys(failCounts).forEach((key) => {
      (debug.failCounts as any)[key] += (failCounts as any)[key];
    });

    // Multi-pass selection (never return 0 if candidates exist)
    const MIN_RESULTS = 8;
    let selectedTrades: typeof scoredTrades = [];
    let passWarning: string | null = null;
    
    // PASS 1: Good trades
    selectedTrades = scoredTrades.filter((st) => {
      const myDelta = st.analysis.deltas.my.teamScoreDelta;
      const theirDelta = st.analysis.deltas.them.teamScoreDelta;
      const fairnessNorm = st.fairness.ratio; // Already normalized 0..1
      const prob = st.probability / 100; // Convert back to 0..1
      
      if (myDelta < 0.01) { failCounts.myDeltaTooLow++; return false; }
      if (theirDelta < 0.00) { failCounts.theirDeltaTooLow++; return false; }
      if (fairnessNorm > 0.35) { failCounts.fairnessTooHigh++; return false; }
      if (prob < 0.15) { failCounts.probTooLow++; return false; }
      if (st.myGrade === "F" || st.oppGrade === "F") return false;
      return true;
    });
    
    if (selectedTrades.length >= MIN_RESULTS) {
      console.log(`[Trade Engine] ${opponentTeam.name}: PASS 1 selected ${selectedTrades.length} trades`);
    } else {
      // PASS 2: Neutral them
      selectedTrades = scoredTrades.filter((st) => {
        const myDelta = st.analysis.deltas.my.teamScoreDelta;
        const theirDelta = st.analysis.deltas.them.teamScoreDelta;
        const fairnessNorm = st.fairness.ratio;
        const prob = st.probability / 100;
        
        if (myDelta < 0.01) return false;
        if (theirDelta < -0.01) return false;
        if (fairnessNorm > 0.45) return false;
        if (prob < 0.10) return false;
        if (st.myGrade === "F" || st.oppGrade === "F") return false;
        return true;
      });
      
      if (selectedTrades.length >= MIN_RESULTS) {
        console.log(`[Trade Engine] ${opponentTeam.name}: PASS 2 selected ${selectedTrades.length} trades`);
      } else {
        // PASS 3: Best-effort plausible
        selectedTrades = scoredTrades.filter((st) => {
          const myDelta = st.analysis.deltas.my.teamScoreDelta;
          const theirDelta = st.analysis.deltas.them.teamScoreDelta;
          const fairnessNorm = st.fairness.ratio;
          const prob = st.probability / 100;
          
          if (myDelta < 0) return false;
          if (theirDelta < -0.02) return false;
          if (fairnessNorm > 0.55) return false;
          if (prob < 0.08) return false;
          if (st.myGrade === "F" || st.oppGrade === "F") return false;
          return true;
        });
        
        if (selectedTrades.length >= MIN_RESULTS) {
          console.log(`[Trade Engine] ${opponentTeam.name}: PASS 3 selected ${selectedTrades.length} trades`);
          passWarning = "No mutually-positive trades found; showing best-effort plausible offers.";
        } else {
          // PASS 4: Never empty - take top by plausibilityScore
          selectedTrades = scoredTrades
            .filter((st) => {
              // Only filter out F grades, everything else is valid
              if (st.myGrade === "F" || st.oppGrade === "F") return false;
              // Ensure scores are valid
              return isValidNumber(st.plausibilityScore ?? 0) && isValidNumber(st.score);
            })
            .sort((a, b) => (b.plausibilityScore ?? 0) - (a.plausibilityScore ?? 0))
            .slice(0, Math.max(MIN_RESULTS, 25));
          
          console.log(`[Trade Engine] ${opponentTeam.name}: PASS 4 selected ${selectedTrades.length} trades (best-effort)`);
          passWarning = "No mutually-positive trades found; showing best-effort plausible offers.";
        }
      }
    }
    
    // Ensure we have at least 1 trade if any scored trades exist
    if (selectedTrades.length === 0 && scoredTrades.length > 0) {
      // Last resort: take any non-F grade trade
      selectedTrades = scoredTrades
        .filter((st) => st.myGrade !== "F" && st.oppGrade !== "F")
        .sort((a, b) => (b.plausibilityScore ?? 0) - (a.plausibilityScore ?? 0))
        .slice(0, MIN_RESULTS);
      passWarning = "No trades passed quality filters, but showing best-effort options.";
    }
    
    // Sort by rankScore (for final ordering)
    selectedTrades.sort((a, b) => b.score - a.score);
    
    // Take top MIN_RESULTS (but ensure at least 1 if any exist)
    const topTrades = selectedTrades.length > 0 
      ? selectedTrades.slice(0, MIN_RESULTS)
      : [];
    
    debug.afterQualityFilters = selectedTrades.length;
    debug.afterAutoRelaxation = topTrades.length;
    debug.final += topTrades.length;
    console.log(`[Trade Engine] ${opponentTeam.name}: finalReturned=${topTrades.length}`);
    
    // Store pass warning if present
    if (passWarning && !globalPassWarning) {
      globalPassWarning = passWarning;
    }
    
    // Build suggestions from scored trades
    for (const st of topTrades) {
      const candidate = st.candidate;
      const analysis = st.analysis;

      // Use precomputed values from scoring
      const myGrade = st.myGrade;
      const oppGrade = st.oppGrade;
      const probability = st.probability;
      const confidence = st.confidence;

      // Calculate percentiles
      const myPercentilesBefore = calculateCategoryPercentiles(analysis.myBefore.ranks, allTeams.length);
      const myPercentilesAfter = calculateCategoryPercentiles(analysis.myAfter.ranks, allTeams.length);
      const theirPercentilesBefore = calculateCategoryPercentiles(analysis.themBefore.ranks, allTeams.length);
      const theirPercentilesAfter = calculateCategoryPercentiles(analysis.themAfter.ranks, allTeams.length);

      const myPercentilesDelta: Record<string, number> = {};
      const theirPercentilesDelta: Record<string, number> = {};
      for (const cat of Object.keys(myPercentilesBefore)) {
        myPercentilesDelta[cat] = myPercentilesAfter[cat] - myPercentilesBefore[cat];
        theirPercentilesDelta[cat] = theirPercentilesAfter[cat] - theirPercentilesBefore[cat];
      }

      // Recalculate avg placement for response
      const myAvgPlacementBefore = calculateAvgPlacement(analysis.myBefore.ranks);
      const myAvgPlacementAfter = calculateAvgPlacement(analysis.myAfter.ranks);
      const theirAvgPlacementBefore = calculateAvgPlacement(analysis.themBefore.ranks);
      const theirAvgPlacementAfter = calculateAvgPlacement(analysis.themAfter.ranks);

      // Calculate top gains/losses (accounting for TO directionality)
      const { CATEGORY_HIGHER_IS_BETTER } = await import("./lib/tradeEngine.js");
      const adjustDeltaForDirection = (cat: string, delta: number): number => {
        const higherIsBetter = CATEGORY_HIGHER_IS_BETTER[cat as CategoryKey] ?? true;
        // For TO (lower is better), invert the delta: negative delta = gain, positive delta = loss
        return higherIsBetter ? delta : -delta;
      };

      // Calculate top gains/losses using percentile deltas (more accurate)
      // Exclude abs(delta) < 0.1 and adjust for TO directionality
      const myTopGains = Object.entries(myPercentilesDelta)
        .map(([cat, delta]) => ({ 
          category: cat, 
          delta: delta as number,
          adjustedDelta: adjustDeltaForDirection(cat, delta as number)
        }))
        .filter(item => Math.abs(item.adjustedDelta) >= 0.1) // Filter out < 0.1% changes
        .filter(item => item.adjustedDelta > 0) // Only gains
        .sort((a, b) => b.adjustedDelta - a.adjustedDelta)
        .slice(0, 3)
        .map(({ category, delta }) => ({ category, delta }));
      
      const myTopLosses = Object.entries(myPercentilesDelta)
        .map(([cat, delta]) => ({ 
          category: cat, 
          delta: delta as number,
          adjustedDelta: adjustDeltaForDirection(cat, delta as number)
        }))
        .filter(item => Math.abs(item.adjustedDelta) >= 0.1) // Filter out < 0.1% changes
        .filter(item => item.adjustedDelta < 0) // Only losses
        .sort((a, b) => a.adjustedDelta - b.adjustedDelta)
        .slice(0, 2)
        .map(({ category, delta }) => ({ category, delta }));
      
      // Calculate opponent top gains/losses using percentile deltas
      const oppTopGains = Object.entries(theirPercentilesDelta)
        .map(([cat, delta]) => ({ 
          category: cat, 
          delta: delta as number,
          adjustedDelta: adjustDeltaForDirection(cat, delta as number)
        }))
        .filter(item => Math.abs(item.adjustedDelta) >= 0.1) // Filter out < 0.1% changes
        .filter(item => item.adjustedDelta > 0) // Only gains
        .sort((a, b) => b.adjustedDelta - a.adjustedDelta)
        .slice(0, 3)
        .map(({ category, delta }) => ({ category, delta }));
      
      const oppTopLosses = Object.entries(theirPercentilesDelta)
        .map(([cat, delta]) => ({ 
          category: cat, 
          delta: delta as number,
          adjustedDelta: adjustDeltaForDirection(cat, delta as number)
        }))
        .filter(item => Math.abs(item.adjustedDelta) >= 0.1) // Filter out < 0.1% changes
        .filter(item => item.adjustedDelta < 0) // Only losses
        .sort((a, b) => a.adjustedDelta - b.adjustedDelta)
        .slice(0, 2)
        .map(({ category, delta }) => ({ category, delta }));
      
      // Debug log for percentile calculation verification
      if (allSuggestions.length === 0) {
        const sampleCat = "pts";
        console.log("[Trade Engine Debug] Percentile calculation sample:", {
          category: sampleCat,
          rankBefore: analysis.myBefore.ranks[sampleCat],
          rankAfter: analysis.myAfter.ranks[sampleCat],
          percentileBefore: myPercentilesBefore[sampleCat],
          percentileAfter: myPercentilesAfter[sampleCat],
          percentileDelta: myPercentilesDelta[sampleCat],
          totalTeams: allTeams.length
        });
      }

      // Generate rationale
      const rationale = generateRationale(analysis, myGrade, oppGrade);

      const opponentAvatarUrl = await getTeamAvatarUrl(req, opponentTeam.id);

      // Prepare per-category data for details view
      const categoryKeys: CategoryKey[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
      const isPctCategory = (cat: string) => cat === "fgPct" || cat === "ftPct";
      const isCountingStat = (cat: string) => !isPctCategory(cat);
      
      const myCategoryDetails = categoryKeys.map((cat) => {
        const totalBefore = analysis.myBefore.totals[cat] ?? 0;
        const totalAfter = analysis.myAfter.totals[cat] ?? 0;
        const deltaTotal = totalAfter - totalBefore;
        
        // Calculate percent change of totals
        let deltaTotalPct = 0;
        if (isPctCategory(cat)) {
          // For FG%/FT%: show percentage points (pp)
          deltaTotalPct = deltaTotal * 100; // e.g., 0.460 -> 0.462 = +0.2pp
        } else {
          // For counting stats: percent change
          if (totalBefore !== 0) {
            deltaTotalPct = (deltaTotal / totalBefore) * 100;
          }
        }
        
        return {
          category: cat,
          totalBefore,
          totalAfter,
          deltaTotal,
          deltaTotalPct,
          rankBefore: analysis.myBefore.ranks[cat] ?? 0,
          rankAfter: analysis.myAfter.ranks[cat] ?? 0,
          rankDelta: (analysis.myAfter.ranks[cat] ?? 0) - (analysis.myBefore.ranks[cat] ?? 0),
        };
      });
      
      const oppCategoryDetails = categoryKeys.map((cat) => {
        const totalBefore = analysis.themBefore.totals[cat] ?? 0;
        const totalAfter = analysis.themAfter.totals[cat] ?? 0;
        const deltaTotal = totalAfter - totalBefore;
        
        // Calculate percent change of totals
        let deltaTotalPct = 0;
        if (isPctCategory(cat)) {
          // For FG%/FT%: show percentage points (pp)
          deltaTotalPct = deltaTotal * 100;
        } else {
          // For counting stats: percent change
          if (totalBefore !== 0) {
            deltaTotalPct = (deltaTotal / totalBefore) * 100;
          }
        }
        
        return {
          category: cat,
          totalBefore,
          totalAfter,
          deltaTotal,
          deltaTotalPct,
          rankBefore: analysis.themBefore.ranks[cat] ?? 0,
          rankAfter: analysis.themAfter.ranks[cat] ?? 0,
          rankDelta: (analysis.themAfter.ranks[cat] ?? 0) - (analysis.themBefore.ranks[cat] ?? 0),
        };
      });

      allSuggestions.push({
        id: `${teamId}_${opponentTeam.id}_${candidate.send.map((p) => p.playerId).join("_")}_${candidate.receive.map((p) => p.playerId).join("_")}`,
        partnerTeam: {
          id: opponentTeam.id,
          name: opponentTeam.name,
          avatarUrl: opponentAvatarUrl,
        },
        trade: candidate,
        impact: {
          my: {
            teamScoreBefore: analysis.myBefore.teamScore0to9,
            teamScoreAfter: analysis.myAfter.teamScore0to9,
            teamScoreDelta: analysis.deltas.my.teamScoreDelta,
            avgPlacementBefore: myAvgPlacementBefore,
            avgPlacementAfter: myAvgPlacementAfter,
            avgPlacementDelta: myAvgPlacementAfter - myAvgPlacementBefore,
            categoryPercentilesBefore: myPercentilesBefore,
            categoryPercentilesAfter: myPercentilesAfter,
            categoryPercentilesDelta: myPercentilesDelta,
            categoryDetails: myCategoryDetails,
            grade: myGrade,
            probability,
            confidence,
          },
          opp: {
            teamScoreBefore: analysis.themBefore.teamScore0to9,
            teamScoreAfter: analysis.themAfter.teamScore0to9,
            teamScoreDelta: analysis.deltas.them.teamScoreDelta,
            avgPlacementBefore: theirAvgPlacementBefore,
            avgPlacementAfter: theirAvgPlacementAfter,
            avgPlacementDelta: theirAvgPlacementAfter - theirAvgPlacementBefore,
            categoryPercentilesBefore: theirPercentilesBefore,
            categoryPercentilesAfter: theirPercentilesAfter,
            categoryPercentilesDelta: theirPercentilesDelta,
            categoryDetails: oppCategoryDetails,
            grade: oppGrade,
            probability,
            confidence,
          },
        },
        summary: {
          myTopGains,
          myTopLosses,
          oppTopGains,
          oppTopLosses,
        },
        rationaleBullets: rationale,
      });
    }
  }

  // Already sorted by score in scoring phase, no need to re-sort
  // Return all suggestions (already limited to top 20 per opponent, but we aggregate across all opponents)

  // Determine reason if empty
  let reason: string | null = null;
  let ok = true;
  let warning: string | null = null;
  
  if (allSuggestions.length === 0) {
    ok = false;
    if (debug.candidatesGenerated === 0) {
      reason = "No candidates generated (missing stats/projections/rosters).";
    } else if (debug.afterNoUntouchables === 0) {
      reason = "Untouchables filter removed all candidates.";
    } else if (debug.afterScoringValid === 0) {
      reason = "All candidates failed scoring validation (NaN/Infinity or missing data).";
    } else if (debug.afterQualityFilters === 0) {
      reason = "All candidates failed quality filters.";
    } else {
      reason = "No trades passed all filters.";
    }
  } else {
    // Check if we should show low confidence warning
    const avgProbability = allSuggestions.reduce((sum, s) => sum + s.impact.my.probability, 0) / allSuggestions.length;
    const avgConfidence = allSuggestions.reduce((sum, s) => sum + s.impact.my.confidence, 0) / allSuggestions.length;
    
    if (avgProbability < 35 || avgConfidence < 35) {
      warning = "Trades found, but confidence is low (injuries / volatility). Showing best options anyway.";
    }
  }

  const myTeamAvatarUrl = await getTeamAvatarUrl(req, myTeam.id);

  const response: any = {
    ok,
    myTeam: {
      id: myTeam.id,
      name: myTeam.name,
      avatarUrl: myTeamAvatarUrl,
    },
    suggestions: allSuggestions,
    leagueTeamsCount: allTeams.length,
  };

  if (warning) {
    response.warning = warning;
  }

  // Include debug info in dev mode
  if (process.env.NODE_ENV !== "production") {
    response.debug = debug;
    if (reason) {
      response.reason = reason;
    }
  }

  // Log summary with top failure reasons
  const topFailReasons = Object.entries(debug.failCounts)
    .filter(([_, count]) => count > 0)
    .sort(([_, a], [__, b]) => b - a)
    .slice(0, 5)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");
  
  console.log(`[Trade Engine] Summary: candidatesGenerated=${debug.candidatesGenerated}, afterScoringValid=${debug.afterScoringValid}, final=${debug.final}, ok=${ok}`);
  if (topFailReasons) {
    console.log(`[Trade Engine] Top failure reasons: ${topFailReasons}`);
  }
  if (reason) {
    console.log(`[Trade Engine] Empty reason: ${reason}`);
  }
  if (warning) {
    console.log(`[Trade Engine] Warning: ${warning}`);
  }

  return res.status(200).json(response);
});


// ---------- START ----------
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`api listening on :${port}`);
});
