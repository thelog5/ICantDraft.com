import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type TeamProfile } from "../api/client";

export default function TeamProfile() {
  const { leagueId, teamId } = useParams<{ leagueId: string; teamId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfile | null>(null);

  useEffect(() => {
    async function loadProfile() {
      if (!leagueId || !teamId) {
        setError("Missing league or team ID");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const data = await api.getTeamProfile(leagueId, teamId);
        setProfile(data.profile);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load team profile");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [leagueId, teamId]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">{error}</div>
        <Link to="/" className="back-link">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container">
        <div className="error">Profile not found</div>
        <Link to="/" className="back-link">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const formatStat = (value: number, isPercentage = false) => {
    if (isPercentage) {
      return `${(value * 100).toFixed(1)}%`;
    }
    return value.toFixed(2);
  };

  return (
    <div className="container">
      <Link to="/" className="back-link">
        ← Back to Dashboard
      </Link>

      <h1>{profile.teamName}</h1>
      {profile.meta.stats_missing && (
        <div className="error" style={{ marginTop: "1rem" }}>
          Warning: Some player stats are missing. Results may be incomplete.
        </div>
      )}

      <div className="profile-section">
        <h3>Team Score</h3>
        <div className="stat-item">
          <div className="stat-label">Normalized Score (0-9)</div>
          <div className="stat-value">{profile.normalizedTeamScore0to9.toFixed(2)}</div>
        </div>
      </div>

      <div className="profile-section">
        <h3>Raw Totals</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Points</div>
            <div className="stat-value">{profile.rawTotals.pts.toFixed(1)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Rebounds</div>
            <div className="stat-value">{profile.rawTotals.reb.toFixed(1)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Assists</div>
            <div className="stat-value">{profile.rawTotals.ast.toFixed(1)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Steals</div>
            <div className="stat-value">{profile.rawTotals.stl.toFixed(1)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Blocks</div>
            <div className="stat-value">{profile.rawTotals.blk.toFixed(1)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">3-Pointers Made</div>
            <div className="stat-value">{profile.rawTotals.threes.toFixed(1)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">FG%</div>
            <div className="stat-value">{formatStat(profile.rawTotals.fgPct, true)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">FT%</div>
            <div className="stat-value">{formatStat(profile.rawTotals.ftPct, true)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Turnovers</div>
            <div className="stat-value">{profile.rawTotals.tov.toFixed(1)}</div>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <h3>Z-Scores</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Points</div>
            <div className="stat-value">{formatStat(profile.zScores.pts)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Rebounds</div>
            <div className="stat-value">{formatStat(profile.zScores.reb)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Assists</div>
            <div className="stat-value">{formatStat(profile.zScores.ast)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Steals</div>
            <div className="stat-value">{formatStat(profile.zScores.stl)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Blocks</div>
            <div className="stat-value">{formatStat(profile.zScores.blk)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">3-Pointers Made</div>
            <div className="stat-value">{formatStat(profile.zScores.threes)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">FG%</div>
            <div className="stat-value">{formatStat(profile.zScores.fgPct)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">FT%</div>
            <div className="stat-value">{formatStat(profile.zScores.ftPct)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Turnovers</div>
            <div className="stat-value">{formatStat(profile.zScores.tov)}</div>
          </div>
        </div>
      </div>

      <div className="profile-section">
        <h3>Category Ranks</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">Points</div>
            <div className="stat-value">{profile.categoryRank.pts}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Rebounds</div>
            <div className="stat-value">{profile.categoryRank.reb}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Assists</div>
            <div className="stat-value">{profile.categoryRank.ast}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Steals</div>
            <div className="stat-value">{profile.categoryRank.stl}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Blocks</div>
            <div className="stat-value">{profile.categoryRank.blk}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">3-Pointers Made</div>
            <div className="stat-value">{profile.categoryRank.threes}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">FG%</div>
            <div className="stat-value">{profile.categoryRank.fgPct}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">FT%</div>
            <div className="stat-value">{profile.categoryRank.ftPct}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Turnovers</div>
            <div className="stat-value">{profile.categoryRank.tov}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

