import { Request, Response, NextFunction } from 'express';
import { getSessionWithCredentials } from '../lib/sessionManager.js';

/**
 * Middleware to require authentication
 * Attaches session data to req
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies?.sid;
  
  if (!sessionId) {
    return res.status(401).json({
      error: 'Not authenticated',
      message: 'Please log in to access this resource',
    });
  }

  const session = await getSessionWithCredentials(sessionId);
  
  if (!session) {
    res.clearCookie('sid');
    return res.status(401).json({
      error: 'Session expired',
      message: 'Your session has expired. Please log in again.',
    });
  }

  // Attach session to request
  (req as any).session = session;
  
  next();
}

/**
 * Middleware to optionally check auth (doesn't fail if not authenticated)
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies?.sid;
  
  if (sessionId) {
    const session = await getSessionWithCredentials(sessionId);
    if (session) {
      (req as any).session = session;
    } else {
      res.clearCookie('sid');
    }
  }
  
  next();
}

