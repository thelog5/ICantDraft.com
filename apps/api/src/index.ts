import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cookieParser from "cookie-parser";
// @ts-ignore - PrismaClient is generated at build time
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
import { getCachedNBASchedule } from "./lib/nbaSchedule.js";
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
app.use(cookieParser());

app.use((req, res, next) => {
  // Get origin from request or env
  const requestOrigin = req.headers.origin;
  const webOrigin = process.env.WEB_ORIGIN || process.env.CORS_ORIGIN || "http://localhost:5173";
  
  // Default: allow all vercel.app origins, localhost, or configured origin
  let allowedOrigin: string = webOrigin;
  
  if (requestOrigin) {
    // Always allow vercel.app origins (most permissive for Vercel deployments)
    if (requestOrigin.includes('vercel.app')) {
      allowedOrigin = requestOrigin;
    }
    // Allow localhost for development
    else if (requestOrigin.includes('localhost')) {
      allowedOrigin = requestOrigin;
    }
    // Allow if matches configured origin
    else if (requestOrigin === webOrigin) {
      allowedOrigin = requestOrigin;
    }
    // In demo mode, be more permissive
    else if (process.env.DEMO_MODE === 'true') {
      allowedOrigin = requestOrigin;
    }
  }
  
  // Handle OPTIONS preflight requests FIRST, before any redirects
  if (req.method === "OPTIONS") {
    (res as any).header("Access-Control-Allow-Origin", allowedOrigin);
    (res as any).header("Access-Control-Allow-Credentials", "true");
    (res as any).header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    (res as any).header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    (res as any).header("Access-Control-Max-Age", "86400"); // 24 hours
    return (res as any).sendStatus(200);
  }
  
  (res as any).header("Access-Control-Allow-Origin", allowedOrigin);
  (res as any).header("Access-Control-Allow-Credentials", "true");
  (res as any).header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  (res as any).header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  // Log CORS for debugging
  console.log(`[CORS] Request from origin: ${requestOrigin || 'none'}, Allowed: ${allowedOrigin}`);
  
  next();
});

const prisma = new PrismaClient();

// ---------- AUTH ROUTES ----------
import authRouter from './routes/auth.js';
import { cleanupExpiredSessions } from './lib/sessionManager.js';

// ---------- DEMO ROUTES ----------
import demoRouter from './routes/demo.js';
import { 
  demoScopeMiddleware,
  getLeagueScoped,
  getTeamScoped,
  getTeamsScoped,
  getPlayersScoped,
  getRosterSlotsScoped 
} from './middleware/demoScope.js';

// ---------- DEMO MODE ----------
import { isDemoMode, getDemoConfig } from './lib/demoMode.js';

// Apply demo scope middleware globally
app.use(demoScopeMiddleware);

app.use('/auth', authRouter);
app.use('/demo', demoRouter);

// Demo config endpoint
app.get('/config/demo', (_req, res) => {
  res.json(getDemoConfig());
});

// Block debug/ESPN routes in demo mode
app.use('/debug', (req, res, next) => {
  if (isDemoMode()) {
    return res.status(403).json({
      error: 'Debug endpoints are not available in demo mode',
      demoMode: true,
    });
  }
  next();
});

// Cleanup expired sessions every hour
setInterval(() => {
  cleanupExpiredSessions().catch(err => {
    console.error('[SessionCleanup] Error:', err);
  });
}, 60 * 60 * 1000);

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
  const protocol = (req as any).protocol || 'http';
  const host = (req as any).get ? (req as any).get("host") : (req as any).headers?.host || 'localhost';
  const base = `${protocol}://${host}`;
  return `${base}/proxy/image?url=${encodeURIComponent(fixed)}`;
}

/**
 * Clean providerPlayerId by removing demo snapshot suffix
 * e.g., "12345_demo_v1" -> "12345"
 */
function cleanProviderPlayerId(providerPlayerId: string | null): string | null {
  if (!providerPlayerId) return null;
  // Remove _demo_* suffix if present
  return providerPlayerId.split('_demo_')[0];
}

async function getTeamAvatarUrl(req: express.Request, teamDbId: string, demoSnapshotId: string | null = null) {
  try {
    // Use demo scoped team lookup
    const team = await getTeamScoped(teamDbId, demoSnapshotId);
    if (!team) {
      console.warn(`[getTeamAvatarUrl] Team not found: ${teamDbId}, demoSnapshotId: ${demoSnapshotId}`);
      return null;
    }

    const meta = (team.meta as any) || {};

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
    if (logo) {
      const proxiedLogo = proxiedImage(req, logo);
      if (proxiedLogo) {
        console.log(`[getTeamAvatarUrl] Using team logo for team ${teamDbId}: ${logo}`);
        return proxiedLogo;
      }
    }

    // 2) Fallback: first roster player's headshot (use demo scoped roster slots)
    const league = await prisma.league.findFirst({
      where: { teams: { some: { id: teamDbId } } },
      select: { id: true, demoSnapshotId: true },
    });
    
    if (!league) {
      console.warn(`[getTeamAvatarUrl] League not found for team ${teamDbId}`);
      return null;
    }
    
    // Use getRosterSlotsScoped to respect demo scope
    const rosterSlots = await getRosterSlotsScoped(league.id, teamDbId, demoSnapshotId);
    const currentSlots = rosterSlots.filter(slot => slot.endAt === null);
    
    // Find first slot with a player that has a providerPlayerId
    const firstRoster = currentSlots.find(slot => slot.player?.providerPlayerId);

    const pid = firstRoster?.player?.providerPlayerId;
    if (pid) {
      const cleanPlayerId = cleanProviderPlayerId(pid);
      if (cleanPlayerId) {
        const headshot = `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`;
        const proxiedHeadshot = proxiedImage(req, headshot);
        if (proxiedHeadshot) {
          console.log(`[getTeamAvatarUrl] Using player headshot fallback for team ${teamDbId}: ${cleanPlayerId}`);
          return proxiedHeadshot;
        }
      }
    }

    console.warn(`[getTeamAvatarUrl] No avatar found for team ${teamDbId} (${team.name}), logo: ${logo ? 'found but failed to proxy' : 'not found'}, roster slots: ${currentSlots.length}, with player: ${currentSlots.filter(s => s.player?.providerPlayerId).length}`);
    return null;
  } catch (err) {
    console.error(`[getTeamAvatarUrl] Error getting avatar for team ${teamDbId}:`, err);
    return null;
  }
}

// ---------- ROUTES ----------

