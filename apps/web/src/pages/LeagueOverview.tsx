import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Layout from "../components/Layout";
import { api, PowerRanking, TeamProfileResponse, ApiError } from "../lib/api";
import Card from "../components/Card";
import Table from "../components/Table";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import RefreshButton from "../components/RefreshButton";
import "./LeagueOverview.css";

export default function LeagueOverview() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [powerRankings, setPowerRankings] = useState<PowerRanking[]>([]);
  const [leagueName, setLeagueName] = useState("");
  const [sampleProfile, setSampleProfile] = useState<TeamProfileResponse | null>(null);

  const loadData = async () => {
    if (!leagueId) return;

    setLoading(true);
    setError(null);

    try {
      const rankingsData = await api.getPowerRankings(leagueId);
      setPowerRankings(rankingsData.powerRankings);
      setLeagueName(rankingsData.league.name);

      // Try to get sample profile for league averages
      if (rankingsData.powerRankings.length > 0) {
        try {
          const profile = await api.getTeamProfile(
            leagueId,
            rankingsData.powerRankings[0].teamId
          );
          setSampleProfile(profile);
        } catch {
          // Ignore if profile fails
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load league data");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [leagueId]);

  if (loading) {
    return (
      <Layout>
        <div className="league-overview">
          <Skeleton height="2rem" width="300px" />
          <Skeleton height="1rem" width="200px" style={{ marginTop: "1rem" }} />
          <div style={{ marginTop: "2rem", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
            <Skeleton height="150px" />
            <Skeleton height="150px" />
            <Skeleton height="150px" />
          </div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="league-overview">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </Layout>
    );
  }

  const top5 = powerRankings.slice(0, 5);
  const topTeam = powerRankings[0];

  // Calculate biggest gaps (most polarized category)
  const categoryKeys: (keyof PowerRanking["ranks"])[] = [
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

  let biggestGap = { category: "N/A", spread: 0 };
  categoryKeys.forEach((cat) => {
    const ranks = powerRankings.map((r) => r.ranks[cat]);
    const spread = Math.max(...ranks) - Math.min(...ranks);
    if (spread > biggestGap.spread) {
      biggestGap = { category: cat.toUpperCase(), spread };
    }
  });

  return (
    <Layout>
      <div className="league-overview">
        <div className="league-overview-header">
          <h1>{leagueName}</h1>
          <RefreshButton onSuccess={loadData} />
        </div>

        <div className="summary-cards">
          <Card>
            <div className="summary-card-title">#1 Team</div>
            <div className="summary-card-value">{topTeam?.teamName || "N/A"}</div>
            <div className="summary-card-subvalue">
              Score: {topTeam?.score0to9.toFixed(2) || "N/A"}
            </div>
          </Card>

          <Card>
            <div className="summary-card-title">League Averages</div>
            {sampleProfile ? (
              <>
                <div className="summary-card-value">
                  FG%: {(sampleProfile.leagueAverage.fgPct * 100).toFixed(1)}%
                </div>
                <div className="summary-card-subvalue">
                  FT%: {(sampleProfile.leagueAverage.ftPct * 100).toFixed(1)}% | TOV:{" "}
                  {sampleProfile.leagueAverage.tov.toFixed(1)}
                </div>
              </>
            ) : (
              <div className="summary-card-subvalue">Loading...</div>
            )}
          </Card>

          <Card>
            <div className="summary-card-title">Biggest Gaps</div>
            <div className="summary-card-value">{biggestGap.category}</div>
            <div className="summary-card-subvalue">
              Spread: {biggestGap.spread} ranks
            </div>
          </Card>
        </div>

        <Card className="top5-card">
          <h2 className="card-title">Top 5 Teams</h2>
          <Table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th>Score</th>
                <th>PTS</th>
                <th>REB</th>
                <th>AST</th>
              </tr>
            </thead>
            <tbody>
              {top5.map((ranking, index) => (
                <tr key={ranking.teamId}>
                  <td className="font-bold">{index + 1}</td>
                  <td className="font-bold">{ranking.teamName}</td>
                  <td className="font-mono font-bold">{ranking.score0to9.toFixed(2)}</td>
                  <td>{ranking.ranks.pts}</td>
                  <td>{ranking.ranks.reb}</td>
                  <td>{ranking.ranks.ast}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </Layout>
  );
}

