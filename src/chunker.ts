import parseDiff from "parse-diff";
import { minimatch } from "minimatch";
import { ReviewBotConfig } from "./config";

export interface ParsedDiffFile {
  filename: string;
  diff: string;
  additions: number;
  deletions: number;
}

export interface DiffChunk {
  files: string[];
  diff: string;
}

const CHUNK_CHAR_LIMIT = 30000; // ~7,500 tokens, safe for fast reasoning

/**
 * Filter and split PR diffs into manageable, high-signal chunks.
 *
 * INTERVIEW TALKING POINT:
 * In naive implementations, large PR diffs exceed LLM context windows or cause
 * "lost in the middle" attention degradation. Smart chunking filters binary/lock files
 * and clusters changes into focused reviews.
 */
export function prepareDiffChunks(
  rawDiff: string,
  config: ReviewBotConfig
): { chunks: DiffChunk[]; skippedFiles: string[] } {
  const files = parseDiff(rawDiff);
  const skippedFiles: string[] = [];
  const validFiles: ParsedDiffFile[] = [];

  for (const file of files) {
    const filename = file.to || file.from || "unknown";

    // 1. Check if file matches any ignore glob pattern
    const isIgnored = config.ignore.some((pattern) =>
      minimatch(filename, pattern, { dot: true })
    );

    if (isIgnored) {
      skippedFiles.push(filename);
      continue;
    }

    // 2. Skip deleted files (usually don't need line-by-line review)
    if (file.deleted) {
      skippedFiles.push(`${filename} (deleted)`);
      continue;
    }

    // Reconstruct file diff
    const fileDiffLines: string[] = [];
    fileDiffLines.push(`diff --git a/${file.from || filename} b/${file.to || filename}`);
    if (file.new) fileDiffLines.push("new file mode");

    for (const chunk of file.chunks) {
      fileDiffLines.push(chunk.content);
      for (const change of chunk.changes) {
        fileDiffLines.push(change.content);
      }
    }

    validFiles.push({
      filename,
      diff: fileDiffLines.join("\n"),
      additions: file.additions,
      deletions: file.deletions,
    });
  }

  // Enforce max files to review limit
  const reviewableFiles = validFiles.slice(0, config.maxFilesToReview);
  if (validFiles.length > config.maxFilesToReview) {
    for (let i = config.maxFilesToReview; i < validFiles.length; i++) {
      skippedFiles.push(`${validFiles[i].filename} (exceeded max review count)`);
    }
  }

  // Group files into chunks below the character threshold
  const chunks: DiffChunk[] = [];
  let currentChunkFiles: string[] = [];
  let currentChunkDiff = "";

  for (const file of reviewableFiles) {
    if (
      currentChunkDiff.length > 0 &&
      currentChunkDiff.length + file.diff.length > CHUNK_CHAR_LIMIT
    ) {
      chunks.push({
        files: currentChunkFiles,
        diff: currentChunkDiff,
      });
      currentChunkFiles = [];
      currentChunkDiff = "";
    }

    currentChunkFiles.push(file.filename);
    currentChunkDiff += (currentChunkDiff.length > 0 ? "\n\n" : "") + file.diff;
  }

  if (currentChunkDiff.length > 0) {
    chunks.push({
      files: currentChunkFiles,
      diff: currentChunkDiff,
    });
  }

  return { chunks, skippedFiles };
}

