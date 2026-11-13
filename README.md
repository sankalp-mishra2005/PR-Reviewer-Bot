# ReviewPulse — AI GitHub PR Reviewer Bot

[![Live Deployment](https://img.shields.io/badge/Railway-Live_24%2F7-0B0D0E?style=flat-square&logo=railway)](https://pr-reviewer-bot-production-4f4f8b9a.up.railway.app)
[![Live Demo PR](https://img.shields.io/badge/Live_Demo_PR-%231_Reviewed-blue?style=flat-square&logo=github)](https://github.com/sankalp-mishra2005/PR-Reviewer-Bot/pull/1)
[![Live Dashboard](https://img.shields.io/badge/Live_Dashboard-Open_Access-brightgreen?style=flat-square&logo=chartdotjs)](https://pr-reviewer-bot-production-4f4f8b9a.up.railway.app/dashboard)
[![CI Pipeline](https://github.com/sankalp-mishra2005/PR-Reviewer-Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/sankalp-mishra2005/PR-Reviewer-Bot/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green?style=flat-square)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)](LICENSE)

An enterprise-grade, event-driven AI code review bot built on **Node.js**, **TypeScript**, and **Google Gemini (gemini-3.5-flash)**, deployed live on **Railway**. 

The bot operates as an official GitHub App. When a pull request is opened or synchronized, the bot intercepts the webhook, parses the unified diff into context-bounded patches, evaluates logic, security, and edge-case defects with Gemini 3.5 Flash, and publishes line-accurate inline review comments directly onto the GitHub PR.

---

## 🌟 Live Production Showcase

The application is deployed 24/7 on Railway and integrated directly with GitHub:

| Service | Live Production URL | Description |
| :--- | :--- | :--- |
| **Live GitHub PR Demo** | [Pull Request #1 (Reviewed)](https://github.com/sankalp-mishra2005/PR-Reviewer-Bot/pull/1) | Real-world Pull Request showcasing 4 line-by-line inline review comments posted by Gemini 3.5 Flash. |
| **Telemetry Dashboard** | [pr-reviewer-bot-production-4f4f8b9a.up.railway.app/dashboard](https://pr-reviewer-bot-production-4f4f8b9a.up.railway.app/dashboard) | Open portfolio access: Real-time telemetry, latency trends, multi-repo switcher, and code inspection drawer. |
| **Live Webhook Gateway** | `https://pr-reviewer-bot-production-4f4f8b9a.up.railway.app/webhook` | Production GitHub App webhook receiver with timing-safe HMAC SHA-256 validation. |
| **Public Stats API** | [`/api/stats`](https://pr-reviewer-bot-production-4f4f8b9a.up.railway.app/api/stats) | JSON metrics: total evaluated PRs, issue distribution, pass rate, and average latency. |
| **Public Reviews API** | [`/api/reviews`](https://pr-reviewer-bot-production-4f4f8b9a.up.railway.app/api/reviews) | JSON audit trail of recent reviews with optional repository filter (`?repo=...`). |

---

## 🔍 Live Pull Request Case Study (PR #1)

You can inspect the live demonstration directly on **[Pull Request #1](https://github.com/sankalp-mishra2005/PR-Reviewer-Bot/pull/1)** (`demo/payment-gateway-endpoint`):

The pull request introduced a payment endpoint with intentional anti-patterns and vulnerabilities. Within **20 seconds** of code submission, the bot analyzed the diff and posted structured feedback:

1. **`CRITICAL` (Line 12)**: Detected missing `return` statement after sending an HTTP 400 response, which would continue execution and trigger `ERR_HTTP_HEADERS_SENT`.
2. **`CRITICAL` (Line 19)**: Flagged unhandled promise rejection on external gateway call `mockStripeCharge`, recommending a `try/catch` guard and 402/500 status mapping.
3. **`SUGGESTION` (Line 11)**: Identified missing input validation guard for `sourceToken` extracted from `req.body`.
4. **`SUGGESTION` (Line 16)**: Pointed out floating-point precision hazards with `Math.round(amount * 100)` when handling currency values.

---

## 🏗️ Production Architecture

```
GitHub Pull Request (opened / synchronize)
       │
       ▼
Railway Gateway (POST https://.../webhook)
  ├─► HMAC SHA-256 signature verification (crypto.timingSafeEqual)
  ├─► Immediate HTTP 200 acknowledgment (satisfies GitHub 10s SLA)
       │
       ▼
Background Execution Pipeline (async)
  ├─► Generates ephemeral GitHub App installation token
  ├─► Fetches PR metadata and unified diff via Octokit
  ├─► Loads repository-level .reviewbot.yml configuration
  ├─► Filters out lockfiles, build artifacts, and ignored globs
  ├─► Chunks diff into context-bounded patches (<30k chars)
       │
       ▼
AI Inference Engine (Google Gemini 3.5 Flash)
  ├─► Evaluates patch with strict JSON Schema output enforcement
  ├─► Resilient fallback cascade: 3.5-flash ➔ 3.1-flash-lite ➔ 2.5-flash-lite ➔ 3.8-flash
       │
       ▼
GitHub Review Publisher
  ├─► Maps diff positions to GitHub right-side line coordinates
  ├─► Posts multi-comment inline review (octokit.rest.pulls.createReview)
  ├─► Submits overall verdict (REQUEST_CHANGES, COMMENT, APPROVE)
       │
       ▼
Embedded Telemetry Store (SQLite)
  ├─► Records execution latency, defect counts, model used, and findings JSON
  └─► Powers the live telemetry dashboard at /dashboard
```

---

## 💡 Key Engineering Highlights

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
- The engine implements an automatic fallback cascade (`gemini-3.5-flash` ➔ `gemini-3.1-flash-lite` ➔ `gemini-2.5-flash-lite` ➔ `gemini-3.8-flash`).
- If the primary model fails or times out, the review automatically retries on the next model without failing the webhook delivery.

### 5. Race-Safe Deduplication & Job Lifecycle
To prevent duplicate reviews and wasted LLM token spend when GitHub re-delivers webhooks or triggers rapid successive events:
- **Atomic Job Claims**: Jobs are claimed using atomic database insertion into SQLite with a unique constraint scoped to `(repo, pr_number, commit_sha)`.
- **Job Status Lifecycle**: Reviews transition through `QUEUED` ➔ `RUNNING` ➔ `COMPLETED` or `FAILED`.
- **Idempotency Guarantee**: If a review is already `RUNNING` or `COMPLETED` for a commit SHA, redundant webhook deliveries return immediately without invoking the LLM pipeline.
- **Controlled Retries**: If a job previously reached `FAILED` status, subsequent webhook deliveries or retries are atomically permitted to re-claim and re-run the review.

---

## 📊 Live Observability & Telemetry Console

The production service includes an open developer dashboard at `https://pr-reviewer-bot-production-4f4f8b9a.up.railway.app/dashboard`:

- **Open Portfolio Access**: Frictionless, immediate access without login challenges so engineering leads and recruiters can test the live application.
- **Dynamic Multi-Repository Switcher**: Dropdown selector allowing users to inspect metrics across all repositories or filter specifically by connected repo.
- **KPI Telemetry Cards**: Real-time tracking of total reviews, critical defect count, pass rate, and mean turnaround latency (~20s).
- **Interactive Visualizations**: Responsive Chart.js charts rendering latency curves and defect severity distributions over time.
- **Audit Table & Slide-Over Drawer**: Searchable table of past reviews; clicking any row opens a deep inspection drawer showing executive summaries, line-highlighted code snippets, and AI remediations.

---

## ⚙️ Repository Configuration (`.reviewbot.yml`)

Repositories can customize review behavior by adding a `.reviewbot.yml` file to the root or `.github/` folder:

```yaml
# Minimum severity required to post an inline comment: CRITICAL | SUGGESTION | NIT
severityThreshold: SUGGESTION

# Skip processing if a pull request modifies more than this many files
maxFilesToReview: 25

# File patterns to exclude from AI analysis
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

---

## ☁️ Deployment Guide (Railway)

### Production Environment Variables

Configure the following variables in your Railway service settings:

| Variable | Description |
| :--- | :--- |
| `NODE_ENV` | Set to `production`. |
| `PORT` | `3000` (Railway binds public HTTP traffic automatically). |
| `GITHUB_APP_ID` | Your GitHub App ID (e.g. `5726031`). |
| `GITHUB_WEBHOOK_SECRET` | Secret token configured on your GitHub App webhook settings. |
| `GITHUB_PRIVATE_KEY` | Full multiline PEM private key from your GitHub App (handles raw PEM or newline replacements). |
| `GEMINI_API_KEY` | Google Gemini API key. |

### Webhook Configuration on GitHub

1. In your GitHub App settings, set **Webhook URL** to:
   ```
   https://<your-railway-domain>.up.railway.app/webhook
   ```
2. Set **Webhook Secret** to match `GITHUB_WEBHOOK_SECRET`.
3. Enable event subscriptions for **Pull requests** (`opened`, `synchronize`, `reopened`).

---

## 💻 Local Development Setup

### 1. Clone & Install

```bash
git clone https://github.com/sankalp-mishra2005/PR-Reviewer-Bot.git
cd PR-Reviewer-Bot
npm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```ini
GITHUB_APP_ID=5726031
GITHUB_PRIVATE_KEY_PATH=./private-key.pem
GITHUB_WEBHOOK_SECRET=your_webhook_secret
GEMINI_API_KEY=your_gemini_api_key
PORT=3000
NODE_ENV=development
SMEE_URL=https://smee.io/your_channel_hash
```

Place your GitHub App's private key (`.pem`) in the root directory.

### 3. Run Server & Tests

```bash
# Start in development mode with ts-node and Smee webhook forwarding
npm run dev

# Run automated integration test suite (15 tests passing)
npm test

# Build for production
npm run build
npm start
```

---

## 🔒 Security & Reliability Measures

- **Timing-Safe HMAC Verification**: All incoming webhooks are validated with `crypto.timingSafeEqual` over HMAC SHA-256 digests.
- **Ephemeral Token Lifecycle**: Installation tokens are minted dynamically using GitHub App JWTs and scoped strictly to the calling repository.
- **Zero Secret Exposure**: `.env`, private keys (`*.pem`), and database files are protected and excluded via `.gitignore`.
- **Graceful Shutdown**: Intercepts `SIGTERM` and `SIGINT` signals to finish inflight reviews and drain database connections before exiting.

---

## 📄 License

MIT © [Sankalp Mishra](https://github.com/sankalp-mishra2005)
