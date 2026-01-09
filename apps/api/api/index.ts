// Vercel serverless function entry point
import serverless from "serverless-http";

// Import the Express app
// Vercel compiles TypeScript, so we can import from source
import app from "../src/index.js";

// Wrap Express app with serverless-http
const handler = serverless(app);

export default handler;
