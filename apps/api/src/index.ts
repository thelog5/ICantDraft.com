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

const prisma = new PrismaClient();

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
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

  // match what your browser is doing
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

  const player =
    data?.teams?.[0]?.roster?.entries?.[0]?.playerPoolEntry?.player ??
    null;

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

  const url = new URL(
    `${baseUrl}/apis/v3/games/fba/seasons/${seasonId}/segments/0/leagues/${leagueId}`
  );
  url.searchParams.append("view", "mSettings");
  url.searchParams.append("view", "mTeam");
  url.searchParams.append("view", "mRoster");
  url.searchParams.append("view", "mStandings");
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

  // --- minimal deterministic normalization ---
  const provider = "ESPN" as const;
  const providerLeagueId = String(data?.id);
  const name = String(data?.settings?.name ?? `ESPN League ${providerLeagueId}`);
  const seasonYear = Number(data?.seasonId ?? seasonId);
  if (!Number.isInteger(seasonYear)) {
    return res.status(500).json({ error: "Missing/invalid league seasonId" });
  }

  // League upsert
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

  // Teams + rosters
  const teamsRaw: any[] = Array.isArray(data?.teams) ? data.teams : [];
  let playersUpserted = 0;
  let teamsUpserted = 0;
  let rosterSlotsCreated = 0;

  for (const t of teamsRaw) {
    const providerTeamId = String(t?.id);
    const teamName = String(t?.name ?? `Team ${providerTeamId}`);

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
        meta: t ?? null,
      },
      update: {
        name: teamName,
        meta: t ?? null,
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
        where: {
          provider_providerPlayerId: {
            provider,
            providerPlayerId,
          },
        },
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

      // Create active roster slot if missing (simple baseline)
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
            meta: {
              timingSource: "ingestion_time_fallback",
              source: "espn_lm-api-reads",
            },
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

  if (!league) {
    return res.status(404).json({ error: "League not found" });
  }

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

// Analytics v0: Team profile with 9-cat ranks
app.get("/leagues/:leagueId/teams/:teamId/profile", async (req, res) => {
  const leagueId = req.params.leagueId;
  const teamId = req.params.teamId;

  // Verify league exists
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true },
  });

  if (!league) {
    return res.status(404).json({ error: "League not found" });
  }

  // Verify team exists and belongs to league
  const team = await prisma.team.findFirst({
    where: { id: teamId, leagueId },
    select: { id: true, name: true },
  });

  if (!team) {
    return res.status(404).json({ error: "Team not found or not in league" });
  }

  // Load all teams with active rosters
  const allTeams = await prisma.team.findMany({
    where: { leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: {
        where: { endAt: null },
        select: {
          player: {
            select: {
              id: true,
              meta: true,
            },
          },
        },
      },
    },
  });
  

  // Extract stats and aggregate per team
  const teamsTotals: TeamTotals[] = [];

  for (const t of allTeams) {
    const playerStats = t.rosterSlots.map((slot) => {
      const { stats } = extractPlayerStats(slot.player.meta);
      return stats;
    });

    const totals = aggregateTeam(playerStats);
    teamsTotals.push({
      ...totals,
      teamId: t.id,
      teamName: t.name,
    });
  }

  if (teamsTotals.length === 0) {
    return res.status(400).json({ error: "No teams with active rosters found" });
  }

  // Compute league distributions
  const dist = computeLeagueDistributions(teamsTotals);

  // Compute ranks
  const ranksMap = rankTeams(teamsTotals);

  // Find target team's totals
  const targetTeamTotals = teamsTotals.find((t) => t.teamId === teamId);
  if (!targetTeamTotals) {
    return res.status(500).json({ error: "Target team totals not found" });
  }

  // Compute z-scores for target team
  const zScores = zScore(targetTeamTotals, dist);

  // Compute team score
  const normalizedTeamScore0to9 = teamScore(zScores);

  // Check if any stats are missing (best-effort check)
  const targetRoster = allTeams.find((t) => t.id === teamId);
  const statsMissing =
    targetRoster?.rosterSlots.some((slot) => {
      const { missing } = extractPlayerStats(slot.player.meta);
      return missing;
    }) ?? false;

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
    categoryRank: ranksMap.get(teamId) ?? {
      pts: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      threes: 0,
      fgPct: 0,
      ftPct: 0,
      tov: 0,
    },
    normalizedTeamScore0to9,
    meta: {
      leagueId,
      teamId,
      computedAt: new Date().toISOString(),
      stats_missing: statsMissing,
    },
  };

  // Compute league average and ranks summary
  const leagueAverage = dist.mean;
  const leagueRanksSummary = teamsTotals
    .map((tt) => {
      const z = zScore(tt, dist);
      return {
        teamId: tt.teamId,
        teamName: tt.teamName,
        ranks: ranksMap.get(tt.teamId)!,
        teamScore: teamScore(z),
      };
    })
    .sort((a, b) => b.teamScore - a.teamScore);

  return res.status(200).json({
    profile,
    leagueAverage,
    leagueRanksSummary,
  });
});

app.get("/leagues/:leagueId/power-rankings", async (req, res) => {
  const leagueId = req.params.leagueId;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true },
  });

  if (!league) {
    return res.status(404).json({ error: "League not found" });
  }

  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: {
      id: true,
      name: true,
      rosterSlots: {
        where: { endAt: null },
        select: {
          player: { select: { meta: true } },
        },
      },
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
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        score0to9: teamScore(z),
        ranks: ranks.get(t.teamId),
      };
    })
    .sort((a, b) => b.score0to9 - a.score0to9);

  return res.json({
    league: { id: league.id, name: league.name },
    powerRankings,
  });
});

app.get("/leagues/:leagueId/overview", async (req, res) => {
  const leagueId = req.params.leagueId;

  // 1) league + teams with active rosters
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
      rosterSlots: {
        where: { endAt: null },
        select: { player: { select: { meta: true } } },
      },
    },
  });

  // 2) totals per team
  const teamTotals: TeamTotals[] = teams.map((t) => {
    const stats = t.rosterSlots.map((s) => extractPlayerStats(s.player.meta).stats);
    const totals = aggregateTeam(stats);
    return { ...totals, teamId: t.id, teamName: t.name };
  });

  const dist = computeLeagueDistributions(teamTotals);
  const ranksMap = rankTeams(teamTotals);

  // 3) league power rankings
  const powerRankings = teamTotals
    .map((t) => {
      const z = zScore(t, dist);
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        score0to9: teamScore(z),
        ranks: ranksMap.get(t.teamId),
      };
    })
    .sort((a, b) => b.score0to9 - a.score0to9);

  return res.status(200).json({
    league,
    leagueAverage: dist.mean,
    powerRankings,
  });
});


// ---------- START ----------
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`api listening on :${port}`);
});
