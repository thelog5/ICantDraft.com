import { useNavigate } from 'react-router-dom';
import './Landing.css';

export default function Landing() {
  const navigate = useNavigate();

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="landing-page">
      {/* Navigation Bar */}
      <nav className="landing-nav">
        <div className="nav-content">
          <div className="nav-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ cursor: 'pointer' }}>
            <img src="/logo.png" alt="ICantDraft.com" className="nav-brand-logo" />
          </div>
          <div className="nav-links">
            <button className="nav-link" onClick={() => scrollToSection('features')}>
              Features
            </button>
            <button className="nav-link" onClick={() => scrollToSection('how-it-works')}>
              How It Works
            </button>
            <button className="nav-link-login" onClick={() => navigate('/setup')}>
              Login
            </button>
            <button className="nav-demo-btn" onClick={() => navigate('/setup?demo=1')}>
              Try Demo
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">Fantasy Basketball Analytics</div>
          <h1 className="hero-title">
            <span className="title-main">ICantDraft</span>
            <span className="title-sub">.com</span>
          </h1>
          <p className="hero-subtitle">
            Advanced 9-category analytics for ESPN Fantasy Basketball
          </p>
          <p className="hero-description">
            Make smarter roster decisions with AI-powered trade suggestions, 
            live weekly projections, intelligent streaming recommendations, and comprehensive team analysis.
          </p>
        </div>
      </section>

      {/* Main Video Demo */}
      <section className="main-video-section">
        <div className="main-video-container">
          <div className="main-video-placeholder">
            <video 
              className="main-video" 
              controls
              playsInline
            >
              <source src="/media/videos/main-demo.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      </section>

      {/* Demo Section - Prominent */}
      <section className="demo-cta-section">
        <div className="demo-cta-content">
          <div className="demo-cta-text">
            <h2 className="demo-cta-title">Try It Now with Real Data</h2>
            <p className="demo-cta-description">
              Experience the full platform instantly with a live ESPN league. No sign-up required — 
              see actual players, real stats, and all features in action. This isn't a simulation — 
              it's a real fantasy basketball league with live data from ESPN.
            </p>
            <ul className="demo-features-list">
              <li>✓ View AI-powered trade suggestions</li>
              <li>✓ Explore live weekly matchup projections</li>
              <li>✓ See smart streaming recommendations</li>
              <li>✓ Analyze real team performance data</li>
            </ul>
          </div>
          <div className="demo-cta-action">
            <button 
              className="demo-cta-button" 
              onClick={() => navigate('/setup?demo=1')}
            >
              Launch Demo
            </button>
            <p className="demo-cta-note">Takes 2 seconds • No account needed</p>
          </div>
        </div>
      </section>

      {/* Features Showcase */}
      <section id="features" className="features-showcase">
        <h2 className="section-title">Everything You Need to Dominate Your League</h2>
        <p className="section-description">
          All features use live data from ESPN — no simulations, just real players and stats.
        </p>

        {/* Feature 1: Trade Suggestions */}
        <div className="feature-showcase-item feature-layout-left">
          <div className="feature-showcase-media">
            <div className="feature-video-placeholder feature-video-trade">
              {<video 
                className="feature-video" 
                autoPlay
                loop
                muted
                playsInline
              >
                <source src="/media/videos/trade-suggestions.mp4" type="video/mp4" />
              </video> }
              <span className="placeholder-label">Trade Suggestions Demo</span>
              <p className="placeholder-text">AI-powered trade analysis with win probability calculations</p>
            </div>
          </div>
          <div className="feature-showcase-text">
            <h3 className="feature-showcase-title">AI-Powered Trade Suggestions</h3>
            <p className="feature-showcase-description">
              Stop guessing if a trade is fair. Our AI engine analyzes every possible trade combination 
              across your league, calculating win probability, category balance, and player value using 
              advanced Z-score normalization.
            </p>
            <ul className="feature-showcase-list">
              <li>Multi-factor trade analysis (1-for-1, 2-for-1, 2-for-2)</li>
              <li>Category impact breakdown for every trade</li>
              <li>Win probability calculations</li>
              <li>Trade balance and fairness scoring</li>
            </ul>
          </div>
        </div>

        {/* Feature 2: Weekly Projections */}
        <div className="feature-showcase-item feature-layout-right">
          <div className="feature-showcase-text">
            <h3 className="feature-showcase-title">Live Weekly Matchup Projections</h3>
            <p className="feature-showcase-description">
              Never be surprised by a matchup result. See projected vs live scores side-by-side, 
              identify which categories you're winning, and focus on the closest contested stats.
            </p>
            <ul className="feature-showcase-list">
              <li>Projected matchup scores for the entire week</li>
              <li>Real-time live score tracking as games happen</li>
              <li>Closest contested categories highlighted</li>
              <li>Category-by-category win/loss breakdown</li>
            </ul>
          </div>
          <div className="feature-showcase-media">
            <div className="feature-video-placeholder feature-video-weekly">
             
              {<video 
                className="feature-video" 
                autoPlay
                loop
                muted
                playsInline
              >
                <source src="/media/videos/weekly-projections.mp4" type="video/mp4" />
              </video>}
              <span className="placeholder-label">Weekly Projections Demo</span>
              <p className="placeholder-text">Projected vs Live scores with contested categories</p>
            </div>
          </div>
        </div>

        {/* Feature 3: Streaming Assistant */}
        <div className="feature-showcase-item feature-layout-left">
          <div className="feature-showcase-media">
            <div className="feature-video-placeholder feature-video-streaming">
             
              { <video 
                className="feature-video" 
                autoPlay
                loop
                muted
                playsInline
              >
                <source src="/media/videos/streaming-assistant.mp4" type="video/mp4" />
              </video> }
              <span className="placeholder-label">Streaming Assistant Demo</span>
              <p className="placeholder-text">Day-by-day waiver recommendations targeting your needs</p>
            </div>
          </div>
          <div className="feature-showcase-text">
            <h3 className="feature-showcase-title">Smart Streaming Recommendations</h3>
            <p className="feature-showcase-description">
              Maximize your waiver wire pickups. Get day-by-day streaming suggestions that target 
              your closest contested categories, with smart drop candidate rankings based on roster percentages.
            </p>
            <ul className="feature-showcase-list">
              <li>Focus categories automatically calculated from matchup</li>
              <li>Day-by-day recommendations for optimal streaming</li>
              <li>Player fit scores for each waiver target</li>
              <li>Drop candidate rankings by roster percentage</li>
            </ul>
          </div>
        </div>

        {/* Feature 4: Team Analysis */}
        <div className="feature-showcase-item feature-layout-right">
          <div className="feature-showcase-text">
            <h3 className="feature-showcase-title">Comprehensive Team Analysis</h3>
            <p className="feature-showcase-description">
              Understand your team's identity. See your power rankings, category strengths and weaknesses, 
              core players, and how you stack up against the league with advanced analytics.
            </p>
            <ul className="feature-showcase-list">
              <li>League power rankings with Z-score analysis</li>
              <li>Category strength/weakness breakdown</li>
              <li>Core player identification</li>
              <li>Team profile and punting strategy detection</li>
            </ul>
          </div>
          <div className="feature-showcase-media">
            <div className="feature-video-placeholder feature-video-team">
            
              {<video 
                className="feature-video" 
                autoPlay
                loop
                muted
                playsInline
              >
                <source src="/media/videos/team-analysis.mp4" type="video/mp4" />
              </video> }
              <span className="placeholder-label">Team Analysis Demo</span>
              <p className="placeholder-text">Power rankings and category analysis</p>
            </div>
          </div>
        </div>
      </section>

      {/* Login Section with Cookie Instructions */}
      <section id="how-it-works" className="login-section">
        <div className="login-container">
          <div className="login-left">
            <h2 className="login-title">Connect Your ESPN League</h2>
            <p className="login-intro">
              Get full access to all features by connecting your ESPN Fantasy Basketball league. 
              Your credentials are encrypted and never stored in your browser.
            </p>

            <div className="cookie-guide">
              <h3 className="cookie-guide-title">How to Find Your ESPN Cookies</h3>
              <div className="cookie-steps">
                <div className="cookie-step">
                  <div className="step-number-small">1</div>
                  <div className="step-content">
                    <p>Go to <strong>espn.com/fantasy/basketball</strong> and log in</p>
                  </div>
                </div>
                <div className="cookie-step">
                  <div className="step-number-small">2</div>
                  <div className="step-content">
                    <p>Press <strong>F12</strong> to open Developer Tools</p>
                  </div>
                </div>
                <div className="cookie-step">
                  <div className="step-number-small">3</div>
                  <div className="step-content">
                    <p>Go to <strong>Application</strong> tab (Chrome) or <strong>Storage</strong> tab (Firefox)</p>
                  </div>
                </div>
                <div className="cookie-step">
                  <div className="step-number-small">4</div>
                  <div className="step-content">
                    <p>Click <strong>Cookies</strong> → <strong>https://www.espn.com</strong></p>
                  </div>
                </div>
                <div className="cookie-step">
                  <div className="step-number-small">5</div>
                  <div className="step-content">
                    <p>Find <strong>espn_s2</strong> and <strong>SWID</strong>, copy their values</p>
                  </div>
                </div>
              </div>
              
              <div className="security-note">
                <span className="security-icon">🔒</span>
                <p>Your credentials are encrypted server-side and never stored in your browser. We only use them to fetch your league data from ESPN.</p>
              </div>
            </div>
          </div>

          <div className="login-right">
            <div className="login-form-preview">
              <h3 className="form-preview-title">Ready to Connect?</h3>
              <p className="form-preview-text">
                Once you have your cookies, connecting takes just 30 seconds.
              </p>
              <button 
                className="login-cta-button" 
                onClick={() => navigate('/setup')}
              >
                Go to Login Page
              </button>
              <div className="form-preview-visual">
                <div className="form-field-preview">
                  <div className="field-label">League ID</div>
                  <div className="field-input-preview"></div>
                </div>
                <div className="form-field-preview">
                  <div className="field-label">Season Year</div>
                  <div className="field-input-preview"></div>
                </div>
                <div className="form-field-preview">
                  <div className="field-label">ESPN_S2 Cookie</div>
                  <div className="field-input-preview"></div>
                </div>
                <div className="form-field-preview">
                  <div className="field-label">SWID Cookie</div>
                  <div className="field-input-preview"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-content">
          <div className="footer-links">
            <button onClick={() => navigate('/setup')} className="footer-link">
              Setup
            </button>
            <a href="https://github.com" className="footer-link" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </div>
          <p className="footer-copyright">
            © {new Date().getFullYear()} ICantDraft. All rights reserved.
          </p>
          <p className="footer-made-by">
            made by the log ✝
          </p>
        </div>
      </footer>
    </div>
  );
}

