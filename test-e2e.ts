import assert from "assert";
import crypto from "crypto";
import dotenv from "dotenv";
import { app } from "./src/index";
import {
  initDb,
  db,
  claimReviewJob,
  completeReviewJob,
  failReviewJob,
} from "./src/db";
import { timingSafeCompare } from "./src/auth";
import { verifyWebhookSignature } from "./src/webhook";
import { Server } from "http";

dotenv.config();

// Ensure test environment variables are set even when running in CI without a .env file
if (!process.env.DASHBOARD_PASSWORD) {
  process.env.DASHBOARD_PASSWORD = "prbot-dashboard-pass-2024";
}
if (!process.env.GITHUB_WEBHOOK_SECRET) {
  process.env.GITHUB_WEBHOOK_SECRET = "prbot-secret-2024";
}

const TEST_PORT = 3105;
const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

let testServer: Server;

async function runTestSuite() {
  console.log("================================================================================");
  console.log("PR Reviewer Bot — Phase 2 Automated Test Suite");
  console.log("================================================================================\n");

  await initDb();

  // Start test server instance
  await new Promise<void>((resolve) => {
    testServer = app.listen(TEST_PORT, () => {
      resolve();
    });
  });

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void>) {
    totalTests++;
    try {
      await fn();
      console.log(`[PASS] Test ${totalTests}: ${name}`);
      passedTests++;
    } catch (err: any) {
      console.error(`[FAIL] Test ${totalTests}: ${name}`);
      console.error(`       Error: ${err.message}\n`);
      throw err;
    }
  }

  try {
    // --------------------------------------------------------------------------
    // 1. Dashboard Authentication Tests
    // --------------------------------------------------------------------------
    console.log("--- Group 1: Dashboard Authentication ---");

    await test("Unauthenticated request to /dashboard returns HTTP 401 with Basic Auth challenge", async () => {
      const res = await fetch(`${TEST_BASE_URL}/dashboard`);
      assert.strictEqual(res.status, 401);
      const authHeader = res.headers.get("www-authenticate");
      assert.ok(authHeader && authHeader.includes("Basic"));
    });

    await test("Unauthenticated request to /api/stats returns HTTP 401 JSON", async () => {
      const res = await fetch(`${TEST_BASE_URL}/api/stats`);
      assert.strictEqual(res.status, 401);
      const data = (await res.json()) as any;
      assert.strictEqual(data.error, "Unauthorized");
    });

    await test("Invalid Basic Auth credentials returns HTTP 401", async () => {
      const badCreds = Buffer.from("admin:wrong-password").toString("base64");
      const res = await fetch(`${TEST_BASE_URL}/api/stats`, {
        headers: { Authorization: `Basic ${badCreds}` },
      });
      assert.strictEqual(res.status, 401);
    });

    await test("Invalid Bearer token returns HTTP 401", async () => {
      const res = await fetch(`${TEST_BASE_URL}/api/stats`, {
        headers: { Authorization: "Bearer bad-token-123" },
      });
      assert.strictEqual(res.status, 401);
    });

    await test("Authenticated request with valid Bearer token returns HTTP 200", async () => {
      const res = await fetch(`${TEST_BASE_URL}/api/stats`, {
        headers: { Authorization: `Bearer ${DASHBOARD_PASSWORD}` },
      });
      assert.strictEqual(res.status, 200);
      const stats = (await res.json()) as any;
      assert.ok(typeof stats.totalReviews === "number");
    });

    await test("Authenticated request with valid Basic Auth returns HTTP 200", async () => {
      const validCreds = Buffer.from(`admin:${DASHBOARD_PASSWORD}`).toString("base64");
      const res = await fetch(`${TEST_BASE_URL}/dashboard`, {
        headers: { Authorization: `Basic ${validCreds}` },
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes("ReviewPulse"));
    });

    await test("Timing-safe credential comparison works correctly and rejects unequal lengths", async () => {
      assert.strictEqual(timingSafeCompare("secret123", "secret123"), true);
      assert.strictEqual(timingSafeCompare("secret123", "secret124"), false);
      assert.strictEqual(timingSafeCompare("short", "much-longer-string"), false);
    });

    // --------------------------------------------------------------------------
    // 2. Webhook Signature Verification Tests
    // --------------------------------------------------------------------------
    console.log("\n--- Group 2: Webhook Signature Verification ---");

    await test("Invalid webhook signature is rejected with HTTP 401", async () => {
      const rawPayload = JSON.stringify({ action: "opened" });
      const res = await fetch(`${TEST_BASE_URL}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "pull_request",
          "x-hub-signature-256": "sha256=invaliddeadbeef000000000000000000000000000000000000000000000000",
        },
        body: rawPayload,
      });
      assert.strictEqual(res.status, 401);
      const data = (await res.json()) as any;
      assert.strictEqual(data.error, "Unauthorized");
    });

    await test("Valid HMAC SHA-256 webhook payload is accepted with HTTP 200", async () => {
      const rawPayload = JSON.stringify({
        action: "labeled", // non-reviewable action to test acknowledgment contract
        pull_request: { number: 999, head: { sha: "dummy-sha" } },
      });
      const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
      const signature = "sha256=" + hmac.update(Buffer.from(rawPayload)).digest("hex");

      const res = await fetch(`${TEST_BASE_URL}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signature,
        },
        body: rawPayload,
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.ok(data.message.includes("Ignored"));
    });

    // --------------------------------------------------------------------------
    // 3. Race-Safe Deduplication & Job Lifecycle Tests
    // --------------------------------------------------------------------------
    console.log("\n--- Group 3: Race-Safe Deduplication & Job Lifecycle ---");

    const testRepo = "org/test-repo";
    const testPrNumber = 42;
    const testCommitA = "commit-sha-aaaaaa" + Date.now();
    const testCommitB = "commit-sha-bbbbbb" + Date.now();

    await test("Initial claim for a new commit SHA succeeds with status RUNNING", async () => {
      const claim = await claimReviewJob({
        repo: testRepo,
        prNumber: testPrNumber,
        commitSha: testCommitA,
        prTitle: "Test PR 42",
        author: "alice",
      });

      assert.strictEqual(claim.claimed, true);
      assert.strictEqual(claim.status, "RUNNING");
      assert.ok(claim.jobId > 0);
    });

    await test("Duplicate claim for the same commit SHA is rejected without re-executing", async () => {
      const claimDup = await claimReviewJob({
        repo: testRepo,
        prNumber: testPrNumber,
        commitSha: testCommitA,
        prTitle: "Test PR 42 Duplicate",
        author: "alice",
      });

      assert.strictEqual(claimDup.claimed, false);
      assert.strictEqual(claimDup.status, "RUNNING");
    });

    await test("Concurrent duplicate webhook claims: exactly 1 wins, all others fail claim", async () => {
      const concurrentCommit = "commit-concurrent-" + Date.now();
      const concurrencyLevel = 5;

      const promises = Array.from({ length: concurrencyLevel }).map(() =>
        claimReviewJob({
          repo: testRepo,
          prNumber: 88,
          commitSha: concurrentCommit,
          prTitle: "Concurrent PR",
          author: "bob",
        })
      );

      const results = await Promise.all(promises);
      const claimedCount = results.filter((r) => r.claimed).length;
      const rejectedCount = results.filter((r) => !r.claimed).length;

      assert.strictEqual(claimedCount, 1, "Exactly one caller must win the atomic claim");
      assert.strictEqual(rejectedCount, concurrencyLevel - 1, "All concurrent callers must be rejected");
    });

    await test("New commit SHA on the same PR successfully triggers a fresh review claim", async () => {
      const claimB = await claimReviewJob({
        repo: testRepo,
        prNumber: testPrNumber,
        commitSha: testCommitB,
        prTitle: "Test PR 42 New Commit",
        author: "alice",
      });

      assert.strictEqual(claimB.claimed, true);
      assert.strictEqual(claimB.status, "RUNNING");
    });

    await test("Deduplication is properly scoped to repo + PR + commit_sha", async () => {
      // Same commit SHA on a different repo must succeed
      const diffRepoClaim = await claimReviewJob({
        repo: "different-org/test-repo",
        prNumber: testPrNumber,
        commitSha: testCommitA,
        prTitle: "Different Repo Same SHA",
        author: "alice",
      });
      assert.strictEqual(diffRepoClaim.claimed, true);

      // Same commit SHA on a different PR in the same repo must succeed
      const diffPrClaim = await claimReviewJob({
        repo: testRepo,
        prNumber: 9999,
        commitSha: testCommitA,
        prTitle: "Different PR Same SHA",
        author: "alice",
      });
      assert.strictEqual(diffPrClaim.claimed, true);
    });

    await test("Job completion records model_used, status COMPLETED, and telemetry", async () => {
      const testJobCommit = "commit-complete-" + Date.now();
      const claim = await claimReviewJob({
        repo: testRepo,
        prNumber: 101,
        commitSha: testJobCommit,
        prTitle: "Completion Test",
        author: "charlie",
      });

      assert.strictEqual(claim.claimed, true);

      await completeReviewJob(claim.jobId, {
        assessment: "APPROVE",
        summary: "Clean code",
        commentCount: 0,
        criticalCount: 0,
        suggestionCount: 0,
        nitCount: 0,
        durationMs: 1450,
        findings: "[]",
        modelUsed: "gemini-3.5-flash",
      });

      const rowResult = await db.execute({
        sql: `SELECT status, model_used, assessment FROM reviews WHERE id = ?`,
        args: [claim.jobId],
      });

      assert.strictEqual(rowResult.rows[0].status, "COMPLETED");
      assert.strictEqual(rowResult.rows[0].model_used, "gemini-3.5-flash");
      assert.strictEqual(rowResult.rows[0].assessment, "APPROVE");
    });

    await test("Controlled retry: previously FAILED job is re-claimable and transitions to RUNNING", async () => {
      const failCommit = "commit-fail-retry-" + Date.now();
      const claim1 = await claimReviewJob({
        repo: testRepo,
        prNumber: 202,
        commitSha: failCommit,
        prTitle: "Failure Retry Test",
        author: "dave",
      });

      assert.strictEqual(claim1.claimed, true);

      // Mark as FAILED
      await failReviewJob(claim1.jobId, "Simulated upstream provider timeout");

      // Verify status is FAILED
      const checkFail = await db.execute({
        sql: `SELECT status, error_message FROM reviews WHERE id = ?`,
        args: [claim1.jobId],
      });
      assert.strictEqual(checkFail.rows[0].status, "FAILED");
      assert.ok(String(checkFail.rows[0].error_message).includes("Simulated"));

      // Controlled retry: attempt to claim again
      const claimRetry = await claimReviewJob({
        repo: testRepo,
        prNumber: 202,
        commitSha: failCommit,
        prTitle: "Failure Retry Test",
        author: "dave",
      });

      assert.strictEqual(claimRetry.claimed, true, "FAILED job must be re-claimable for retry");
      assert.strictEqual(claimRetry.status, "RUNNING");
      assert.strictEqual(claimRetry.jobId, claim1.jobId);
    });

    await test("Database failure during job creation throws operational error safely", async () => {
      await assert.rejects(
        async () => {
          // Pass null for NOT NULL column to induce database operational error
          await claimReviewJob({
            repo: null as any,
            prNumber: 999,
            commitSha: "corrupt-sha",
            prTitle: "Corrupt",
            author: "attacker",
          });
        },
        (err: any) => {
          return (
            String(err.message).includes("NOT NULL") ||
            String(err.message).includes("SQLITE") ||
            err.name === "LibsqlError"
          );
        }
      );
    });

    // --------------------------------------------------------------------------
    // Summary
    // --------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log(`ALL TESTS PASSED: ${passedTests} / ${totalTests} test cases succeeded cleanly!`);
    console.log("================================================================================");
  } finally {
    testServer.close();
  }
}

runTestSuite().catch((err) => {
  console.error("\n[FATAL] Test Suite Aborted with Error:", err);
  if (testServer) testServer.close();
  process.exit(1);
});
