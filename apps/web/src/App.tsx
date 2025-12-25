import { Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import TeamProfile from "./pages/TeamProfile";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/league/:leagueId/team/:teamId" element={<TeamProfile />} />
    </Routes>
  );
}

export default App;

