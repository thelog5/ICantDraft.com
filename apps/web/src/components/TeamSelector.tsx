import { useState, useEffect } from "react";
import { api, Team, ApiError } from "../lib/api";
import { setStoredMyTeamId } from "./SidebarLayout";
import "./TeamSelector.css";

type TeamSelectorProps = {
  leagueId: string;
  onSelect: (teamId: string) => void;
};

export default function TeamSelector({ leagueId, onSelect }: TeamSelectorProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  useEffect(() => {
    const loadTeams = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getTeams(leagueId);
        setTeams(data.teams);
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

    if (leagueId) {
      loadTeams();
    }
  }, [leagueId]);

  const handleSelect = () => {
    if (selectedTeamId) {
      setStoredMyTeamId(selectedTeamId);
      onSelect(selectedTeamId);
    }
  };

  if (loading) {
    return <div className="team-selector-loading">Loading teams...</div>;
  }

  if (error) {
    return <div className="team-selector-error">{error}</div>;
  }

  return (
    <div className="team-selector">
      <h2 className="team-selector-title">Select Your Team</h2>
      <div className="team-selector-list">
        {teams.map((team) => (
          <button
            key={team.id}
            className={`team-selector-item ${selectedTeamId === team.id ? "selected" : ""}`}
            onClick={() => setSelectedTeamId(team.id)}
          >
            {team.name}
          </button>
        ))}
      </div>
      <button
        className="team-selector-button"
        onClick={handleSelect}
        disabled={!selectedTeamId}
      >
        Continue to Dashboard
      </button>
    </div>
  );
}

