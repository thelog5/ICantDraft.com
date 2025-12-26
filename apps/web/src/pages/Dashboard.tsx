import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopNav from "../components/TopNav";
import HomeHeader from "../components/HomeHeader";
import {
  getResolvedLeagueId,
  getResolvedTeamId,
  hasSettings,
} from "../lib/settings";
import { api, TeamProfileResponse, ApiError } from "../lib/api";
import Card from "../components/Card";
import CategoryTile from "../components/CategoryTile";
import TeamRadarChart from "../components/RadarChart";
import WeeklyBarChart from "../components/WeeklyBarChart";
import PuntImpactChart from "../components/PuntImpactChart";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./Dashboard.css";

type RosterPlayer = {
  id: string;
  fullName: string;
  providerPlayerId: string | null;
  positions: string[];
  headshotUrl: string | null;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const leagueId = getResolvedLeagueId();
  const teamId = getResolvedTeamId();

  useEffect(() => {
    // Check settings first
    if (!hasSettings() || !leagueId || !teamId) {
      navigate("/settings", { state: { message: "Please configure your league and team in Settings." } });
      return;
    }

    // Check API health
    api.checkHealth().catch((err) => {
      const status = err instanceof ApiError && err.status 
        ? ` (HTTP ${err.status})`
        : "";
      setApiError(`API appears to be offline${status}`);
    });

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
        setError("Failed to load dashboard data");
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
        <div className="dashboard">
          <Skeleton height="200px" width="100%" />
          <Skeleton height="400px" width="100%" style={{ marginTop: "2rem" }} />
        </div>
      </TopNav>
    );
  }

  if (error) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="dashboard">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </TopNav>
    );
  }

  if (!profile) {
    return (
      <TopNav onRefresh={handleRefresh}>
        <div className="dashboard">
          <ErrorState message="No team profile found" onRetry={loadData} />
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

  const totalTeams = profile.leagueRanksSummary.length;

  // Prepare radar chart data (normalize ranks to 0-100, best = 100)
  const radarData = categoryKeys.map((key) => {
    const rank = profile.profile.categoryRank[key];
    const normalizedValue = ((totalTeams - rank + 1) / totalTeams) * 100;
    return {
      category: categoryLabels[key],
      value: normalizedValue,
    };
  });

  // Calculate projected wins (categories where rank is top half)
  const projectedWins = categoryKeys.filter((key) => {
    const rank = profile.profile.categoryRank[key];
    const isLowerBetter = key === "tov";
    if (isLowerBetter) {
      return rank <= Math.ceil(totalTeams / 2);
    }
    return rank <= Math.ceil(totalTeams / 2);
  }).length;

  // Weekly projections data (team vs league average) - ALL 9 categories
  const weeklyData = categoryKeys.map((key) => {
    const myValue = profile.profile.rawTotals[key];
    const leagueAvg = profile.leagueAverage[key];
    
    // For percentages, ensure reasonable display values
    let displayMyValue = myValue;
    let displayLeagueAvg = leagueAvg;
    let displayOpponent = leagueAvg * 0.95;
    
    if (key === "fgPct" || key === "ftPct") {
      // Convert to percentage display (0-100)
      displayMyValue = myValue * 100;
      displayLeagueAvg = leagueAvg * 100;
      displayOpponent = displayLeagueAvg * 0.98;
    }
    
    return {
      category: categoryLabels[key],
      myTeam: displayMyValue,
      opponent: displayOpponent,
      leagueAvg: displayLeagueAvg,
      isPercentage: key === "fgPct" || key === "ftPct",
    };
  });

  // Punt strategy: worst 2 z-scores
  const puntCandidates = categoryKeys
    .map((key) => ({
      key,
      zScore: profile.profile.zScores[key],
      isLowerBetter: key === "tov",
    }))
    .sort((a, b) => {
      if (a.isLowerBetter) return a.zScore - b.zScore;
      return b.zScore - a.zScore;
    })
    .slice(0, 2);

  // Keep focus: best 4 ranks
  const keepFocus = categoryKeys
    .map((key) => ({
      key,
      rank: profile.profile.categoryRank[key],
      isLowerBetter: key === "tov",
    }))
    .filter((cat) => !cat.isLowerBetter)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4);

  // Impact chart data
  const impactData = categoryKeys.slice(0, 4).map((key) => ({
    category: categoryLabels[key],
    gain: Math.max(0, profile.profile.zScores[key] * 10),
    loss: Math.max(0, -profile.profile.zScores[key] * 10),
  }));

  return (
    <TopNav onRefresh={handleRefresh}>
      {apiError && (
        <div className="api-error-banner">
          ⚠️ {apiError}
        </div>
      )}
      <div className="dashboard">
        <HomeHeader leagueId={leagueId!} myTeamId={teamId!} />
        <div className="dashboard-grid">
          {/* Category Overview - Left */}
          <Card className="dashboard-card category-overview-card">
            <h2 className="card-title">Category Overview</h2>
            <div className="category-tiles-grid">
              {categoryKeys.map((key) => (
                <CategoryTile
                  key={key}
                  category={categoryLabels[key]}
                  rank={profile.profile.categoryRank[key]}
                  totalTeams={totalTeams}
                />
              ))}
            </div>
          </Card>

          {/* Team Performance - Right */}
          <Card className="dashboard-card team-performance-card">
            <h2 className="card-title">Team Performance</h2>
            <div className="team-performance-content">
              <TeamRadarChart data={radarData} />
              <div className="team-performance-stats">
                <div className="team-score-display">
                  <span className="team-score-label">Team Score:</span>
                  <span className="team-score-value">
                    {profile.profile.normalizedTeamScore0to9.toFixed(1)} / 9.0
                  </span>
                </div>
                <div className="projected-wins-display">
                  <span className="projected-wins-label">Projected Wins:</span>
                  <span className="projected-wins-value">
                    {projectedWins} out of 9 Cats
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Weekly Projections */}
          <Card className="dashboard-card weekly-projections-card">
            <h2 className="card-title">Weekly Projections</h2>
            <div className="weekly-matchup-selector">
              <div className="matchup-header-bar">
                <button className="matchup-nav-btn" disabled>&lt;</button>
                <div className="matchup-teams">
                  <span className="matchup-team-icon">🏀</span>
                  <span className="matchup-my-team">Your Team</span>
                </div>
                <button className="matchup-nav-btn" disabled>&gt;</button>
              </div>
              <div className="matchup-score-bar">
                <div className="matchup-score">5-4</div>
                <div className="matchup-league-avg">vs. League Avg: 6-3</div>
              </div>
            </div>
            <div className="weekly-projections-content">
              <div className="weekly-chart-container">
                <WeeklyBarChart data={weeklyData} />
                <div className="weekly-chart-note">
                  <strong>All 9 categories shown.</strong> FG%/FT% shown as percentages. Data derived from season totals – real weekly projections coming soon.
                </div>
              </div>
            </div>
          </Card>

          {/* Trade Suggestions */}
          <Card className="dashboard-card trade-suggestions-card">
            <div className="trade-suggestions-header">
              <h2 className="card-title">Trade Suggestions</h2>
              <button className="view-all-button" disabled>View All Proposals →</button>
            </div>
            <div className="trade-suggestions-grid">
              <div className="trade-suggestion-placeholder">
                <div className="trade-placeholder-icon">📊</div>
                <p className="trade-placeholder-text">
                  Trade analysis engine requires player-level valuation data
                </p>
                <p className="trade-placeholder-subtext">Coming soon</p>
              </div>
            </div>
          </Card>

          {/* My Team Analysis */}
          <Card className="dashboard-card team-analysis-card">
            <h2 className="card-title">My Team Analysis</h2>
            {roster.length > 0 ? (
              <div className="team-analysis-list">
                {roster.slice(0, 4).map((player, idx) => {
                  // Simple heuristic role assignment based on roster position
                  const roles = ["Core Player", "3PT Specialist", "Expendable", "Punt-Conflict"];
                  const roleClasses = ["core", "specialist", "expendable", "conflict"];
                  const ratings = [5, 3, 2, 3];
                  
                  return (
                    <div key={player.id} className="team-analysis-item">
                      <div className="player-info">
                        {player.headshotUrl ? (
                          <img
                            src={player.headshotUrl}
                            alt={player.fullName}
                            className="player-headshot"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="player-headshot"></div>
                        )}
                        <div className="player-details">
                          <div className="player-name">{player.fullName}</div>
                          <div className={`player-role ${roleClasses[idx % 4]}`}>
                            {roles[idx % 4]}
                          </div>
                        </div>
                      </div>
                      <div className="player-rating positive">
                        <span className="player-rating-icon">✓</span>
                        <span>{ratings[idx % 4]}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="team-analysis-empty">
                <p className="empty-state-text">
                  Roster data not available. Please ensure player data has been ingested.
                </p>
              </div>
            )}
          </Card>

          {/* Punt Strategy */}
          <Card className="dashboard-card punt-strategy-card">
            <h2 className="card-title">Punt Strategy</h2>
            <div className="punt-strategy-content">
              <div className="punt-strategy-recommendation">
                <div className="punt-strategy-label">Recommended Punt:</div>
                <div className="punt-strategy-categories">
                  {puntCandidates.map((cat) => (
                    <span key={cat.key} className="punt-category-badge">
                      {categoryLabels[cat.key]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="punt-strategy-focus">
                <div className="punt-strategy-label">Keep Focus:</div>
                <div className="punt-strategy-focus-cats">
                  {keepFocus.map((cat) => categoryLabels[cat.key]).join(", ")}
                </div>
              </div>
              <div className="punt-impact-chart-container">
                <h4>Category Impact</h4>
                <PuntImpactChart data={impactData} />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </TopNav>
  );
}
