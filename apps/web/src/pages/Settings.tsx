import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import TopNav from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { getActiveContext, setActiveContext, ActiveContext } from "../lib/activeContext";
import Card from "../components/Card";
import "./Settings.css";

export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [leagueKeyInput, setLeagueKeyInput] = useState("");
  const [teamKeyInput, setTeamKeyInput] = useState("");
  const redirectMessage = (location.state as any)?.message;

  useEffect(() => {
    // Load existing context if available
    const ctx = getActiveContext();
    if (ctx) {
      setLeagueKeyInput(ctx.leagueKeyInput);
      setTeamKeyInput(ctx.teamKeyInput);
    }
  }, []);

  const handleSave = async () => {
    if (!leagueKeyInput.trim() || !teamKeyInput.trim()) {
      setError("Please enter both league key and team key");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Resolve league
      const leagueRes = await api.resolveLeague(leagueKeyInput.trim());
      
      // Resolve team
      const teamRes = await api.resolveTeam(leagueRes.leagueId, teamKeyInput.trim());

      // Store active context
      const ctx: ActiveContext = {
        leagueKeyInput: leagueKeyInput.trim(),
        teamKeyInput: teamKeyInput.trim(),
        leagueId: leagueRes.leagueId,
        teamId: teamRes.teamId,
        leagueName: leagueRes.leagueName,
        teamName: teamRes.teamName,
      };
      
      setActiveContext(ctx);
      setSuccess(true);

      setTimeout(() => {
        navigate("/dashboard");
      }, 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to save settings");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <TopNav>
      <div className="settings-page">
        <h1 className="settings-title">Settings</h1>

        <Card className="settings-card">
          <h2 className="card-title">League & Team</h2>
          <div className="settings-content">
            {redirectMessage && (
              <div className="settings-message">{redirectMessage}</div>
            )}
            <p className="settings-description">
              Enter your league key (UUID or ESPN league ID) and team key (UUID, ESPN team ID, or
              team name).
            </p>

            <div className="settings-input-group">
              <label htmlFor="leagueKey" className="settings-label">
                League Key
              </label>
              <input
                id="leagueKey"
                type="text"
                value={leagueKeyInput}
                onChange={(e) => setLeagueKeyInput(e.target.value)}
                placeholder="Enter league UUID or ESPN league ID"
                className="settings-input"
              />
            </div>

            <div className="settings-input-group">
              <label htmlFor="teamKey" className="settings-label">
                Team Key
              </label>
              <input
                id="teamKey"
                type="text"
                value={teamKeyInput}
                onChange={(e) => setTeamKeyInput(e.target.value)}
                placeholder="Enter team UUID, ESPN team ID, or team name"
                className="settings-input"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>

            {error && <div className="settings-error">{error}</div>}
            {success && (
              <div className="settings-success">
                Settings saved! Redirecting to dashboard...
              </div>
            )}

            <button
              className="settings-save-button"
              onClick={handleSave}
              disabled={loading || !leagueKeyInput.trim() || !teamKeyInput.trim()}
            >
              {loading ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </Card>
      </div>
    </TopNav>
  );
}
