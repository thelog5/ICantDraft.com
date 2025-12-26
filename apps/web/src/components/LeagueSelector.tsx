import { useState, useEffect } from "react";
import { api, ApiError } from "../lib/api";
import "./LeagueSelector.css";

type LeagueSelectorProps = {
  onSelect?: (leagueId: string) => void;
};

export default function LeagueSelector({ onSelect }: LeagueSelectorProps) {
  const [leagueId, setLeagueId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("icantdraft_league_id");
    if (saved) setLeagueId(saved);
  }, []);

  const handleLoad = async () => {
    if (!leagueId.trim()) {
      setError("Please enter a league ID");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Resolve league key (UUID or ESPN numeric)
      const resolved = await api.resolveLeague(leagueId.trim());
      if (onSelect) {
        onSelect(resolved.leagueId);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to load league");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="league-selector">
      <div className="league-selector-input-group">
        <input
          type="text"
          value={leagueId}
          onChange={(e) => setLeagueId(e.target.value)}
          placeholder="Enter League ID"
          className="league-selector-input"
          onKeyDown={(e) => e.key === "Enter" && handleLoad()}
        />
        <button
          onClick={handleLoad}
          disabled={loading}
          className="league-selector-button"
        >
          {loading ? "Loading..." : "Load League"}
        </button>
      </div>
      {error && <div className="league-selector-error">{error}</div>}
    </div>
  );
}


