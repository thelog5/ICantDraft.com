import { ReactNode, useLayoutEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { getActiveContext } from "../lib/activeContext";
import Icon from "./Icon";
import "./TopNav.css";
import "./Product.css";

const views = [
  ["/dashboard", "Overview"],
  ["/weekly-projections", "Weekly Projections"],
  ["/team-analysis", "Team Analysis"],
  ["/trade-suggestions", "Trade Suggestions"],
  ["/streaming", "Streaming"],
  ["/settings", "Settings"],
];
export default function TopNav({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && active) nav.scrollLeft = active.offsetLeft - nav.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2;
  }, [pathname]);
  const ctx = getActiveContext();
  const sample = ctx?.leagueKeyInput === "sample-demo";
  return (
    <div className="topnav-layout">
      <a className="skip-to-content" href="#product-content">Skip to content</a>
      <header className="topnav-header">
        <div className="topnav-brand-row">
          <Link to="/" className="topnav-logo" aria-label="ICantDraft.com home">
            <img src="/wordmark.png" alt="ICantDraft.com" className="logo-image" />
          </Link>
          <div className="topnav-sport"><Icon name="ball" size={17} /><span>FANTASY BASKETBALL</span><span className="sport-format">9-CAT</span></div>
          <Link to="/settings" className="topnav-account"><span className="account-avatar">{ctx?.teamName?.slice(0, 2).toUpperCase() || 'IC'}</span><span>My workspace</span></Link>
        </div>
        <nav ref={navRef} className="topnav-tabs" aria-label="Product navigation">
          {views.map(([path, label]) => <Link key={path} to={path} aria-current={pathname === path ? "page" : undefined} className={`topnav-tab ${pathname === path ? "active" : ""}`}>{label}</Link>)}
        </nav>
      </header>
      <div className="workspace-context">
        <div className="workspace-context-inner">
          <div className="context-league"><span className="context-label">YOUR LEAGUE</span><strong>{ctx?.leagueName || "Fantasy workspace"}</strong><span className="context-divider"/><span className="context-team">{ctx?.teamName || "Select your team"}</span></div>
          <div className="context-status"><span className="status-dot"/>{sample ? "SAMPLE DATA" : "ESPN LEAGUE"}{sample && <span className="sample-caption">Archived stats · Illustrative schedules</span>}</div>
        </div>
      </div>
      <main id="product-content" className="topnav-main" tabIndex={-1}>{children}</main>
      <footer className="product-footer"><span>ICANTDRAFT<span className="brand-red">.COM</span></span><span>Know your roster. Own your league.</span><span>Fantasy basketball intelligence</span></footer>
    </div>
  );
}
