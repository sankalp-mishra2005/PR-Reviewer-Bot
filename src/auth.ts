import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Perform a constant-time comparison of two strings to prevent timing side-channel attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    // Perform dummy timing-safe comparison on bufA to equalize branch timing
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authentication middleware for dashboard and telemetry API routes.
 *
 * Supports:
 *  1. Bearer Token: Authorization: Bearer <DASHBOARD_PASSWORD>
 *  2. HTTP Basic Auth: Authorization: Basic <base64(username:DASHBOARD_PASSWORD)>
 *
 * Returns HTTP 401 with WWW-Authenticate header for browser challenges
 * or JSON response for API clients.
 */
export function requireDashboardAuth(req: Request, res: Response, next: NextFunction): void {
  // Only enforce dashboard authentication on /dashboard and /api/* routes
  // The /webhook route has its own HMAC SHA-256 verification and health check is public
  const isProtectedRoute = req.path.startsWith("/dashboard") || req.path.startsWith("/api");
  if (!isProtectedRoute) {
    return next();
  }

  const configuredPassword = process.env.DASHBOARD_PASSWORD;

  if (!configuredPassword) {
    console.error("[SECURITY] DASHBOARD_PASSWORD is not set in environment. Access denied.");
    res.status(500).json({
      error: "ConfigurationError",
      message: "DASHBOARD_PASSWORD is not configured on the server.",
    });
    return;
  }

  const authHeader = req.headers["authorization"] || "";

  // 1. Check Bearer Token
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && timingSafeCompare(token, configuredPassword)) {
      return next();
    }
  }

  // 2. Check HTTP Basic Authentication
  if (authHeader.startsWith("Basic ")) {
    const b64 = authHeader.slice(6).trim();
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      const colonIndex = decoded.indexOf(":");
      const password = colonIndex !== -1 ? decoded.slice(colonIndex + 1) : decoded;

      if (password && timingSafeCompare(password, configuredPassword)) {
        return next();
      }
    } catch {
      // Malformed base64
    }
  }

  // Unauthenticated / Invalid credentials
  const isApiRequest =
    req.path.startsWith("/api") || (req.headers.accept && req.headers.accept.includes("application/json"));

  if (isApiRequest) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required. Provide valid Bearer token or Basic Auth credentials.",
    });
    return;
  }

  // Browser HTML challenge
  res
    .set("WWW-Authenticate", 'Basic realm="PR Reviewer Dashboard", charset="UTF-8"')
    .status(401)
    .send(
      "<!DOCTYPE html><html><body style='font-family:sans-serif;background:#08090d;color:#eee;padding:40px;text-align:center'><h2>401 Unauthorized</h2><p>Authentication is required to access this dashboard.</p></body></html>"
    );
}
