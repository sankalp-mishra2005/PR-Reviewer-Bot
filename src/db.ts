import { createClient } from "@libsql/client";
import path from "path";

const dbPath = path.resolve(process.cwd(), "reviews.db");
export const db = createClient({
  url: `file:${dbPath}`,
});

export type ReviewJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface ReviewRecord {
  id?: number;
  repo: string;
  prNumber: number;
  prTitle: string;
  author: string;
  commitSha?: string;
  modelUsed?: string;
  status?: ReviewJobStatus;
  assessment: string;
  summary: string;
  commentCount: number;
  criticalCount: number;
  suggestionCount: number;
  nitCount: number;
  durationMs: number;
  findings?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReviewStats {
  totalReviews: number;
  changesRequested: number;
  approved: number;
  commentsOnly: number;
  totalComments: number;
  totalCritical: number;
  totalSuggestions: number;
  totalNits: number;
  totalRepos: number;
  avgDurationMs: number;
}

export interface ClaimJobResult {
  claimed: boolean;
  status: ReviewJobStatus;
  jobId: number;
}

/**
 * Initialize SQLite database tables, migrations, and unique indexes.
 */
export async function initDb(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_title TEXT NOT NULL,
      author TEXT NOT NULL,
      commit_sha TEXT,
      model_used TEXT DEFAULT 'gemini-3.5-flash',
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      assessment TEXT NOT NULL,
      summary TEXT NOT NULL,
      comment_count INTEGER NOT NULL,
      critical_count INTEGER NOT NULL,
      suggestion_count INTEGER NOT NULL,
      nit_count INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      findings TEXT DEFAULT '[]',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Run schema migrations for existing database files
  const migrations = [
    `ALTER TABLE reviews ADD COLUMN findings TEXT DEFAULT '[]';`,
    `ALTER TABLE reviews ADD COLUMN commit_sha TEXT;`,
    `ALTER TABLE reviews ADD COLUMN model_used TEXT DEFAULT 'gemini-3.5-flash';`,
    `ALTER TABLE reviews ADD COLUMN status TEXT DEFAULT 'COMPLETED';`,
    `ALTER TABLE reviews ADD COLUMN error_message TEXT;`,
    `ALTER TABLE reviews ADD COLUMN updated_at DATETIME;`,
  ];

  for (const migration of migrations) {
    try {
      await db.execute(migration);
    } catch {
      // Column already exists
    }
  }

  // Populate updated_at for existing rows
  try {
    await db.execute(`UPDATE reviews SET updated_at = created_at WHERE updated_at IS NULL;`);
  } catch {
    // Ignore on empty database
  }

  // Ensure historical records have distinct placeholder commit_sha values so the unique index succeeds
  try {
    await db.execute(`UPDATE reviews SET commit_sha = 'legacy-' || id WHERE commit_sha IS NULL;`);
  } catch {
    // Ignore update failures on empty database
  }

  // Create unique index scoped to repo + pr_number + commit_sha for atomic deduplication
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_repo_pr_commit 
    ON reviews(repo, pr_number, commit_sha);
  `);
}

/**
 * Atomically claims a review job for a given repository + PR number + commit SHA.
 * Returns claimed: true if this caller won the claim and should proceed to LLM execution.
 * If already COMPLETED or currently RUNNING, returns claimed: false to prevent duplicate execution.
 * If previously FAILED, allows atomic re-claim for controlled retries.
 */
export async function claimReviewJob(params: {
  repo: string;
  prNumber: number;
  commitSha: string;
  prTitle: string;
  author: string;
}): Promise<ClaimJobResult> {
  const { repo, prNumber, commitSha, prTitle, author } = params;

  try {
    // Attempt atomic insertion of RUNNING job
    const result = await db.execute({
      sql: `
        INSERT INTO reviews (
          repo, pr_number, commit_sha, pr_title, author, status,
          assessment, summary, comment_count, critical_count,
          suggestion_count, nit_count, duration_ms, model_used, findings
        ) VALUES (?, ?, ?, ?, ?, 'RUNNING', 'PENDING', 'Review in progress...', 0, 0, 0, 0, 0, 'gemini-3.5-flash', '[]')
      `,
      args: [repo, prNumber, commitSha, prTitle, author],
    });

    return {
      claimed: true,
      status: "RUNNING",
      jobId: Number(result.lastInsertRowid),
    };
  } catch (insertErr: any) {
    const errorMsg = String(insertErr?.message || insertErr);
    // If not a unique constraint violation (e.g. operational DB failure or NOT NULL violation), bubble the error up
    if (!errorMsg.includes("UNIQUE") || errorMsg.includes("NOT NULL")) {
      throw insertErr;
    }

    // Unique constraint triggered: Query the existing job status
    const existingResult = await db.execute({
      sql: `SELECT id, status FROM reviews WHERE repo = ? AND pr_number = ? AND commit_sha = ? LIMIT 1`,
      args: [repo, prNumber, commitSha],
    });

    if (existingResult.rows.length === 0) {
      // Extremely rare edge-case: re-throw
      throw insertErr;
    }

    const existingRow = existingResult.rows[0];
    const existingId = Number(existingRow.id);
    const existingStatus = String(existingRow.status) as ReviewJobStatus;

    // Controlled retry: If the job previously FAILED, allow atomic re-claim
    if (existingStatus === "FAILED") {
      const updateResult = await db.execute({
        sql: `
          UPDATE reviews 
          SET status = 'RUNNING', 
              error_message = NULL, 
              summary = 'Retrying review...',
              updated_at = CURRENT_TIMESTAMP 
          WHERE id = ? AND status = 'FAILED'
        `,
        args: [existingId],
      });

      if (updateResult.rowsAffected > 0) {
        return {
          claimed: true,
          status: "RUNNING",
          jobId: existingId,
        };
      }
    }

    // Already COMPLETED or another worker is actively RUNNING
    return {
      claimed: false,
      status: existingStatus,
      jobId: existingId,
    };
  }
}

/**
 * Completes a claimed review job with findings and telemetry.
 */
export async function completeReviewJob(
  jobId: number,
  data: {
    assessment: string;
    summary: string;
    commentCount: number;
    criticalCount: number;
    suggestionCount: number;
    nitCount: number;
    durationMs: number;
    findings: string;
    modelUsed: string;
  }
): Promise<void> {
  await db.execute({
    sql: `
      UPDATE reviews SET
        status = 'COMPLETED',
        assessment = ?,
        summary = ?,
        comment_count = ?,
        critical_count = ?,
        suggestion_count = ?,
        nit_count = ?,
        duration_ms = ?,
        findings = ?,
        model_used = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [
      data.assessment,
      data.summary,
      data.commentCount,
      data.criticalCount,
      data.suggestionCount,
      data.nitCount,
      data.durationMs,
      data.findings,
      data.modelUsed,
      jobId,
    ],
  });
}

