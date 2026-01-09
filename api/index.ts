// Vercel serverless function entry point
// This file at repo-root/api/index.ts is auto-detected by Vercel
import serverless from "serverless-http";
import { app } from "../apps/api/src/index.js";

export default serverless(app);

