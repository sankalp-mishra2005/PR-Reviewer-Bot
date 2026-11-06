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
 * AI Code Review Engine powered by Google Gemini.
 *
 * Uses Gemini's structured output schema to ensure
 * type-safe, deterministic JSON responses.
 */
export async function generateCodeReview(params: ReviewParams): Promise<ReviewResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in .env!");
  }

  const ai = new GoogleGenAI({ apiKey });

  let systemInstruction = `
You are a Principal Software Engineer conducting a thorough Pull Request code review.
Your goal is to provide high-signal, actionable feedback that helps the author ship secure, robust, and maintainable code.

CORE REVIEW PRINCIPLES:
1. FOCUS ON:
   - Logic bugs, race conditions, edge case failures.
   - Security vulnerabilities (injection, auth flaws, secret leaks).
   - Resource leaks, performance bottlenecks, unhandled async errors.
   - Error handling and defensive programming.
2. AVOID NOISE:
   - Do NOT comment on trivial formatting or style unless it causes a bug.
   - Do NOT repeat what the code does ("This line adds a variable...").
   - Filter out trivial nits unless they have real consequences.
3. INLINE COMMENTS:
   - "path" must be the exact relative filename.
   - "line" must be the line number in the NEW version of the file (added or modified line).
   - Provide concrete suggestions or code snippets showing how to fix the issue.
4. OVERALL ASSESSMENT:
   - "APPROVE": Changes are safe, clean, and ready to merge.
   - "REQUEST_CHANGES": Critical bugs, security flaws, or major architectural issues exist.
   - "COMMENT": Minor suggestions or non-blocking feedback.
`;

  if (params.customInstructions) {
    systemInstruction += `\nREPOSITORY CUSTOM INSTRUCTIONS:\n${params.customInstructions}\n`;
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

  for (const model of fallbackModels) {
    try {
      console.log(`      Attempting review with ${model}...`);
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
        break; // Successfully got response!
      }
    } catch (err: any) {
      console.warn(`      Model ${model} hit error: ${err.message}. Trying next fallback...`);
      lastError = err;
    }
  }

  if (!response || !response.text) {
    throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
  }

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed = JSON.parse(text) as ReviewResult;
  parsed.comments = filterBySeverity(parsed.comments, params.severityThreshold);

  return parsed;
}