// Health check
app.get("/health", (_req, res) => {
  (res as any).status(200).json({ ok: true, timestamp: Date.now() });
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
    if (!league) return (res as any).status(404).json({ error: "League not found" });

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
    // @ts-ignore - fetch Response type
    const r = await fetch(u.toString(), { redirect: "follow", headers });

    if (!(r as any).ok) {
      // log upstream so you can see if it's 403 vs 404
      console.error("proxy/image upstream failed", {
        url: u.toString(),
        status: (r as any).status,
        contentType: (r as any).headers.get("content-type"),
      });
      return (res as any).status(404).json({ error: "Image not found", status: (r as any).status });
    }

    const buf = Buffer.from(await (r as any).arrayBuffer());
    let contentType = ((r as any).headers.get("content-type") || "").trim();

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
    // Use demo scope
    const demoSnapshotId = req.demoScope?.demoSnapshotId || null;

    const league = await getLeagueScoped(leagueId, demoSnapshotId);
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    const team = await getTeamScoped(teamId, demoSnapshotId);
    if (!team || team.leagueId !== leagueId) {
      return res.status(404).json({ error: "Team not found or not in league" });
    }

    // Get roster slots with demo scope
    const rosterSlots = await getRosterSlotsScoped(leagueId, teamId, demoSnapshotId);
    
    // Filter to only current roster (endAt: null)
    const currentRosterSlots = rosterSlots.filter(slot => slot.endAt === null);

    const roster = currentRosterSlots.map((slot) => {
      const player = slot.player;
      const meta = (player.meta as any) || {};
      const positions = meta.positions || [];

      let headshotUrl: string | null = null;
      if (player.providerPlayerId) {
        const cleanPlayerId = cleanProviderPlayerId(player.providerPlayerId);
        if (cleanPlayerId) {
          headshotUrl = proxiedImage(
            req,
            `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`
          );
        }
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
    if (!league) return (res as any).status(404).json({ error: "League not found" });

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
        const cleanPlayerId = cleanProviderPlayerId(player.providerPlayerId);
        if (cleanPlayerId) {
          headshotUrl = proxiedImage(
            req,
            `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`
          );
        }
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
    // Use demo scope
    const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;
    
    const league = await getLeagueScoped(leagueId, demoSnapshotId);
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    // Get all teams with demo scope
    const allTeamsData = await getTeamsScoped(leagueId, demoSnapshotId);
    
    if (allTeamsData.length === 0) {
      console.error(`No teams found for league ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
      return res.status(404).json({ error: "No teams found in league" });
    }
    
    // Fetch roster slots for each team with providerPlayerId for headshots
    const allTeams = await Promise.all(allTeamsData.map(async (t: any) => {
      const rosterSlots = await getRosterSlotsScoped(leagueId, t.id, demoSnapshotId);
      const currentSlots = rosterSlots.filter((slot: any) => !slot.endAt);
      return {
        id: t.id,
        name: t.name,
        meta: t.meta,
        providerTeamId: t.providerTeamId,
        rosterSlots: currentSlots.map((slot: any) => ({
          meta: slot.meta,
          slotLabel: slot.slotLabel,
          player: {
            id: slot.playerId,
            fullName: slot.player?.fullName || 'Unknown',
            meta: slot.player?.meta || null,
            providerPlayerId: slot.player?.providerPlayerId || null,
          },
        })),
      };
    }));

    if (allTeams.length === 0) {
      console.error(`No teams with roster data found for league ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
      return res.status(404).json({ error: "No teams with roster data found" });
    }

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
      try {
        // Filter out roster slots without player.meta before calculating
        const validRosterSlots = team.rosterSlots.filter((slot: any) => 
          slot.player && slot.player.meta
        );
        
        if (validRosterSlots.length === 0) {
          console.warn(`[Weekly Projections] Team ${team.id} (${team.name}) has no roster slots with player.meta`);
          continue;
        }
        
        const { totals, totalsWithAttempts } = await calculateTeamWeeklyProjection(
          validRosterSlots,
          league.seasonYear,
          defaultGamesPerWeek,
          scoringPeriodStartDate || undefined,
          scoringPeriodEndDate || undefined
        );
        teamProjections.push({ teamId: team.id, totals, totalsWithAttempts });
      } catch (err) {
        console.error(`[Weekly Projections] Error calculating projection for team ${team.id} (${team.name}):`, err);
        console.error(`[Weekly Projections] Error stack:`, err instanceof Error ? err.stack : 'No stack');
        // Skip this team if calculation fails
      }
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
      console.error(`Team not found: ${teamId} in league ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
      console.error(`Available teams: ${allTeams.map(t => t.id).join(', ')}`);
      return res.status(404).json({ error: `Team not found. Available teams: ${allTeams.length}` });
    }

    // Calculate selected team's projection
    let teamTotals: NineCatTotals;
    let teamPlayers: any[];
    try {
      // Filter out roster slots without player.meta before calculating
      const validRosterSlots = selectedTeam.rosterSlots.filter((slot: any) => 
        slot.player && slot.player.meta
      );
      
      if (validRosterSlots.length === 0) {
        return res.status(400).json({ error: `Team ${selectedTeam.name} has no roster slots with player stats. Please ensure player data has been ingested.` });
      }
      
      const result = await calculateTeamWeeklyProjection(
        validRosterSlots,
        league.seasonYear,
        defaultGamesPerWeek,
        scoringPeriodStartDate || undefined,
        scoringPeriodEndDate || undefined
      );
      teamTotals = result.totals;
      teamPlayers = result.players;
    } catch (err) {
      console.error(`[Weekly Projections] Error calculating projection for selected team ${selectedTeam.id}:`, err);
      console.error(`[Weekly Projections] Error stack:`, err instanceof Error ? err.stack : 'No stack');
      return res.status(500).json({ error: `Failed to calculate weekly projection: ${err instanceof Error ? err.message : String(err)}` });
    }

    // Get team avatar
    const teamAvatarUrl = await getTeamAvatarUrl(req, selectedTeam.id, demoSnapshotId);

    // Add headshots to team players
    const teamPlayersWithHeadshots = teamPlayers.map((p: any) => {
      const teamPlayer = selectedTeam.rosterSlots.find((slot: any) => slot.player.id === p.playerId);
      const cleanPlayerId = cleanProviderPlayerId(teamPlayer?.player?.providerPlayerId);
      return {
        ...p,
        headshotUrl: cleanPlayerId
          ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`)
          : null,
      };
    });

    const teamProjection: WeeklyTeamProjection = {
      teamId: selectedTeam.id,
      teamName: selectedTeam.name,
      avatarUrl: teamAvatarUrl,
      projectedTotals: teamTotals,
      players: teamPlayersWithHeadshots,
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
        let opponentTotals: NineCatTotals;
        let opponentPlayers: any[];
        try {
          // Filter out roster slots without player.meta before calculating
          const validOpponentSlots = opponent.rosterSlots.filter((slot: any) => 
            slot.player && slot.player.meta
          );
          
          if (validOpponentSlots.length === 0) {
            console.warn(`[Weekly Projections] Opponent ${opponent.id} (${opponent.name}) has no roster slots with player.meta`);
            opponentTotals = {
              pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, tov: 0, fgPct: 0, ftPct: 0
            };
            opponentPlayers = [];
          } else {
            const result = await calculateTeamWeeklyProjection(
              validOpponentSlots,
              league.seasonYear,
              defaultGamesPerWeek,
              scoringPeriodStartDate || undefined,
              scoringPeriodEndDate || undefined
            );
            opponentTotals = result.totals;
            opponentPlayers = result.players;
          }
        } catch (err) {
          console.error(`[Weekly Projections] Error calculating projection for opponent ${opponent.id}:`, err);
          console.error(`[Weekly Projections] Error stack:`, err instanceof Error ? err.stack : 'No stack');
          // Continue without opponent projection if it fails
          opponentTotals = {
            pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, tov: 0, fgPct: 0, ftPct: 0
          };
          opponentPlayers = [];
        }

        const opponentAvatarUrl = await getTeamAvatarUrl(req, opponent.id, demoSnapshotId);

        // Add headshots to opponent players
        const opponentPlayersWithHeadshots = opponentPlayers.map((p: any) => {
          const oppPlayer = opponent.rosterSlots.find((slot: any) => slot.player.id === p.playerId);
          const cleanPlayerId = cleanProviderPlayerId(oppPlayer?.player?.providerPlayerId);
          return {
            ...p,
            headshotUrl: cleanPlayerId
              ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`)
              : null,
          };
        });

        opponentProjection = {
          teamId: opponent.id,
          teamName: opponent.name,
          avatarUrl: opponentAvatarUrl,
          projectedTotals: opponentTotals,
          players: opponentPlayersWithHeadshots,
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

    // Add live/current matchup score and category results
    // ESPN provides scoreByStat with actual live category totals
    let liveMatchupScore = null;
    let liveCategories: any[] | null = null;
    
    // ESPN stat ID to 9-cat key mapping
    const espnStatIdToKey: Record<number, string> = {
      0: "pts",    // Points
      1: "blk",    // Blocks
      2: "stl",    // Steals
      3: "ast",    // Assists
      6: "reb",    // Rebounds
      11: "tov",   // Turnovers
      17: "threes", // 3-Pointers Made
      19: "fgPct", // FG%
      20: "ftPct", // FT%
    };
    
    if (matchupData) {
      // Use ESPN's category wins/losses for the live score
      liveMatchupScore = {
        teamCatsWon: matchupData.myCatsWon || 0,
        teamCatsLost: matchupData.myCatsLost || 0,
        tied: matchupData.myCatsTied || 0,
        opponentCatsWon: matchupData.oppCatsWon || 0,
        opponentCatsLost: matchupData.oppCatsLost || 0,
        opponentTied: matchupData.oppCatsTied || 0,
      };
      
      // Use actual ESPN scoreByStat for live category breakdown
      const myScoreByStat = matchupData.myScoreByStat || {};
      const oppScoreByStat = matchupData.oppScoreByStat || {};
      
      if (Object.keys(myScoreByStat).length > 0) {
        // Build live categories from ESPN's actual stats
        const categoryKeys = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
        liveCategories = categoryKeys.map(key => {
          // Find ESPN stat ID for this key
          const espnStatId = Object.entries(espnStatIdToKey).find(([_, k]) => k === key)?.[0];
          const myStatData = espnStatId ? myScoreByStat[espnStatId] : null;
          const oppStatData = espnStatId ? oppScoreByStat[espnStatId] : null;
          
          const teamTotal = myStatData?.score ?? 0;
          const opponentTotal = oppStatData?.score ?? 0;
          
          // Determine winner based on ESPN's result field, or calculate it
          let winner: "TEAM" | "OPPONENT" | "TIE" = "TIE";
          if (myStatData?.result === "WIN") {
            winner = "TEAM";
          } else if (myStatData?.result === "LOSS") {
            winner = "OPPONENT";
          } else if (key === "tov") {
            // Lower is better for turnovers
            if (teamTotal < opponentTotal) winner = "TEAM";
            else if (teamTotal > opponentTotal) winner = "OPPONENT";
          } else {
            // Higher is better for other stats
            if (teamTotal > opponentTotal) winner = "TEAM";
            else if (teamTotal < opponentTotal) winner = "OPPONENT";
          }
          
          return { key, teamTotal, opponentTotal, winner };
        });
        
        console.log(`[Weekly Projections] Live score from ESPN: ${liveMatchupScore.teamCatsWon}-${liveMatchupScore.opponentCatsWon} (${liveMatchupScore.tied} tied)`);
        console.log(`[Weekly Projections] Live categories:`, liveCategories.map(c => `${c.key}: ${c.teamTotal} vs ${c.opponentTotal} (${c.winner})`).join(', '));
      } else if (matchupResults && matchupResults.categories) {
        // Fallback to projections if no ESPN live stats available
        liveCategories = matchupResults.categories.map(cat => ({
          key: cat.key,
          teamTotal: cat.teamTotal,
          opponentTotal: cat.opponentTotal,
          winner: cat.winner
        }));
        console.log(`[Weekly Projections] Using projected stats (no ESPN live data): ${liveMatchupScore.teamCatsWon}-${liveMatchupScore.opponentCatsWon}`);
      }
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
      liveMatchupScore,
      liveCategories,
    });
  } catch (err) {
    console.error("[Weekly Projections] Error fetching weekly projections:", err);
    console.error("[Weekly Projections] Stack trace:", err instanceof Error ? err.stack : 'No stack trace');
    return res.status(500).json({ 
      error: "Failed to fetch weekly projections",
      details: err instanceof Error ? err.message : String(err)
    });
  }
});

// Free agents endpoint - returns only unowned players in the league
app.get("/leagues/:leagueId/free-agents", async (req, res) => {
  const leagueId = req.params.leagueId;
  const limit = parseInt(req.query.limit as string) || 200;
  const search = (req.query.search as string) || "";
  const positions = (req.query.positions as string) || "";
  const includeQuestionable = req.query.includeQuestionable === "true";

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, seasonYear: true },
    });
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    // Get all active roster slots in the league to determine owned players
    const activeRosterSlots = await prisma.rosterSlot.findMany({
      where: {
        leagueId: league.id,
        endAt: null,
      },
      select: {
        playerId: true,
      },
    });

    const ownedPlayerIds = new Set(activeRosterSlots.map((slot) => slot.playerId));

    // Get all players in the league
    const allPlayers = await prisma.player.findMany({
      where: {
        leagues: {
          some: { id: leagueId },
        },
        isActive: true,
      },
      select: {
        id: true,
        providerPlayerId: true,
        fullName: true,
        positions: true,
        meta: true,
      },
    });

    // Filter to free agents only
    const freeAgents = allPlayers.filter((p) => !ownedPlayerIds.has(p.id));

    // Apply search filter
    const searchFiltered = search
      ? freeAgents.filter((p) =>
          p.fullName.toLowerCase().includes(search.toLowerCase())
        )
      : freeAgents;

    // Apply position filter
    const positionFiltered = positions
      ? searchFiltered.filter((p) => {
          const playerPositions = Array.isArray(p.positions) ? p.positions : [];
          const requestedPositions = positions.split(",");
          return requestedPositions.some((pos) => playerPositions.includes(pos));
        })
      : searchFiltered;

    // Get scoring period info from first team's meta
    const firstTeam = await prisma.team.findFirst({
      where: { leagueId },
      select: { meta: true },
    });
    const firstTeamMeta = (firstTeam?.meta as any) || {};
    const defaultGamesPerWeek = 4;
    const scoringPeriodStartDate = firstTeamMeta.scoringPeriodStartDate || null;
    const scoringPeriodEndDate = firstTeamMeta.scoringPeriodEndDate || null;

    // Process each free agent
    type FreeAgentData = {
      playerId: string;
      providerPlayerId: string;
      fullName: string;
      positions: string[];
      headshotUrl: string | null;
      perGameStats: {
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
      weeklyProjection: {
        projectedGames: number;
        totals: {
          pts: number;
          reb: number;
          ast: number;
          stl: number;
          blk: number;
          threes: number;
          tov: number;
          fgPct: number;
          ftPct: number;
        };
        attempts: {
          fga: number;
          fgm: number;
          fta: number;
          ftm: number;
        };
      };
      injuryStatus: string;
      hasStats: boolean;
    };

    const processedFreeAgents: FreeAgentData[] = [];

    for (const player of positionFiltered) {
      const meta = (player.meta as any) || {};
      const playerStats = extractNineCatFromPlayerMeta(meta, league.seasonYear);

      if (!playerStats.hasStats) continue;

      // Calculate injury info
      const injuryInfo = extractInjuryInfo(meta, null);

      // Filter by injury status
      if (injuryInfo.status === "OUT" || injuryInfo.status === "IR") {
        continue; // Always exclude OUT/IR
      }

      if (!includeQuestionable && (injuryInfo.status === "DTD" || injuryInfo.status === "SUSP")) {
        continue; // Exclude DTD/SUSP unless explicitly requested
      }

      // Calculate projected games
      const projectedGames = calculateProjectedGamesThisWeek(
        defaultGamesPerWeek,
        injuryInfo,
        scoringPeriodStartDate || undefined,
        scoringPeriodEndDate || undefined
      );

      if (projectedGames === 0) continue;

      // Calculate weekly projection
      const perGame = playerStats.perGame;
      const totals = {
        pts: perGame.pts * projectedGames,
        reb: perGame.reb * projectedGames,
        ast: perGame.ast * projectedGames,
        stl: perGame.stl * projectedGames,
        blk: perGame.blk * projectedGames,
        threes: perGame.threes * projectedGames,
        tov: perGame.tov * projectedGames,
        fgPct: perGame.fgPct,
        ftPct: perGame.ftPct,
      };

      // Calculate attempts
      const fgaPerGame = playerStats.totals.fga / Math.max(1, playerStats.totals.gp);
      const fgmPerGame = playerStats.totals.fgm / Math.max(1, playerStats.totals.gp);
      const ftaPerGame = playerStats.totals.fta / Math.max(1, playerStats.totals.gp);
      const ftmPerGame = playerStats.totals.ftm / Math.max(1, playerStats.totals.gp);

      const attempts = {
        fga: fgaPerGame * projectedGames,
        fgm: fgmPerGame * projectedGames,
        fta: ftaPerGame * projectedGames,
        ftm: ftmPerGame * projectedGames,
      };

      // Generate headshot URL
      const cleanPlayerId = cleanProviderPlayerId(player.providerPlayerId);
      const headshotUrl = cleanPlayerId
        ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`)
        : null;

      processedFreeAgents.push({
        playerId: player.id,
        providerPlayerId: player.providerPlayerId,
        fullName: player.fullName,
        positions: Array.isArray(player.positions) ? player.positions : [],
        headshotUrl,
        perGameStats: perGame,
        weeklyProjection: {
          projectedGames,
          totals,
          attempts,
        },
        injuryStatus: injuryInfo.status,
        hasStats: playerStats.hasStats,
      });
    }

    // Limit results
    const limitedResults = processedFreeAgents.slice(0, limit);

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({
      league: {
        id: league.id,
        name: league.name,
      },
      freeAgents: limitedResults,
      totalCount: processedFreeAgents.length,
      returnedCount: limitedResults.length,
    });
  } catch (err) {
    console.error("Error fetching free agents:", err);
    return res.status(500).json({ error: "Failed to fetch free agents" });
  }
});

// Helper: Extract player game schedule from ESPN meta
// NBA Team Schedule mapping for 2024-25 season
// This is a simplified version - in production, fetch from NBA API or maintain updated schedule
const NBA_TEAM_SCHEDULES: Record<string, string[]> = {
  // Format: YYYY-MM-DD dates when each team plays
  // This should be populated from NBA schedule API or maintained
  // For now, we'll use a fallback approach based on typical NBA schedule (3-4 games per week)
};

// Recommendation thresholds
const MIN_DELTA_CAT_SCORE = 0.05; // Minimum 5% improvement in contested category
const MIN_GAMES_NEXT_3_DAYS = 2; // Minimum games in next 3 days for volume streamers
const MAX_RECS_PER_DAY = 2; // Maximum recommendations per day

/**
 * Calculate category closeness for matchup snapshot
 */
function calculateCategoryCloseness(
  myTotal: number,
  oppTotal: number,
  categoryKey: NineCatKey,
  maxValue: number
): { 
  closeness: "close" | "likely_win" | "likely_loss";
  margin: number;
  marginPct: number;
  isFlippable: boolean;
} {
  const diff = myTotal - oppTotal;
  const absDiff = Math.abs(diff);
  const marginPct = absDiff / maxValue;

  // For TO, lower is better
  const isWinning = categoryKey === "tov" ? myTotal < oppTotal : myTotal > oppTotal;
  
  let closeness: "close" | "likely_win" | "likely_loss";
  if (marginPct < 0.07) {
    closeness = "close";
  } else if (isWinning) {
    closeness = "likely_win";
  } else {
    closeness = "likely_loss";
  }

  // A category is flippable if it's close or if we're losing by a small margin
  const isFlippable = closeness === "close" || (closeness === "likely_loss" && marginPct < 0.15);

  return {
    closeness,
    margin: diff,
    marginPct,
    isFlippable,
  };
}

/**
 * Helper to determine if a player's stat boosts a contested category
 */
function playerBoostsCategory(perGame: Record<NineCatKey, number>, cat: NineCatKey): boolean {
  const value = perGame[cat];
  if (typeof value !== 'number') return false;
  
  // Lower thresholds for free agents (waiver wire players are less productive)
  switch (cat) {
    case 'pts':
      return value >= 8.0; // At least 8 PPG
    case 'reb':
      return value >= 4.0; // At least 4 RPG
    case 'ast':
      return value >= 2.5; // At least 2.5 APG
    case 'stl':
      return value >= 0.6; // At least 0.6 SPG
    case 'blk':
      return value >= 0.5; // At least 0.5 BPG
    case 'threes':
      return value >= 1.0; // At least 1 3PM per game
    case 'fgPct':
      return value >= 0.42; // At least 42% FG
    case 'ftPct':
      return value >= 0.70; // At least 70% FT
    case 'tov':
      return value <= 2.0; // Low turnovers (lower is better)
    default:
      return false;
  }
}

/**
 * Rank free agents for streaming adds
 */
function rankFreeAgentsForAdds(
  freeAgents: Array<{
    playerId: string;
    name: string;
    stats: ReturnType<typeof extractNineCatFromPlayerMeta>;
    schedule: Date[];
    gamesThisWeek: number;
    injuryStatus: string;
  }>,
  contestedCategories: Array<{ key: NineCatKey; normalizedDelta: number; weight?: number }>,
  targetDate?: Date
): Array<{
  player: typeof freeAgents[0];
  score: number;
  boosts: NineCatKey[];
  strengths: NineCatKey[];
  weaknesses: NineCatKey[];
  reason: string;
  fitScore: number;
}> {
  const ranked = freeAgents
    .map((player) => {
      if (!player.stats.hasStats) return null;
      
      const perGame = player.stats.perGame;
      
      // Calculate score based on contested categories - PRIORITIZE FOCUS CATEGORIES
      let focusScore = 0;
      const boosts: NineCatKey[] = [];
      
      // Lower thresholds for free agents (waiver wire players are less productive)
      const thresholds: Record<NineCatKey, number> = {
        pts: 8, reb: 4, ast: 2.5, stl: 0.6, blk: 0.5, threes: 1.0, fgPct: 0.42, ftPct: 0.70, tov: 2.0
      };
      
      for (const cat of contestedCategories) {
        const key = cat.key;
        const isPct = key === "fgPct" || key === "ftPct";
        const isTov = key === "tov";
        
        // Get category weight (closer categories = higher weight)
        // Default weight is based on normalized delta (smaller = more important)
        const catWeight = cat.weight ?? (1 / (cat.normalizedDelta + 0.05));
        
        if (isPct) {
          // For percentages: small positive contribution if above threshold, negative if below
          const threshold = thresholds[key];
          if (perGame[key] >= threshold) {
            // Good percentage player - small bonus
            focusScore += catWeight * 2;
            boosts.push(key);
          } else if (perGame[key] < threshold - 0.05) {
            // Bad percentage player - penalty (but reduced)
            focusScore -= catWeight * 1;
          }
        } else if (!isTov) {
          // For counting stats: weight by per-game average contribution
          const contribution = perGame[key];
          if (contribution >= thresholds[key]) {
            // Above threshold = full weight
            focusScore += contribution * catWeight;
            boosts.push(key);
          } else if (contribution >= thresholds[key] * 0.5) {
            // Partial contribution
            focusScore += contribution * catWeight * 0.5;
          }
        }
        // Don't consider TOV for streaming focus - can't stream for fewer turnovers
      }

      // FG%/FT% guardrails - penalize players who "tank" percentages
      let pctPenalty = 0;
      const FGM_THRESHOLD = 3; // Significant shooting volume
      const FTM_THRESHOLD = 1.5;
      
      // Estimate FGM/FGA from typical relationships
      const estimatedFGA = perGame.pts * 0.7 - perGame.threes * 0.7 - (perGame.ftPct > 0 ? 2 : 0);
      const estimatedFGM = estimatedFGA * perGame.fgPct;
      
      if (estimatedFGM > FGM_THRESHOLD) {
        // Meaningful shooting volume
        if (perGame.fgPct < 0.40) {
          // Tank FG% warning - significant penalty
          pctPenalty += 15;
        } else if (perGame.fgPct < 0.42) {
          // Moderate FG% concern
          pctPenalty += 8;
        }
      }
      
      // Estimate FTM from FT%
      const estimatedFTA = perGame.pts * 0.15;
      const estimatedFTM = estimatedFTA * perGame.ftPct;
      
      if (estimatedFTM > FTM_THRESHOLD) {
        // Meaningful FT volume
        if (perGame.ftPct < 0.65) {
          // Tank FT% warning - significant penalty
          pctPenalty += 12;
        } else if (perGame.ftPct < 0.70) {
          // Moderate FT% concern
          pctPenalty += 6;
        }
      }

      // Calculate overall value score (secondary consideration)
      const valueScore =
        perGame.pts * 0.8 +
        perGame.reb * 1.0 +
        perGame.ast * 1.2 +
        perGame.stl * 2.5 +
        perGame.blk * 2.5 +
        perGame.threes * 1.5 +
        (perGame.fgPct > 0.45 ? 3 : 0) +
        (perGame.ftPct > 0.75 ? 2 : 0) -
        perGame.tov * 1.0;

      // Identify strengths (top 3 categories)
      const catValues: Array<{ key: NineCatKey; value: number }> = [
        { key: "pts", value: perGame.pts },
        { key: "reb", value: perGame.reb * 2 },
        { key: "ast", value: perGame.ast * 2.5 },
        { key: "stl", value: perGame.stl * 5 },
        { key: "blk", value: perGame.blk * 5 },
        { key: "threes", value: perGame.threes * 3 },
      ];
      catValues.sort((a, b) => b.value - a.value);
      const strengths = catValues.slice(0, 3).map((c) => c.key);

      // Identify weaknesses
      const weaknesses: NineCatKey[] = [];
      if (perGame.tov > 2.0) weaknesses.push("tov");
      if (perGame.fgPct < 0.42) weaknesses.push("fgPct");
      if (perGame.ftPct < 0.70) weaknesses.push("ftPct");

      // Combined score: 70% focus categories + 30% overall value - percentage penalties
      const finalScore = (focusScore * 0.7 + valueScore * 0.3) - pctPenalty;

      // Fit score (0-100) based on how many focus cats they help
      const fitScore = Math.min(100, (boosts.length / Math.max(1, contestedCategories.length)) * 100);

      // Generate reason
      let reason = "";
      if (boosts.length > 0) {
        reason = `Boosts ${boosts.slice(0, 2).join(", ")}`;
      } else {
        reason = `Volume streamer (${player.gamesThisWeek}g)`;
      }
      
      // Add percentage warning if applicable
      if (pctPenalty >= 12) {
        reason += " ⚠️ FG%/FT% risk";
      }

      return {
        player,
        score: finalScore,
        boosts: boosts.slice(0, 3),
        strengths,
        weaknesses,
        reason,
        fitScore,
      };
    })
    .filter((r) => r !== null);

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}

/**
 * Rank roster players for drops
 */
function rankRosterForDrops(
  roster: Array<{
    playerId: string;
    name: string;
    stats: ReturnType<typeof extractNineCatFromPlayerMeta>;
    schedule: Date[];
    gamesRemaining: number;
    isCore?: boolean;
    rosterPct?: number | null;
  }>,
  leagueDist: ReturnType<typeof computeLeagueDistributions>,
  currentDate: Date
): Array<{
  player: typeof roster[0];
  dropScore: number; // Lower = better drop candidate (lower roster%)
  playerValue: number; // Overall PTV value
  reason: string;
  riskLevel: "low" | "medium" | "high";
  nextGameDate: string | null;
  rosterPct: number | null;
}> {
  const ranked = roster
    .map((player) => {
      if (!player.stats.hasStats) return null;
      if (player.isCore) return null; // Never drop core players

      const perGame = player.stats.perGame;
      const rosterPct = player.rosterPct ?? null;

      // Calculate player value for fallback sorting
      const playerValue =
        perGame.pts * 1.0 +
        perGame.reb * 1.2 +
        perGame.ast * 1.5 +
        perGame.stl * 3.5 +
        perGame.blk * 3.5 +
        perGame.threes * 2.0 +
        (perGame.fgPct * 100) +
        (perGame.ftPct * 100) -
        (perGame.tov * 2.0);

      // Check if player plays soon
      const upcomingGames = player.schedule.filter((d) => d >= currentDate);
      const nextGameDate = upcomingGames.length > 0 ? upcomingGames[0].toISOString().split('T')[0] : null;

      // Drop score: PRIMARY = roster% (lower is better drop candidate)
      // For players without roster%, use very high score to place at end
      let dropScore: number;
      if (rosterPct !== null) {
        // Use roster% directly as drop score (0-100 range, lower = better drop)
        dropScore = rosterPct;
        
        // Small bonus if no games remaining (makes them slightly better to drop)
        if (player.gamesRemaining === 0) {
          dropScore -= 5;
        }
      } else {
        // No roster% data: use player value as fallback, placing at end
        // Start at 1000 to ensure they sort after players with roster%
        dropScore = 1000 - playerValue;
      }

      // Generate reason based on ROSTER%
      let reason = "";
      if (rosterPct === null) {
        reason = player.gamesRemaining === 0 
          ? "No games remaining (unknown roster %)"
          : "Replacement-level player";
      } else if (rosterPct <= 20) {
        reason = `${rosterPct.toFixed(0)}% rostered — rarely owned`;
      } else if (rosterPct <= 40) {
        reason = `${rosterPct.toFixed(0)}% rostered — low ownership`;
      } else if (rosterPct <= 60) {
        reason = `${rosterPct.toFixed(0)}% rostered — moderate ownership`;
      } else {
        reason = `${rosterPct.toFixed(0)}% rostered — widely owned`;
      }

      // Deprecated risk level (keeping for backward compatibility)
      let riskLevel: "low" | "medium" | "high" = "low";

      return {
        player,
        dropScore,
        playerValue,
        reason,
        riskLevel,
        nextGameDate,
        rosterPct,
      };
    })
    .filter((r) => r !== null);

  // Sort by dropScore ascending (lower roster% = better drop candidate)
  ranked.sort((a, b) => a.dropScore - b.dropScore);

  // Exclude top 3 players by roster% (or value if no roster%) as guardrail
  const sortedByOwnership = [...ranked].sort((a, b) => {
    if (a.rosterPct !== null && b.rosterPct !== null) {
      return b.rosterPct - a.rosterPct; // Higher roster% = more owned
    } else if (a.rosterPct !== null) {
      return -1; // a has roster%, prioritize
    } else if (b.rosterPct !== null) {
      return 1; // b has roster%, prioritize
    } else {
      return b.playerValue - a.playerValue; // Fallback to value
    }
  });
  const top3Ids = new Set(sortedByOwnership.slice(0, 3).map(r => r.player.playerId));
  
  return ranked.filter(r => !top3Ids.has(r.player.playerId));
}

/**
 * Extract player schedule - now uses proTeamId to look up NBA team schedules
 * Note: NBA schedules are fetched separately and passed in via context
 */
function extractPlayerSchedule(
  playerMeta: any, 
  scoringPeriodStart: Date, 
  scoringPeriodEnd: Date,
  nbaSchedules?: Map<string, Date[]>
): Date[] {
  const gameDates: Date[] = [];
  
  // Normalize period dates to UTC midnight for consistent comparison
  const periodStartUTC = new Date(Date.UTC(scoringPeriodStart.getFullYear(), scoringPeriodStart.getMonth(), scoringPeriodStart.getDate()));
  const periodEndUTC = new Date(Date.UTC(scoringPeriodEnd.getFullYear(), scoringPeriodEnd.getMonth(), scoringPeriodEnd.getDate(), 23, 59, 59));
  
  // ESPN Fantasy API doesn't provide player game schedules
  // We need to use proTeamId to look up the NBA team's schedule
  const proTeamId = playerMeta?.proTeamId;
  
  if (!proTeamId || !nbaSchedules) {
    return gameDates;
  }
  
  // Map ESPN fantasy proTeamId to NBA team ID
  const fantasyToNBAMap: Record<number, string> = {
    1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: '11', 12: '12', 13: '13', 14: '14', 15: '15', 16: '16', 17: '17', 18: '18',
    19: '19', 20: '20', 21: '21', 22: '22', 23: '23', 24: '24', 25: '25', 26: '26',
    27: '27', 28: '28', 29: '29', 30: '30',
  };
  
  const nbaTeamId = fantasyToNBAMap[proTeamId];
  if (!nbaTeamId) {
    return gameDates;
  }
  
  // Get team schedule from NBA schedules map
  const teamGames = nbaSchedules.get(nbaTeamId) || [];
  
  // Filter to scoring period
  for (const gameDate of teamGames) {
        const gameDateUTC = new Date(Date.UTC(gameDate.getFullYear(), gameDate.getMonth(), gameDate.getDate()));
        
        if (gameDateUTC >= periodStartUTC && gameDateUTC <= periodEndUTC) {
          gameDates.push(gameDateUTC);
        }
      }
  
  return gameDates;
}

// Helper: Get acquisition limits from league
async function getAcquisitionLimits(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  });
  
  const settings = (league?.settings as any) || {};
  const acquisitionLimit = typeof settings.acquisitionLimit === "number" ? settings.acquisitionLimit : null;
  
  // TODO: Get acquisitionsUsed from transactions table when implemented
  // For now, return null and let frontend handle it
  const acquisitionsUsed = typeof settings.acquisitionsUsed === "number" ? settings.acquisitionsUsed : null;
  
  return {
    limit: acquisitionLimit,
    used: acquisitionsUsed,
    remaining: acquisitionLimit !== null && acquisitionsUsed !== null 
      ? Math.max(0, acquisitionLimit - acquisitionsUsed)
      : null,
  };
}

