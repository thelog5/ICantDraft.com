// Vercel serverless function entry point
// Vercel's @vercel/node can handle Express apps directly
import app from "../src/index.js";

// Export the Express app directly - Vercel handles it
export default app;
