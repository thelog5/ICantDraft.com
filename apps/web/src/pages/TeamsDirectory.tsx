import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { api, Team, ApiError } from "../lib/api";
import Card from "../components/Card";
import Table from "../components/Table";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import RefreshButton from "../components/RefreshButton";
import "./TeamsDirectory.css";

export default function TeamsDirectory() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [leagueName, setLeagueName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = async () => {
    if (!leagueId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.getTeams(leagueId);
      setTeams(data.teams);
      setLeagueName(data.league.name);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load teams");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [leagueId]);

  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <Layout>
        <div className="teams-directory">
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
        <div className="teams-directory">
          <ErrorState message={error} onRetry={loadData} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="teams-directory">
        <div className="teams-directory-header">
          <h1>{leagueName} - Teams</h1>
          <RefreshButton onSuccess={loadData} />
        </div>

        <div className="teams-directory-controls">
          <input
            type="text"
            placeholder="Search teams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="teams-directory-search"
          />
        </div>

        <Card>
          <Table>
            <thead>
              <tr>
                <th>Team Name</th>
                <th>Provider ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeams.map((team) => (
                <tr
                  key={team.id}
                  className="clickable"
                  onClick={() => navigate(`/leagues/${leagueId}/teams/${team.id}`)}
                >
                  <td className="font-bold">{team.name}</td>
                  <td className="font-mono">{team.providerTeamId}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </Layout>
  );
}

