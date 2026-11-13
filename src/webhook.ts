import crypto from "crypto";
import { Request, Response } from "express";
import { reviewPullRequest } from "./reviewer";

/**
 * Verify that the webhook payload actually came from GitHub.
 * GitHub signs every webhook with HMAC SHA-256 using your secret.
 *
 * WHY THIS MATTERS (interview talking point):
 * Without this, anyone who knows your webhook URL could send fake
 * events and trick your bot into posting spam comments on PRs.
 */
export function verifyWebhookSignature(
  payload: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  const digest = "sha256=" + hmac.update(payload).digest("hex");

  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

/**
 * Main webhook handler.
 * GitHub sends different event types — we only care about
 * pull_request events with specific actions.
 */
export async function handleWebhook(
  req: Request,
  res: Response
): Promise<void> {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("❌ GITHUB_WEBHOOK_SECRET not set!");
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  // Step 1: Verify the webhook signature
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const isValid = verifyWebhookSignature(
    req.body as Buffer,
    signature,
    webhookSecret
  );

  if (!isValid) {
    console.warn("[SECURITY] Invalid webhook signature rejected");
    res.status(401).json({ error: "Unauthorized", message: "Invalid webhook signature" });
    return;
  }

  // Step 2: Parse the payload
  const event = req.headers["x-github-event"] as string;
  const payload = JSON.parse((req.body as Buffer).toString());

  console.log(`\n[INFO] Webhook received: ${event} (action: ${payload.action})`);

  // Step 3: Handle only pull_request events
  if (event === "pull_request") {
    const action = payload.action;

    // We review on: opened, synchronize (new commits pushed), reopened
    if (["opened", "synchronize", "reopened"].includes(action)) {
      const pr = payload.pull_request;
      const repo = payload.repository;

      console.log(`[INFO] Processing PR #${pr.number}: "${pr.title}"`);
      console.log(`       Repository: ${repo.full_name}`);
      console.log(`       Author:     ${pr.user.login}`);
      console.log(`       Diff stats: +${pr.additions} -${pr.deletions} across ${pr.changed_files} files`);

      // Respond immediately to GitHub (webhook acknowledgment contract)
      res.status(200).json({
        message: "Webhook accepted; review pipeline dispatched",
        pr: pr.number,
        commit: pr.head.sha,
      });

      // Process the review asynchronously
      try {
        await reviewPullRequest({
          owner: repo.owner.login,
          repo: repo.name,
          pullNumber: pr.number,
          installationId: payload.installation.id,
        });
        console.log(`[INFO] Review pipeline complete for PR #${pr.number}`);
      } catch (error: any) {
        if (error.name === "HttpError") {
          console.error(`[ERROR] [GitHub API Failure] PR #${pr.number}: HTTP ${error.status} - ${error.message}`);
        } else if (String(error.message).includes("Gemini") || String(error.message).includes("models")) {
          console.error(`[ERROR] [AI Provider Failure] PR #${pr.number}: ${error.message}`);
        } else if (String(error.message).includes("SQLITE") || error.name === "LibsqlError") {
          console.error(`[ERROR] [Database Failure] PR #${pr.number}: ${error.message}`);
        } else {
          console.error(`[ERROR] [Pipeline Failure] PR #${pr.number}:`, error.stack || error.message || error);
        }
      }

      return;
    }

    console.log(`[INFO] Ignored non-reviewable pull_request action: ${action}`);
    res.status(200).json({ message: `Ignored non-reviewable pull_request action: ${action}` });
    return;
  }

  // For all other events, just acknowledge
  res.status(200).json({ message: "Event received, no action needed" });
}