// Unified Streaming Overview endpoint
app.get("/leagues/:leagueId/streaming/overview", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.query.teamId as string | undefined;

  if (!teamId) {
    return res.status(400).json({ 
      status: "error",
      errorCode: "MISSING_TEAM_ID",
      message: "teamId query parameter required"
    });
  }

  try {
    console.log(`[Streaming Overview] leagueId=${leagueId}, teamId=${teamId}`);

    // Fetch league
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, seasonYear: true, settings: true },
    });
    
    if (!league) {
      return res.status(404).json({ 
        status: "error",
        errorCode: "LEAGUE_NOT_FOUND",
        message: "League not found"
      });
    }

    console.log(`[Streaming Overview] Found league: ${league.name}, season: ${league.seasonYear}`);

    // Get scoring period info
    const firstTeam = await prisma.team.findFirst({
      where: { leagueId },
      select: { meta: true },
    });
    const firstTeamMeta = (firstTeam?.meta as any) || {};
    const scoringPeriodStartDate = firstTeamMeta.scoringPeriodStartDate 
      ? new Date(firstTeamMeta.scoringPeriodStartDate)
      : new Date();
    const scoringPeriodEndDate = firstTeamMeta.scoringPeriodEndDate
      ? new Date(firstTeamMeta.scoringPeriodEndDate)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    console.log(`[Streaming Overview] Scoring period: ${scoringPeriodStartDate.toISOString()} to ${scoringPeriodEndDate.toISOString()}`);

    // Get acquisition limits
    const acquisitionLimits = await getAcquisitionLimits(leagueId);
    console.log(`[Streaming Overview] Acquisition limits:`, acquisitionLimits);

    // Get team and opponent
    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: {
        id: true,
        name: true,
        meta: true,
        rosterSlots: {
          where: { endAt: null },
          select: {
            meta: true,
            slotLabel: true,
            player: { 
              select: { 
                id: true, 
                fullName: true, 
                positions: true,
                meta: true, 
                providerPlayerId: true 
              } 
            },
          },
        },
      },
    });

    if (!team) {
      return res.status(404).json({ 
        status: "error",
        errorCode: "TEAM_NOT_FOUND",
        message: "Team not found"
      });
    }

    // Get opponent from weekly projection
    const defaultGamesPerWeek = 4;
    const myProjection = await calculateTeamWeeklyProjection(
      team.rosterSlots,
      league.seasonYear,
      defaultGamesPerWeek,
      scoringPeriodStartDate.toISOString(),
      scoringPeriodEndDate.toISOString()
    );

    // Try to find opponent
    const teamMeta = (team.meta as any) || {};
    const opponentTeamId = teamMeta.currentOpponentId;
    let opponent = null;
    let oppProjection: { totals: NineCatTotals; totalsWithAttempts: any; players: any[] } | null = null;

    if (opponentTeamId) {
      opponent = await prisma.team.findFirst({
        where: { id: opponentTeamId, leagueId },
        select: {
          id: true,
          name: true,
          rosterSlots: {
            where: { endAt: null },
            select: {
              meta: true,
              slotLabel: true,
              player: { 
                select: { 
                  id: true, 
                  fullName: true, 
                  positions: true,
                  meta: true, 
                  providerPlayerId: true 
                } 
              },
            },
          },
        },
      });

      if (opponent) {
        oppProjection = await calculateTeamWeeklyProjection(
          opponent.rosterSlots,
          league.seasonYear,
          defaultGamesPerWeek,
          scoringPeriodStartDate.toISOString(),
          scoringPeriodEndDate.toISOString()
        );
      }
    }

    // Determine contested categories (projected)
    const categoryLabels: Record<NineCatKey, string> = {
      pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK",
      threes: "3PM", fgPct: "FG%", ftPct: "FT%", tov: "TO",
    };
    const categoryKeys: NineCatKey[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
    
    type ContestedCategory = {
      key: NineCatKey;
      label: string;
      myValue: number;
      oppValue: number;
      absDelta: number;
      normalizedDelta: number;
      source: "Projected" | "Live" | "Equal";
      isFavored: boolean;
    };
    
    const projectedContested: ContestedCategory[] = [];
    const liveContested: ContestedCategory[] = [];
    let finalStreamingFocus: ContestedCategory[] = [];
    const contestedCategories: NineCatKey[] = [];
    
    if (oppProjection) {
      const myTotals = myProjection.totals;
      const oppTotals = oppProjection.totals;
      
      const maxValues: Record<NineCatKey, number> = {
        pts: Math.max(myTotals.pts, oppTotals.pts, 100),
        reb: Math.max(myTotals.reb, oppTotals.reb, 50),
        ast: Math.max(myTotals.ast, oppTotals.ast, 50),
        stl: Math.max(myTotals.stl, oppTotals.stl, 10),
        blk: Math.max(myTotals.blk, oppTotals.blk, 10),
        threes: Math.max(myTotals.threes, oppTotals.threes, 30),
        fgPct: 1,
        ftPct: 1,
        tov: Math.max(myTotals.tov, oppTotals.tov, 30),
      };

      // Compute projected contested categories
      for (const key of categoryKeys) {
        const myValue = myTotals[key];
        const oppValue = oppTotals[key];
        const isPct = key === "fgPct" || key === "ftPct";
        const isTov = key === "tov";
        
        let absDelta: number;
        if (isPct) {
          // For percentages: convert to percentage points
          absDelta = Math.abs(myValue - oppValue) * 100;
        } else {
          absDelta = Math.abs(myValue - oppValue);
        }
        
        const normalizedDelta = absDelta / (isPct ? 100 : maxValues[key]);
        const isFavored = isTov ? myValue < oppValue : myValue > oppValue;
        
        projectedContested.push({
          key,
          label: categoryLabels[key],
          myValue,
          oppValue,
          absDelta,
          normalizedDelta,
          source: "Projected",
          isFavored,
        });
      }
      
      // Sort projected by normalized delta (smallest = most contested)
      projectedContested.sort((a, b) => a.normalizedDelta - b.normalizedDelta);
      
      // TODO: If we have live data in the future, compute liveContested similarly
      // For now, use projected as the live data (same as weekly projections fallback)
      for (const cat of projectedContested) {
        liveContested.push({ ...cat, source: "Live" as const });
      }
      
      // Compute Final Streaming Focus by combining projected and live
      // Exclude turnovers (can't stream for fewer TOs)
      const streamableKeys = categoryKeys.filter(k => k !== "tov");
      
      const combined = streamableKeys.map((key) => {
        const projectedCat = projectedContested.find(c => c.key === key)!;
        const liveCat = liveContested.find(c => c.key === key);
        
        const projectedDelta = projectedCat.normalizedDelta;
        const liveDelta = liveCat?.normalizedDelta || projectedDelta;
        
        const smallerDelta = Math.min(projectedDelta, liveDelta);
        const source: "Projected" | "Live" | "Equal" = 
          projectedDelta < liveDelta ? "Projected" : 
          projectedDelta > liveDelta ? "Live" : 
          "Equal";
        
        // Use the source with smaller delta
        const cat = source === "Live" && liveCat ? liveCat : projectedCat;
        return { 
          ...cat, 
          normalizedDelta: smallerDelta,
          source 
        };
      });
      
      // Sort by priority delta (smallest = most contested)
      combined.sort((a, b) => a.normalizedDelta - b.normalizedDelta);
      finalStreamingFocus = combined.slice(0, 4);
      
      // Extract top 4 keys for backward compatibility
      contestedCategories.push(...finalStreamingFocus.map(c => c.key));
    }

    console.log(`[Streaming Overview] Final Streaming Focus:`, finalStreamingFocus.map(c => c.label).join(', '));

    // Get ALL free agents (not rostered by anyone)
    const activeRosterSlots = await prisma.rosterSlot.findMany({
      where: { leagueId: league.id, endAt: null },
      select: { playerId: true },
    });
    const ownedPlayerIds = new Set(activeRosterSlots.map((slot) => slot.playerId));

    console.log(`[Streaming Overview] Found ${ownedPlayerIds.size} rostered players`);

    const allPlayers = await prisma.player.findMany({
      where: {
        leagues: { some: { id: leagueId } },
        isActive: true,
      },
      select: {
        id: true,
        providerPlayerId: true,
        fullName: true,
        positions: true,
        meta: true,
      },
    });

    console.log(`[Streaming Overview] Found ${allPlayers.length} total players in league`);

    const freeAgents = allPlayers.filter((p) => !ownedPlayerIds.has(p.id));
    console.log(`[Streaming Overview] Found ${freeAgents.length} free agents`);

    // Fetch NBA schedules for the scoring period
    const nbaSchedules = await getCachedNBASchedule(scoringPeriodStartDate, scoringPeriodEndDate);
    console.log(`[Streaming Overview] Loaded NBA schedules for ${nbaSchedules.size} teams`);

    // Process free agents with stats and schedule
    const freeAgentsWithData = freeAgents
      .map((p) => {
        const stats = extractNineCatFromPlayerMeta(p.meta as any, league.seasonYear);
        if (!stats.hasStats) return null;

        const injuryInfo = extractInjuryInfo(p.meta as any, null);
        if (injuryInfo.status === "OUT" || injuryInfo.status === "IR") return null;

        const schedule = extractPlayerSchedule(p.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
        const gamesThisWeek = schedule.length;

        if (gamesThisWeek === 0) return null;

        // Calculate projected totals
        const projectedTotals = {
          pts: stats.perGame.pts * gamesThisWeek,
          reb: stats.perGame.reb * gamesThisWeek,
          ast: stats.perGame.ast * gamesThisWeek,
          stl: stats.perGame.stl * gamesThisWeek,
          blk: stats.perGame.blk * gamesThisWeek,
          threes: stats.perGame.threes * gamesThisWeek,
          tov: stats.perGame.tov * gamesThisWeek,
          fgPct: stats.perGame.fgPct,
          ftPct: stats.perGame.ftPct,
        };

        // Determine which contested categories this player boosts
        const boosts: NineCatKey[] = [];
        for (const cat of contestedCategories) {
          if (playerBoostsCategory(stats.perGame, cat)) {
            boosts.push(cat);
          }
        }

        // Calculate fit score
        const fitScore = contestedCategories.length > 0
          ? Math.round((boosts.length / contestedCategories.length) * 100)
          : 0;

        // Map schedule to gamesByDay
        const gamesByDay: Record<string, boolean> = {};
        for (const gameDate of schedule) {
          const dateKey = gameDate.toISOString().split('T')[0];
          gamesByDay[dateKey] = true;
        }

        // Create human-readable schedule text
        const scheduleText = schedule.length > 0
          ? schedule
              .map((d) => d.toLocaleDateString('en-US', { weekday: 'short' }))
              .join(', ')
          : 'No games';

        return {
          playerId: p.id,
          name: p.fullName,
          teamAbbr: (p.meta as any)?.proTeamAbbr || "FA",
          headshotUrl: (() => {
            const cleanId = cleanProviderPlayerId(p.providerPlayerId);
            return cleanId ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanId}.png`) : null;
          })(),
          gamesThisWeek,
          gamesByDay,
          scheduleText,
          projectedTotals,
          projectedPerGame: stats.perGame,
          boosts,
          fitScore,
        };
      })
      .filter((p) => p !== null);

    console.log(`[Streaming Overview] Processed ${freeAgentsWithData.length} free agents with stats`);

    // Build matchup snapshot
    let matchupSnapshot = null;
    if (oppProjection) {
      const categoryLabels: Record<NineCatKey, string> = {
        pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK",
        threes: "3PM", fgPct: "FG%", ftPct: "FT%", tov: "TO",
      };
      const categoryKeys: NineCatKey[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
      const myTotals = myProjection.totals;
      const oppTotals = oppProjection.totals;
      const maxValues: Record<NineCatKey, number> = {
        pts: Math.max(myTotals.pts, oppTotals.pts, 100),
        reb: Math.max(myTotals.reb, oppTotals.reb, 50),
        ast: Math.max(myTotals.ast, oppTotals.ast, 50),
        stl: Math.max(myTotals.stl, oppTotals.stl, 10),
        blk: Math.max(myTotals.blk, oppTotals.blk, 10),
        threes: Math.max(myTotals.threes, oppTotals.threes, 30),
        fgPct: 1,
        ftPct: 1,
        tov: Math.max(myTotals.tov, oppTotals.tov, 30),
      };

      const matchupResult = calculateMatchupResults(myTotals, oppTotals);
      const categories = categoryKeys.map((key) => {
        const closenessData = calculateCategoryCloseness(myTotals[key], oppTotals[key], key, maxValues[key]);
        return {
          key,
          label: categoryLabels[key],
          myTotal: myTotals[key],
          oppTotal: oppTotals[key],
          ...closenessData,
        };
      });

      matchupSnapshot = {
        projectedScore: {
          wins: matchupResult.projectedScore.teamCatsWon,
          losses: matchupResult.projectedScore.opponentCatsWon,
          ties: matchupResult.projectedScore.tied,
        },
        categories,
        closeCategories: categories.filter((c) => c.closeness === "close"),
        flippableCategories: categories.filter((c) => c.isFlippable),
      };
    }

    // Rank free agents and roster for recommendations
    const currentDate = new Date();
    // Use Final Streaming Focus categories with proper weights (smaller delta = higher weight)
    const contestedCategoriesForRanking = finalStreamingFocus.map((cat) => ({
      key: cat.key,
      normalizedDelta: cat.normalizedDelta,
      weight: 1 / (cat.normalizedDelta + 0.02), // Smaller delta = higher weight
    }));

    const freeAgentsForRanking = freeAgents.map((p) => {
      const stats = extractNineCatFromPlayerMeta(p.meta as any, league.seasonYear);
      const schedule = extractPlayerSchedule(p.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
      const injuryInfo = extractInjuryInfo(p.meta as any, null);
      return {
        playerId: p.id,
        name: p.fullName,
        stats,
        schedule,
        gamesThisWeek: schedule.length,
        injuryStatus: injuryInfo.status,
      };
    }).filter((p) => p.stats.hasStats && p.injuryStatus !== "OUT" && p.injuryStatus !== "IR" && p.gamesThisWeek > 0);

    const rankedFreeAgents = rankFreeAgentsForAdds(freeAgentsForRanking, contestedCategoriesForRanking, currentDate);

    const rosterForRanking = team.rosterSlots.map((slot) => {
      const stats = extractNineCatFromPlayerMeta(slot.player.meta as any, league.seasonYear);
      const schedule = extractPlayerSchedule(slot.player.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
      
      // Extract roster percentage from ESPN player meta (if available)
      const playerMeta = (slot.player.meta as any) || {};
      const ownership = playerMeta.ownership || {};
      const rosterPct = typeof ownership.percentOwned === "number" ? ownership.percentOwned : null;
      
      return {
        playerId: slot.player.id,
        name: slot.player.fullName,
        stats,
        schedule,
        gamesRemaining: schedule.length,
        isCore: false, // TODO: integrate with core player detection
        rosterPct,
      };
    }).filter((p) => p.stats.hasStats);

    // Compute league distributions for value-based drop ranking
    const allTeams = await prisma.team.findMany({
      where: { leagueId },
      select: {
        id: true,
        name: true,
        rosterSlots: {
          where: { endAt: null },
          select: {
            meta: true,
            player: { select: { id: true, fullName: true, meta: true } },
          },
        },
      },
    });
    
    // Compute team totals for league distribution
    const teamsTotals: TeamTotals[] = [];
    for (const t of allTeams) {
      // Filter out IR players
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
    
    const leagueDist = computeLeagueDistributions(teamsTotals);

    const rankedDrops = rankRosterForDrops(rosterForRanking, leagueDist, currentDate);

    // Generate daily recommendations
    const dates: Date[] = [];
    for (let d = new Date(scoringPeriodStartDate); d <= scoringPeriodEndDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d));
    }

    const dailyRecommendations = dates.map((date, dayIndex) => {
      const dateKey = date.toISOString().split('T')[0];
      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      // Find free agents playing on this date (use ISO date string for comparison)
      const freeAgentsPlayingToday = rankedFreeAgents.filter((r) => {
        const playsToday = r.player.schedule.some((gameDate) => {
          const gameDateKey = gameDate.toISOString().split('T')[0];
          return gameDateKey === dateKey;
        });
        return playsToday;
      });
      
      // Debug logging for day filtering
      if (dayIndex <= 2) {
        console.log(`[Day ${dayIndex}] ${dayLabel} (${dateKey}):`, {
          totalFreeAgents: rankedFreeAgents.length,
          playingToday: freeAgentsPlayingToday.length,
          examplePlayers: freeAgentsPlayingToday.slice(0, 3).map(r => ({
            name: r.player.name,
            schedule: r.player.schedule.map(d => d.toISOString().split('T')[0])
          }))
        });
      }

      // Generate recommendations (date-aware filtering)
      const recommendations: any[] = [];
      
      if (freeAgentsPlayingToday.length > 0 && rankedDrops.length > 0) {
        // Recommend top adds for this date
        // For day 0 (today), show more recs; for future days, show fewer
        const maxRecs = dayIndex === 0 ? MAX_RECS_PER_DAY : Math.min(2, MAX_RECS_PER_DAY);
        const topAdds = freeAgentsPlayingToday.slice(0, maxRecs);
        
        // Find drops who DON'T play today (prefer to drop inactive players)
        const dropsNotPlayingToday = rankedDrops.filter((d) => {
          const playsToday = d.player.schedule.some((gameDate) => {
            const gameDateKey = gameDate.toISOString().split('T')[0];
            return gameDateKey === dateKey;
          });
          return !playsToday;
        });
        const dropCandidatesForDay = dropsNotPlayingToday.length > 0 ? dropsNotPlayingToday : rankedDrops;
        
        for (const addRec of topAdds) {
          const bestDrop = dropCandidatesForDay[0]; // Suggest best drop who doesn't play today
          
          recommendations.push({
            addPlayerId: addRec.player.playerId,
            addPlayerName: addRec.player.name,
            addReason: addRec.reason,
            addBoosts: addRec.boosts,
            addFitScore: addRec.fitScore,
            dropPlayerId: bestDrop.player.playerId,
            dropPlayerName: bestDrop.player.name,
            dropReason: bestDrop.reason,
            dropRiskLevel: bestDrop.riskLevel,
            mode: addRec.boosts.length > 0 ? "strict" : "opportunity",
          });
        }
      }

      // Count games (use ISO date string for comparison)
      const youGames = team.rosterSlots.filter((slot) => {
        const schedule = extractPlayerSchedule(slot.player.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
        return schedule.some((gameDate) => {
          const gameDateKey = gameDate.toISOString().split('T')[0];
          return gameDateKey === dateKey;
        });
      }).length;

      const oppGames = opponent
        ? opponent.rosterSlots.filter((slot) => {
            const schedule = extractPlayerSchedule(slot.player.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
            return schedule.some((gameDate) => {
              const gameDateKey = gameDate.toISOString().split('T')[0];
              return gameDateKey === dateKey;
            });
          }).length
        : 0;

      const noRecommendationReason = 
        recommendations.length > 0 ? null :
        freeAgentsPlayingToday.length === 0 ? "No free agents play today" :
        rankedDrops.length === 0 ? "No safe drop candidates" :
        dayIndex > 0 ? "Focus on today's recommendations first" :
        "No high-impact adds available";

      return {
        dateISO: dateKey,
        label: dayLabel,
        youGames,
        oppGames,
        freeAgentsPlayingCount: freeAgentsPlayingToday.length,
        recommendations,
        noRecommendationReason,
      };
    });

    // Enhanced free agents with rankings
    const enhancedFreeAgents = rankedFreeAgents.slice(0, 50).map((r) => {
      const playerData = freeAgentsWithData.find((fa) => fa.playerId === r.player.playerId);
      return {
        ...playerData,
        score: r.score,
        fitScore: r.fitScore,
        strengths: r.strengths,
        weaknesses: r.weaknesses,
        reason: r.reason,
      };
    });

    // Drop candidates
    const dropCandidates = rankedDrops.slice(0, 5).map((r) => ({
      playerId: r.player.playerId,
      name: r.player.name,
      gamesRemaining: r.player.gamesRemaining,
      nextGameDate: r.nextGameDate,
      reason: r.reason,
      riskLevel: r.riskLevel,
      rosterPct: r.rosterPct,
      perGame: r.player.stats.perGame,
    }));

    res.setHeader("Cache-Control", "public, max-age=180");
    return res.json({
      status: "ok",
      meta: {
        weekId: (firstTeamMeta.matchupPeriodId as number) || 1,
        scoringPeriodId: (firstTeamMeta.scoringPeriodId as number) || 1,
        startDateISO: scoringPeriodStartDate.toISOString().split('T')[0],
        endDateISO: scoringPeriodEndDate.toISOString().split('T')[0],
        addsLimit: acquisitionLimits.limit,
        addsUsed: acquisitionLimits.used,
        addsRemaining: acquisitionLimits.remaining,
      },
      matchupSnapshot,
      targets: {
        contestedCats: contestedCategories,
        recommendedCats: contestedCategories,
      },
      // Final Streaming Focus - computed from projected + live data
      finalStreamingFocus: finalStreamingFocus.map((cat) => ({
        key: cat.key,
        label: cat.label,
        myValue: cat.myValue,
        oppValue: cat.oppValue,
        absDelta: Number(cat.absDelta.toFixed(2)),
        source: cat.source,
        isFavored: cat.isFavored,
      })),
      dailyRecommendations,
      freeAgents: enhancedFreeAgents,
      dropCandidates,
      roster: team.rosterSlots.map((slot) => {
        const schedule = extractPlayerSchedule(slot.player.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
        const gamesByDay: Record<string, boolean> = {};
        for (const gameDate of schedule) {
          const dateKey = gameDate.toISOString().split('T')[0];
          gamesByDay[dateKey] = true;
        }

        const stats = extractNineCatFromPlayerMeta(slot.player.meta as any, league.seasonYear);
        const gamesThisWeek = schedule.length;

        return {
          playerId: slot.player.id,
          name: slot.player.fullName,
          teamAbbr: (slot.player.meta as any)?.proTeamAbbr || "N/A",
          headshotUrl: (() => {
            const cleanId = cleanProviderPlayerId(slot.player.providerPlayerId);
            return cleanId ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanId}.png`) : null;
          })(),
          gamesByDay,
          gamesRemaining: gamesThisWeek,
          projectedTotals: {
            pts: stats.perGame.pts * gamesThisWeek,
            reb: stats.perGame.reb * gamesThisWeek,
            ast: stats.perGame.ast * gamesThisWeek,
            stl: stats.perGame.stl * gamesThisWeek,
            blk: stats.perGame.blk * gamesThisWeek,
            threes: stats.perGame.threes * gamesThisWeek,
            tov: stats.perGame.tov * gamesThisWeek,
            fgPct: stats.perGame.fgPct,
            ftPct: stats.perGame.ftPct,
          },
          perGame: stats.perGame,
        };
      }),
    });
  } catch (err) {
    console.error("[Streaming Overview] Error:", err);
    return res.status(500).json({ 
      status: "error",
      errorCode: "INTERNAL_ERROR",
      message: "Failed to generate streaming overview",
      details: err instanceof Error ? err.message : String(err)
    });
  }
});

