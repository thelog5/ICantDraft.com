import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getActiveContext } from "../lib/activeContext";
import { api } from "../lib/api";
import "./TopNav.css";

type TopNavProps = {
  children: ReactNode;
  onRefresh?: () => void;
};

export default function TopNav({ children, onRefresh }: TopNavProps) {
  const location = useLocation();
  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const ctx = getActiveContext();
    if (ctx) {
      if (ctx.leagueName) setLeagueName(ctx.leagueName);
      if (ctx.teamName) setTeamName(ctx.teamName);
    }
  }, [location.pathname]); // Re-check on route change

  const handleRefresh = async () => {
    if (onRefresh) {
      setRefreshing(true);
      try {
        await api.refreshEspnData();
        onRefresh();
      } catch (err) {
        console.error("Refresh failed:", err);
      } finally {
        setRefreshing(false);
      }
    }
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="topnav-layout">
      <header className="topnav-header">
        <div className="topnav-left">
          <Link to="/dashboard" className="topnav-logo">
            <span className="logo-icon">🏀</span>
            <span className="logo-text">ICantDraft.com</span>
          </Link>
          <nav className="topnav-tabs">
            <Link
              to="/dashboard"
              className={`topnav-tab ${isActive("/dashboard") ? "active" : ""}`}
            >
              Home
            </Link>
            <Link
              to="/weekly-projections"
              className={`topnav-tab ${isActive("/weekly-projections") ? "active" : ""}`}
            >
              Weekly Projections
            </Link>
            <Link
              to="/punt-strategy"
              className={`topnav-tab ${isActive("/punt-strategy") ? "active" : ""}`}
            >
              Punt Strategy
            </Link>
            <Link
              to="/team-analysis"
              className={`topnav-tab ${isActive("/team-analysis") ? "active" : ""}`}
            >
              Team Analysis
            </Link>
            <Link
              to="/trade-suggestions"
              className={`topnav-tab ${isActive("/trade-suggestions") ? "active" : ""}`}
            >
              Trade Suggestions
            </Link>
            <Link
              to="/streaming"
              className={`topnav-tab ${isActive("/streaming") ? "active" : ""}`}
            >
              Streaming
            </Link>
            <Link
              to="/pickups"
              className={`topnav-tab ${isActive("/pickups") ? "active" : ""}`}
            >
              Pickups
            </Link>
            <Link
              to="/settings"
              className={`topnav-tab ${isActive("/settings") ? "active" : ""}`}
            >
              Settings
            </Link>
          </nav>
        </div>
        <div className="topnav-right">
          {leagueName && (
            <div className="topnav-league">
              <span className="topnav-league-label">League:</span>
              <span className="topnav-league-name">{leagueName}</span>
            </div>
          )}
          {teamName && (
            <div className="topnav-team">
              <span className="topnav-team-label">My Team:</span>
              <span className="topnav-team-name">{teamName}</span>
            </div>
          )}
          {onRefresh && (
            <button
              className="topnav-refresh"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh ESPN Data"}
            </button>
          )}
        </div>
      </header>
      <main className="topnav-main">{children}</main>
    </div>
  );
}

