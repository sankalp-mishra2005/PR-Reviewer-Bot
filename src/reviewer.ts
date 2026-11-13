import { createOctokitClient } from "./github";
import { generateCodeReview, ReviewComment, ReviewResult } from "./ai";
import { loadRepoConfig } from "./config";
import { prepareDiffChunks } from "./chunker";
import { claimReviewJob, completeReviewJob, failReviewJob } from "./db";

export interface ReviewParams {
  owner: string;
  repo: string;
  pullNumber: number;
  installationId: number;
}

/**
 * Phase 2 & 4: Production-Grade AI Reviewer with Telemetry, Observability,
 * and Race-Safe Commit-Level Deduplication.
 *
 * 1. Claims review job atomically in SQLite scoped to repo + PR + commit_sha.
 * 2. Skips duplicate webhook deliveries if commit is already RUNNING or COMPLETED.
 * 3. Allows controlled retry if previous attempt FAILED.
 * 4. Loads repo-level configuration (.reviewbot.yml) if available.
 * 5. Parses diff and filters out non-actionable files (lockfiles, binaries, builds).
 * 6. Chunks large diffs to prevent token overflow.
 * 7. Executes AI review with custom repository instructions and model failover.
 * 8. Posts structured review with inline comments to GitHub.
 * 9. Completes review job in SQLite with execution latency, defect breakdown, and model attribution.
 */
export async function reviewPullRequest(params: ReviewParams): Promise<void> {
  const { owner, repo, pullNumber, installationId } = params;
  const startTime = Date.now();

  console.log(`\n[INFO] Starting AI review evaluation for ${owner}/${repo}#${pullNumber}...`);

  const octokit = createOctokitClient(installationId);

  // 1. Fetch Pull Request details (for title, body, and head SHA)
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  const headSha = pr.head.sha;

  // 2. Race-Safe Deduplication & Job Claiming (Scoped to repo + PR + commit SHA)
  const claim = await claimReviewJob({
    repo: `${owner}/${repo}`,
    prNumber: pullNumber,
    commitSha: headSha,
    prTitle: pr.title,
    author: pr.user?.login || "unknown",
  });

  if (!claim.claimed) {
    console.log(
      `   [INFO] PR #${pullNumber} head commit ${headSha.slice(0, 7)} already has status '${claim.status}'. Skipping duplicate execution.`
    );
    return;
  }

  console.log(`   [INFO] Review job #${claim.jobId} claimed with status RUNNING for commit ${headSha.slice(0, 7)}`);

  try {
    // 3. Load repository config (.reviewbot.yml)
    const config = await loadRepoConfig(octokit, owner, repo, pr.head.sha);

    // 4. Fetch the raw unified diff
    const { data: rawDiff } = (await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: {
        format: "diff",
      },
    })) as unknown as { data: string };

    if (!rawDiff || rawDiff.trim().length === 0) {
      console.log("   [INFO] No diff content found. Completing job with clean verdict.");
      await completeReviewJob(claim.jobId, {
        assessment: "APPROVE",
        summary: "No diff content found in pull request.",
        commentCount: 0,
        criticalCount: 0,
        suggestionCount: 0,
        nitCount: 0,
        durationMs: Date.now() - startTime,
        findings: "[]",
        modelUsed: "none",
      });
      return;
    }

    // 5. Smart chunking & file filtering
    const { chunks, skippedFiles } = prepareDiffChunks(rawDiff, config);

    if (chunks.length === 0) {
      console.log("   [INFO] All modified files were ignored by configuration. Skipping AI analysis.");
      await completeReviewJob(claim.jobId, {
        assessment: "APPROVE",
        summary: "All modified files were excluded by repository ignore rules.",
        commentCount: 0,
        criticalCount: 0,
        suggestionCount: 0,
        nitCount: 0,
        durationMs: Date.now() - startTime,
        findings: "[]",
        modelUsed: "none",
      });
      return;
    }

    console.log(`   [INFO] Diff partitioned into ${chunks.length} chunk(s) across reviewable files.`);
    if (skippedFiles.length > 0) {
      console.log(`   [INFO] Skipped ${skippedFiles.length} non-actionable file(s) (lockfiles/ignored/assets).`);
    }

    // 6. Run AI reviews across chunks
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

    // 7. Aggregate results
    const allComments: ReviewComment[] = [];
    const summaries: string[] = [];
    let worstAssessment: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" = "APPROVE";
    const modelsUsed = new Set<string>();

    for (const r of allResults) {
      summaries.push(r.summary);
      allComments.push(...r.comments);
      if (r.modelUsed) modelsUsed.add(r.modelUsed);

      if (r.overallAssessment === "REQUEST_CHANGES") {
        worstAssessment = "REQUEST_CHANGES";
      } else if (r.overallAssessment === "COMMENT" && worstAssessment !== "REQUEST_CHANGES") {
        worstAssessment = "COMMENT";
      }
    }

    const dominantModel = Array.from(modelsUsed).join(", ") || "gemini-3.5-flash";

    // 8. Format the review markdown
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

    // 9. Prepare inline comments vs fallback
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

    // 10. Add metadata footer
    body += "\n\n<details><summary>Review Parameters</summary>\n\n";
    body += `- Severity threshold: \`${config.severityThreshold}\`\n`;
    body += `- Chunks analyzed: \`${chunks.length}\`\n`;
    body += `- Model: \`${dominantModel}\`\n`;
    if (skippedFiles.length > 0) {
      body += `- Skipped non-actionable files (${skippedFiles.length}):\n`;
      for (const f of skippedFiles) {
        body += `  - \`${f}\`\n`;
      }
    }
    body += "\n</details>\n";
    body += `\n---\n*Generated by PR Reviewer Bot (${dominantModel})*`;

    // 11. Post review to GitHub
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
    } catch (ghErr: any) {
      console.warn(`   [WARN] Inline comment placement failed (${ghErr.message}). Falling back to review summary body.`);

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

    // 12. Complete review job in SQLite
    const durationMs = Date.now() - startTime;
    const criticalCount = allComments.filter((c) => c.severity === "CRITICAL").length;
    const suggestionCount = allComments.filter((c) => c.severity === "SUGGESTION").length;
    const nitCount = allComments.filter((c) => c.severity === "NIT").length;

    await completeReviewJob(claim.jobId, {
      assessment: worstAssessment,
      summary: summaries.join(" "),
      commentCount: allComments.length,
      criticalCount,
      suggestionCount,
      nitCount,
      durationMs,
      findings: JSON.stringify(allComments),
      modelUsed: dominantModel,
    });

    console.log(
      `   [INFO] Review job #${claim.jobId} COMPLETED and recorded to SQLite (${durationMs}ms, ${allComments.length} issues, model=${dominantModel})`
    );
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error(`   [ERROR] Review job #${claim.jobId} failed: ${errorMsg}`);
    try {
      await failReviewJob(claim.jobId, errorMsg);
    } catch (dbErr: any) {
      console.error(`   [ERROR] Failed to mark job #${claim.jobId} as FAILED:`, dbErr?.message || dbErr);
    }
    throw error;
  }
}
