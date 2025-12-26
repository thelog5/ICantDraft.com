import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { api, PowerRanking, ApiError } from "../lib/api";
import Table from "../components/Table";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import RefreshButton from "../components/RefreshButton";
import "./PowerRankings.css";

export default function PowerRankings() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [powerRankings, setPowerRankings] = useState<PowerRanking[]>([]);
  const [leagueName, setLeagueName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCategoryRanks, setShowCategoryRanks] = useState(true);

  const loadData = async () => {
    if (!leagueId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.getPowerRankings(leagueId);
      setPowerRankings(data.powerRankings);
      setLeagueName(data.league.name);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load power rankings");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [leagueId]);

  const filteredRankings = powerRankings.filter((r) =>
    r.teamName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <Layout>
        <div className="power-rankings">
          <Skeleton height="2rem" width="300px" />
          <Skeleton height="1rem" width="200px" style={{ marginTop: "1rem" }} />
          <Skeleton height="400px" style={{ marginTop: "2rem" }} />
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="power-rankings">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="power-rankings">
        <div className="power-rankings-header">
          <h1>{leagueName} - Power Rankings</h1>
          <RefreshButton onSuccess={loadData} />
        </div>

        <div className="power-rankings-controls">
          <input
            type="text"
            placeholder="Search teams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="power-rankings-search"
          />
          <label className="power-rankings-toggle">
            <input
              type="checkbox"
              checked={showCategoryRanks}
              onChange={(e) => setShowCategoryRanks(e.target.checked)}
            />
            Show category ranks
          </label>
        </div>

        <Table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Team</th>
              <th>Score</th>
              {showCategoryRanks && (
                <>
                  <th>PTS</th>
                  <th>REB</th>
                  <th>AST</th>
                  <th>STL</th>
                  <th>BLK</th>
                  <th>3PM</th>
                  <th>FG%</th>
                  <th>FT%</th>
                  <th>TOV</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRankings.map((ranking, index) => (
              <tr
                key={ranking.teamId}
                className="clickable"
                onClick={() => navigate(`/leagues/${leagueId}/teams/${ranking.teamId}`)}
              >
                <td className="font-bold">{index + 1}</td>
                <td className="font-bold">{ranking.teamName}</td>
                <td className="font-mono font-bold">{ranking.score0to9.toFixed(2)}</td>
                {showCategoryRanks && (
                  <>
                    <td>{ranking.ranks.pts}</td>
                    <td>{ranking.ranks.reb}</td>
                    <td>{ranking.ranks.ast}</td>
                    <td>{ranking.ranks.stl}</td>
                    <td>{ranking.ranks.blk}</td>
                    <td>{ranking.ranks.threes}</td>
                    <td>{ranking.ranks.fgPct}</td>
                    <td>{ranking.ranks.ftPct}</td>
                    <td>{ranking.ranks.tov}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Layout>
  );
}

