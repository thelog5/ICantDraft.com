import { ReactNode } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import "./Layout.css";

type LayoutProps = {
  children: ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  const { leagueId } = useParams<{ leagueId: string }>();
  const location = useLocation();
  const hasLeague = !!leagueId;

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="navbar-left">
          <Link to="/" className="navbar-brand">
            DraftSite
          </Link>
        </div>
        {hasLeague && (
          <div className="navbar-tabs">
            <Link
              to={`/leagues/${leagueId}`}
              className={`navbar-tab ${isActive(`/leagues/${leagueId}`) ? "active" : ""}`}
            >
              Overview
            </Link>
            <Link
              to={`/leagues/${leagueId}/power-rankings`}
              className={`navbar-tab ${isActive(`/leagues/${leagueId}/power-rankings`) ? "active" : ""}`}
            >
              Power Rankings
            </Link>
            <Link
              to={`/leagues/${leagueId}/teams`}
              className={`navbar-tab ${isActive(`/leagues/${leagueId}/teams`) ? "active" : ""}`}
            >
              Teams
            </Link>
            <Link
              to={`/leagues/${leagueId}/free-agents`}
              className={`navbar-tab ${isActive(`/leagues/${leagueId}/free-agents`) ? "active" : ""}`}
            >
              Free Agents
            </Link>
          </div>
        )}
      </nav>
      <main className="main-content">{children}</main>
    </div>
  );
}

