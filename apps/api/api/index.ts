// Vercel serverless function entry point
// This file at apps/api/api/index.ts is auto-detected by Vercel when Root Directory is apps/api
import serverless from "serverless-http";
// Import from built dist file - Vercel compiles TypeScript automatically
import { app } from "../dist/index.js";

export default serverless(app);
