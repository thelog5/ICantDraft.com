import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Layout from "../components/Layout";
import { api, TeamProfileResponse, ApiError } from "../lib/api";
import Card from "../components/Card";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import Badge from "../components/Badge";
import "./TeamAnalysis.css";

export default function TeamAnalysis() {
  const { leagueId, teamId } = useParams<{ leagueId: string; teamId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);

  const loadData = async () => {
    if (!leagueId || !teamId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.getTeamProfile(leagueId, teamId);
      setProfile(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load team profile");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [leagueId, teamId]);

  if (loading) {
    return (
      <Layout>
        <div className="team-analysis">
          <Skeleton height="3rem" width="400px" />
          <Skeleton height="200px" style={{ marginTop: "2rem" }} />
          <Skeleton height="200px" style={{ marginTop: "1rem" }} />
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="team-analysis">
          <ErrorState message={error} onRetry={loadData} />
          <Link to={`/leagues/${leagueId}`} className="back-link">
            ← Back to League
          </Link>
        </div>
      </Layout>
    );
  }

  if (!profile) {
    return (
      <Layout>
        <div className="team-analysis">
          <ErrorState message="Team profile not found" />
          <Link to={`/leagues/${leagueId}`} className="back-link">
            ← Back to League
          </Link>
        </div>
      </Layout>
    );
  }

  const { profile: p, leagueRanksSummary } = profile;

  // Find team rank
  const teamRank =
    leagueRanksSummary.findIndex((t) => t.teamId === teamId) + 1 || 0;

  // Strengths (best 3 ranks = lowest numbers)
  const categoryEntries = Object.entries(p.categoryRank) as Array<
    [keyof typeof p.categoryRank, number]
  >;
  const strengths = categoryEntries
    .filter(([cat]) => cat !== "tov") // TOV is inverted
    .sort(([, a], [, b]) => a - b)
    .slice(0, 3)
    .map(([cat]) => cat.toUpperCase());

  // Weaknesses (worst 3 ranks = highest numbers)
  const weaknesses = categoryEntries
    .filter(([cat]) => cat !== "tov")
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([cat]) => cat.toUpperCase());

  // Punt candidates (worst z-scores)
  const zEntries = Object.entries(p.zScores) as Array<
    [keyof typeof p.zScores, number]
  >;
  const puntCandidates = zEntries
    .filter(([cat]) => cat !== "tov")
    .map(([cat, z]) => [cat, cat === "tov" ? -z : z] as const)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 2)
    .map(([cat]) => cat.toUpperCase());

  return (
    <Layout>
      <div className="team-analysis">
        <Link to={`/leagues/${leagueId}`} className="back-link">
          ← Back to League
        </Link>

        <div className="team-analysis-header">
          <div>
            <h1>{p.teamName}</h1>
            <div className="team-analysis-meta">
              <Badge variant="primary">Rank #{teamRank}</Badge>
              <span className="team-analysis-score">
                Score: {p.normalizedTeamScore0to9.toFixed(2)}/9
              </span>
              <span className="team-analysis-timestamp">
                Updated: {new Date(p.meta.computedAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {p.meta.stats_missing && (
          <Card className="warning-card">
            <div className="warning-text">
              ⚠️ Some player stats are missing. Results may be incomplete.
            </div>
          </Card>
        )}

        <Card>
          <h2 className="card-title">Category Strengths & Weaknesses</h2>
          <div className="strengths-weaknesses">
            <div>
              <h3 className="strengths-title">Strengths</h3>
              <div className="category-tags">
                {strengths.map((cat) => (
                  <Badge key={cat} variant="success">
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <h3 className="weaknesses-title">Weaknesses</h3>
              <div className="category-tags">
                {weaknesses.map((cat) => (
                  <Badge key={cat} variant="danger">
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="card-title">Punt Strategy</h2>
          <p className="punt-explanation">
            Punt means intentionally ignoring categories where you're far below league avg to
            dominate others.
          </p>
          <div className="punt-candidates">
            <h3>Suggested Punt Candidates:</h3>
            <div className="category-tags">
              {puntCandidates.map((cat) => (
                <Badge key={cat} variant="warning">
                  {cat}
                </Badge>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="card-title">Trade Suggestions</h2>
          <div className="trade-suggestions">
            <div className="trade-target">
              <h4>Target 1</h4>
              <p>Target players that improve FT% and BLK with low TOV</p>
            </div>
            <div className="trade-target">
              <h4>Target 2</h4>
              <p>Avoid players that hurt FT%</p>
            </div>
            <div className="trade-target">
              <h4>Target 3</h4>
              <p>Focus on categories where you rank in top 3</p>
            </div>
          </div>
          <div className="todo-note">
            <strong>TODO:</strong> Needs player-level comparison endpoint
          </div>
        </Card>

        <Card>
          <h2 className="card-title">Roster Fit</h2>
          <div className="todo-note">
            <strong>TODO:</strong> Roster list needs endpoint. Current API response does not
            include player-level data.
          </div>
        </Card>
      </div>
    </Layout>
  );
}

