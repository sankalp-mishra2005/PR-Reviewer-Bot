import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import fs from "fs";

/**
 * Create an authenticated Octokit instance for a specific installation.
 *
 * HOW GITHUB APP AUTH WORKS (interview talking point):
 * 1. Your app has a private key (downloaded when you created the app)
 * 2. You use the key to create a JWT (JSON Web Token)
 * 3. You exchange the JWT for an installation access token
 * 4. The token lets you act as the app on that specific repo
 *
 * The Octokit SDK handles all of this for us automatically.
 */
export function createOctokitClient(installationId: number): Octokit {
  let privateKey: string;

  // Support reading private key directly from environment variable (ideal for cloud deployments)
  if (process.env.GITHUB_PRIVATE_KEY) {
    const rawKey = process.env.GITHUB_PRIVATE_KEY.trim();
    if (rawKey.includes("BEGIN RSA PRIVATE KEY") || rawKey.includes("BEGIN PRIVATE KEY")) {
      privateKey = rawKey.replace(/\\n/g, "\n");
    } else {
      // Handle base64 encoded private key
      try {
        const decoded = Buffer.from(rawKey, "base64").toString("utf-8");
        privateKey = decoded.includes("PRIVATE KEY") ? decoded : rawKey.replace(/\\n/g, "\n");
      } catch {
        privateKey = rawKey.replace(/\\n/g, "\n");
      }
    }
  } else {
    // Fall back to reading from local filesystem path
    const privateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH || "./private-key.pem";
    privateKey = fs.readFileSync(privateKeyPath, "utf-8");
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID!,
      privateKey,
      installationId,
    },
  });
}

