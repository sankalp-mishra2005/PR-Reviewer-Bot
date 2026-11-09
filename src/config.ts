import yaml from "js-yaml";
import { Octokit } from "octokit";

export interface ReviewBotConfig {
  ignore: string[];
  severityThreshold: "CRITICAL" | "SUGGESTION" | "NIT";
  maxFilesToReview: number;
  customInstructions?: string;
}

export const DEFAULT_CONFIG: ReviewBotConfig = {
  ignore: [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "*.lock",
    "*.min.js",
    "*.min.css",
    "*.map",
    "*.svg",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.ico",
    "*.pdf",
    "dist/**",
    "build/**",
    ".next/**",
    "node_modules/**",
  ],
  severityThreshold: "NIT",
  maxFilesToReview: 30,
};

/**
 * Fetch and parse .reviewbot.yml or .github/reviewbot.yml from the target repository.
 * If neither exists, returns the default configuration.
 */
export async function loadRepoConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<ReviewBotConfig> {
  const configPaths = [".reviewbot.yml", ".github/reviewbot.yml"];

  for (const path of configPaths) {
    try {
      const response = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if ("content" in response.data && typeof response.data.content === "string") {
        const rawYaml = Buffer.from(response.data.content, "base64").toString("utf-8");
        const parsed = yaml.load(rawYaml) as Partial<ReviewBotConfig> | null;

        if (parsed && typeof parsed === "object") {
          console.log(`   ⚙️ Loaded custom repository config from ${path}`);
          return {
            ignore: Array.isArray(parsed.ignore)
              ? [...DEFAULT_CONFIG.ignore, ...parsed.ignore]
              : DEFAULT_CONFIG.ignore,
            severityThreshold: parsed.severityThreshold || DEFAULT_CONFIG.severityThreshold,
            maxFilesToReview: parsed.maxFilesToReview || DEFAULT_CONFIG.maxFilesToReview,
            customInstructions: parsed.customInstructions || undefined,
          };
        }
      }
    } catch {
      // File not found or couldn't be loaded, continue checking next path
    }
  }

  console.log("   ⚙️ No custom config found; using default review settings.");
  return DEFAULT_CONFIG;
}

