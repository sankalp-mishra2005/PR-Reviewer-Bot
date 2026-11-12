# 🤖 Autonomous AI PR Reviewer Bot

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Gemini](https://img.shields.io/badge/Google_Gemini-8E75C2?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)

An enterprise-grade, event-driven GitHub App that performs automated, high-signal code reviews on Pull Requests using **Google Gemini 3.5 Flash**. 

Built with production systems design: HMAC webhook verification, intelligent unified diff chunking, noise suppression, per-repo YAML configuration, and a built-in observability dashboard.

---

## 🌟 Key Features

- **⚡ Event-Driven Ingestion:** Listens to GitHub webhook events (`pull_request.opened`, `synchronize`, `reopened`) via HMAC SHA-256 signature verification.
- **🧠 Senior Engineer AI Reviews:** Powered by Gemini 3.5 Flash with structured JSON schemas to identify security vulnerabilities, logic bugs, and race conditions.
- **💬 Inline GitHub Comments:** Places reviews directly on the modified code lines with severity tags (`CRITICAL`, `SUGGESTION`, `NIT`).
- **📦 Smart Diff Chunking & Filtering:** Automatically skips lockfiles (`package-lock.json`), minified bundles, and images; partitions large PRs to prevent context degradation.
- **⚙️ Custom Repository Config:** Supports `.reviewbot.yml` in target repositories for custom rules, ignore patterns, and severity thresholds.
- **📊 Real-Time Observability Dashboard:** Built-in web UI at `/dashboard` tracking latency, bug counts, and review histories backed by SQLite.

---

## 🏗️ Architecture

```mermaid
flowchart LR
    A[GitHub Pull Request] -->|Webhook POST| B[Express Ingestion Gateway]
    B -->|Verify HMAC| C[Diff Parser & Smart Chunker]
    C -->|Filtered Diff + Rules| D[Gemini 3.5 Flash Engine]
    D -->|Structured Review JSON| E[Review Publisher]
    E -->|Inline Comments| A
    E -->|Telemetry| F[(SQLite Database)]
    F --> G[Live Dashboard /dashboard]
```

---

## 🚀 Quickstart

### 1. Clone & Install
```bash
git clone <repo-url>
cd "PR Reviwer Bot"
npm install
```

### 2. Configure Environment
Create a `.env` file from `.env.example`:
```env
GITHUB_APP_ID=your_github_app_id
GITHUB_PRIVATE_KEY_PATH=./private-key.pem
GITHUB_WEBHOOK_SECRET=your_webhook_secret
GEMINI_API_KEY=your_gemini_api_key
PORT=3000
NODE_ENV=development
SMEE_URL=https://smee.io/your_channel
```

### 3. Run Development Server
```bash
npm run dev
```

Visit the Live Dashboard:
👉 **`http://localhost:3000/dashboard`**

---

## 📄 Repository Configuration (`.reviewbot.yml`)
Add `.reviewbot.yml` to any repository using the bot:
```yaml
ignore:
  - "tests/**"
  - "*.spec.ts"
severityThreshold: "SUGGESTION" # Options: CRITICAL | SUGGESTION | NIT
maxFilesToReview: 25
customInstructions: "Enforce strict error handling on all database and network calls."
```

