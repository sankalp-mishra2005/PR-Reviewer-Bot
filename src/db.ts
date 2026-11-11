import { createClient } from "@libsql/client";
import path from "path";

const dbPath = path.resolve(process.cwd(), "reviews.db");
export const db = createClient({
  url: `file:${dbPath}`,
});

export interface ReviewRecord {
  repo: string;
  prNumber: number;
  prTitle: string;
  author: string;
  assessment: string;
  summary: string;
  commentCount: number;
  criticalCount: number;
  suggestionCount: number;
  nitCount: number;
  durationMs: number;
}

export interface ReviewStats {
  totalReviews: number;
  changesRequested: number;
  approved: number;
  commentsOnly: number;
  totalComments: number;
  totalCritical: number;
  avgDurationMs: number;
}

/**
 * Initialize SQLite database tables.
 */
export async function initDb(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_title TEXT NOT NULL,
      author TEXT NOT NULL,
      assessment TEXT NOT NULL,
      summary TEXT NOT NULL,
      comment_count INTEGER NOT NULL,
      critical_count INTEGER NOT NULL,
      suggestion_count INTEGER NOT NULL,
      nit_count INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Save review metadata and telemetry to database.
 */
export async function recordReview(record: ReviewRecord): Promise<void> {
  await db.execute({
    sql: `
      INSERT INTO reviews (
        repo, pr_number, pr_title, author, assessment,
        summary, comment_count, critical_count, suggestion_count,
        nit_count, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      record.repo,
      record.prNumber,
      record.prTitle,
      record.author,
      record.assessment,
      record.summary,
      record.commentCount,
      record.criticalCount,
      record.suggestionCount,
      record.nitCount,
      record.durationMs,
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
      AVG(duration_ms) as avgDurationMs
    FROM reviews
  `);

  const row = result.rows[0];
  return {
    totalReviews: Number(row.totalReviews || 0),
    changesRequested: Number(row.changesRequested || 0),
    approved: Number(row.approved || 0),
    commentsOnly: Number(row.commentsOnly || 0),
    totalComments: Number(row.totalComments || 0),
    totalCritical: Number(row.totalCritical || 0),
    avgDurationMs: Math.round(Number(row.avgDurationMs || 0)),
  };
}

/**
 * Retrieve recent review history records.
 */
export async function getRecentReviews(limit: number = 25): Promise<any[]> {
  const result = await db.execute({
    sql: `SELECT * FROM reviews ORDER BY id DESC LIMIT ?`,
    args: [limit],
  });

  return result.rows;
}

