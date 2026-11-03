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
function verifyWebhookSignature(
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
    console.warn("⚠️  Invalid webhook signature — rejecting request");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Step 2: Parse the payload
  const event = req.headers["x-github-event"] as string;
  const payload = JSON.parse((req.body as Buffer).toString());

  console.log(`\n📨 Received event: ${event} (action: ${payload.action})`);

  // Step 3: Handle only pull_request events
  if (event === "pull_request") {
    const action = payload.action;

    // We review on: opened, synchronize (new commits pushed), reopened
    if (["opened", "synchronize", "reopened"].includes(action)) {
      const pr = payload.pull_request;
      const repo = payload.repository;

      console.log(`\n🔍 PR #${pr.number}: "${pr.title}"`);
      console.log(`   📁 Repo: ${repo.full_name}`);
      console.log(`   👤 Author: ${pr.user.login}`);
      console.log(`   📊 Changes: +${pr.additions} -${pr.deletions} across ${pr.changed_files} files`);

      // Respond immediately (GitHub expects a response within 10 seconds)
      res.status(200).json({ message: "Review started" });

      // Process the review asynchronously
      try {
        await reviewPullRequest({
          owner: repo.owner.login,
          repo: repo.name,
          pullNumber: pr.number,
          installationId: payload.installation.id,
        });
        console.log(`✅ Review complete for PR #${pr.number}`);
      } catch (error) {
        console.error(`❌ Review failed for PR #${pr.number}:`, error);
      }

      return;
    }
  }

  // For all other events, just acknowledge
  res.status(200).json({ message: "Event received, no action needed" });
}

