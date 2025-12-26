import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SidebarLayout, { getStoredLeagueId, getStoredMyTeamId } from "../components/SidebarLayout";
import { api, TeamProfileResponse, ApiError } from "../lib/api";
import Card from "../components/Card";
import CategoryRow from "../components/CategoryRow";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import "./Team.css";

export default function Team() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [leagueName, setLeagueName] = useState("");
  const leagueId = getStoredLeagueId();
  const myTeamId = getStoredMyTeamId();

  useEffect(() => {
    if (!leagueId || !myTeamId) {
      navigate("/");
      return;
    }

    loadData();
  }, [leagueId, myTeamId, navigate]);

  const loadData = async () => {
    if (!leagueId || !myTeamId) return;

    setLoading(true);
    setError(null);

    try {
      const profileData = await api.getTeamProfile(leagueId, myTeamId);
      setProfile(profileData);

      // Get league name from power rankings
      try {
        const rankingsData = await api.getPowerRankings(leagueId);
        setLeagueName(rankingsData.league.name);
      } catch {
        // Ignore
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load team data");
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SidebarLayout leagueId={leagueId || undefined} leagueName={leagueName}>
        <div className="team-page">
          <Skeleton height="200px" width="100%" />
          <Skeleton height="400px" width="100%" style={{ marginTop: "2rem" }} />
        </div>
      </SidebarLayout>
    );
  }

  if (error) {
    return (
      <SidebarLayout leagueId={leagueId || undefined} leagueName={leagueName} onRefresh={loadData}>
        <div className="team-page">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </SidebarLayout>
    );
  }

  if (!profile) {
    return (
      <SidebarLayout leagueId={leagueId || undefined} leagueName={leagueName} onRefresh={loadData}>
        <div className="team-page">
          <ErrorState message="No team profile found" onRetry={loadData} />
        </div>
      </SidebarLayout>
    );
  }

  const totalTeams = profile.leagueRanksSummary.length;

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
    pts: "Points",
    reb: "Rebounds",
    ast: "Assists",
    stl: "Steals",
    blk: "Blocks",
    threes: "3-Pointers Made",
    fgPct: "Field Goal %",
    ftPct: "Free Throw %",
    tov: "Turnovers",
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Calculate punt strategy (worst 2 z-scores)
  const zScoreData = categoryKeys.map((key) => ({
    key,
    label: categoryLabels[key],
    zScore: profile.profile.zScores[key],
    rank: profile.profile.categoryRank[key],
    isLowerBetter: key === "tov",
  }));

  const puntCandidates = [...zScoreData]
    .sort((a, b) => {
      // For TOV, lower z-score is worse (more negative)
      if (a.isLowerBetter) return a.zScore - b.zScore;
      return b.zScore - a.zScore;
    })
    .slice(0, 2);

  return (
    <SidebarLayout leagueId={leagueId || undefined} leagueName={leagueName} onRefresh={loadData}>
      <div className="team-page">
        <div className="team-header">
          <div className="team-header-main">
            <h1 className="team-title">{profile.profile.teamName}</h1>
            <div className="team-badge">
              <span className="team-badge-label">Team Score:</span>
              <span className="team-badge-value">
                {profile.profile.normalizedTeamScore0to9.toFixed(1)} / 9.0
              </span>
            </div>
          </div>
          <div className="team-meta">
            Last computed: {formatDate(profile.profile.meta.computedAt)}
          </div>
        </div>

        <div className="team-grid">
          <Card className="team-card">
            <h2 className="card-title">Raw Totals</h2>
            <div className="team-stats-grid">
              {categoryKeys.map((key) => (
                <div key={key} className="team-stat-item">
                  <div className="team-stat-label">{categoryLabels[key]}</div>
                  <div className="team-stat-value">
                    {key === "fgPct" || key === "ftPct"
                      ? `${(profile.profile.rawTotals[key] * 100).toFixed(1)}%`
                      : profile.profile.rawTotals[key].toFixed(1)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="team-card">
            <h2 className="card-title">Z-Scores</h2>
            <div className="team-stats-grid">
              {categoryKeys.map((key) => (
                <div key={key} className="team-stat-item">
                  <div className="team-stat-label">{categoryLabels[key]}</div>
                  <div className="team-stat-value">
                    {profile.profile.zScores[key].toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="team-card">
            <h2 className="card-title">Category Ranks</h2>
            <div className="category-ranks-list">
              {categoryKeys.map((key) => (
                <CategoryRow
                  key={key}
                  category={categoryLabels[key]}
                  rank={profile.profile.categoryRank[key]}
                  totalTeams={totalTeams}
                  value={profile.profile.rawTotals[key]}
                  leagueAverage={profile.leagueAverage[key]}
                  isLowerBetter={key === "tov"}
                />
              ))}
            </div>
          </Card>

          <Card className="team-card punt-strategy-card">
            <h2 className="card-title">Punt Strategy</h2>
            <div className="punt-strategy-content">
              <div className="punt-strategy-recommendation">
                <div className="punt-strategy-label">Recommended Punt Categories:</div>
                <div className="punt-strategy-categories">
                  {puntCandidates.map((cat) => (
                    <span key={cat.key} className="punt-category-badge">
                      {cat.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="punt-strategy-explanation">
                These categories have the worst z-scores. Punting them allows you to focus on
                strengthening your other categories.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </SidebarLayout>
  );
}