/**
 * Marks a review job as FAILED without permanently blocking future retries.
 */
export async function failReviewJob(jobId: number, errorMessage: string): Promise<void> {
  await db.execute({
    sql: `
      UPDATE reviews SET
        status = 'FAILED',
        assessment = 'FAILED',
        error_message = ?,
        summary = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [errorMessage, `Review execution failed: ${errorMessage}`, jobId],
  });
}

/**
 * Save review metadata and telemetry to database (legacy / direct helper).
 */
export async function recordReview(record: ReviewRecord): Promise<void> {
  const commitSha = record.commitSha || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.execute({
    sql: `
      INSERT INTO reviews (
        repo, pr_number, commit_sha, pr_title, author, status,
        assessment, summary, comment_count, critical_count,
        suggestion_count, nit_count, duration_ms, model_used, findings
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      record.repo,
      record.prNumber,
      commitSha,
      record.prTitle,
      record.author,
      record.status || "COMPLETED",
      record.assessment,
      record.summary,
      record.commentCount,
      record.criticalCount,
      record.suggestionCount,
      record.nitCount,
      record.durationMs,
      record.modelUsed || "gemini-3.5-flash",
      record.findings || "[]",
    ],
  });
}

/**
 * Aggregate telemetry metrics for observability dashboard.
 */
export async function getReviewStats(): Promise<ReviewStats> {
  const result = await db.execute(`
    SELECT
      COUNT(*) as totalReviews,
      SUM(CASE WHEN assessment = 'REQUEST_CHANGES' THEN 1 ELSE 0 END) as changesRequested,
      SUM(CASE WHEN assessment = 'APPROVE' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN assessment = 'COMMENT' THEN 1 ELSE 0 END) as commentsOnly,
      SUM(comment_count) as totalComments,
      SUM(critical_count) as totalCritical,
      SUM(suggestion_count) as totalSuggestions,
      SUM(nit_count) as totalNits,
      COUNT(DISTINCT repo) as totalRepos,
      AVG(duration_ms) as avgDurationMs
    FROM reviews
    WHERE status = 'COMPLETED'
  `);

  const row = result.rows[0];
  return {
    totalReviews: Number(row.totalReviews || 0),
    changesRequested: Number(row.changesRequested || 0),
    approved: Number(row.approved || 0),
    commentsOnly: Number(row.commentsOnly || 0),
    totalComments: Number(row.totalComments || 0),
    totalCritical: Number(row.totalCritical || 0),
    totalSuggestions: Number(row.totalSuggestions || 0),
    totalNits: Number(row.totalNits || 0),
    totalRepos: Number(row.totalRepos || 0),
    avgDurationMs: Math.round(Number(row.avgDurationMs || 0)),
  };
}

/**
 * Retrieve recent review history records, optionally filtered by repository.
 */
export async function getRecentReviews(limit: number = 25, repo?: string): Promise<any[]> {
  if (repo) {
    const result = await db.execute({
      sql: `SELECT * FROM reviews WHERE repo = ? ORDER BY id DESC LIMIT ?`,
      args: [repo, limit],
    });
    return result.rows;
  }

  const result = await db.execute({
    sql: `SELECT * FROM reviews ORDER BY id DESC LIMIT ?`,
    args: [limit],
  });

  return result.rows;
}
