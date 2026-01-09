// Vercel serverless function entry point
// Import the compiled Express app from dist
// Note: Vercel builds the TypeScript, so we import the compiled JS
import app from "../dist/index.js";

// Export the Express app directly - Vercel handles it
export default app;
