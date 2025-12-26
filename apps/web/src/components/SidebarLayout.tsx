import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import "./SidebarLayout.css";

const LEAGUE_ID_KEY = "icantdraft_league_id";
const MY_TEAM_ID_KEY = "icantdraft_my_team_id";

type SidebarLayoutProps = {
  children: ReactNode;
  leagueId?: string;
  leagueName?: string;
  onRefresh?: () => void;
};

export default function SidebarLayout({
  children,
  leagueId,
  leagueName,
  onRefresh,
}: SidebarLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const handleRefresh = async () => {
    if (onRefresh) {
      try {
        await api.refreshEspnData();
        onRefresh();
      } catch (err) {
        console.error("Failed to refresh:", err);
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(LEAGUE_ID_KEY);
    localStorage.removeItem(MY_TEAM_ID_KEY);
    navigate("/");
  };

  return (
    <div className="sidebar-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Link to="/" className="sidebar-logo">
            <span className="logo-icon">🏀</span>
            <span className="logo-text">ICantDraft.com</span>
          </Link>
        </div>
        <nav className="sidebar-nav">
          <Link
            to="/dashboard"
            className={`sidebar-nav-item ${isActive("/dashboard") ? "active" : ""}`}
          >
            Dashboard
          </Link>
          <Link
            to="/rankings"
            className={`sidebar-nav-item ${isActive("/rankings") ? "active" : ""}`}
          >
            Rankings
          </Link>
          <Link
            to="/team"
            className={`sidebar-nav-item ${isActive("/team") ? "active" : ""}`}
          >
            My Team
          </Link>
        </nav>
      </aside>
      <div className="main-wrapper">
        <header className="topbar">
          <div className="topbar-left">
            {leagueName && (
              <div className="topbar-league">
                <span className="topbar-label">League:</span>
                <span className="topbar-value">{leagueName}</span>
              </div>
            )}
          </div>
          <div className="topbar-right">
            {leagueId && (
              <>
                <button className="topbar-refresh" onClick={handleRefresh}>
                  Refresh Data
                </button>
                <button className="topbar-logout" onClick={handleLogout}>
                  Change League
                </button>
              </>
            )}
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}

export function getStoredLeagueId(): string | null {
  return localStorage.getItem(LEAGUE_ID_KEY);
}

export function getStoredMyTeamId(): string | null {
  return localStorage.getItem(MY_TEAM_ID_KEY);
}

export function setStoredLeagueId(leagueId: string): void {
  localStorage.setItem(LEAGUE_ID_KEY, leagueId);
}

export function setStoredMyTeamId(teamId: string): void {
  localStorage.setItem(MY_TEAM_ID_KEY, teamId);
}