// Streaming impact calculation endpoint
app.post("/leagues/:leagueId/streaming/impact", async (req, res) => {
  const leagueId = req.params.leagueId;
  const { teamId, opponentTeamId, addPlayerId, dropPlayerId } = req.body;

  if (!teamId || !addPlayerId || !dropPlayerId) {
    return res.status(400).json({
      status: "error",
      message: "teamId, addPlayerId, and dropPlayerId are required"
    });
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, seasonYear: true },
    });
    if (!league) {
      return res.status(404).json({ status: "error", message: "League not found" });
    }

    // Get scoring period
    const firstTeam = await prisma.team.findFirst({
      where: { leagueId },
      select: { meta: true },
    });
    const firstTeamMeta = (firstTeam?.meta as any) || {};
    const scoringPeriodStartDate = firstTeamMeta.scoringPeriodStartDate 
      ? new Date(firstTeamMeta.scoringPeriodStartDate)
      : new Date();
    const scoringPeriodEndDate = firstTeamMeta.scoringPeriodEndDate
      ? new Date(firstTeamMeta.scoringPeriodEndDate)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Get team roster
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        rosterSlots: {
          where: { endAt: null },
          select: {
            meta: true,
            slotLabel: true,
            player: { select: { id: true, fullName: true, meta: true, providerPlayerId: true } },
          },
        },
      },
    });
    if (!team) {
      return res.status(404).json({ status: "error", message: "Team not found" });
    }

    // Get add player
    const addPlayer = await prisma.player.findUnique({
      where: { id: addPlayerId },
      select: { id: true, fullName: true, meta: true, providerPlayerId: true },
    });
    if (!addPlayer) {
      return res.status(404).json({ status: "error", message: "Add player not found" });
    }

    // Calculate BEFORE projection
    const defaultGamesPerWeek = 4;
    const beforeProjection = await calculateTeamWeeklyProjection(
      team.rosterSlots,
      league.seasonYear,
      defaultGamesPerWeek,
      scoringPeriodStartDate.toISOString(),
      scoringPeriodEndDate.toISOString()
    );

    // Calculate AFTER projection (remove drop, add new player)
    const modifiedRoster = team.rosterSlots
      .filter(slot => slot.player.id !== dropPlayerId)
      .concat([{
        meta: {},
        slotLabel: "UTIL",
        player: addPlayer,
      }]);

    const afterProjection = await calculateTeamWeeklyProjection(
      modifiedRoster as any,
      league.seasonYear,
      defaultGamesPerWeek,
      scoringPeriodStartDate.toISOString(),
      scoringPeriodEndDate.toISOString()
    );

    // Calculate deltas
    const categoryKeys: NineCatKey[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
    const deltas: Record<NineCatKey, number> = {} as any;
    for (const key of categoryKeys) {
      if (key === "fgPct" || key === "ftPct") {
        deltas[key] = afterProjection.totals[key] - beforeProjection.totals[key];
      } else {
        deltas[key] = afterProjection.totals[key] - beforeProjection.totals[key];
      }
    }

    // Get opponent projection if available
    let matchupResultBefore = null;
    let matchupResultAfter = null;
    if (opponentTeamId) {
      const opponent = await prisma.team.findUnique({
        where: { id: opponentTeamId },
        select: {
          rosterSlots: {
            where: { endAt: null },
            select: {
              meta: true,
              slotLabel: true,
              player: { select: { id: true, fullName: true, meta: true, providerPlayerId: true } },
            },
          },
        },
      });

      if (opponent) {
        const oppProjection = await calculateTeamWeeklyProjection(
          opponent.rosterSlots,
          league.seasonYear,
          defaultGamesPerWeek,
          scoringPeriodStartDate.toISOString(),
          scoringPeriodEndDate.toISOString()
        );

        matchupResultBefore = calculateMatchupResults(beforeProjection.totals, oppProjection.totals);
        matchupResultAfter = calculateMatchupResults(afterProjection.totals, oppProjection.totals);
      }
    }

    res.setHeader("Cache-Control", "no-cache");
    return res.json({
      status: "ok",
      before: beforeProjection.totals,
      after: afterProjection.totals,
      deltas,
      matchupResultBefore: matchupResultBefore ? {
        wins: matchupResultBefore.projectedScore.teamCatsWon,
        losses: matchupResultBefore.projectedScore.opponentCatsWon,
        ties: matchupResultBefore.projectedScore.tied,
      } : null,
      matchupResultAfter: matchupResultAfter ? {
        wins: matchupResultAfter.projectedScore.teamCatsWon,
        losses: matchupResultAfter.projectedScore.opponentCatsWon,
        ties: matchupResultAfter.projectedScore.tied,
      } : null,
    });
  } catch (err) {
    console.error("[Streaming Impact] Error:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to calculate impact",
      details: err instanceof Error ? err.message : String(err)
    });
  }
});

