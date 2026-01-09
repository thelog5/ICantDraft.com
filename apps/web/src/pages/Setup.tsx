import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { setActiveContext } from '../lib/activeContext';
import './Setup.css';

export default function Setup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDemoMode = searchParams.get('demo') === '1';

  // Form state
  const [leagueId, setLeagueId] = useState('');
  const [seasonId, setSeasonId] = useState(new Date().getFullYear());
  const [espnS2, setEspnS2] = useState('');
  const [swid, setSwid] = useState('');

  // Connection state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [leagueName, setLeagueName] = useState('');
  const [teams, setTeams] = useState<Array<{ teamId: number; teamName: string; managerName?: string }>>([]);
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);

  // Auto-start demo if demo param present
  useEffect(() => {
    if (isDemoMode) {
      handleDemoStart();
    }
  }, [isDemoMode]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Just validate the credentials work and get team list (don't store in backend)
      const response = await fetch('http://localhost:3000/auth/espn/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          seasonId,
          espn_s2: espnS2,
          swid,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || 'Failed to connect to ESPN');
        setLoading(false);
        return;
      }

      setLeagueName(data.leagueName);
      setTeams(data.teams);
      setConnected(true);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleSelectTeam = async () => {
    if (!selectedTeam) {
      setError('Please select a team');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Resolve the team in our database to get internal IDs
      const leagueRes = await api.resolveLeague(leagueId);
      const teamRes = await api.resolveTeam(leagueRes.leagueId, String(selectedTeam));

      // Set active context (same as old Settings page logic)
      setActiveContext({
        leagueKeyInput: leagueId,
        teamKeyInput: String(selectedTeam),
        leagueId: leagueRes.leagueId,
        teamId: teamRes.teamId,
        leagueName: leagueName,
        teamName: teams.find(t => t.teamId === selectedTeam)?.teamName || '',
      });

      // Success! Redirect to dashboard
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleDemoStart = async () => {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('http://localhost:3000/auth/demo/info', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || 'Demo mode not available');
        setLoading(false);
        return;
      }

      // Set active context using the existing system (same as before auth was added)
      setActiveContext({
        leagueKeyInput: data.leagueProviderLeagueId,
        teamKeyInput: data.teamProviderTeamId,
        leagueId: data.leagueId,
        teamId: data.teamId,
        leagueName: data.leagueName,
        teamName: data.teamName,
      });

      // Success! Redirect to dashboard
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'An error occurred starting demo mode.');
      setLoading(false);
    }
  };

  return (
    <div className="setup-page">
      {/* Top Navigation */}
      <nav className="setup-nav">
        <div className="setup-nav-content">
          <Link to="/" className="setup-nav-logo">
            <img src="/logo.png" alt="ICantDraft.com" className="setup-logo-image" />
          </Link>
          <div className="setup-nav-links">
            <Link to="/" className="setup-nav-link">
              Back to Home
            </Link>
          </div>
        </div>
      </nav>

      <div className="setup-container">
        <div className="setup-header">
          <h1 className="setup-title">Get Started</h1>
          <p className="setup-subtitle">Connect your ESPN league or try demo mode</p>
          
          <button 
            className="quick-demo-btn" 
            onClick={handleDemoStart}
            disabled={loading}
          >
            {loading ? '⏳ Starting Demo...' : '🚀 Try Demo Now'}
          </button>
        </div>

        <div className="setup-content">
          {/* ESPN Connection Form */}
          <div className="setup-panel">
            <h2 className="panel-title">Connect ESPN League</h2>
            
            <div className="cookie-instructions">
              <h3 className="cookie-instructions-title">How to Find Your ESPN Cookies:</h3>
              <ol className="cookie-steps">
                <li>Open <strong>espn.com/fantasy/basketball</strong> in your browser</li>
                <li>Make sure you're <strong>logged in</strong> to your ESPN account</li>
                <li>Press <strong>F12</strong> (or right-click → Inspect)</li>
                <li>Go to the <strong>Application</strong> tab (Chrome) or <strong>Storage</strong> tab (Firefox)</li>
                <li>Click <strong>Cookies</strong> → <strong>https://www.espn.com</strong></li>
                <li>Find <strong>espn_s2</strong> and <strong>SWID</strong> — copy their values</li>
              </ol>
              <p className="cookie-note">
                Your cookies are encrypted and never stored in your browser. They're only used to fetch your league data from ESPN.
              </p>
            </div>

            {!connected ? (
              <form onSubmit={handleConnect} className="setup-form">
                <div className="form-group">
                  <label htmlFor="leagueId" className="form-label">
                    League ID
                  </label>
                  <input
                    type="text"
                    id="leagueId"
                    className="form-input"
                    value={leagueId}
                    onChange={(e) => setLeagueId(e.target.value)}
                    placeholder="e.g., 12345678"
                    required
                  />
                  <p className="form-hint">Find this in your ESPN league URL</p>
                </div>

                <div className="form-group">
                  <label htmlFor="seasonId" className="form-label">
                    Season Year
                  </label>
                  <input
                    type="number"
                    id="seasonId"
                    className="form-input"
                    value={seasonId}
                    onChange={(e) => setSeasonId(parseInt(e.target.value))}
                    placeholder="2026"
                    min="2020"
                    max="2030"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="espnS2" className="form-label">
                    ESPN_S2 Cookie
                  </label>
                  <input
                    type="password"
                    id="espnS2"
                    className="form-input"
                    value={espnS2}
                    onChange={(e) => setEspnS2(e.target.value)}
                    placeholder="Your ESPN_S2 cookie value"
                    required
                  />
                  <p className="form-hint">
                    Your credentials are encrypted and never stored in the browser
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="swid" className="form-label">
                    SWID Cookie
                  </label>
                  <input
                    type="password"
                    id="swid"
                    className="form-input"
                    value={swid}
                    onChange={(e) => setSwid(e.target.value)}
                    placeholder="Your SWID (with or without braces)"
                    required
                  />
                </div>

                {error && <div className="error-message">{error}</div>}

                <button type="submit" className="btn-submit" disabled={loading}>
                  {loading ? 'Connecting...' : 'Validate & Connect'}
                </button>
              </form>
            ) : (
              <div className="team-selection">
                <div className="success-message">
                  ✓ Connected to {leagueName}
                </div>

                <div className="form-group">
                  <label htmlFor="team" className="form-label">
                    Choose Your Team
                  </label>
                  <select
                    id="team"
                    className="form-input"
                    value={selectedTeam || ''}
                    onChange={(e) => setSelectedTeam(parseInt(e.target.value))}
                    required
                  >
                    <option value="">Select a team...</option>
                    {teams.map((team) => (
                      <option key={team.teamId} value={team.teamId}>
                        {team.teamName} {team.managerName ? `(${team.managerName})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {error && <div className="error-message">{error}</div>}

                <button
                  onClick={handleSelectTeam}
                  className="btn-submit"
                  disabled={loading || !selectedTeam}
                >
                  {loading ? 'Continuing...' : 'Continue'}
                </button>
              </div>
            )}
          </div>

          {/* Demo Mode Panel */}
          <div className="setup-panel demo-panel">
            <h2 className="panel-title">Try Demo Mode</h2>
            <p className="demo-description">
              Explore the full app with a <strong>real, active ESPN league</strong> — complete with actual players, teams, and live stats. No ESPN account needed.
            </p>

            <div className="demo-features">
              <div className="demo-feature">✓ View AI-powered trade suggestions</div>
              <div className="demo-feature">✓ Explore live weekly projections</div>
              <div className="demo-feature">✓ See smart streaming recommendations</div>
              <div className="demo-feature">✓ Analyze real team performance</div>
            </div>

            <p className="demo-note">
              <strong>Note:</strong> Demo mode uses a real ESPN league with live data. This is not simulated — you'll see actual players and stats from an active fantasy league.
            </p>

            {error && !connected && <div className="error-message">{error}</div>}

            <button
              onClick={handleDemoStart}
              className="btn-demo"
              disabled={loading}
            >
              {loading ? 'Starting Demo...' : 'Explore with Demo League'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

