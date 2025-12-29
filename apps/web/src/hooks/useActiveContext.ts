import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getActiveContext, ActiveContext } from "../lib/activeContext";

type UseActiveContextResult = {
  loading: boolean;
  ctx: ActiveContext | null;
};

/**
 * Hook that provides active context and redirects to settings if missing/invalid
 * (except when already on /settings or /home pages)
 */
export function useActiveContext(): UseActiveContextResult {
  const navigate = useNavigate();
  const location = useLocation();
  const [ctx, setCtx] = useState<ActiveContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const activeCtx = getActiveContext();
    
    // Don't redirect if we're already on settings or home page
    const isSettingsPage = location.pathname === "/settings";
    const isHomePage = location.pathname === "/" || location.pathname === "/home";
    
    if (!activeCtx && !isSettingsPage && !isHomePage) {
      // No valid context - redirect to settings
      navigate("/settings", { 
        replace: true,
        state: { message: "Please configure your league and team." }
      });
      setCtx(null);
    } else {
      setCtx(activeCtx);
    }
    
    setLoading(false);
  }, [navigate, location.pathname]);

  return { loading, ctx };
}

