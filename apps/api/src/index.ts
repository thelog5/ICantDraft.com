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

    return res.json({ teamId: team.id, teamName: team.name, roster });
  } catch (err) {
    console.error("Error fetching roster:", err);
    return res.status(500).json({ error: "Failed to fetch roster" });
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

    // roster.entries[].playerPoolEntry.player
    const entries: any[] = Array.isArray(t?.roster?.entries) ? t.roster.entries : [];
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
            slotLabel: typeof e?.lineupSlotId === "number" ? String(e.lineupSlotId) : null,
            meta: { timingSource: "ingestion_time_fallback", source: "espn_lm-api-reads" },
          },
        });
        rosterSlotsCreated++;
      }
    }
  }

  return res.status(200).json({
    ok: true,
    league: { id: league.id, providerLeagueId, seasonYear, name },
    teamsUpserted,
    playersUpserted,
    rosterSlotsCreated,
  });
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
    select: { id: true },
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
        select: { player: { select: { id: true, meta: true } } },
      },
    },
  });

  const teamsTotals: TeamTotals[] = [];

  for (const t of allTeams) {
    const playerStats = t.rosterSlots.map((slot) => extractPlayerStats(slot.player.meta).stats);
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
  const statsMissing =
    targetRoster?.rosterSlots.some((slot) => extractPlayerStats(slot.player.meta).missing) ?? false;

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
    select: { id: true, name: true },
  });
  if (!league) return res.status(404).json({ error: "League not found" });

  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: { where: { endAt: null }, select: { player: { select: { meta: true } } } },
    },
  });

  const teamTotals: TeamTotals[] = teams.map((t) => {
    const stats = t.rosterSlots.map((s) => extractPlayerStats(s.player.meta).stats);
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
    select: { id: true, name: true },
  });
  if (!league) return res.status(404).json({ error: "League not found" });

  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: { where: { endAt: null }, select: { player: { select: { meta: true } } } },
    },
  });

  const teamTotals: TeamTotals[] = teams.map((t) => {
    const stats = t.rosterSlots.map((s) => extractPlayerStats(s.player.meta).stats);
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

// ---------- START ----------
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`api listening on :${port}`);
});
