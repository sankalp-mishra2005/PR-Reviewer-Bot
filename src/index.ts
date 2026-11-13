import express from "express";
import dotenv from "dotenv";
import { handleWebhook } from "./webhook";
import { initDb } from "./db";
import { dashboardRouter } from "./dashboard";
const SmeeClient = require("smee-client");

// Load environment variables before setting up middleware
dotenv.config();

// Process-level failure monitoring: fail fast in production rather than silently continuing in an invalid state
process.on("unhandledRejection", (reason: any) => {
  console.error("[FATAL] Unhandled Promise Rejection:", reason?.stack || reason);
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
});

process.on("uncaughtException", (error: Error) => {
  console.error("[FATAL] Uncaught Exception:", error.stack || error);
  process.exit(1);
});

export const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint (Public)
app.get("/", (_req, res) => {
  res.json({
    status: "PR Reviewer Bot is running!",
    version: "2.0.0",
    dashboard: `http://localhost:${PORT}/dashboard`,
    timestamp: new Date().toISOString(),
  });
});

// Mount Authenticated Observability Dashboard & Analytics API (/dashboard and /api/*)
app.use(dashboardRouter);

// Webhook endpoint - receives raw body for HMAC signature verification
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

// Express Centralized Error Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`[ERROR] Unhandled error during ${req.method} ${req.path}:`, err?.stack || err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    error: err.name || "InternalServerError",
    message: err.message || "An unexpected error occurred",
  });
});

// Initialize database and start server
async function bootstrap() {
  await initDb();
  console.log("[INFO] SQLite database initialized (reviews.db)");

  const server = app.listen(PORT, () => {
    console.log("=".repeat(50));
    console.log("PR Reviewer Bot — Service Gateway (v2.0)");
    console.log("=".repeat(50));
    console.log(`[INFO] Server listening on http://localhost:${PORT}`);
    console.log(`[INFO] Dashboard UI:    http://localhost:${PORT}/dashboard`);
    console.log(`[INFO] Webhook route:   http://localhost:${PORT}/webhook`);
    console.log(`[INFO] Environment:     ${process.env.NODE_ENV || "development"}`);

    if (process.env.SMEE_URL) {
      try {
        const smee = new SmeeClient({
          source: process.env.SMEE_URL,
          target: `http://localhost:${PORT}/webhook`,
          logger: console,
        });
        const events = smee.start();
        if (events) {
          if (typeof events.on === "function") {
            events.on("error", (err: any) => {
              console.warn("[WARN] Smee event stream warning:", err?.message || err);
            });
          }
          events.onerror = (err: any) => {
            console.warn("[WARN] Smee tunnel connection warning:", err?.message || err);
          };
        }
        console.log(`[INFO] Smee proxy forwarding: ${process.env.SMEE_URL} -> http://localhost:${PORT}/webhook`);
      } catch (smeeErr: any) {
        console.warn("[WARN] Could not start Smee tunnel:", smeeErr?.message || smeeErr);
      }
    }

    console.log("=".repeat(50));
    console.log("[INFO] Listening for incoming GitHub webhook events...");
  });

  // Graceful shutdown handling
  const handleShutdown = (signal: string) => {
    console.log(`\n[INFO] Received ${signal}. Shutting down HTTP server gracefully...`);
    server.close(() => {
      console.log("[INFO] HTTP server closed cleanly.");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("[ERROR] Forced shutdown after timeout.");
      process.exit(1);
    }, 5000).unref();
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
}

// Start server only when executed directly, not when imported by test suites
if (require.main === module) {
  bootstrap();
}
