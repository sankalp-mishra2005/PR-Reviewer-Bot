import { createOctokitClient } from "./github";
import { generateCodeReview, ReviewComment, ReviewResult } from "./ai";
import { loadRepoConfig } from "./config";
import { prepareDiffChunks } from "./chunker";
import { recordReview } from "./db";

interface ReviewParams {
  owner: string;
  repo: string;
  pullNumber: number;
  installationId: number;
}

/**
 * Phase 4: Production-Grade AI Reviewer with Telemetry & Observability.
 *
 * 1. Loads repo-level configuration (.reviewbot.yml) if available.
 * 2. Parses diff and filters out ignored files (lockfiles, binaries, builds).
 * 3. Chunks large diffs to prevent token overflow.
 * 4. Executes AI review with custom repository instructions.
 * 5. Filters noise according to configured severity threshold.
 * 6. Posts structured review with inline comments and execution metadata.
 * 7. Records execution metrics (latency, severity breakdown) in SQLite for dashboard analytics.
 */
export async function reviewPullRequest(params: ReviewParams): Promise<void> {
  const { owner, repo, pullNumber, installationId } = params;
  const startTime = Date.now();

  console.log(`\nStarting Phase 4 AI review for ${owner}/${repo}#${pullNumber}...`);

  const octokit = createOctokitClient(installationId);

  // 1. Fetch Pull Request details (for title, body, and head SHA)
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  // 2. Load repository config (.reviewbot.yml)
  const config = await loadRepoConfig(octokit, owner, repo, pr.head.sha);

  // 3. Fetch the raw unified diff
  const { data: rawDiff } = (await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: {
      format: "diff",
    },
  })) as unknown as { data: string };

  if (!rawDiff || rawDiff.trim().length === 0) {
    console.log("   ℹ️ No diff content found. Skipping review.");
    return;
  }

  // 4. Smart chunking & file filtering
  const { chunks, skippedFiles } = prepareDiffChunks(rawDiff, config);

  if (chunks.length === 0) {
    console.log("   [INFO] All modified files were ignored by configuration. Skipping AI analysis.");
    return;
  }

  console.log(`   [INFO] Diff partitioned into ${chunks.length} chunk(s) across reviewable files.`);
  if (skippedFiles.length > 0) {
    console.log(`   [INFO] Skipped ${skippedFiles.length} non-actionable file(s) (lockfiles/ignored/assets).`);
  }

  // 5. Run AI reviews across chunks
  const allResults: ReviewResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`   [INFO] Analyzing chunk ${i + 1}/${chunks.length} (${chunk.files.join(", ")})...`);

    const result = await generateCodeReview({
      title: pr.title,
      description: pr.body || undefined,
      diff: chunk.diff,
      customInstructions: config.customInstructions,
      severityThreshold: config.severityThreshold,
    });

    allResults.push(result);
  }

  // 6. Aggregate results
  const allComments: ReviewComment[] = [];
  const summaries: string[] = [];
  let worstAssessment: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" = "APPROVE";

  for (const r of allResults) {
    summaries.push(r.summary);
    allComments.push(...r.comments);

    if (r.overallAssessment === "REQUEST_CHANGES") {
      worstAssessment = "REQUEST_CHANGES";
    } else if (r.overallAssessment === "COMMENT" && worstAssessment !== "REQUEST_CHANGES") {
      worstAssessment = "COMMENT";
    }
  }

  // 7. Format the review markdown
  const assessmentText =
    worstAssessment === "APPROVE"
      ? "Approved"
      : worstAssessment === "REQUEST_CHANGES"
      ? "Changes Requested"
      : "Commentary";

  let body = [
    `## Automated Code Review`,
    "",
    `**Verdict:** ${assessmentText}`,
    "",
    `### Summary`,
    summaries.join("\n\n"),
    "",
  ].join("\n");

  // 8. Prepare inline comments vs fallback
  const inlineComments: Array<{
    path: string;
    line: number;
    side: "RIGHT";
    body: string;
  }> = [];
  const fallbackComments: ReviewComment[] = [];

  for (const c of allComments) {
    const badge = `**[${c.severity}]**`;
    const commentBody = `${badge} ${c.comment}`;

    if (c.path && c.line && c.line > 0) {
      inlineComments.push({
        path: c.path,
        line: c.line,
        side: "RIGHT",
        body: commentBody,
      });
    } else {
      fallbackComments.push(c);
    }
  }

  if (fallbackComments.length > 0) {
    body += "\n### Additional Observations\n";
    for (const c of fallbackComments) {
      body += `- **[${c.severity}]** \`${c.path}\`: ${c.comment}\n`;
    }
  }

  // 9. Add metadata footer
  body += "\n\n<details><summary>Review Parameters</summary>\n\n";
  body += `- Severity threshold: \`${config.severityThreshold}\`\n`;
  body += `- Chunks analyzed: \`${chunks.length}\`\n`;
  if (skippedFiles.length > 0) {
    body += `- Skipped non-actionable files (${skippedFiles.length}):\n`;
    for (const f of skippedFiles) {
      body += `  - \`${f}\`\n`;
    }
  }
  body += "\n</details>\n";
  body += "\n---\n*Generated by PR Reviewer Bot (Gemini 3.5 Flash)*";

  // 10. Post review to GitHub
  try {
    if (inlineComments.length > 0) {
      console.log(`   [INFO] Submitting ${inlineComments.length} inline review comments to GitHub...`);
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: pr.head.sha,
        event: "COMMENT",
        body,
        comments: inlineComments,
      });
      console.log(`   [INFO] Posted review with inline comments on PR #${pullNumber}`);
    } else {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        event: "COMMENT",
        body,
      });
      console.log(`   [INFO] Posted review summary on PR #${pullNumber}`);
    }
  } catch (err: any) {
    console.warn(`   [WARN] Inline comment placement failed (${err.message}). Falling back to review summary body.`);

    let fallbackBody = body + "\n\n### Detailed Feedback\n";
    for (const c of inlineComments) {
      fallbackBody += `\n- **${c.path}:${c.line}**\n  ${c.body.replace(/\n/g, "\n  ")}\n`;
    }

    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      event: "COMMENT",
      body: fallbackBody,
    });
    console.log(`   [INFO] Posted fallback review summary on PR #${pullNumber}`);
  }

  // 11. Record telemetry into SQLite for Observability Dashboard
  const durationMs = Date.now() - startTime;
  const criticalCount = allComments.filter((c) => c.severity === "CRITICAL").length;
  const suggestionCount = allComments.filter((c) => c.severity === "SUGGESTION").length;
  const nitCount = allComments.filter((c) => c.severity === "NIT").length;

  try {
    await recordReview({
      repo: `${owner}/${repo}`,
      prNumber: pullNumber,
      prTitle: pr.title,
      author: pr.user?.login || "unknown",
      assessment: worstAssessment,
      summary: summaries.join(" "),
      commentCount: allComments.length,
      criticalCount,
      suggestionCount,
      nitCount,
      durationMs,
      findings: JSON.stringify(allComments),
    });
    console.log(`   [INFO] Review telemetry recorded to SQLite (${durationMs}ms, ${allComments.length} issues)`);
  } catch (dbErr: any) {
    console.warn(`   [WARN] Failed to record review telemetry to DB: ${dbErr.message}`);
  }
}
