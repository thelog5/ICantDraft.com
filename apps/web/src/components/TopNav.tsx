import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getActiveContext } from "../lib/activeContext";
import "./TopNav.css";

type TopNavProps = {
  children: ReactNode;
};

export default function TopNav({ children }: TopNavProps) {
  const location = useLocation();
  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);

  useEffect(() => {
    const ctx = getActiveContext();
    if (ctx) {
      if (ctx.leagueName) setLeagueName(ctx.leagueName);
      if (ctx.teamName) setTeamName(ctx.teamName);
    }
  }, [location.pathname]); // Re-check on route change

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="topnav-layout">
      <header className="topnav-header">
        <div className="topnav-left">
          <Link to="/" className="topnav-logo">
            <img src="/logo.png" alt="ICantDraft.com" className="logo-image" />
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
        </div>
      </header>
      <main className="topnav-main">{children}</main>
    </div>
  );
}

