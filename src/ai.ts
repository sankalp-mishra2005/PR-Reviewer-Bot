import { GoogleGenAI, Type } from "@google/genai";

export interface ReviewComment {
  path: string;
  line: number;
  comment: string;
  severity: "CRITICAL" | "SUGGESTION" | "NIT";
}

export interface ReviewResult {
  summary: string;
  overallAssessment: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  comments: ReviewComment[];
  modelUsed: string;
}

export interface ReviewParams {
  title: string;
  description?: string;
  diff: string;
  customInstructions?: string;
  severityThreshold?: "CRITICAL" | "SUGGESTION" | "NIT";
}

/**
 * Filter review comments according to configured severity threshold.
 */
function filterBySeverity(
  comments: ReviewComment[],
  threshold: "CRITICAL" | "SUGGESTION" | "NIT" = "NIT"
): ReviewComment[] {
  if (threshold === "CRITICAL") {
    return comments.filter((c) => c.severity === "CRITICAL");
  }
  if (threshold === "SUGGESTION") {
    return comments.filter((c) => c.severity === "CRITICAL" || c.severity === "SUGGESTION");
  }
  return comments;
}

/**
 * Distinguish fatal client/auth/config errors from transient upstream rate-limits or 503 spikes.
 */
function isFatalClientOrAuthError(err: any): boolean {
  const status = err?.status || err?.statusCode || err?.response?.status;
  const msg = String(err?.message || "").toUpperCase();

  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return true;
  }

  if (
    msg.includes("API_KEY_INVALID") ||
    msg.includes("API KEY NOT VALID") ||
    msg.includes("PERMISSION_DENIED") ||
    msg.includes("UNAUTHENTICATED") ||
    msg.includes("INVALID_ARGUMENT")
  ) {
    return true;
  }

  return false;
}

/**
 * AI Code Review Engine powered by Google Gemini.
 *
 * Uses Gemini's structured output schema to ensure
 * type-safe, deterministic JSON responses with automated
 * upstream model failover and error classification.
 */
export async function generateCodeReview(params: ReviewParams): Promise<ReviewResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment");
  }

  const ai = new GoogleGenAI({ apiKey });

  let systemInstruction = `
You are a Principal Software Engineer conducting a thorough Pull Request code review.
Your goal is to provide high-signal, actionable feedback that helps the author ship secure, robust, and maintainable code.

CORE REVIEW PRINCIPLES:
1. FOCUS ON:
   - Logic bugs, race conditions, edge case failures.
   - Security vulnerabilities (injection, auth flaws, data exposure, IDOR).
   - Performance bottlenecks (N+1 queries, memory leaks, unindexed operations).
   - Error handling (unhandled rejections, silent failures).
   - Architectural regressions.

2. DO NOT COMMENT ON:
   - Formatting, whitespace, stylistic preferences (let linters handle this).
   - Import ordering or trivial naming preferences.
   - Code that was not changed in the diff.

3. TONE & FORMAT:
   - Be constructive, precise, and concise.
   - Provide concrete code remediation examples where appropriate.
   - Reference exact file paths and line numbers.

4. SEVERITY TIERS:
   - CRITICAL: Must-fix bugs that cause security holes, data loss, crashes, or financial errors.
   - SUGGESTION: Important improvements for reliability, maintainability, or performance.
   - NIT: Minor non-blocking observations.
`;

  if (params.customInstructions) {
    systemInstruction += `\nREPOSITORY-SPECIFIC RULES:\n${params.customInstructions}\n`;
  }

  const userPrompt = `
PR Title: ${params.title}
PR Description: ${params.description || "No description provided"}

Unified Diff to review:
\`\`\`diff
${params.diff}
\`\`\`
`;

  const fallbackModels = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3.8-flash",
  ];

  let response: any = null;
  let lastError: any = null;
  let modelUsed = fallbackModels[0];

  for (const model of fallbackModels) {
    try {
      console.log(`      [INFO] Dispatching review request to model: ${model}...`);
      modelUsed = model;

      response = await ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: "High-level summary of the changes and overall code quality.",
              },
              overallAssessment: {
                type: Type.STRING,
                enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
                description: "Final decision: APPROVE, REQUEST_CHANGES, or COMMENT.",
              },
              comments: {
                type: Type.ARRAY,
                description: "Line-specific feedback on changed code.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    path: {
                      type: Type.STRING,
                      description: "File path relative to repository root.",
                    },
                    line: {
                      type: Type.INTEGER,
                      description: "Line number in the newly modified file.",
                    },
                    comment: {
                      type: Type.STRING,
                      description: "Constructive feedback and recommended fix.",
                    },
                    severity: {
                      type: Type.STRING,
                      enum: ["CRITICAL", "SUGGESTION", "NIT"],
                      description: "Severity level of the issue.",
                    },
                  },
                  required: ["path", "line", "comment", "severity"],
                },
              },
            },
            required: ["summary", "overallAssessment", "comments"],
          },
        },
      });

      if (response && response.text) {
        break; // Successfully got response
      }
    } catch (err: any) {
      lastError = err;

      // Fail fast on authentication, authorization, or schema errors
      if (isFatalClientOrAuthError(err)) {
        console.error(`      [ERROR] Fatal authentication/client error on model ${model}: ${err.message}. Aborting failover cascade.`);
        throw err;
      }

      // Transient capacity (503/429) - proceed to fallback model
      console.warn(`      [WARN] Model ${model} returned transient error: ${err.message}. Stepping to next fallback model...`);
    }
  }

  if (!response || !response.text) {
    throw new Error(`All Gemini review models exhausted. Last error: ${lastError?.message}`);
  }

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned empty response payload");
  }

  const parsed = JSON.parse(text) as ReviewResult;
  parsed.comments = filterBySeverity(parsed.comments, params.severityThreshold);
  parsed.modelUsed = modelUsed;

  return parsed;
}