// Streaming schedule endpoint - day-by-day schedule with players
app.get("/leagues/:leagueId/streaming/schedule", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.query.teamId as string | undefined;
  const opponentTeamId = req.query.opponentTeamId as string | undefined;

  if (!teamId) {
    return res.status(400).json({ error: "teamId query parameter required" });
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, seasonYear: true, settings: true },
    });
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    // Get scoring period info
    const firstTeam = await prisma.team.findFirst({
      where: { leagueId },
      select: { meta: true },
    });
    const firstTeamMeta = (firstTeam?.meta as any) || {};
    const scoringPeriodStartDate = firstTeamMeta.scoringPeriodStartDate 
      ? new Date(firstTeamMeta.scoringPeriodStartDate)
      : new Date();
    const scoringPeriodEndDate = firstTeamMeta.scoringPeriodEndDate
      ? new Date(firstTeamMeta.scoringPeriodEndDate)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Get team roster
    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: {
        id: true,
        name: true,
        rosterSlots: {
          where: { endAt: null },
          select: {
            meta: true,
            slotLabel: true,
            player: { 
              select: { 
                id: true, 
                fullName: true, 
                positions: true,
                meta: true, 
                providerPlayerId: true 
              } 
            },
          },
        },
      },
    });
    if (!team) return res.status(404).json({ error: "Team not found" });

    // Get opponent roster
    let opponent = null;
    if (opponentTeamId) {
      opponent = await prisma.team.findFirst({
        where: { id: opponentTeamId, leagueId },
        select: {
          id: true,
          name: true,
          rosterSlots: {
            where: { endAt: null },
            select: {
              meta: true,
              slotLabel: true,
              player: { 
                select: { 
                  id: true, 
                  fullName: true, 
                  positions: true,
                  meta: true, 
                  providerPlayerId: true 
                } 
              },
            },
          },
        },
      });
    }

    // Get all free agents
    const activeRosterSlots = await prisma.rosterSlot.findMany({
      where: { leagueId: league.id, endAt: null },
      select: { playerId: true },
    });
    const ownedPlayerIds = new Set(activeRosterSlots.map((slot) => slot.playerId));

    const allPlayers = await prisma.player.findMany({
      where: {
        leagues: { some: { id: leagueId } },
        isActive: true,
      },
      select: {
        id: true,
        providerPlayerId: true,
        fullName: true,
        positions: true,
        meta: true,
      },
    });

    const freeAgents = allPlayers.filter((p) => !ownedPlayerIds.has(p.id));

    // Fetch NBA schedules for the scoring period
    const nbaSchedules = await getCachedNBASchedule(scoringPeriodStartDate, scoringPeriodEndDate);
    console.log(`[Streaming Schedule] Loaded NBA schedules for ${nbaSchedules.size} teams`);

    // Build day-by-day schedule
    const dates: Date[] = [];
    for (let d = new Date(scoringPeriodStartDate); d <= scoringPeriodEndDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d));
    }

    const days = dates.map((date) => {
      const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'short' });
      
      // My players playing today
      const myPlayersPlaying = team.rosterSlots
        .filter((slot) => {
          const schedule = extractPlayerSchedule(slot.player.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
          return schedule.some((gameDate) => gameDate.toDateString() === date.toDateString());
        })
        .map((slot) => ({
          playerId: slot.player.id,
          name: slot.player.fullName,
          headshotUrl: (() => {
            const cleanId = cleanProviderPlayerId(slot.player.providerPlayerId);
            return cleanId ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanId}.png`) : null;
          })(),
          positions: slot.player.positions,
        }));

      // Opponent players playing today
      const oppPlayersPlaying = opponent
        ? opponent.rosterSlots
            .filter((slot) => {
              const schedule = extractPlayerSchedule(slot.player.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
              return schedule.some((gameDate) => gameDate.toDateString() === date.toDateString());
            })
            .map((slot) => ({
              playerId: slot.player.id,
              name: slot.player.fullName,
              headshotUrl: (() => {
                const cleanId = cleanProviderPlayerId(slot.player.providerPlayerId);
                return cleanId ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanId}.png`) : null;
              })(),
              positions: slot.player.positions,
            }))
        : [];

      // Free agents playing today
      const freeAgentsPlaying = freeAgents
        .filter((p) => {
          const schedule = extractPlayerSchedule(p.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
          return schedule.some((gameDate) => gameDate.toDateString() === date.toDateString());
        })
        .map((p) => {
          const stats = extractNineCatFromPlayerMeta(p.meta as any, league.seasonYear);
          const schedule = extractPlayerSchedule(p.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
          const gamesThisWeek = schedule.length;
          
          return {
            playerId: p.id,
            name: p.fullName,
            headshotUrl: (() => {
              const cleanId = cleanProviderPlayerId(p.providerPlayerId);
              return cleanId ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanId}.png`) : null;
            })(),
            positions: p.positions,
            gamesThisWeek,
            playsToday: true,
            perGame: stats.perGame,
          };
        })
        .slice(0, 20); // Limit to top 20 per day

      return {
        date: date.toISOString().split('T')[0],
        label: dayOfWeek,
        myGames: myPlayersPlaying.length,
        oppGames: oppPlayersPlaying.length,
        myPlayersPlaying,
        oppPlayersPlaying,
        freeAgentsPlaying,
      };
    });

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({
      scoringPeriod: {
        startDate: scoringPeriodStartDate.toISOString().split('T')[0],
        endDate: scoringPeriodEndDate.toISOString().split('T')[0],
      },
      days,
      note: null,
    });
  } catch (err) {
    console.error("Error generating streaming schedule:", err);
    return res.status(500).json({ error: "Failed to generate streaming schedule" });
  }
});

// Streaming plan endpoint - day-by-day recommendations
app.get("/leagues/:leagueId/streaming/plan", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.query.teamId as string | undefined;
  const opponentTeamId = req.query.opponentTeamId as string | undefined;

  if (!teamId) {
    return res.status(400).json({ error: "teamId query parameter required" });
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, seasonYear: true, settings: true },
    });
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    // Get scoring period info
    const firstTeam = await prisma.team.findFirst({
      where: { leagueId },
      select: { meta: true },
    });
    const firstTeamMeta = (firstTeam?.meta as any) || {};
    const scoringPeriodStartDate = firstTeamMeta.scoringPeriodStartDate 
      ? new Date(firstTeamMeta.scoringPeriodStartDate)
      : new Date();
    const scoringPeriodEndDate = firstTeamMeta.scoringPeriodEndDate
      ? new Date(firstTeamMeta.scoringPeriodEndDate)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Get acquisition limits
    const acquisitionLimits = await getAcquisitionLimits(leagueId);

    // Get team and opponent data
    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: {
        id: true,
        name: true,
        meta: true,
        rosterSlots: {
          where: { endAt: null },
          select: {
            meta: true,
            slotLabel: true,
            player: { select: { id: true, fullName: true, meta: true, providerPlayerId: true } },
          },
        },
      },
    });
    if (!team) return res.status(404).json({ error: "Team not found" });

    let opponent = null;
    if (opponentTeamId) {
      opponent = await prisma.team.findFirst({
        where: { id: opponentTeamId, leagueId },
        select: {
          id: true,
          name: true,
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
    }

    // Calculate current projections
    const defaultGamesPerWeek = 4;
    const { totals: myTotals } = await calculateTeamWeeklyProjection(
      team.rosterSlots,
      league.seasonYear,
      defaultGamesPerWeek,
      scoringPeriodStartDate.toISOString(),
      scoringPeriodEndDate.toISOString()
    );

    let oppTotals: NineCatTotals | null = null;
    if (opponent) {
      const oppProjection = await calculateTeamWeeklyProjection(
        opponent.rosterSlots,
        league.seasonYear,
        defaultGamesPerWeek,
        scoringPeriodStartDate.toISOString(),
        scoringPeriodEndDate.toISOString()
      );
      oppTotals = oppProjection.totals;
    }

    // Determine most contested categories
    type ContestedCategory = {
      key: NineCatKey;
      label: string;
      myValue: number;
      oppValue: number;
      absDelta: number;
      normalizedDelta: number;
    };

    const contestedCategories: ContestedCategory[] = [];
    const categoryLabels: Record<NineCatKey, string> = {
      pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK",
      threes: "3PM", fgPct: "FG%", ftPct: "FT%", tov: "TO",
    };

    if (oppTotals) {
      const categoryKeys: NineCatKey[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
      
      // Normalize deltas for fair comparison
      const maxValues: Record<NineCatKey, number> = {
        pts: Math.max(myTotals.pts, oppTotals.pts, 100),
        reb: Math.max(myTotals.reb, oppTotals.reb, 50),
        ast: Math.max(myTotals.ast, oppTotals.ast, 50),
        stl: Math.max(myTotals.stl, oppTotals.stl, 10),
        blk: Math.max(myTotals.blk, oppTotals.blk, 10),
        threes: Math.max(myTotals.threes, oppTotals.threes, 30),
        fgPct: 1,
        ftPct: 1,
        tov: Math.max(myTotals.tov, oppTotals.tov, 30),
      };

      for (const key of categoryKeys) {
        const absDelta = Math.abs(myTotals[key] - oppTotals[key]);
        const normalizedDelta = absDelta / maxValues[key];

        contestedCategories.push({
          key,
          label: categoryLabels[key],
          myValue: myTotals[key],
          oppValue: oppTotals[key],
          absDelta,
          normalizedDelta,
        });
      }

      // Sort by normalized delta (smallest = most contested)
      contestedCategories.sort((a, b) => a.normalizedDelta - b.normalizedDelta);
    }

    const topContested = contestedCategories.slice(0, 4);

    // Get all free agents
    const activeRosterSlots = await prisma.rosterSlot.findMany({
      where: { leagueId: league.id, endAt: null },
      select: { playerId: true },
    });
    const ownedPlayerIds = new Set(activeRosterSlots.map((slot) => slot.playerId));

    const allPlayers = await prisma.player.findMany({
      where: {
        leagues: { some: { id: leagueId } },
        isActive: true,
      },
      select: {
        id: true,
        providerPlayerId: true,
        fullName: true,
        positions: true,
        meta: true,
      },
    });

    const freeAgents = allPlayers.filter((p) => !ownedPlayerIds.has(p.id));

    // Check if we have schedule data
    const hasScheduleData = freeAgents.some((p) => {
      const schedule = extractPlayerSchedule(p.meta as any, scoringPeriodStartDate, scoringPeriodEndDate);
      return schedule.length > 0;
    });

    if (!hasScheduleData) {
      // No schedule data available - return empty plan
      return res.json({
        hasScheduleData: false,
        acquisitionLimits,
        contestedCategories: topContested.map((c) => ({
          key: c.key,
          label: c.label,
          myValue: Number(c.myValue.toFixed(1)),
          oppValue: Number(c.oppValue.toFixed(1)),
          absDelta: Number(c.absDelta.toFixed(1)),
        })),
        dailyPlan: [],
        message: "Schedule data not available. Use manual add/drop preview instead.",
      });
    }

    // Build day-by-day plan
    type DailyRecommendation = {
      date: string;
      suggestedAdd: {
        playerId: string;
        name: string;
        headshotUrl: string | null;
        projectedStats: any;
      } | null;
      suggestedDrop: {
        playerId: string;
        name: string;
      } | null;
      expectedNetDelta: any;
      expectedCatsChange: number;
      reason: string;
    };

    const dailyPlan: DailyRecommendation[] = [];
    let remainingAdds = acquisitionLimits.remaining ?? 999; // If unknown, allow many

    // Fetch NBA schedules for the scoring period
    const nbaSchedules = await getCachedNBASchedule(scoringPeriodStartDate, scoringPeriodEndDate);
    console.log(`[Streaming Plan] Loaded NBA schedules for ${nbaSchedules.size} teams`);

    // Generate dates in scoring period
    const dates: Date[] = [];
    for (let d = new Date(scoringPeriodStartDate); d <= scoringPeriodEndDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d));
    }

    for (const date of dates) {
      if (remainingAdds <= 0) break;

      // Find free agents playing on this date
      const freeAgentsPlayingToday = freeAgents.filter((p) => {
        const schedule = extractPlayerSchedule(p.meta as any, scoringPeriodStartDate, scoringPeriodEndDate, nbaSchedules);
        return schedule.some((gameDate) => 
          gameDate.toDateString() === date.toDateString()
        );
      });

      if (freeAgentsPlayingToday.length === 0) {
        dailyPlan.push({
          date: date.toISOString(),
          suggestedAdd: null,
          suggestedDrop: null,
          expectedNetDelta: null,
          expectedCatsChange: 0,
          reason: "No free agents with games today",
        });
        continue;
      }

      // Score each free agent based on contested categories
      let bestAdd: any = null;
      let bestScore = -Infinity;

      for (const player of freeAgentsPlayingToday) {
        const playerStats = extractNineCatFromPlayerMeta(player.meta as any, league.seasonYear);
        if (!playerStats.hasStats) continue;

        const injuryInfo = extractInjuryInfo(player.meta as any, null);
        if (injuryInfo.status === "OUT" || injuryInfo.status === "IR") continue;

        // Score based on contested categories (per-game contribution)
        let score = 0;
        const boosts: string[] = [];

        for (const cat of topContested) {
          const perGameContribution = playerStats.perGame[cat.key];
          if (perGameContribution > 0.1) {
            score += perGameContribution / (cat.normalizedDelta + 0.01);
            boosts.push(cat.label);
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestAdd = {
            player,
            playerStats,
            score,
            boosts: boosts.slice(0, 2),
          };
        }
      }

      if (!bestAdd) {
        dailyPlan.push({
          date: date.toISOString(),
          suggestedAdd: null,
          suggestedDrop: null,
          expectedNetDelta: null,
          expectedCatsChange: 0,
          reason: "No suitable free agents for contested categories",
        });
        continue;
      }

      // Find best drop candidate (lowest value player)
      const myRosterPlayers = team.rosterSlots.map((slot) => ({
        playerId: slot.player.id,
        playerName: slot.player.fullName,
        stats: extractNineCatFromPlayerMeta(slot.player.meta as any, league.seasonYear),
      }));

      const dropCandidates = myRosterPlayers
        .filter((p) => p.stats.hasStats)
        .sort((a, b) => {
          const scoreA = 
            a.stats.perGame.pts * 1.0 +
            a.stats.perGame.reb * 1.2 +
            a.stats.perGame.ast * 1.5 +
            a.stats.perGame.stl * 3.0 +
            a.stats.perGame.blk * 3.0;
          const scoreB = 
            b.stats.perGame.pts * 1.0 +
            b.stats.perGame.reb * 1.2 +
            b.stats.perGame.ast * 1.5 +
            b.stats.perGame.stl * 3.0 +
            b.stats.perGame.blk * 3.0;
          return scoreA - scoreB;
        });

      const suggestedDrop = dropCandidates[0] || null;

      const cleanPlayerId = cleanProviderPlayerId(bestAdd.player.providerPlayerId);
      const headshotUrl = cleanPlayerId
        ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`)
        : null;

      dailyPlan.push({
        date: date.toISOString(),
        suggestedAdd: {
          playerId: bestAdd.player.id,
          name: bestAdd.player.fullName,
          headshotUrl,
          projectedStats: bestAdd.playerStats.perGame,
        },
        suggestedDrop: suggestedDrop ? {
          playerId: suggestedDrop.playerId,
          name: suggestedDrop.playerName,
        } : null,
        expectedNetDelta: null, // TODO: Calculate net delta
        expectedCatsChange: 1, // Simplified
        reason: bestAdd.boosts.length > 0 
          ? `Targets contested cats: ${bestAdd.boosts.join(", ")}`
          : "Adds general value",
      });

      remainingAdds--;
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({
      hasScheduleData: true,
      acquisitionLimits,
      contestedCategories: topContested.map((c) => ({
        key: c.key,
        label: c.label,
        myValue: Number(c.myValue.toFixed(1)),
        oppValue: Number(c.oppValue.toFixed(1)),
        absDelta: Number(c.absDelta.toFixed(1)),
      })),
      dailyPlan,
      scoringPeriod: {
        startAt: scoringPeriodStartDate.toISOString(),
        endAt: scoringPeriodEndDate.toISOString(),
      },
    });
  } catch (err) {
    console.error("Error generating streaming plan:", err);
    return res.status(500).json({ error: "Failed to generate streaming plan" });
  }
});

// Streaming impact calculation endpoint
app.post("/leagues/:leagueId/streaming/impact", express.json(), async (req, res) => {
  const leagueId = req.params.leagueId;
  const { teamId, opponentTeamId, addPlayerId, dropPlayerId, scoringPeriodStartDate, scoringPeriodEndDate } = req.body;

  if (!teamId || !addPlayerId || !dropPlayerId) {
    return res.status(400).json({ error: "teamId, addPlayerId, and dropPlayerId required" });
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, seasonYear: true },
    });
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    // Get team data
    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: {
        id: true,
        name: true,
        rosterSlots: {
          where: { endAt: null },
          select: {
            meta: true,
            slotLabel: true,
            player: { select: { id: true, fullName: true, meta: true, providerPlayerId: true } },
          },
        },
      },
    });
    if (!team) return res.status(404).json({ error: "Team not found" });

    // Get opponent data if provided
    let opponent = null;
    if (opponentTeamId) {
      opponent = await prisma.team.findFirst({
        where: { id: opponentTeamId, leagueId },
        select: {
          id: true,
          name: true,
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
    }

    // Get add and drop player data
    const addPlayer = await prisma.player.findUnique({
      where: { id: addPlayerId },
      select: { id: true, fullName: true, meta: true, providerPlayerId: true },
    });
    const dropPlayer = await prisma.player.findUnique({
      where: { id: dropPlayerId },
      select: { id: true, fullName: true, meta: true, providerPlayerId: true },
    });

    if (!addPlayer) return res.status(404).json({ error: "Add player not found" });
    if (!dropPlayer) return res.status(404).json({ error: "Drop player not found" });

    const defaultGamesPerWeek = 4;

    // Calculate BEFORE totals (current roster)
    const { totals: beforeTotals, totalsWithAttempts: beforeTotalsWithAttempts } = await calculateTeamWeeklyProjection(
      team.rosterSlots,
      league.seasonYear,
      defaultGamesPerWeek,
      scoringPeriodStartDate,
      scoringPeriodEndDate
    );

    // Calculate opponent totals
    let oppTotals: NineCatTotals | null = null;
    if (opponent) {
      const oppProjection = await calculateTeamWeeklyProjection(
        opponent.rosterSlots,
        league.seasonYear,
        defaultGamesPerWeek,
        scoringPeriodStartDate,
        scoringPeriodEndDate
      );
      oppTotals = oppProjection.totals;
    }

    // Calculate drop player's contribution
    const dropPlayerStats = extractNineCatFromPlayerMeta(dropPlayer.meta as any, league.seasonYear);
    const dropInjuryInfo = extractInjuryInfo(dropPlayer.meta as any, null);
    const dropProjectedGames = calculateProjectedGamesThisWeek(
      defaultGamesPerWeek,
      dropInjuryInfo,
      scoringPeriodStartDate,
      scoringPeriodEndDate
    );

    const dropContribution = {
      pts: dropPlayerStats.perGame.pts * dropProjectedGames,
      reb: dropPlayerStats.perGame.reb * dropProjectedGames,
      ast: dropPlayerStats.perGame.ast * dropProjectedGames,
      stl: dropPlayerStats.perGame.stl * dropProjectedGames,
      blk: dropPlayerStats.perGame.blk * dropProjectedGames,
      threes: dropPlayerStats.perGame.threes * dropProjectedGames,
      tov: dropPlayerStats.perGame.tov * dropProjectedGames,
    };

    const dropFgaPerGame = dropPlayerStats.totals.fga / Math.max(1, dropPlayerStats.totals.gp);
    const dropFgmPerGame = dropPlayerStats.totals.fgm / Math.max(1, dropPlayerStats.totals.gp);
    const dropFtaPerGame = dropPlayerStats.totals.fta / Math.max(1, dropPlayerStats.totals.gp);
    const dropFtmPerGame = dropPlayerStats.totals.ftm / Math.max(1, dropPlayerStats.totals.gp);

    const dropAttempts = {
      fga: dropFgaPerGame * dropProjectedGames,
      fgm: dropFgmPerGame * dropProjectedGames,
      fta: dropFtaPerGame * dropProjectedGames,
      ftm: dropFtmPerGame * dropProjectedGames,
    };

    // Calculate add player's contribution
    const addPlayerStats = extractNineCatFromPlayerMeta(addPlayer.meta as any, league.seasonYear);
    const addInjuryInfo = extractInjuryInfo(addPlayer.meta as any, null);
    const addProjectedGames = calculateProjectedGamesThisWeek(
      defaultGamesPerWeek,
      addInjuryInfo,
      scoringPeriodStartDate,
      scoringPeriodEndDate
    );

    const addContribution = {
      pts: addPlayerStats.perGame.pts * addProjectedGames,
      reb: addPlayerStats.perGame.reb * addProjectedGames,
      ast: addPlayerStats.perGame.ast * addProjectedGames,
      stl: addPlayerStats.perGame.stl * addProjectedGames,
      blk: addPlayerStats.perGame.blk * addProjectedGames,
      threes: addPlayerStats.perGame.threes * addProjectedGames,
      tov: addPlayerStats.perGame.tov * addProjectedGames,
    };

    const addFgaPerGame = addPlayerStats.totals.fga / Math.max(1, addPlayerStats.totals.gp);
    const addFgmPerGame = addPlayerStats.totals.fgm / Math.max(1, addPlayerStats.totals.gp);
    const addFtaPerGame = addPlayerStats.totals.fta / Math.max(1, addPlayerStats.totals.gp);
    const addFtmPerGame = addPlayerStats.totals.ftm / Math.max(1, addPlayerStats.totals.gp);

    const addAttempts = {
      fga: addFgaPerGame * addProjectedGames,
      fgm: addFgmPerGame * addProjectedGames,
      fta: addFtaPerGame * addProjectedGames,
      ftm: addFtmPerGame * addProjectedGames,
    };

    // Calculate AFTER totals (subtract drop, add add)
    const afterTotalsWithAttempts = {
      fga: (beforeTotalsWithAttempts.fga || 0) - dropAttempts.fga + addAttempts.fga,
      fgm: (beforeTotalsWithAttempts.fgm || 0) - dropAttempts.fgm + addAttempts.fgm,
      fta: (beforeTotalsWithAttempts.fta || 0) - dropAttempts.fta + addAttempts.fta,
      ftm: (beforeTotalsWithAttempts.ftm || 0) - dropAttempts.ftm + addAttempts.ftm,
    };

    const afterTotals: NineCatTotals = {
      pts: beforeTotals.pts - dropContribution.pts + addContribution.pts,
      reb: beforeTotals.reb - dropContribution.reb + addContribution.reb,
      ast: beforeTotals.ast - dropContribution.ast + addContribution.ast,
      stl: beforeTotals.stl - dropContribution.stl + addContribution.stl,
      blk: beforeTotals.blk - dropContribution.blk + addContribution.blk,
      threes: beforeTotals.threes - dropContribution.threes + addContribution.threes,
      tov: beforeTotals.tov - dropContribution.tov + addContribution.tov,
      fgPct: afterTotalsWithAttempts.fga > 0 ? afterTotalsWithAttempts.fgm / afterTotalsWithAttempts.fga : 0,
      ftPct: afterTotalsWithAttempts.fta > 0 ? afterTotalsWithAttempts.ftm / afterTotalsWithAttempts.fta : 0,
    };

    // Calculate matchup results
    let matchupBefore = null;
    let matchupAfter = null;
    let categoryChanges: Array<{ key: NineCatKey; label: string; beforeWin: boolean; afterWin: boolean; flipped: boolean }> = [];

    if (oppTotals) {
      const categoryKeys: NineCatKey[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
      const categoryLabels: Record<NineCatKey, string> = {
        pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK",
        threes: "3PM", fgPct: "FG%", ftPct: "FT%", tov: "TO",
      };

      let beforeWins = 0;
      let beforeLosses = 0;
      let afterWins = 0;
      let afterLosses = 0;

      for (const key of categoryKeys) {
        const beforeWin = key === "tov" 
          ? beforeTotals[key] < oppTotals[key]
          : beforeTotals[key] > oppTotals[key];

        const afterWin = key === "tov"
          ? afterTotals[key] < oppTotals[key]
          : afterTotals[key] > oppTotals[key];

        if (beforeWin) beforeWins++;
        else beforeLosses++;

        if (afterWin) afterWins++;
        else afterLosses++;

        categoryChanges.push({
          key,
          label: categoryLabels[key],
          beforeWin,
          afterWin,
          flipped: beforeWin !== afterWin,
        });
      }

      matchupBefore = { wins: beforeWins, losses: beforeLosses };
      matchupAfter = { wins: afterWins, losses: afterLosses };
    }

    // Calculate deltas
    const deltas = {
      pts: afterTotals.pts - beforeTotals.pts,
      reb: afterTotals.reb - beforeTotals.reb,
      ast: afterTotals.ast - beforeTotals.ast,
      stl: afterTotals.stl - beforeTotals.stl,
      blk: afterTotals.blk - beforeTotals.blk,
      threes: afterTotals.threes - beforeTotals.threes,
      tov: afterTotals.tov - beforeTotals.tov,
      fgPct: afterTotals.fgPct - beforeTotals.fgPct,
      ftPct: afterTotals.ftPct - beforeTotals.ftPct,
    };

    res.setHeader("Cache-Control", "no-cache");
    return res.json({
      before: {
        myTotals: beforeTotals,
        oppTotals,
        matchupResult: matchupBefore,
      },
      after: {
        myTotals: afterTotals,
        oppTotals,
        matchupResult: matchupAfter,
      },
      deltas: {
        totals: deltas,
        categoryChanges,
        netCatsWonDelta: matchupAfter && matchupBefore
          ? matchupAfter.wins - matchupBefore.wins
          : 0,
      },
      explain: {
        droppedPlayer: {
          name: dropPlayer.fullName,
          projectedGames: dropProjectedGames,
          contribution: dropContribution,
        },
        addedPlayer: {
          name: addPlayer.fullName,
          projectedGames: addProjectedGames,
          contribution: addContribution,
        },
      },
    });
  } catch (err) {
    console.error("Error calculating streaming impact:", err);
    return res.status(500).json({ error: "Failed to calculate streaming impact" });
  }
});

// Streaming recommendations endpoint (now uses free agents)
app.get("/leagues/:leagueId/streaming/recommendations", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.query.teamId as string | undefined;

  if (!teamId) {
    return res.status(400).json({ error: "teamId query parameter required" });
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, seasonYear: true, settings: true },
    });
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    // Get all teams
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
            player: { select: { id: true, fullName: true, meta: true, positions: true } },
          },
        },
      },
    });

    const selectedTeam = allTeams.find((t) => t.id === teamId);
    if (!selectedTeam) {
      return res.status(404).json({ error: "Team not found" });
    }

    // Get scoring period info
    const firstTeamMeta = (allTeams[0]?.meta as any) || {};
    const defaultGamesPerWeek = 4;
    const scoringPeriodStartDate = firstTeamMeta.scoringPeriodStartDate || null;
    const scoringPeriodEndDate = firstTeamMeta.scoringPeriodEndDate || null;

    // Calculate my team's projection
    const { totals: myTotals, totalsWithAttempts: myTotalsWithAttempts } = await calculateTeamWeeklyProjection(
      selectedTeam.rosterSlots,
      league.seasonYear,
      defaultGamesPerWeek,
      scoringPeriodStartDate || undefined,
      scoringPeriodEndDate || undefined
    );

    // Find opponent
    const teamMeta = (selectedTeam.meta as any) || {};
    const matchupData = teamMeta.matchup || null;
    let opponentTotals: NineCatTotals | null = null;
    let opponentTotalsWithAttempts: any = null;

    if (matchupData && matchupData.opponentTeamId) {
      const opponentProviderId = String(matchupData.opponentTeamId);
      const opponent = allTeams.find((t) => t.providerTeamId === opponentProviderId);

      if (opponent) {
        const oppProjection = await calculateTeamWeeklyProjection(
          opponent.rosterSlots,
          league.seasonYear,
          defaultGamesPerWeek,
          scoringPeriodStartDate || undefined,
          scoringPeriodEndDate || undefined
        );
        opponentTotals = oppProjection.totals;
        opponentTotalsWithAttempts = oppProjection.totalsWithAttempts;
      }
    }

    // Compute contention (most contested categories)
    type ContestedCategory = {
      key: NineCatKey;
      label: string;
      myValue: number;
      oppValue: number;
      delta: number;
      absDelta: number;
      weight: number;
    };

    const contestedCategories: ContestedCategory[] = [];
    const categoryLabels: Record<NineCatKey, string> = {
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

    if (opponentTotals) {
      const categoryKeys: NineCatKey[] = ["pts", "reb", "ast", "stl", "blk", "threes", "fgPct", "ftPct", "tov"];
      
      for (const key of categoryKeys) {
        const myValue = myTotals[key];
        const oppValue = opponentTotals[key];
        const delta = myValue - oppValue;
        const absDelta = Math.abs(delta);
        const epsilon = 0.01;
        const weight = 1 / (absDelta + epsilon);

        contestedCategories.push({
          key,
          label: categoryLabels[key],
          myValue,
          oppValue,
          delta,
          absDelta,
          weight,
        });
      }

      // Sort by smallest difference (most contested)
      contestedCategories.sort((a, b) => a.absDelta - b.absDelta);
    }

    // Get all active roster slots to determine owned players
    const activeRosterSlots = await prisma.rosterSlot.findMany({
      where: {
        leagueId: league.id,
        endAt: null,
      },
      select: {
        playerId: true,
      },
    });

    const ownedPlayerIds = new Set(activeRosterSlots.map((slot) => slot.playerId));

    // Get all players in the league
    const allPlayers = await prisma.player.findMany({
      where: {
        leagues: {
          some: { id: leagueId },
        },
        isActive: true,
      },
      select: {
        id: true,
        providerPlayerId: true,
        fullName: true,
        positions: true,
        meta: true,
      },
    });

    // Filter to TRUE free agents (not owned by ANY team in the league)
    const freeAgents = allPlayers.filter((p) => !ownedPlayerIds.has(p.id));

    // Score each free agent
    type ScoredPlayer = {
      playerId: string;
      providerPlayerId: string;
      fullName: string;
      positions: string[];
      headshotUrl: string | null;
      projectedGamesRemainingThisWeek: number;
      projectedTotalsAdd: {
        pts: number;
        reb: number;
        ast: number;
        stl: number;
        blk: number;
        threes: number;
        tov: number;
        fgPct: number;
        ftPct: number;
      };
      addedAttempts: {
        fga: number;
        fgm: number;
        fta: number;
        ftm: number;
      };
      keyCatsBoosted: string[];
      score: number;
    };

    const scoredPlayers: ScoredPlayer[] = [];

    for (const player of freeAgents) {
      const meta = (player.meta as any) || {};
      const playerStats = extractNineCatFromPlayerMeta(meta, league.seasonYear);
      
      if (!playerStats.hasStats) continue;

      // Calculate injury info
      const injuryInfo = extractInjuryInfo(meta, null);
      
      // Skip OUT/IR players
      if (injuryInfo.status === "OUT" || injuryInfo.status === "IR") {
        continue;
      }

      // Calculate projected games
      const projectedGames = calculateProjectedGamesThisWeek(
        defaultGamesPerWeek,
        injuryInfo,
        scoringPeriodStartDate || undefined,
        scoringPeriodEndDate || undefined
      );

      if (projectedGames === 0) continue;

      // Calculate projected totals
      const perGame = playerStats.perGame;
      const projectedTotalsAdd = {
        pts: perGame.pts * projectedGames,
        reb: perGame.reb * projectedGames,
        ast: perGame.ast * projectedGames,
        stl: perGame.stl * projectedGames,
        blk: perGame.blk * projectedGames,
        threes: perGame.threes * projectedGames,
        tov: perGame.tov * projectedGames,
        fgPct: perGame.fgPct,
        ftPct: perGame.ftPct,
      };

      // Calculate attempts
      const fgaPerGame = playerStats.totals.fga / Math.max(1, playerStats.totals.gp);
      const fgmPerGame = playerStats.totals.fgm / Math.max(1, playerStats.totals.gp);
      const ftaPerGame = playerStats.totals.fta / Math.max(1, playerStats.totals.gp);
      const ftmPerGame = playerStats.totals.ftm / Math.max(1, playerStats.totals.gp);

      const addedAttempts = {
        fga: fgaPerGame * projectedGames,
        fgm: fgmPerGame * projectedGames,
        fta: ftaPerGame * projectedGames,
        ftm: ftmPerGame * projectedGames,
      };

      // Score based on contested categories
      let score = 0;
      const keyCatsBoosted: string[] = [];

      if (contestedCategories.length > 0) {
        // Focus on top 4 most contested
        const topContested = contestedCategories.slice(0, 4);

        for (const cat of topContested) {
          const contribution = projectedTotalsAdd[cat.key];
          
          // For TO, lower is better, so penalize if adding TO when behind
          if (cat.key === "tov") {
            // If I'm losing TO (myValue > oppValue), penalize adding TO
            if (cat.delta > 0) {
              score -= contribution * cat.weight * 0.5;
            }
          } else {
            // For other cats, reward contribution
            score += contribution * cat.weight;
            
            // Mark as key cat if significant contribution
            if (contribution > 0.1) {
              keyCatsBoosted.push(cat.label);
            }
          }
        }
      }

      // Fallback: if no contested cats, use general value
      if (score === 0) {
        score = projectedTotalsAdd.pts * 0.5 + 
                projectedTotalsAdd.reb * 0.3 + 
                projectedTotalsAdd.ast * 0.3 + 
                projectedTotalsAdd.stl * 2 + 
                projectedTotalsAdd.blk * 2 + 
                projectedTotalsAdd.threes * 1;
      }

      // Generate headshot URL using ESPN CDN
      const cleanPlayerId = cleanProviderPlayerId(player.providerPlayerId);
      const headshotUrl = cleanPlayerId
        ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`)
        : null;

      scoredPlayers.push({
        playerId: player.id,
        providerPlayerId: player.providerPlayerId,
        fullName: player.fullName,
        positions: Array.isArray(player.positions) ? player.positions : [],
        headshotUrl,
        projectedGamesRemainingThisWeek: projectedGames,
        projectedTotalsAdd,
        addedAttempts,
        keyCatsBoosted: keyCatsBoosted.slice(0, 3), // Top 3 cats
        score,
      });
    }

    // Sort by score descending
    scoredPlayers.sort((a, b) => b.score - a.score);

    // Top streamers today (top 8)
    const topStreamersToday = scoredPlayers.slice(0, 8);

    // Suggested adds (same as top streamers for now, could be different logic)
    const suggestedAdds = scoredPlayers.slice(0, 12);

    // Schedule advantage
    // Calculate remaining games for my team and opponent
    let myRemainingGames = 0;
    let opponentRemainingGames = 0;

    for (const slot of selectedTeam.rosterSlots) {
      const meta = (slot.player.meta as any) || {};
      const injuryInfo = extractInjuryInfo(meta, null);
      const projectedGames = calculateProjectedGamesThisWeek(
        defaultGamesPerWeek,
        injuryInfo,
        scoringPeriodStartDate || undefined,
        scoringPeriodEndDate || undefined
      );
      myRemainingGames += projectedGames;
    }

    if (matchupData && matchupData.opponentTeamId) {
      const opponentProviderId = String(matchupData.opponentTeamId);
      const opponent = allTeams.find((t) => t.providerTeamId === opponentProviderId);

      if (opponent) {
        for (const slot of opponent.rosterSlots) {
          const meta = (slot.player.meta as any) || {};
          const injuryInfo = extractInjuryInfo(meta, null);
          const projectedGames = calculateProjectedGamesThisWeek(
            defaultGamesPerWeek,
            injuryInfo,
            scoringPeriodStartDate || undefined,
            scoringPeriodEndDate || undefined
          );
          opponentRemainingGames += projectedGames;
        }
      }
    }

    // Trade acquisition limit (from league settings if available)
    const leagueSettings = (league.settings as any) || {};
    const acquisitionLimit = typeof leagueSettings.acquisitionLimit === "number" ? leagueSettings.acquisitionLimit : null;
    const acquisitionsUsed = typeof teamMeta.acquisitionsUsed === "number" ? teamMeta.acquisitionsUsed : null;
    const acquisitionsRemaining = acquisitionLimit !== null && acquisitionsUsed !== null 
      ? Math.max(0, acquisitionLimit - acquisitionsUsed) 
      : null;

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({
      contention: contestedCategories.slice(0, 4).map((c) => ({
        key: c.key,
        label: c.label,
        myValue: Number(c.myValue.toFixed(1)),
        oppValue: Number(c.oppValue.toFixed(1)),
        delta: Number(c.delta.toFixed(1)),
      })),
      topStreamersToday: topStreamersToday.map((p) => ({
        playerId: p.playerId,
        providerPlayerId: p.providerPlayerId,
        fullName: p.fullName,
        positions: p.positions,
        headshotUrl: p.headshotUrl,
        projectedGamesRemainingThisWeek: p.projectedGamesRemainingThisWeek,
        projectedTotalsAdd: {
          pts: Number(p.projectedTotalsAdd.pts.toFixed(1)),
          reb: Number(p.projectedTotalsAdd.reb.toFixed(1)),
          ast: Number(p.projectedTotalsAdd.ast.toFixed(1)),
          stl: Number(p.projectedTotalsAdd.stl.toFixed(1)),
          blk: Number(p.projectedTotalsAdd.blk.toFixed(1)),
          threes: Number(p.projectedTotalsAdd.threes.toFixed(1)),
          tov: Number(p.projectedTotalsAdd.tov.toFixed(1)),
          fgPct: Number((p.projectedTotalsAdd.fgPct * 100).toFixed(1)),
          ftPct: Number((p.projectedTotalsAdd.ftPct * 100).toFixed(1)),
        },
        addedAttempts: {
          fga: Number(p.addedAttempts.fga.toFixed(1)),
          fgm: Number(p.addedAttempts.fgm.toFixed(1)),
          fta: Number(p.addedAttempts.fta.toFixed(1)),
          ftm: Number(p.addedAttempts.ftm.toFixed(1)),
        },
        keyCatsBoosted: p.keyCatsBoosted,
        score: Number(p.score.toFixed(2)),
      })),
      suggestedAdds: suggestedAdds.map((p) => ({
        playerId: p.playerId,
        providerPlayerId: p.providerPlayerId,
        fullName: p.fullName,
        positions: p.positions,
        headshotUrl: p.headshotUrl,
        projectedGamesRemainingThisWeek: p.projectedGamesRemainingThisWeek,
        projectedTotalsAdd: {
          pts: Number(p.projectedTotalsAdd.pts.toFixed(1)),
          reb: Number(p.projectedTotalsAdd.reb.toFixed(1)),
          ast: Number(p.projectedTotalsAdd.ast.toFixed(1)),
          stl: Number(p.projectedTotalsAdd.stl.toFixed(1)),
          blk: Number(p.projectedTotalsAdd.blk.toFixed(1)),
          threes: Number(p.projectedTotalsAdd.threes.toFixed(1)),
          tov: Number(p.projectedTotalsAdd.tov.toFixed(1)),
          fgPct: Number((p.projectedTotalsAdd.fgPct * 100).toFixed(1)),
          ftPct: Number((p.projectedTotalsAdd.ftPct * 100).toFixed(1)),
        },
        addedAttempts: {
          fga: Number(p.addedAttempts.fga.toFixed(1)),
          fgm: Number(p.addedAttempts.fgm.toFixed(1)),
          fta: Number(p.addedAttempts.fta.toFixed(1)),
          ftm: Number(p.addedAttempts.ftm.toFixed(1)),
        },
        keyCatsBoosted: p.keyCatsBoosted,
        score: Number(p.score.toFixed(2)),
      })),
      scheduleAdvantage: {
        myRemainingGames: Math.round(myRemainingGames),
        opponentRemainingGames: Math.round(opponentRemainingGames),
        advantage: Math.round(myRemainingGames - opponentRemainingGames),
      },
      tradeAcquisitionLimit: {
        limit: acquisitionLimit,
        used: acquisitionsUsed,
        remaining: acquisitionsRemaining,
      },
    });
  } catch (err) {
    console.error("Error fetching streaming recommendations:", err);
    return res.status(500).json({ error: "Failed to fetch streaming recommendations" });
  }
});

// Get weekly projection for team (legacy endpoint - keep for backward compatibility)
app.get("/leagues/:leagueId/teams/:teamId/weekly-projection", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.params.teamId;

  try {
    // Use demo scope
    const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;
    
    const league = await getLeagueScoped(leagueId, demoSnapshotId);
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    const team = await getTeamScoped(teamId, demoSnapshotId);
    if (!team || team.leagueId !== leagueId) {
      return (res as any).status(404).json({ error: "Team not found or not in league" });
    }

    const rosterSlotsData = await getRosterSlotsScoped(leagueId, teamId, demoSnapshotId);
    const currentSlots = rosterSlotsData.filter((slot: any) => !slot.endAt);
    
    // Map to expected format with providerPlayerId for headshots
    const rosterSlots = currentSlots.map((slot: any) => ({
      meta: slot.meta,
      slotLabel: slot.slotLabel,
      player: {
        id: slot.playerId,
        fullName: slot.player?.fullName || 'Unknown',
        meta: slot.player?.meta || null,
        providerPlayerId: slot.player?.providerPlayerId || null,
      },
    }));

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
      
      // Generate headshot URL
      const cleanPlayerId = cleanProviderPlayerId((player as any).providerPlayerId);
      const headshotUrl = cleanPlayerId
        ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`)
        : null;

      return {
        playerId: player.id,
        playerName: player.fullName,
        headshotUrl, // Add headshot URL
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
    // Use demo scope
    const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;
    
    const league = await getLeagueScoped(leagueId, demoSnapshotId);
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    const team = await getTeamScoped(teamId, demoSnapshotId);
    if (!team || team.leagueId !== leagueId) {
      return (res as any).status(404).json({ error: "Team not found or not in league" });
    }

    const teamMeta = (team.meta as any) || {};
    const standings = teamMeta.standings || null;
    const matchup = teamMeta.matchup || null;

    // Opponent name
    let opponentName: string | null = null;
    let opponentDbId: string | null = null;

    if (matchup?.opponentTeamId) {
      // Find opponent using demo scoped teams
      const allTeams = await getTeamsScoped(leagueId, demoSnapshotId);
      const opponent = allTeams.find((t: any) => t.providerTeamId === String(matchup.opponentTeamId));
      opponentName = opponent?.name || null;
      opponentDbId = opponent?.id || null;
    }

    // Team avatar = ESPN logo (proxied), fallback to player headshot
    const myAvatarUrl = await getTeamAvatarUrl(req, team.id, demoSnapshotId);
    const oppAvatarUrl = opponentDbId ? await getTeamAvatarUrl(req, opponentDbId, demoSnapshotId) : null;

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
    // Use demo scope
    const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;
    
    const league = await getLeagueScoped(leagueId, demoSnapshotId);
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    const teams = await getTeamsScoped(leagueId, demoSnapshotId);

    // Get avatar URLs for all teams in parallel
    const standings = await Promise.all(teams.map(async (team: any) => {
      const meta = (team.meta as any) || {};
      const standingsData = meta.standings || {};
      const avatarUrl = await getTeamAvatarUrl(req, team.id, demoSnapshotId);
      
      return {
        teamId: team.id,
        teamName: team.name,
        avatarUrl,
        rank: typeof standingsData.rank === "number" ? standingsData.rank : 999,
        wins: standingsData.wins || 0,
        losses: standingsData.losses || 0,
        ties: standingsData.ties || 0,
      };
    }));

    standings.sort((a, b) => a.rank - b.rank);

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

  if (!teamId) return (res as any).status(400).json({ error: "teamId query parameter required" });

  try {
    // Use demo scope
    const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;
    
    const league = await getLeagueScoped(leagueId, demoSnapshotId);
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    const team = await getTeamScoped(teamId, demoSnapshotId);
    if (!team || team.leagueId !== leagueId) {
      return (res as any).status(404).json({ error: "Team not found" });
    }

    const teamMeta = (team.meta as any) || {};
    const matchupData = teamMeta.matchup || null;

    if (!matchupData || !matchupData.opponentTeamId) {
      return (res as any).json({ ok: false, reason: "No current matchup data available. Run ESPN data sync." });
    }

    // Find opponent using demo scoped teams
    const allTeams = await getTeamsScoped(leagueId, demoSnapshotId);
    const opponent = allTeams.find((t: any) => t.providerTeamId === String(matchupData.opponentTeamId));

    if (!opponent) return (res as any).json({ ok: false, reason: "Opponent team not found" });

    const teamAvatar = await getTeamAvatarUrl(req, team.id, demoSnapshotId);
    const oppAvatar = await getTeamAvatarUrl(req, opponent.id, demoSnapshotId);

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

  // @ts-ignore - fetch returns globalThis.Response
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

  const contentType = (r as any).headers.get("content-type") ?? "";
  const location = (r as any).headers.get("location") ?? "";
  // @ts-ignore - fetch Response type
  // @ts-ignore - fetch Response type
  const text = await r.text();

  return (res as any).status(200).json({
    requestedUrl: url.toString(),
    status: (r as any).status,
    redirected: (r as any).status >= 300 && (r as any).status < 400,
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

  // @ts-ignore - fetch returns globalThis.Response
  const r = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
      Origin: "https://fantasy.espn.com",
      Referer: `https://fantasy.espn.com/basketball/league?leagueId=${leagueId}`,
      Cookie: `espn_s2=${espn_s2.trim()}; SWID=${swid.trim()}; swid=${swid.trim()};`,
    },
  });

  if (!(r as any).ok) {
    // @ts-ignore - fetch Response type
    const text = await r.text().catch(() => "");
    return (res as any).status(502).json({ error: "ESPN fetch failed", status: (r as any).status, snippet: text.slice(0, 300) });
  }

  // @ts-ignore - fetch Response type
  const data: any = await r.json();
  const player = data?.teams?.[0]?.roster?.entries?.[0]?.playerPoolEntry?.player ?? null;

  return (res as any).status(200).json({ ok: true, player });
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
  url.searchParams.append("view", "mSchedule");
  url.searchParams.append("view", "mStandings");
  url.searchParams.append("view", "mMatchupScore");
  url.searchParams.append("view", "mLiveScoring");
  url.searchParams.append("view", "mBoxscore"); // Required for scoreByStat live category data
  url.searchParams.append("view", "mStatus");
  url.searchParams.set("platformVersion", platformVersion);

  // @ts-ignore - fetch returns globalThis.Response
  const r = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
      Origin: "https://fantasy.espn.com",
      Referer: `https://fantasy.espn.com/basketball/league?leagueId=${leagueId}`,
      Cookie: `espn_s2=${espn_s2.trim()}; SWID=${swid.trim()}; swid=${swid.trim()};`,
    },
  });

  if (!(r as any).ok) {
    // @ts-ignore - fetch Response type
    const text = await r.text().catch(() => "");
    return (res as any).status(502).json({ error: "ESPN fetch failed", status: (r as any).status, snippet: text.slice(0, 300) });
  }

  // @ts-ignore - fetch Response type
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

  // Extract scoring period dates from current matchup
  let scoringPeriodStartDate: string | null = null;
  let scoringPeriodEndDate: string | null = null;
  
  if (currentMatchupPeriod !== null) {
    const currentMatchup = schedule.find((m) => m?.matchupPeriodId === currentMatchupPeriod);
    if (currentMatchup) {
      // ESPN provides matchupPeriodStartDate and matchupPeriodEndDate in ISO format
      scoringPeriodStartDate = currentMatchup.matchupPeriodStartDate || null;
      scoringPeriodEndDate = currentMatchup.matchupPeriodEndDate || null;
      
      console.log(`[Ingestion] Current matchup period ${currentMatchupPeriod}: ${scoringPeriodStartDate} to ${scoringPeriodEndDate}`);
    }
  }

  const matchupMap = new Map<string, any>();

  for (const matchup of schedule) {
    if (matchup?.matchupPeriodId !== currentMatchupPeriod) continue;

    const homeId = String(matchup?.home?.teamId);
    const awayId = String(matchup?.away?.teamId);

    if (homeId && matchup?.home) {
      const homeCumScore = matchup.home.cumulativeScore || {};
      const awayCumScore = matchup.away?.cumulativeScore || {};

      // Extract live category stats from scoreByStat
      // ESPN stat IDs: 0=PTS, 1=BLK, 2=STL, 3=AST, 6=REB, 11=TO, 17=3PM, 19=FG%, 20=FT%
      const homeScoreByStat = homeCumScore.scoreByStat || {};
      const awayScoreByStat = awayCumScore.scoreByStat || {};

      // Debug: Log scoreByStat extraction
      console.log(`[Ingestion] Team ${homeId} scoreByStat keys:`, Object.keys(homeScoreByStat));
      if (Object.keys(homeScoreByStat).length > 0) {
        console.log(`[Ingestion] Team ${homeId} PTS (0):`, homeScoreByStat["0"]?.score, `REB (6):`, homeScoreByStat["6"]?.score);
      }

      matchupMap.set(homeId, {
        opponentTeamId: awayId,
        myCatsWon: homeCumScore.wins || 0,
        myCatsLost: homeCumScore.losses || 0,
        myCatsTied: homeCumScore.ties || 0,
        oppCatsWon: awayCumScore.wins || 0,
        oppCatsLost: awayCumScore.losses || 0,
        oppCatsTied: awayCumScore.ties || 0,
        isHome: true,
        // Live category stats from ESPN
        myScoreByStat: homeScoreByStat,
        oppScoreByStat: awayScoreByStat,
      });
    }

    if (awayId && matchup?.away) {
      const homeCumScore = matchup.home?.cumulativeScore || {};
      const awayCumScore = matchup.away.cumulativeScore || {};

      // Extract live category stats from scoreByStat
      const homeScoreByStat = homeCumScore.scoreByStat || {};
      const awayScoreByStat = awayCumScore.scoreByStat || {};

      matchupMap.set(awayId, {
        opponentTeamId: homeId,
        myCatsWon: awayCumScore.wins || 0,
        myCatsLost: awayCumScore.losses || 0,
        myCatsTied: awayCumScore.ties || 0,
        oppCatsWon: homeCumScore.wins || 0,
        oppCatsLost: homeCumScore.losses || 0,
        oppCatsTied: homeCumScore.ties || 0,
        isHome: false,
        // Live category stats from ESPN
        myScoreByStat: awayScoreByStat,
        oppScoreByStat: homeScoreByStat,
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
      scoringPeriodStartDate,
      scoringPeriodEndDate,
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
    if (!league) return (res as any).status(404).json({ error: "League not found" });

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
        url.searchParams.append("view", "mSchedule");
        url.searchParams.set("platformVersion", platformVersion);

        // @ts-ignore - fetch returns globalThis.Response
        const r = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0",
            Origin: "https://fantasy.espn.com",
            Referer: `https://fantasy.espn.com/basketball/league?leagueId=${providerLeagueId}`,
            Cookie: `espn_s2=${espn_s2.trim()}; SWID=${swid.trim()}; swid=${swid.trim()};`,
          },
        });

        if ((r as any).ok) {
          // @ts-ignore - fetch Response type
    const data: any = await r.json();
          const teamsRaw: any[] = Array.isArray(data?.teams) ? data.teams : [];
          const targetTeam = teamsRaw.find(
            (t: any) => String(t?.id) === team.providerTeamId
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
          espnFetchError = `ESPN API returned status ${(r as any).status}`;
        }
      } else {
        espnFetchError = "Missing ESPN credentials in environment";
      }
    } catch (err) {
      espnFetchError = err instanceof Error ? err.message : "Unknown error fetching ESPN data";
    }

    // Calculate diff
    const wouldBeEnded = activeRosterSlots
      .filter((slot: any) => !espnProviderPlayerIds.has(slot.player.providerPlayerId))
      .map((slot: any) => ({
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
      dbActiveRoster: activeRosterSlots.map((slot: any) => ({
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
app.get("/debug/weekly-projections/:leagueId", async (req: express.Request, res: express.Response) => {
  const leagueId = (req as any).params.leagueId;

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, name: true },
    });
    if (!league) return (res as any).status(404).json({ error: "League not found" });

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
        const opponent = allTeams.find((t: any) => t.providerTeamId === opponentProviderId);
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

    return (res as any).json({
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
    return (res as any).status(500).json({ error: "Failed to fetch debug info" });
  }
});

// Helper: List teams in a league
app.get("/leagues/:leagueId/teams", async (req: express.Request, res: express.Response) => {
  try {
    const leagueId = (req as any).params.leagueId;
    
    // Use demo scope
    const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;

    const league = await getLeagueScoped(leagueId, demoSnapshotId);
    if (!league) return (res as any).status(404).json({ error: "League not found" });

    const teams = await getTeamsScoped(leagueId, demoSnapshotId);

    // Get avatar URLs for all teams in parallel
    const teamsWithAvatars = await Promise.all(teams.map(async (t: any) => {
      const avatarUrl = await getTeamAvatarUrl(req, t.id, demoSnapshotId);
      return {
        id: t.id,
        name: t.name,
        providerTeamId: t.providerTeamId,
        avatarUrl,
      };
    }));

    return (res as any).status(200).json({
      league: { id: league.id, name: league.name },
      teams: teamsWithAvatars,
    });
  } catch (err) {
    console.error("Error fetching teams:", err);
    return (res as any).status(500).json({ error: "Failed to fetch teams" });
  }
});

// List leagues
app.get("/leagues", async (_req: express.Request, res: express.Response) => {
  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, seasonYear: true, provider: true, providerLeagueId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return (res as any).json({ leagues });
});

// Team profile (9-cat ranks)
app.get("/leagues/:leagueId/teams/:teamId/profile", async (req, res) => {
  const leagueId = (req as any).params.leagueId;
  const teamId = (req as any).params.teamId;

  try {
    // Use demo scope
    const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;

    const league = await getLeagueScoped(leagueId, demoSnapshotId);
    if (!league) {
      console.error(`League not found: ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
      return (res as any).status(404).json({ error: "League not found. Please check that the league exists and you have access to it." });
    }

    const team = await getTeamScoped(teamId, demoSnapshotId);
    if (!team || team.leagueId !== leagueId) {
      console.error(`Team not found: ${teamId} in league ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
      return (res as any).status(404).json({ error: "Team not found or not in league" });
    }

    // Get all teams with demo scope
    const allTeamsData = await getTeamsScoped(leagueId, demoSnapshotId);
    
    // Fetch roster slots for each team with player data
    const allTeams = await Promise.all(allTeamsData.map(async (t: any) => {
      const rosterSlots = await getRosterSlotsScoped(leagueId, t.id, demoSnapshotId);
      const currentSlots = rosterSlots.filter((slot: any) => !slot.endAt);
      
      // Get player data for each slot (roster slots already include player via include)
      const slotsWithPlayers = currentSlots.map((slot: any) => {
        return {
          meta: slot.meta,
          player: { 
            id: slot.playerId, 
            meta: slot.player?.meta || null,
            fullName: slot.player?.fullName || null,
          },
        };
      });
      
      return {
        id: t.id,
        name: t.name,
        rosterSlots: slotsWithPlayers,
      };
    }));

  const teamsTotals: TeamTotals[] = [];

  for (const t of allTeams) {
    // Debug: log team roster slot info
    const totalSlots = t.rosterSlots.length;
    const slotsWithPlayer = t.rosterSlots.filter(s => s.player).length;
    const slotsWithPlayerMeta = t.rosterSlots.filter(s => s.player?.meta).length;
    
    // Filter out IR players from team totals AND slots without player meta
    const activeRosterSlots = t.rosterSlots.filter((slot) => {
      // Must have player and player meta to calculate stats
      if (!slot.player || !slot.player.meta) return false;
      
      const slotMeta = (slot.meta as any) || {};
      const isIR = slotMeta.isIR === true || 
        slotMeta.status === "IR" || 
        slotMeta.status === "IL" || 
        slotMeta.status === "OUT";
      return !isIR;
    });
    
    console.log(`[Team Profile] Team ${t.name} (${t.id}): ${totalSlots} total slots, ${slotsWithPlayer} with player, ${slotsWithPlayerMeta} with player.meta, ${activeRosterSlots.length} active (non-IR)`);
    
    // Only calculate stats if we have active roster slots with player meta
    if (activeRosterSlots.length > 0) {
      try {
        const playerStats = activeRosterSlots.map((slot) => extractPlayerStats(slot.player.meta, league.seasonYear).stats);
        const totals = aggregateTeam(playerStats);
        teamsTotals.push({ ...totals, teamId: t.id, teamName: t.name });
      } catch (err) {
        console.error(`Error calculating stats for team ${t.id}:`, err);
        // Skip this team if stats calculation fails
      }
    }
  }

  if (teamsTotals.length === 0) {
    console.error(`[Team Profile] No teams with active rosters found for league ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
    console.error(`[Team Profile] Total teams fetched: ${allTeams.length}`);
    console.error(`[Team Profile] Teams with roster slots: ${allTeams.filter(t => t.rosterSlots.length > 0).length}`);
    const teamsWithPlayerMeta = allTeams.filter(t => t.rosterSlots.some(s => s.player?.meta)).length;
    console.error(`[Team Profile] Teams with player.meta: ${teamsWithPlayerMeta}`);
    
    // Provide actionable error message
    if (allTeams.length === 0) {
      return res.status(400).json({ error: "No teams found in league. Please ensure the league exists and you have access to it." });
    } else if (allTeams.every(t => t.rosterSlots.length === 0)) {
      return res.status(400).json({ error: "No roster slots found for any teams. Please run the ESPN data ingestion to populate roster data." });
    } else if (allTeams.every(t => !t.rosterSlots.some(s => s.player?.meta))) {
      return res.status(400).json({ error: "Roster slots found but player stats are missing. Please ensure player data has been ingested with stats." });
    } else {
      return res.status(400).json({ error: "No teams with active (non-IR) rosters found. All players may be on IR, or roster data needs to be refreshed." });
    }
  }

  const dist = computeLeagueDistributions(teamsTotals);
  const ranksMap = rankTeams(teamsTotals);

  const targetTeamTotals = teamsTotals.find((t) => t.teamId === teamId);
  if (!targetTeamTotals) {
    console.error(`[Team Profile] Target team totals not found for teamId: ${teamId}`);
    console.error(`[Team Profile] Available team IDs in teamsTotals: ${teamsTotals.map(t => t.teamId).join(', ')}`);
    return res.status(500).json({ 
      error: "Target team totals not found. The team may not have any active roster players with stats.",
      teamId,
      availableTeams: teamsTotals.map(t => ({ teamId: t.teamId, teamName: t.teamName }))
    });
  }

  const zScores = zScore(targetTeamTotals, dist);
  const normalizedTeamScore0to9 = teamScore(zScores);

  const targetRoster = allTeams.find((t) => t.id === teamId);
  // Check stats missing only for active (non-IR) players
  const activeTargetSlots = targetRoster?.rosterSlots.filter((slot) => {
    // Must have player and player meta
    if (!slot.player || !slot.player.meta) return false;
    
    const slotMeta = (slot.meta as any) || {};
    const isIR = slotMeta.isIR === true || 
      slotMeta.status === "IR" || 
      slotMeta.status === "IL" || 
      slotMeta.status === "OUT";
    return !isIR;
  }) || [];
  
  let statsMissing = false;
  try {
    statsMissing = activeTargetSlots.some((slot) => {
      if (!slot.player?.meta) return false;
      return extractPlayerStats(slot.player.meta, league.seasonYear).missing;
    }) ?? false;
  } catch (err) {
    console.error(`Error checking stats missing for team ${teamId}:`, err);
    statsMissing = false;
  }

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

    return (res as any).status(200).json({ profile, leagueAverage, leagueRanksSummary });
  } catch (error: any) {
    console.error("[Team Profile] Error fetching team profile:", error);
    console.error("[Team Profile] Stack trace:", error instanceof Error ? error.stack : 'No stack trace');
    return (res as any).status(500).json({ 
      error: "Failed to fetch team profile",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Power rankings
app.get("/leagues/:leagueId/power-rankings", async (req, res) => {
  const leagueId = req.params.leagueId;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, seasonYear: true },
  });
  if (!league) return (res as any).status(404).json({ error: "League not found" });

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

  // Use demo scope
  const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;
  
  const league = await getLeagueScoped(leagueId, demoSnapshotId);
  if (!league) return (res as any).status(404).json({ error: "League not found" });

  // Get all teams with demo scope
  const allTeamsData = await getTeamsScoped(leagueId, demoSnapshotId);
  
  // Fetch roster slots for each team
  const teams = await Promise.all(allTeamsData.map(async (t: any) => {
    const rosterSlots = await getRosterSlotsScoped(leagueId, t.id, demoSnapshotId);
    const currentSlots = rosterSlots.filter((slot: any) => !slot.endAt);
    return {
      id: t.id,
      name: t.name,
      rosterSlots: currentSlots.map((slot: any) => ({
        meta: slot.meta,
        player: { meta: slot.player?.meta || null },
      })),
    };
  }));

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
  try {
    const leagueId = req.params.leagueId;
    const teamId = req.params.teamId;
    const tradeSize = req.query.tradeSize as string | undefined; // "1for1" | "2for2" | undefined (both)
    const excludeUntouchables = req.query.excludeUntouchables !== "false"; // Default true
    const showQuestionable = req.query.showQuestionable === "true";
    const untouchablePlayerIds = req.query.untouchables 
      ? (Array.isArray(req.query.untouchables) ? req.query.untouchables : [req.query.untouchables]).map(String)
      : [];

    // Use demo scope
    const demoSnapshotId = (req as any).demoScope?.demoSnapshotId || null;
  
  const league = await getLeagueScoped(leagueId, demoSnapshotId);
  if (!league) {
    console.error(`League not found: ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
    return (res as any).status(404).json({ error: "League not found. Please check that the league exists and you have access to it." });
  }

  // Get my team with demo scope
  const myTeamData = await getTeamScoped(teamId, demoSnapshotId);
  if (!myTeamData || myTeamData.leagueId !== leagueId) {
    console.error(`Team not found: ${teamId} in league ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
    return (res as any).status(404).json({ error: "Team not found or not in league" });
  }

  // Get scoring period info (for weekly projections)
  const teamMeta = (myTeamData.meta as any) || {};
  const defaultGamesPerWeek = 4;
  const scoringPeriodStartDate = teamMeta.scoringPeriodStartDate || undefined;
  const scoringPeriodEndDate = teamMeta.scoringPeriodEndDate || undefined;

  // Get my team roster slots
  const myRosterSlots = await getRosterSlotsScoped(leagueId, teamId, demoSnapshotId);
  const myCurrentSlots = myRosterSlots.filter((slot: any) => !slot.endAt);
  const myTeam = {
    id: myTeamData.id,
    name: myTeamData.name,
    rosterSlots: myCurrentSlots.map((slot: any) => ({
      meta: slot.meta,
      player: {
        id: slot.playerId,
        fullName: slot.player?.fullName || 'Unknown',
        meta: slot.player?.meta || null,
        providerPlayerId: slot.player?.providerPlayerId || null,
      },
    })),
  };

  // Get all teams with demo scope
  const allTeamsData = await getTeamsScoped(leagueId, demoSnapshotId);
  
  // Fetch roster slots for each team
  const allTeams = await Promise.all(allTeamsData.map(async (t: any) => {
    const rosterSlots = await getRosterSlotsScoped(leagueId, t.id, demoSnapshotId);
    const currentSlots = rosterSlots.filter((slot: any) => !slot.endAt);
    return {
      id: t.id,
      name: t.name,
      rosterSlots: currentSlots.map((slot: any) => ({
        meta: slot.meta,
        player: {
          id: slot.playerId,
          fullName: slot.player?.fullName || 'Unknown',
          meta: slot.player?.meta || null,
          providerPlayerId: slot.player?.providerPlayerId || null,
        },
      })),
    };
  }));

  // Compute team totals for all teams (for league distribution)
  const teamsTotals: TeamTotals[] = [];
  for (const t of allTeams) {
    const totalSlots = t.rosterSlots.length;
    const slotsWithPlayerMeta = t.rosterSlots.filter(s => s.player?.meta).length;
    
    const activeRosterSlots = t.rosterSlots.filter((slot) => {
      // Must have player and player meta to calculate stats
      if (!slot.player || !slot.player.meta) return false;
      
      const slotMeta = (slot.meta as any) || {};
      const isIR = slotMeta.isIR === true || 
        slotMeta.status === "IR" || 
        slotMeta.status === "IL" || 
        slotMeta.status === "OUT";
      return !isIR;
    });
    
    console.log(`[Trade Suggestions] Team ${t.name}: ${totalSlots} slots, ${slotsWithPlayerMeta} with meta, ${activeRosterSlots.length} active`);
    
    // Only calculate stats if we have active roster slots with player meta
    if (activeRosterSlots.length > 0) {
      try {
        const playerStats = activeRosterSlots.map((slot) => extractPlayerStats(slot.player.meta, league.seasonYear).stats);
        const totals = aggregateTeam(playerStats);
        teamsTotals.push({ ...totals, teamId: t.id, teamName: t.name });
      } catch (err) {
        console.error(`Error calculating stats for team ${t.id}:`, err);
        // Skip this team if stats calculation fails
      }
    }
  }

  if (teamsTotals.length === 0) {
    console.error(`[Trade Suggestions] No teams with active rosters found for league ${leagueId}, demoSnapshotId: ${demoSnapshotId}`);
    console.error(`[Trade Suggestions] Total teams fetched: ${allTeams.length}`);
    console.error(`[Trade Suggestions] Teams with roster slots: ${allTeams.filter(t => t.rosterSlots.length > 0).length}`);
    const teamsWithPlayerMeta = allTeams.filter(t => t.rosterSlots.some(s => s.player?.meta)).length;
    console.error(`[Trade Suggestions] Teams with player.meta: ${teamsWithPlayerMeta}`);
    
    // Provide actionable error message
    if (allTeams.length === 0) {
      return res.status(400).json({ error: "No teams found in league. Please ensure the league exists and you have access to it." });
    } else if (allTeams.every(t => t.rosterSlots.length === 0)) {
      return res.status(400).json({ error: "No roster slots found for any teams. Please run the ESPN data ingestion to populate roster data." });
    } else if (allTeams.every(t => !t.rosterSlots.some(s => s.player?.meta))) {
      return res.status(400).json({ error: "Roster slots found but player stats are missing. Please ensure player data has been ingested with stats." });
    } else {
      return res.status(400).json({ error: "No teams with active (non-IR) rosters found. All players may be on IR, or roster data needs to be refreshed." });
    }
  }

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
    const cleanPlayerId = cleanProviderPlayerId(slot.player.providerPlayerId);
    const headshotUrl = cleanPlayerId
      ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`)
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
      const cleanPlayerId = cleanProviderPlayerId(slot.player.providerPlayerId);
      const headshotUrl = cleanPlayerId
        ? proxiedImage(req, `https://a.espncdn.com/i/headshots/nba/players/full/${cleanPlayerId}.png`)
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

      const opponentAvatarUrl = await getTeamAvatarUrl(req, opponentTeam.id, demoSnapshotId);

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
  }

  // Use demo scope (already set earlier in function)
  const myTeamAvatarUrl = await getTeamAvatarUrl(req, myTeam.id, demoSnapshotId);

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
  } catch (error: any) {
    console.error("[Trade Suggestions] Error:", error);
    return res.status(500).json({ 
      ok: false,
      error: "Failed to fetch trade suggestions",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});


// Health check endpoint
app.get("/health", (_req, res) => {
  (res as any).json({ 
    ok: true, 
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});

// Root route
app.get("/", (_req, res) => {
  (res as any).json({ 
    ok: true, 
    message: "ICantDraft API",
    version: "1.0.0",
    endpoints: ["/health", "/leagues", "/auth", "/demo"]
  });
});

// ---------- START (Local Dev Only) ----------
// For Vercel, use api/index.ts with serverless-http
// Export app for serverless function
export default app;

// Start server for local development only
// Don't run in Vercel serverless environment
if (process.env.VERCEL !== "1" && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`api listening on :${port}`);
  });
}
