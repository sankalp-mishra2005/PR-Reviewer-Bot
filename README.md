# pr-reviewer-bot

[![CI](https://github.com/sankalp-mishra2005/PR-Reviewer-Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/sankalp-mishra2005/PR-Reviewer-Bot/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green?style=flat-square)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)](LICENSE)

An automated code review bot for GitHub pull requests, built on Node.js, TypeScript, and Google Gemini.

The bot operates as an event-driven GitHub App. When a pull request is opened or updated, it receives a webhook event, parses and chunks the unified diff, evaluates the changes against code quality and security heuristics using Gemini 3.5 Flash, and publishes inline comments directly onto the affected lines in GitHub.

---

## Design Goals & Trade-offs

### 1. High Signal-to-Noise Ratio
Most automated review bots create fatigue by commenting on generated assets, minified bundles, or style preferences already handled by linters. 
- The diff parser automatically ignores files like `package-lock.json`, `pnpm-lock.yaml`, `*.min.js`, and source maps before spending LLM tokens.
- Repositories can define minimum severity gates (`CRITICAL`, `SUGGESTION`, `NIT`) via `.reviewbot.yml` to suppress lower-priority comments.

### 2. Context-Bounded Chunking
Sending large pull requests in a single prompt often exceeds token limits or causes the model to miss subtle defects.
- Incoming diffs are parsed into per-file patches via `parse-diff`.
- Files are grouped into logical chunks bounded to under 30,000 characters.
- Each chunk is reviewed independently with the PR's title and description included as context.

### 3. Structured Outputs Over Prompt Parsing
Relying on raw markdown outputs from LLMs makes programmatic parsing brittle.
- Reviews use the `@google/genai` SDK with strict JSON schema definitions (`Type.OBJECT`).
- Every finding returns a strictly typed structure containing the exact file path, target line number, severity category, and remediation explanation.

### 4. Upstream Provider Resilience
Upstream AI providers occasionally experience capacity spikes (HTTP 503 `UNAVAILABLE`).
- The engine implements an automatic fallback cascade (`gemini-3.5-flash` -> `gemini-3.1-flash-lite` -> `gemini-2.5-flash-lite` -> `gemini-3.8-flash`).
- If the primary model fails or times out, the review automatically retries on the next model without failing the webhook delivery.

### 5. Local Telemetry & Observability
Every review execution records performance and defect data into an embedded SQLite database (`reviews.db`).
- Metrics include end-to-end turnaround latency, total issues detected, and verdict distribution.
- An integrated web console at `/dashboard` provides interactive telemetry charts and a slide-over code inspection drawer.

---

## How It Works

```
GitHub Pull Request (opened / synchronize)
       |
       v
Express Gateway (/webhook)
  -> Validates HMAC SHA-256 signature using crypto.timingSafeEqual
  -> Responds immediately with HTTP 200 to satisfy GitHub's 10-second timeout
       |
       v
Processing Pipeline (async)
  -> Fetches PR metadata and unified diff via Octokit
  -> Reads repository rules from .reviewbot.yml
  -> Filters out lockfiles, binaries, and ignored patterns
  -> Groups modified files into context-bounded chunks (<30k characters)
       |
       v
AI Inference Engine
  -> Evaluates each chunk via Gemini 3.5 Flash (structured JSON schema)
  -> Falls back to Gemini 3.1 Flash-Lite on upstream 503 errors
       |
       v
GitHub Review Publisher
  -> Maps line numbers to the diff's right side (added/modified lines)
  -> Submits review with inline comments via octokit.rest.pulls.createReview
  -> Falls back to a top-level review summary if an inline position is rejected
       |
       v
Telemetry Store (SQLite)
  -> Saves execution duration, defect counts, and findings JSON to reviews.db
  -> Serves live metrics to the developer console at /dashboard
```

---

## Repository Configuration (`.reviewbot.yml`)

You can customize the bot's behavior per repository by adding a `.reviewbot.yml` (or `.github/reviewbot.yml`) file:

```yaml
# Minimum severity required to post an inline comment: CRITICAL | SUGGESTION | NIT
severityThreshold: SUGGESTION

# Skip processing if a pull request modifies more than this many files
maxFilesToReview: 25

# Additional file patterns to ignore
ignore:
  - "**/*.min.js"
  - "dist/**"
  - "build/**"
  - "coverage/**"
  - "tests/fixtures/**"

# Custom instructions appended to the review prompt
customInstructions: >
  Enforce parameterized queries on all raw SQL statements.
  Flag any unhandled promise rejections or missing return statements in Express route handlers.
```

### Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `severityThreshold` | `string` | `"SUGGESTION"` | Minimum severity to publish. Options: `CRITICAL`, `SUGGESTION`, `NIT`. |
| `maxFilesToReview` | `number` | `30` | Safety ceiling to avoid processing massive bulk commits or bot PRs. |
| `ignore` | `string[]` | `[]` | Glob patterns to exclude from analysis. |
| `customInstructions` | `string` | `""` | Additional project-specific rules appended to the review prompt. |

---

## Local Development & Setup

### Prerequisites
- Node.js >= 18.0.0
- npm
- A registered GitHub App with `Pull requests: Read & write` and `Contents: Read` permissions
- Google Gemini API key

### 1. Installation

```bash
git clone https://github.com/sankalp-mishra2005/PR-Reviewer-Bot.git
cd PR-Reviewer-Bot
npm install
```

### 2. Environment Variables

Create a `.env` file in the project root:

```ini
# GitHub App Authentication
GITHUB_APP_ID=5726031
GITHUB_PRIVATE_KEY_PATH=./private-key.pem
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# AI Engine
GEMINI_API_KEY=your_gemini_api_key

# Service Settings
PORT=3000
NODE_ENV=development

# Webhook Tunnel (for local development)
SMEE_URL=https://smee.io/your_channel_hash
```

Place your GitHub App's private key (`.pem`) at the path referenced by `GITHUB_PRIVATE_KEY_PATH`.

### 3. Running the Server

```bash
# Start in development mode with ts-node and Smee forwarding
npm run dev

# Or build and run for production
npm run build
npm start
```

Once running, the server provides:
- Webhook endpoint: `http://localhost:3000/webhook`
- Developer console: `http://localhost:3000/dashboard`
- Aggregated stats API: `http://localhost:3000/api/stats`
- Recent reviews API: `http://localhost:3000/api/reviews`

---

## Observability & Developer Console

The service includes an embedded web dashboard at `http://localhost:3000/dashboard`:

- **Metric Cards**: Real-time counts for evaluated PRs, critical vulnerabilities detected, clean pass rates, and mean turnaround latency.
- **Interactive Telemetry**: Responsive Chart.js visualizations tracking review duration trends and defect distributions over time.
- **Review Audit Log**: Searchable and filterable table of past reviews (`Changes Requested`, `Approved`, `Has Critical`).
- **Inspection Drawer**: Clicking any review opens a slide-over panel displaying the executive summary, affected code snippets with highlighted line numbers, AI explanations, and recommended remediations.

---

## Security Considerations

- **Timing Attack Mitigation**: GitHub webhook signatures are verified using `crypto.timingSafeEqual` over SHA-256 HMAC buffers rather than basic string comparisons.
- **Ephemeral Credentials**: GitHub App authentication generates short-lived installation access tokens on demand, scoped strictly to the repository opening the PR.
- **Secret Isolation**: Private keys, database files, and environment configurations are excluded from version control via `.gitignore`.

---

## License

MIT
