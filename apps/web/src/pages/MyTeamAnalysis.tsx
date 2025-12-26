import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopNav from "../components/TopNav";
import {
  getResolvedLeagueId,
  getResolvedTeamId,
  getResolvedLeagueName,
  getResolvedTeamName,
  hasSettings,
} from "../lib/settings";
import { api, TeamProfileResponse, ApiError } from "../lib/api";
import Card from "../components/Card";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./MyTeamAnalysis.css";

type RosterPlayer = {
  id: string;
  fullName: string;
  providerPlayerId: string | null;
  positions: string[];
  headshotUrl: string | null;
};

export default function MyTeamAnalysis() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);

  const leagueId = getResolvedLeagueId();
  const teamId = getResolvedTeamId();
  const leagueName = getResolvedLeagueName();
  const teamName = getResolvedTeamName();

  useEffect(() => {
    if (!hasSettings() || !leagueId || !teamId) {
      navigate("/settings", {
        state: { message: "Please configure your league and team in Settings." },
      });
      return;
    }

    loadData();
  }, [leagueId, teamId, navigate]);

  const loadData = async () => {
    if (!leagueId || !teamId) return;

    setLoading(true);
    setError(null);

    try {
      const [profileData, rosterData] = await Promise.all([
        api.getTeamProfile(leagueId, teamId),
        api.getRoster(leagueId, teamId).catch(() => ({ roster: [] })),
      ]);

      setProfile(profileData);
      setRoster(rosterData.roster || []);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load team analysis data");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      await api.refreshEspnData();
      await loadData();
    } catch (err) {
      console.error("Refresh failed:", err);
    }
  };

  if (loading) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="my-team-analysis">
          <Skeleton height="200px" width="100%" />
          <Skeleton height="400px" width="100%" style={{ marginTop: "2rem" }} />
        </div>
      </TopNav>
    );
  }

  if (error) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="my-team-analysis">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  if (!profile) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="my-team-analysis">
          <ErrorState message="Team profile not found" />
        </div>
      </TopNav>
    );
  }

  const categoryKeys: Array<keyof typeof profile.profile.categoryRank> = [
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

  const categoryLabels: Record<string, string> = {
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

  // Strengths: top 3 best ranks (lowest rank numbers)
  const strengths = categoryKeys
    .map((key) => ({
      key,
      rank: profile.profile.categoryRank[key],
      zScore: profile.profile.zScores[key],
    }))
    .filter((cat) => cat.key !== "tov")
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);

  // Weaknesses: bottom 3 worst ranks (highest rank numbers)
  const weaknesses = categoryKeys
    .map((key) => ({
      key,
      rank: profile.profile.categoryRank[key],
      zScore: profile.profile.zScores[key],
    }))
    .filter((cat) => cat.key !== "tov")
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3);

  // Punt candidates: worst 2 z-scores
  const puntCandidates = categoryKeys
    .map((key) => ({
      key,
      zScore: profile.profile.zScores[key],
      rank: profile.profile.categoryRank[key],
    }))
    .filter((cat) => cat.key !== "tov")
    .sort((a, b) => a.zScore - b.zScore)
    .slice(0, 2);

  // Keep focus: best 3-4 z-scores
  const keepFocus = categoryKeys
    .map((key) => ({
      key,
      zScore: profile.profile.zScores[key],
      rank: profile.profile.categoryRank[key],
    }))
    .filter((cat) => cat.key !== "tov")
    .sort((a, b) => b.zScore - a.zScore)
    .slice(0, 4);

  const totalTeams = profile.leagueRanksSummary.length;

  return (
    <TopNav onRefresh={handleRefresh}>
      <div className="my-team-analysis">
        <div className="page-header">
          <h1 className="page-title">Team Analysis: {teamName || "My Team"}</h1>
          <p className="page-subtitle">{leagueName}</p>
        </div>

        {/* A) Full Roster Table */}
        <Card>
          <h2 className="card-title">Full Roster</h2>
          {roster.length > 0 ? (
            <div className="roster-table-wrapper">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Position</th>
                    <th className="stat-col">PTS</th>
                    <th className="stat-col">REB</th>
                    <th className="stat-col">AST</th>
                    <th className="stat-col">STL</th>
                    <th className="stat-col">BLK</th>
                    <th className="stat-col">3PM</th>
                    <th className="stat-col">FG%</th>
                    <th className="stat-col">FT%</th>
                    <th className="stat-col">TO</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((player) => (
                    <tr key={player.id}>
                      <td className="player-cell">
                        <div className="player-info-cell">
                          {player.headshotUrl ? (
                            <img
                              src={player.headshotUrl}
                              alt={player.fullName}
                              className="player-headshot-small"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="player-headshot-placeholder"></div>
                          )}
                          <span className="player-name-cell">{player.fullName}</span>
                        </div>
                      </td>
                      <td className="position-cell">
                        {player.positions.length > 0 ? player.positions.join(", ") : "—"}
                      </td>
                      <td className="stat-col estimated">Est.</td>
                      <td className="stat-col estimated">Est.</td>
                      <td className="stat-col estimated">Est.</td>
                      <td className="stat-col estimated">Est.</td>
                      <td className="stat-col estimated">Est.</td>
                      <td className="stat-col estimated">Est.</td>
                      <td className="stat-col estimated">Est.</td>
                      <td className="stat-col estimated">Est.</td>
                      <td className="stat-col estimated">Est.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="roster-note">
                <small>
                  Player-level stat breakdown requires additional API endpoint (coming soon).
                  Estimated placeholders shown.
                </small>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>No roster data available. Please ensure player data has been ingested.</p>
            </div>
          )}
        </Card>

        {/* B) Strengths / Weaknesses */}
        <Card>
          <h2 className="card-title">Category Strengths & Weaknesses</h2>
          <div className="strengths-weaknesses-grid">
            <div className="strength-section">
              <h3 className="section-label">Top 3 Strengths</h3>
              <div className="category-badges">
                {strengths.map((cat) => (
                  <div key={cat.key} className="category-badge strength">
                    <div className="badge-category">{categoryLabels[cat.key]}</div>
                    <div className="badge-detail">
                      Rank #{cat.rank} / {totalTeams}
                    </div>
                    <div className="badge-z">z: {cat.zScore.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="weakness-section">
              <h3 className="section-label">Bottom 3 Weaknesses</h3>
              <div className="category-badges">
                {weaknesses.map((cat) => (
                  <div key={cat.key} className="category-badge weakness">
                    <div className="badge-category">{categoryLabels[cat.key]}</div>
                    <div className="badge-detail">
                      Rank #{cat.rank} / {totalTeams}
                    </div>
                    <div className="badge-z">z: {cat.zScore.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* C) Punt Strategy */}
        <Card>
          <h2 className="card-title">Punt Strategy Recommendation</h2>
          <p className="punt-explanation">
            Based on your team's z-scores and category rankings, here's a deterministic
            punt strategy to maximize your competitive advantage.
          </p>
          <div className="punt-strategy-grid">
            <div className="punt-section">
              <h3 className="punt-section-title">Recommended Punt (1-2 categories)</h3>
              <div className="punt-badges">
                {puntCandidates.map((cat) => (
                  <div key={cat.key} className="punt-badge">
                    <div className="punt-badge-category">{categoryLabels[cat.key]}</div>
                    <div className="punt-badge-reason">
                      Rank #{cat.rank} / {totalTeams} • z: {cat.zScore.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
              <p className="punt-note">
                These categories have your lowest z-scores. Punting them (intentionally
                ignoring) lets you dominate other categories.
              </p>
            </div>
            <div className="focus-section">
              <h3 className="focus-section-title">Keep Focus (3-4 categories)</h3>
              <div className="focus-badges">
                {keepFocus.map((cat) => (
                  <div key={cat.key} className="focus-badge">
                    <div className="focus-badge-category">{categoryLabels[cat.key]}</div>
                    <div className="focus-badge-reason">
                      Rank #{cat.rank} / {totalTeams} • z: {cat.zScore.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
              <p className="focus-note">
                These are your strongest categories. Double down here to secure wins.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </TopNav>
  );
}

