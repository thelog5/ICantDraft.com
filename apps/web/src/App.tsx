import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from "react-router-dom";
const Landing = lazy(() => import("./pages/Landing"));
const Setup = lazy(() => import("./pages/Setup"));
const Home = lazy(() => import("./pages/Home"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const WeeklyProjections = lazy(() => import("./pages/WeeklyProjections"));
const TradeSuggestions = lazy(() => import("./pages/TradeSuggestions"));
const Streaming = lazy(() => import("./pages/Streaming"));
const MyTeamAnalysis = lazy(() => import("./pages/MyTeamAnalysis"));
const Settings = lazy(() => import("./pages/Settings"));

function App() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem", textAlign: "center" }} role="status">Loading your workspace…</div>}><Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/setup" element={<Setup />} />
      
      {/* App routes (activeContext based) */}
      <Route path="/home" element={<Home />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/weekly-projections" element={<WeeklyProjections />} />
      <Route path="/trade-suggestions" element={<TradeSuggestions />} />
      <Route path="/streaming" element={<Streaming />} />
      <Route path="/team-analysis" element={<MyTeamAnalysis />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  );
}

export default App;
