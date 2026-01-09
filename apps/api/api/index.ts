// Vercel serverless function entry point
// Vercel's @vercel/node compiles TypeScript, so we can import from source
// @ts-ignore - Vercel will compile this at runtime
import app from "../src/index.js";

// Export the Express app directly - Vercel handles it
export default app;
