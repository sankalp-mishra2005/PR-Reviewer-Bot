import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

async function runE2ETest() {
  console.log("==========================================");
  console.log("[TEST] Running End-to-End Integration Suite");
  console.log("==========================================");

  const secret = process.env.GITHUB_WEBHOOK_SECRET || "prbot-secret-2024";

  // Simulate pull_request.opened event for sankalp-mishra2005/society-maintenance #1
  const payload = JSON.stringify({
    action: "synchronize",
    pull_request: {
      number: 1,
      title: "Add user auth controller & JWT validation",
      user: { login: "sankalp-mishra2005" },
      additions: 28,
      deletions: 0,
      changed_files: 2,
    },
    repository: {
      name: "society-maintenance",
      full_name: "sankalp-mishra2005/society-maintenance",
      owner: { login: "sankalp-mishra2005" },
    },
    installation: {
      id: 181190393, // Your real GitHub App installation ID
    },
  });

  const hmac = crypto.createHmac("sha256", secret);
  const signature = "sha256=" + hmac.update(Buffer.from(payload)).digest("hex");

  console.log("1. Sending valid HMAC-signed webhook to http://localhost:3000/webhook...");
  const res = await fetch("http://localhost:3000/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "pull_request",
      "x-hub-signature-256": signature,
    },
    body: payload,
  });

  const resJson = await res.json();
  console.log(`   Response (${res.status}):`, resJson);

  if (res.status !== 200) {
    throw new Error(`Webhook rejected with status ${res.status}`);
  }

  console.log("2. Waiting 15 seconds for Gemini to analyze diff and record telemetry in SQLite...");
  await new Promise((resolve) => setTimeout(resolve, 15000));

  console.log("3. Querying /api/stats to verify live database state...");
  const statsRes = await fetch("http://localhost:3000/api/stats");
  const stats = await statsRes.json();
  console.log("   Stats:", stats);

  console.log("4. Querying /api/reviews to verify review records...");
  const reviewsRes = await fetch("http://localhost:3000/api/reviews");
  const reviews = (await reviewsRes.json()) as any[];
  console.log("   Reviews recorded:", reviews.length);
  if (reviews.length > 0) {
    console.log("   Latest Review Record:", {
      repo: reviews[0].repo,
      pr: `#${reviews[0].pr_number}`,
      assessment: reviews[0].assessment,
      durationMs: `${reviews[0].duration_ms}ms`,
      critical: reviews[0].critical_count,
      suggestion: reviews[0].suggestion_count,
      nit: reviews[0].nit_count,
    });
  }

  console.log("==========================================");
  console.log("[PASS] End-to-end integration test passed successfully.");
  console.log("==========================================");
}

runE2ETest().catch((err) => {
  console.error("[FAIL] Integration test failed:", err.message || err);
  process.exit(1);
});
