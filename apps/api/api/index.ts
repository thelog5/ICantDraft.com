// Vercel serverless function entry point
import serverless from "serverless-http";

// Import the Express app
// Vercel compiles TypeScript, so we can import from source
import app from "../src/index.js";

// Wrap Express app with serverless-http
const handler = serverless(app, {
  binary: ['image/*', 'application/json'],
});

// Export handler with error handling
export default async (req: any, res: any) => {
  try {
    console.log(`[Serverless] ${req.method} ${req.url}`);
    return await handler(req, res);
  } catch (error) {
    console.error('[Serverless] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', message: String(error) });
    }
  }
};
