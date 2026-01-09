// Vercel serverless function entry point
// This file at apps/api/api/index.ts is auto-detected by Vercel when Root Directory is apps/api
import serverless from "serverless-http";
import { app } from "../src/index.js";

export default serverless(app);
