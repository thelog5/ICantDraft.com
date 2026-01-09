import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthContextType {
  authenticated: boolean;
  mode: 'espn' | 'demo' | null;
  leagueId: string | null;
  teamId: string | null;
  leagueName: string | null;
  teamName: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [mode, setMode] = useState<'espn' | 'demo' | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const response = await fetch('http://localhost:3001/auth/me', {
        credentials: 'include',
      });

      if (!response.ok) {
        setAuthenticated(false);
        setLoading(false);
        return;
      }

      const data = await response.json();

      if (data.authenticated) {
        setAuthenticated(true);
        setMode(data.mode);
        setLeagueId(data.leagueId);
        setTeamId(data.teamId);
        setLeagueName(data.leagueName);
        setTeamName(data.teamName);
      } else {
        setAuthenticated(false);
      }
    } catch (error) {
      console.error('[Auth] Error checking authentication:', error);
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch('http://localhost:3001/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });

      setAuthenticated(false);
      setMode(null);
      setLeagueId(null);
      setTeamId(null);
      setLeagueName(null);
      setTeamName(null);
    } catch (error) {
      console.error('[Auth] Error logging out:', error);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        mode,
        leagueId,
        teamId,
        leagueName,
        teamName,
        loading,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

