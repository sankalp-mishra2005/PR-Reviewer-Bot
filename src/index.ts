import express from "express";
import dotenv from "dotenv";
import { handleWebhook } from "./webhook";
import { initDb } from "./db";
import { dashboardRouter } from "./dashboard";
const SmeeClient = require("smee-client");

// Prevent unhandled promise rejections from crashing the server on network disconnects
process.on("unhandledRejection", (reason: any) => {
  console.warn("⚠️ Unhandled rejection caught:", reason?.message || reason);
});

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get("/", (_req, res) => {
  res.json({
    status: "PR Reviewer Bot is running!",
    version: "1.0.0",
    dashboard: `http://localhost:${PORT}/dashboard`,
    timestamp: new Date().toISOString(),
  });
});

// Mount Phase 4 Observability Dashboard & Analytics API
app.use(dashboardRouter);

// Webhook endpoint - receives raw body for signature verification
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

// Initialize database and start server
async function bootstrap() {
  await initDb();
  console.log("📦 SQLite database initialized (reviews.db)");

  app.listen(PORT, () => {
    console.log("=".repeat(50));
    console.log("PR Reviewer Bot (Phase 4 — Production Ready)");
    console.log("=".repeat(50));
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard UI:   http://localhost:${PORT}/dashboard`);
    console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || "development"}`);

    if (process.env.SMEE_URL) {
      try {
        const smee = new SmeeClient({
          source: process.env.SMEE_URL,
          target: `http://localhost:${PORT}/webhook`,
          logger: console,
        });
        const events = smee.start();
        if (events && typeof events.on === "function") {
          events.on("error", (err: any) => {
            console.warn("⚠️ Smee event stream warning:", err?.message || err);
          });
        }
        console.log(`🌐 Smee forwarding: ${process.env.SMEE_URL} -> http://localhost:${PORT}/webhook`);
      } catch (smeeErr: any) {
        console.warn("⚠️ Could not start Smee tunnel:", smeeErr?.message || smeeErr);
      }
    }

    console.log("=".repeat(50));
    console.log("");
    console.log("Waiting for GitHub webhook events...");
  });
}

bootstrap().catch((err) => {
  console.error("❌ Failed to start server:", err);
});
