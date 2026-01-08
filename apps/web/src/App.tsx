import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import WeeklyProjections from "./pages/WeeklyProjections";
import TradeSuggestions from "./pages/TradeSuggestions";
import Streaming from "./pages/Streaming";
import MyTeamAnalysis from "./pages/MyTeamAnalysis";
import Settings from "./pages/Settings";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/weekly-projections" element={<WeeklyProjections />} />
      <Route path="/trade-suggestions" element={<TradeSuggestions />} />
      <Route path="/streaming" element={<Streaming />} />
      <Route path="/team-analysis" element={<MyTeamAnalysis />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}

export default App;
