import { Router } from "express";
import { getRecentReviews, getReviewStats, ReviewStats } from "./db";
import { requireDashboardAuth } from "./auth";

export const dashboardRouter = Router();

// Public portfolio access: Dashboard and telemetry are open by default without login prompts.
// Optional authentication can be enabled by setting ENABLE_DASHBOARD_AUTH="true" in .env.
if (process.env.ENABLE_DASHBOARD_AUTH === "true") {
  dashboardRouter.use(requireDashboardAuth);
}

// JSON API: stats
dashboardRouter.get("/api/stats", async (_req, res) => {
  try {
    const stats = await getReviewStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// JSON API: recent reviews (supports optional ?repo=owner/repo&limit=N)
dashboardRouter.get("/api/reviews", async (req, res) => {
  try {
    const repo = typeof req.query.repo === "string" ? req.query.repo : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
    const reviews = await getRecentReviews(limit, repo);
    res.json(reviews);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// HTML Dashboard UI - Linear, Vercel, GitHub & Sentry Inspired SaaS Console
dashboardRouter.get("/dashboard", async (req, res) => {
  try {
    const filterRepo = typeof req.query.repo === "string" ? req.query.repo : "";
    const stats = await getReviewStats();
    const reviews = await getRecentReviews(100);

    // Extract unique repositories for the dropdown filter
    const uniqueRepos = Array.from(
      new Set(reviews.map((r: any) => String(r.repo)).filter(Boolean))
    ).sort();

    const total = stats.totalReviews;
    const approvalRate = total > 0 ? Math.round((stats.approved / total) * 100) : 0;
    const changesRate = total > 0 ? Math.round((stats.changesRequested / total) * 100) : 0;
    const commentsRate = total > 0 ? Math.round((stats.commentsOnly / total) * 100) : 0;

    const totalIssues = stats.totalComments;
    const avgLatencySec = stats.avgDurationMs > 0 ? (stats.avgDurationMs / 1000).toFixed(1) : "0.0";

    // Prepare serializable reviews data for client-side Chart.js and Inspection Drawer
    const reviewsClientData = reviews.map((r, idx) => {
      let findingsList: Array<{ path: string; line: number; severity: string; comment: string }> = [];
      try {
        if (r.findings) {
          findingsList = typeof r.findings === "string" ? JSON.parse(r.findings) : r.findings;
        }
      } catch {
        findingsList = [];
      }

      return {
        id: r.id,
        idx,
        repo: r.repo,
        prNumber: r.pr_number,
        prTitle: r.pr_title,
        author: r.author,
        commitSha: r.commit_sha || "",
        modelUsed: r.model_used || "gemini-3.5-flash",
        status: r.status || "COMPLETED",
        assessment: r.assessment,
        summary: r.summary,
        commentCount: r.comment_count,
        criticalCount: r.critical_count,
        suggestionCount: r.suggestion_count,
        nitCount: r.nit_count,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
        findings: findingsList,
      };
    });

    const reviewsJsonEscaped = JSON.stringify(reviewsClientData).replace(/</g, "\\u003c");

    const rowsHtml =
      reviews.length === 0
        ? `
        <tr id="emptyTableState">
          <td colspan="7" class="py-20 text-center">
            <div class="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
              <div class="w-10 h-10 rounded-lg bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center text-zinc-400">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
                  <circle cx="18" cy="18" r="3"></circle>
                  <circle cx="6" cy="6" r="3"></circle>
                  <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
                  <line x1="6" y1="9" x2="6" y2="21"></line>
                </svg>
              </div>
              <div>
                <p class="text-sm font-medium text-zinc-200">No pull requests evaluated yet</p>
                <p class="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Open a pull request on your connected GitHub repository to stream automated code reviews, defect categorization, and runtime telemetry.
                </p>
              </div>
              <div class="pt-2 flex items-center gap-2 text-xs font-mono text-zinc-400">
                <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Gateway ready on /webhook</span>
              </div>
            </div>
          </td>
        </tr>
      `
        : reviews
            .map((r, idx) => {
              const isApproved = r.assessment === "APPROVE";
              const isChanges = r.assessment === "REQUEST_CHANGES";

              const badgeBg = isApproved
                ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/40"
                : isChanges
                ? "bg-rose-950/40 text-rose-400 border-rose-800/40"
                : "bg-zinc-800/60 text-zinc-300 border-zinc-700/60";

              const dotBg = isApproved
                ? "bg-emerald-400"
                : isChanges
                ? "bg-rose-400"
                : "bg-zinc-400";

              const verdictLabel = isApproved
                ? "Approved"
                : isChanges
                ? "Changes Requested"
                : "Commentary";

              const dateStr = new Date(r.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return `
              <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors group cursor-pointer review-row"
                  id="row-${idx}"
                  data-repo="${escapeHtml(r.repo.toLowerCase())}"
                  data-author="${escapeHtml(r.author.toLowerCase())}"
                  data-decision="${escapeHtml(r.assessment.toLowerCase())}"
                  data-critical="${r.critical_count}"
                  data-suggestion="${r.suggestion_count}"
                  data-nit="${r.nit_count}"
                  onclick="openDrawer(${idx})">
                <td class="py-3.5 px-4">
                  <div class="flex items-start gap-2.5">
                    <div class="mt-0.5 text-zinc-500 group-hover:text-zinc-300 transition-colors">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
                        <circle cx="18" cy="18" r="3"></circle>
                        <circle cx="6" cy="6" r="3"></circle>
                        <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
                        <line x1="6" y1="9" x2="6" y2="21"></line>
                      </svg>
                    </div>
                    <div class="flex flex-col">
                      <div class="flex items-center gap-2">
                        <span class="text-[11px] font-mono text-zinc-400">${escapeHtml(r.repo)}</span>
                        <span class="text-[11px] font-mono text-zinc-600">#${r.pr_number}</span>
                      </div>
                      <a href="https://github.com/${r.repo}/pull/${r.pr_number}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-zinc-200 hover:text-indigo-400 transition-colors mt-0.5" onclick="event.stopPropagation()">
                        ${escapeHtml(String(r.pr_title))}
                      </a>
                    </div>
                  </div>
                </td>
                <td class="py-3.5 px-4">
                  <div class="flex items-center gap-1.5 text-xs text-zinc-300 font-mono">
                    <div class="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] text-zinc-400 uppercase">
                      ${r.author.charAt(0)}
                    </div>
                    <span>@${escapeHtml(r.author)}</span>
                  </div>
                </td>
                <td class="py-3.5 px-4">
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border ${badgeBg}">
                    <span class="w-1.5 h-1.5 rounded-full ${dotBg}"></span>
                    ${verdictLabel}
                  </span>
                </td>
                <td class="py-3.5 px-4">
                  <div class="flex items-center gap-1.5 text-xs font-mono">
                    <span class="px-2 py-0.5 rounded ${r.critical_count > 0 ? "bg-rose-950/50 text-rose-300 border border-rose-900/40 font-semibold" : "bg-zinc-800/40 text-zinc-500 border border-zinc-800"}" title="Critical bugs & security flaws">${r.critical_count} Crit</span>
                    <span class="px-2 py-0.5 rounded ${r.suggestion_count > 0 ? "bg-amber-950/40 text-amber-300 border border-amber-900/30" : "bg-zinc-800/40 text-zinc-500 border border-zinc-800"}" title="Suggestions">${r.suggestion_count} Sug</span>
                    <span class="px-2 py-0.5 rounded ${r.nit_count > 0 ? "bg-zinc-800 text-zinc-300 border border-zinc-700/40" : "bg-zinc-800/40 text-zinc-500 border border-zinc-800"}" title="Nits">${r.nit_count} Nit</span>
                  </div>
                </td>
                <td class="py-3.5 px-4 font-mono text-xs text-zinc-300">
                  ${(r.duration_ms / 1000).toFixed(1)}s
                </td>
                <td class="py-3.5 px-4 font-mono text-xs text-zinc-400">
                  ${dateStr}
                </td>
                <td class="py-3.5 px-4 text-right">
                  <button type="button" onclick="event.stopPropagation(); openDrawer(${idx})" class="inline-flex items-center gap-1 text-xs font-medium text-zinc-300 hover:text-white px-2.5 py-1 rounded border border-zinc-700/80 hover:border-zinc-500 transition-colors bg-zinc-900/60">
                    <span>Inspect</span>
                    <svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                  </button>
                </td>
              </tr>
            `;
            })
            .join("\n");

    const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR Reviewer — Developer SaaS Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    code, .font-mono { font-family: 'JetBrains Mono', monospace; }
    /* Subtle custom scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #08090d; }
    ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
  </style>
</head>
<body class="bg-[#08090d] text-[#e1e4ea] min-h-screen antialiased selection:bg-indigo-500/30 selection:text-indigo-200">

  <!-- Linear-Inspired Top Navigation Bar -->
  <header class="border-b border-zinc-800/80 bg-[#0d0f17]/90 backdrop-blur sticky top-0 z-30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
      <!-- Left: Brand & Navigation -->
      <div class="flex items-center gap-6">
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-md bg-zinc-800/90 border border-zinc-700 flex items-center justify-center text-zinc-100 shadow-sm">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="18" cy="18" r="3"></circle>
              <circle cx="6" cy="6" r="3"></circle>
              <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
              <line x1="6" y1="9" x2="6" y2="21"></line>
            </svg>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm tracking-tight text-white">ReviewPulse</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-zinc-800 border border-zinc-700/60">v1.0</span>
          </div>
        </div>

        <nav class="hidden md:flex items-center gap-1 text-xs font-medium text-zinc-400">
          <a href="/dashboard" class="px-3 py-1.5 rounded-md text-white bg-zinc-800/70 border border-zinc-700/50">Overview</a>
          <a href="#reviewsTable" class="px-3 py-1.5 rounded-md hover:text-white hover:bg-zinc-800/40 transition-colors">Audit Log</a>
          <a href="#analyticsSection" class="px-3 py-1.5 rounded-md hover:text-white hover:bg-zinc-800/40 transition-colors">Telemetry</a>
          <button onclick="openSystemModal()" class="px-3 py-1.5 rounded-md hover:text-white hover:bg-zinc-800/40 transition-colors">System Specs</button>
        </nav>
      </div>

      <!-- Right: Connection Status & Engine -->
      <div class="flex items-center gap-3">
        <!-- Live Connection Status -->
        <div class="flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>GitHub App Active</span>
        </div>

        <!-- AI Engine Badge -->
        <div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/80 border border-zinc-800 text-xs font-mono text-zinc-400">
          <span class="text-zinc-500">Engine:</span>
          <span class="text-zinc-200">Gemini 3.5 Flash</span>
        </div>

        <!-- Live Sync Button -->
        <button onclick="syncData()" id="syncBtn" class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono text-zinc-300 hover:text-white hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 transition-all">
          <svg id="syncIcon" class="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          <span>Sync</span>
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

    <!-- Section Header (Clean Linear Style) -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/60 pb-4">
      <div>
        <h1 class="text-base font-semibold text-white tracking-tight">Pull Request Observability & Quality Telemetry</h1>
        <p class="text-xs text-zinc-400 mt-0.5">Continuous automated inspection, defect categorization, and real-time execution metrics.</p>
      </div>
      <div class="flex items-center gap-2 text-xs font-mono text-zinc-400">
        <span id="activeRepoBadge" class="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono">Scope: All Repositories</span>
      </div>
    </div>

    <!-- 4 Compact Vercel-Style Metric Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      <!-- Total PRs Evaluated -->
      <div class="p-4 rounded-lg bg-[#0f1118] border border-zinc-800/80 hover:border-zinc-700 transition-all">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-zinc-400">PRs Evaluated</span>
          <svg class="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M13 6h3a2 2 0 0 1 2 2v7"></path><line x1="6" y1="9" x2="6" y2="21"></line></svg>
        </div>
        <div class="text-2xl font-semibold text-zinc-100 mt-2 font-mono tracking-tight">${total}</div>
        <div class="text-xs text-zinc-400 mt-1 flex items-center gap-1.5 font-sans">
          <span class="text-emerald-400 font-medium">${stats.approved} approved</span>
          <span class="text-zinc-600">•</span>
          <span class="text-rose-400 font-medium">${stats.changesRequested} changes req</span>
        </div>
      </div>

      <!-- Critical Issues Detected -->
      <div class="p-4 rounded-lg bg-[#0f1118] border border-zinc-800/80 hover:border-rose-900/60 transition-all cursor-pointer" onclick="filterByTab('critical')">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-rose-400">Critical Issues Detected</span>
          <svg class="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        </div>
        <div class="text-2xl font-semibold text-rose-400 mt-2 font-mono tracking-tight">${stats.totalCritical}</div>
        <div class="text-xs text-zinc-400 mt-1">
          Security flaws & runtime crashes
        </div>
      </div>

      <!-- Clean Approval Rate -->
      <div class="p-4 rounded-lg bg-[#0f1118] border border-zinc-800/80 hover:border-emerald-900/60 transition-all cursor-pointer" onclick="filterByTab('approved')">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-emerald-400">Clean Approval Rate</span>
          <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>
        <div class="text-2xl font-semibold text-emerald-400 mt-2 font-mono tracking-tight">${approvalRate}%</div>
        <div class="text-xs text-zinc-400 mt-1">
          Passed with zero blocking defects
        </div>
      </div>

      <!-- Mean Review Latency -->
      <div class="p-4 rounded-lg bg-[#0f1118] border border-zinc-800/80 hover:border-zinc-700 transition-all">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-zinc-400">Mean Review Latency</span>
          <svg class="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <div class="text-2xl font-semibold text-zinc-100 mt-2 font-mono tracking-tight">${avgLatencySec}s</div>
        <div class="text-xs text-zinc-400 mt-1">
          From webhook to inline comment
        </div>
      </div>
    </div>

    <!-- Analytics & Telemetry Charts Section (Vercel & Pulsar Inspired) -->
    <div id="analyticsSection" class="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
      <!-- Chart 1: Turnaround Latency Timeline -->
      <div class="p-4 rounded-lg bg-[#0f1118] border border-zinc-800/80 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">Review Turnaround Latency</h2>
            <p class="text-xs text-zinc-500 mt-0.5">Execution duration (seconds) per pull request evaluation</p>
          </div>
          <span class="text-xs font-mono text-zinc-400">${total} total evaluations</span>
        </div>
        <div class="h-44 w-full relative">
          <canvas id="latencyChart"></canvas>
        </div>
      </div>

      <!-- Chart 2: Defect Severity Distribution -->
      <div class="p-4 rounded-lg bg-[#0f1118] border border-zinc-800/80 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">Defect Severity & Resolution Distribution</h2>
            <p class="text-xs text-zinc-500 mt-0.5">Categorized issues discovered across code reviews</p>
          </div>
          <span class="text-xs font-mono text-zinc-400">${totalIssues} total findings</span>
        </div>
        <div class="h-44 w-full relative">
          <canvas id="severityChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Review Audit Log (Main Attraction - GitHub & Linear Style) -->
    <div class="rounded-lg bg-[#0f1118] border border-zinc-800/80 overflow-hidden shadow-sm" id="reviewsTableSection">
      <!-- Table Header & Controls -->
      <div class="p-3.5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0d0f17]">
        <!-- Left: Title & Filter Tabs -->
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-200 font-mono">Review Audit Log</h2>
          <div class="flex items-center bg-zinc-900 border border-zinc-800 rounded-md p-0.5 text-xs">
            <button onclick="filterByTab('all')" id="tab-all" class="px-2.5 py-1 rounded text-white bg-zinc-800 font-medium transition-colors">All (${reviews.length})</button>
            <button onclick="filterByTab('changes')" id="tab-changes" class="px-2.5 py-1 rounded text-zinc-400 hover:text-white font-medium transition-colors">Changes Req (${stats.changesRequested})</button>
            <button onclick="filterByTab('approved')" id="tab-approved" class="px-2.5 py-1 rounded text-zinc-400 hover:text-white font-medium transition-colors">Approved (${stats.approved})</button>
            <button onclick="filterByTab('critical')" id="tab-critical" class="px-2.5 py-1 rounded text-zinc-400 hover:text-white font-medium transition-colors">Has Critical (${reviews.filter(r => r.critical_count > 0).length})</button>
          </div>
        </div>

        <!-- Right: Repository Dropdown & Search Input -->
        <div class="flex flex-wrap items-center gap-2">
          <!-- Repo Selector Dropdown -->
          <div class="relative">
            <select id="repoSelect" onchange="applyFilters()" class="bg-[#141722] border border-zinc-800 hover:border-zinc-700 rounded-md px-2.5 py-1 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer">
              <option value="">All Repositories (${uniqueRepos.length})</option>
              ${uniqueRepos.map(r => `<option value="${r}" ${filterRepo === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>
          </div>

          <div class="relative w-full sm:w-56">
            <svg class="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" id="searchInput" onkeyup="applyFilters()" placeholder="Filter title, author..." class="w-full bg-[#141722] border border-zinc-800 hover:border-zinc-700 rounded-md pl-8 pr-2.5 py-1 text-xs text-zinc-200 font-mono placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors">
          </div>
          <span id="rowCountPill" class="text-xs font-mono text-zinc-500 whitespace-nowrap">${reviews.length} total</span>
        </div>
      </div>

      <!-- Table Content -->
      <div class="overflow-x-auto">
        <table class="w-full text-left" id="reviewsTable">
          <thead class="bg-zinc-900/60 text-[11px] font-mono uppercase text-zinc-400 border-b border-zinc-800/80">
            <tr>
              <th class="py-2.5 px-4 font-medium">Repository & Pull Request</th>
              <th class="py-2.5 px-4 font-medium">Author</th>
              <th class="py-2.5 px-4 font-medium">Assessment</th>
              <th class="py-2.5 px-4 font-medium">Findings Breakdown</th>
              <th class="py-2.5 px-4 font-medium">Turnaround</th>
              <th class="py-2.5 px-4 font-medium">Evaluated</th>
              <th class="py-2.5 px-4 font-medium text-right">Inspect</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800/40">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <!-- Slide-Over Inspection Drawer (Linear & Sentry Style) -->
  <div id="drawerBackdrop" class="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 hidden transition-opacity opacity-0" onclick="closeDrawer()"></div>
  
  <aside id="inspectionDrawer" class="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-[#0c0e15] border-l border-zinc-800 shadow-2xl z-50 transform translate-x-full transition-transform duration-200 ease-in-out flex flex-col">
    <!-- Drawer Header -->
    <div class="p-4 border-b border-zinc-800 bg-[#0e1018] flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-7 h-7 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M13 6h3a2 2 0 0 1 2 2v7"></path><line x1="6" y1="9" x2="6" y2="21"></line></svg>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span id="drawerRepo" class="text-xs font-mono text-zinc-400"></span>
            <span id="drawerPrNumber" class="text-xs font-mono text-zinc-500"></span>
          </div>
          <h3 id="drawerPrTitle" class="text-sm font-semibold text-white truncate max-w-md"></h3>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <a id="drawerGithubLink" href="#" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-white rounded border border-zinc-700 hover:border-zinc-500 transition-colors flex items-center gap-1.5">
          <span>Open on GitHub</span>
          <svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
        </a>
        <button onclick="closeDrawer()" class="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors" title="Close (Esc)">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
    </div>

    <!-- Quick Meta Bar -->
    <div class="px-5 py-2.5 bg-[#090b10] border-b border-zinc-800/80 flex flex-wrap items-center justify-between text-xs font-mono gap-2">
      <div class="flex items-center gap-2">
        <span id="drawerVerdictBadge" class="px-2 py-0.5 rounded-full border"></span>
        <span class="text-zinc-500">•</span>
        <span id="drawerAuthor" class="text-zinc-400"></span>
      </div>
      <div class="flex items-center gap-3 text-zinc-400">
        <span id="drawerDuration"></span>
        <span>•</span>
        <span id="drawerTimestamp"></span>
      </div>
    </div>

    <!-- Drawer Body (Scrollable) -->
    <div class="flex-1 overflow-y-auto p-5 space-y-5">
      <!-- Executive Summary Box -->
      <div class="space-y-1.5">
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
          <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
          <span>Executive Review Assessment</span>
        </div>
        <div class="p-3.5 rounded-md bg-[#11131c] border border-zinc-800 text-xs text-zinc-300 leading-relaxed font-sans" id="drawerSummary">
        </div>
      </div>

      <!-- Line-Specific Code Findings -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
            <svg class="w-3.5 h-3.5 text-rose-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>Code Findings & Remediations</span>
            <span id="drawerFindingsCount" class="text-zinc-500"></span>
          </div>
          <!-- Severity Filter Inside Drawer -->
          <div class="flex items-center gap-1 text-[11px] font-mono">
            <button onclick="filterDrawerFindings('all')" id="df-all" class="px-2 py-0.5 rounded bg-zinc-800 text-white">All</button>
            <button onclick="filterDrawerFindings('critical')" id="df-critical" class="px-2 py-0.5 rounded text-zinc-400 hover:text-white">Critical</button>
            <button onclick="filterDrawerFindings('suggestion')" id="df-suggestion" class="px-2 py-0.5 rounded text-zinc-400 hover:text-white">Suggestions</button>
          </div>
        </div>

        <!-- Findings List Container -->
        <div id="drawerFindingsList" class="space-y-3">
          <!-- Populated dynamically via JS -->
        </div>
      </div>
    </div>
  </aside>

  <!-- System Status Modal -->
  <div id="systemModal" class="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 hidden flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-[#0f1118] border border-zinc-800 rounded-lg p-5 space-y-4 shadow-2xl">
      <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </div>
          <h3 class="text-sm font-semibold text-white">System Architecture & Infrastructure</h3>
        </div>
        <button onclick="closeSystemModal()" class="text-zinc-400 hover:text-white p-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <div class="space-y-2.5 text-xs font-mono">
        <div class="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80">
          <span class="text-zinc-400">GitHub App ID</span>
          <span class="text-zinc-200">5726031</span>
        </div>
        <div class="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80">
          <span class="text-zinc-400">Installation ID</span>
          <span class="text-zinc-200">181190393</span>
        </div>
        <div class="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80">
          <span class="text-zinc-400">Webhook Route</span>
          <span class="text-emerald-400">/webhook (HMAC SHA-256)</span>
        </div>
        <div class="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80">
          <span class="text-zinc-400">Smee Proxy Tunnel</span>
          <span class="text-indigo-400 truncate max-w-[200px]" title="https://smee.io/4R7C7pdS9tO9ldqz">smee.io/4R7C7pdS...</span>
        </div>
        <div class="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80">
          <span class="text-zinc-400">AI Model Stack</span>
          <span class="text-zinc-200">Gemini 3.5 Flash &rarr; 3.1 Flash-Lite</span>
        </div>
        <div class="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80">
          <span class="text-zinc-400">Datastore</span>
          <span class="text-zinc-200">SQLite (reviews.db)</span>
        </div>
      </div>

      <div class="pt-2 flex justify-end">
        <button onclick="closeSystemModal()" class="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors">Close</button>
      </div>
    </div>
  </div>

  <!-- Raw Reviews Data Injected into Client JS -->
  <script id="reviewsDataScript" type="application/json">
    ${reviewsJsonEscaped}
  </script>

  <script>
    // State management
    const allReviews = JSON.parse(document.getElementById('reviewsDataScript').textContent);
    let activeTab = 'all';
    let currentDrawerReview = null;
    let currentDrawerFindingsFilter = 'all';

    // 1. Chart.js Telemetry Initializations
    document.addEventListener('DOMContentLoaded', () => {
      initLatencyChart();
      initSeverityChart();
      applyFilters();
    });

    function initLatencyChart() {
      const ctx = document.getElementById('latencyChart');
      if (!ctx) return;

      const labels = allReviews.map(r => '#' + r.prNumber).reverse();
      const data = allReviews.map(r => (r.durationMs / 1000).toFixed(1)).reverse();

      new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels.length ? labels : ['PR #1'],
          datasets: [{
            label: 'Review Latency (s)',
            data: data.length ? data : [0],
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.12)',
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointBackgroundColor: '#818cf8',
            pointRadius: 4,
            pointHoverRadius: 6,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#11131c',
              borderColor: '#27272a',
              borderWidth: 1,
              titleColor: '#e4e4e7',
              bodyColor: '#a1a1aa',
              padding: 10,
              displayColors: false,
              callbacks: {
                label: function(context) {
                  return 'Turnaround: ' + context.parsed.y + ' seconds';
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.04)' },
              ticks: { color: '#71717a', font: { family: 'JetBrains Mono', size: 10 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(255, 255, 255, 0.04)' },
              ticks: { color: '#71717a', font: { family: 'JetBrains Mono', size: 10 }, callback: v => v + 's' }
            }
          }
        }
      });
    }

    function initSeverityChart() {
      const ctx = document.getElementById('severityChart');
      if (!ctx) return;

      const labels = allReviews.map(r => '#' + r.prNumber).reverse();
      const criticalData = allReviews.map(r => r.criticalCount).reverse();
      const suggestionData = allReviews.map(r => r.suggestionCount).reverse();
      const nitData = allReviews.map(r => r.nitCount).reverse();

      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels.length ? labels : ['PR #1'],
          datasets: [
            {
              label: 'Critical',
              data: criticalData.length ? criticalData : [0],
              backgroundColor: '#f43f5e',
              borderRadius: 3,
            },
            {
              label: 'Suggestions',
              data: suggestionData.length ? suggestionData : [0],
              backgroundColor: '#fbbf24',
              borderRadius: 3,
            },
            {
              label: 'Nits',
              data: nitData.length ? nitData : [0],
              backgroundColor: '#71717a',
              borderRadius: 3,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: {
                color: '#a1a1aa',
                boxWidth: 8,
                boxHeight: 8,
                font: { family: 'Inter', size: 11 }
              }
            },
            tooltip: {
              backgroundColor: '#11131c',
              borderColor: '#27272a',
              borderWidth: 1,
              titleColor: '#e4e4e7',
              bodyColor: '#a1a1aa',
              padding: 10
            }
          },
          scales: {
            x: {
              stacked: true,
              grid: { color: 'rgba(255, 255, 255, 0.04)' },
              ticks: { color: '#71717a', font: { family: 'JetBrains Mono', size: 10 } }
            },
            y: {
              stacked: true,
              beginAtZero: true,
              grid: { color: 'rgba(255, 255, 255, 0.04)' },
              ticks: { color: '#71717a', font: { family: 'JetBrains Mono', size: 10 }, stepSize: 1 }
            }
          }
        }
      });
    }

    // 2. Filter Table Logic
    function filterByTab(tab) {
      activeTab = tab;
      const tabs = ['all', 'changes', 'approved', 'critical'];
      tabs.forEach(t => {
        const btn = document.getElementById('tab-' + t);
        if (btn) {
          if (t === tab) {
            btn.className = 'px-2.5 py-1 rounded text-white bg-zinc-800 font-medium transition-colors';
          } else {
            btn.className = 'px-2.5 py-1 rounded text-zinc-400 hover:text-white font-medium transition-colors';
          }
        }
      });
      applyFilters();
    }

    function applyFilters() {
      const search = (document.getElementById('searchInput').value || '').toLowerCase();
      const selectedRepo = (document.getElementById('repoSelect')?.value || '').toLowerCase();
      const rows = document.querySelectorAll('.review-row');
      let visibleCount = 0;

      rows.forEach(row => {
        const repo = (row.getAttribute('data-repo') || '').toLowerCase();
        const author = (row.getAttribute('data-author') || '').toLowerCase();
        const decision = row.getAttribute('data-decision') || '';
        const critCount = parseInt(row.getAttribute('data-critical') || '0', 10);

        const repoMatches = !selectedRepo || repo === selectedRepo;
        const textMatches = !search || repo.includes(search) || author.includes(search) || row.textContent.toLowerCase().includes(search);

        let tabMatches = true;
        if (activeTab === 'changes') {
          tabMatches = decision === 'request_changes';
        } else if (activeTab === 'approved') {
          tabMatches = decision === 'approve';
        } else if (activeTab === 'critical') {
          tabMatches = critCount > 0;
        }

        if (repoMatches && textMatches && tabMatches) {
          row.style.display = '';
          visibleCount++;
        } else {
          row.style.display = 'none';
        }
      });

      const pill = document.getElementById('rowCountPill');
      if (pill) {
        pill.textContent = visibleCount + ' of ' + rows.length + ' PRs';
      }

      const activeBadge = document.getElementById('activeRepoBadge');
      if (activeBadge) {
        activeBadge.textContent = selectedRepo ? 'Scope: ' + selectedRepo : 'Scope: All Repositories';
      }
    }

    // 3. Slide-over Inspection Drawer Logic
    function openDrawer(idx) {
      const review = allReviews[idx];
      if (!review) return;

      currentDrawerReview = review;
      currentDrawerFindingsFilter = 'all';

      // Set Header info
      document.getElementById('drawerRepo').textContent = review.repo;
      document.getElementById('drawerPrNumber').textContent = '#' + review.prNumber;
      document.getElementById('drawerPrTitle').textContent = review.prTitle;
      document.getElementById('drawerGithubLink').href = 'https://github.com/' + review.repo + '/pull/' + review.prNumber;
      document.getElementById('drawerAuthor').textContent = '@' + review.author;
      document.getElementById('drawerDuration').textContent = (review.durationMs / 1000).toFixed(1) + 's latency';
      document.getElementById('drawerTimestamp').textContent = new Date(review.createdAt).toLocaleString();

      // Verdict badge
      const isApproved = review.assessment === 'APPROVE';
      const isChanges = review.assessment === 'REQUEST_CHANGES';
      const vBadge = document.getElementById('drawerVerdictBadge');
      if (isApproved) {
        vBadge.className = 'px-2 py-0.5 rounded-full border bg-emerald-950/40 text-emerald-400 border-emerald-800/40';
        vBadge.textContent = 'Approved';
      } else if (isChanges) {
        vBadge.className = 'px-2 py-0.5 rounded-full border bg-rose-950/40 text-rose-400 border-rose-800/40';
        vBadge.textContent = 'Changes Requested';
      } else {
        vBadge.className = 'px-2 py-0.5 rounded-full border bg-zinc-800 text-zinc-300 border-zinc-700';
        vBadge.textContent = 'Commentary';
      }

      // Summary
      document.getElementById('drawerSummary').textContent = review.summary;

      // Findings Count
      const count = review.findings ? review.findings.length : 0;
      document.getElementById('drawerFindingsCount').textContent = '(' + count + ')';

      // Reset drawer filter buttons
      setDrawerFilterButtonState('all');

      // Render Findings
      renderDrawerFindings();

      // Open drawer UI
      const drawer = document.getElementById('inspectionDrawer');
      const backdrop = document.getElementById('drawerBackdrop');
      backdrop.classList.remove('hidden');
      setTimeout(() => {
        backdrop.classList.remove('opacity-0');
        drawer.classList.remove('translate-x-full');
      }, 10);

      document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
      const drawer = document.getElementById('inspectionDrawer');
      const backdrop = document.getElementById('drawerBackdrop');
      drawer.classList.add('translate-x-full');
      backdrop.classList.add('opacity-0');
      setTimeout(() => {
        backdrop.classList.add('hidden');
        document.body.style.overflow = '';
      }, 200);
    }

    function filterDrawerFindings(type) {
      currentDrawerFindingsFilter = type;
      setDrawerFilterButtonState(type);
      renderDrawerFindings();
    }

    function setDrawerFilterButtonState(type) {
      ['all', 'critical', 'suggestion'].forEach(t => {
        const btn = document.getElementById('df-' + t);
        if (btn) {
          if (t === type) {
            btn.className = 'px-2 py-0.5 rounded bg-zinc-800 text-white font-medium';
          } else {
            btn.className = 'px-2 py-0.5 rounded text-zinc-400 hover:text-white';
          }
        }
      });
    }

    function renderDrawerFindings() {
      const container = document.getElementById('drawerFindingsList');
      if (!currentDrawerReview || !currentDrawerReview.findings || currentDrawerReview.findings.length === 0) {
        container.innerHTML = '<p class="text-xs text-zinc-400 italic p-3 rounded bg-[#0a0c12] border border-zinc-800">No line-specific defects were detected in this review diff.</p>';
        return;
      }

      let findings = currentDrawerReview.findings;
      if (currentDrawerFindingsFilter === 'critical') {
        findings = findings.filter(f => f.severity === 'CRITICAL');
      } else if (currentDrawerFindingsFilter === 'suggestion') {
        findings = findings.filter(f => f.severity === 'SUGGESTION');
      }

      if (findings.length === 0) {
        container.innerHTML = '<p class="text-xs text-zinc-400 italic p-3 rounded bg-[#0a0c12] border border-zinc-800">No findings match the selected severity filter.</p>';
        return;
      }

      container.innerHTML = findings.map((f, i) => {
        const isCrit = f.severity === 'CRITICAL';
        const isSug = f.severity === 'SUGGESTION';

        const badgeClass = isCrit
          ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
          : isSug
          ? 'bg-amber-950/60 text-amber-300 border-amber-800/50'
          : 'bg-zinc-800 text-zinc-300 border-zinc-700/60';

        // Extract potential code fix or recommendation if present
        let commentText = f.comment;
        let suggestionBlock = '';
        if (commentText.includes('Use parameterized queries:')) {
          suggestionBlock = \`db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);\`;
        } else if (commentText.includes('process.env.JWT_SECRET')) {
          suggestionBlock = \`const JWT_SECRET = process.env.JWT_SECRET;\`;
        } else if (commentText.includes('Missing return')) {
          suggestionBlock = \`if (!user) { return res.status(401).json({ error: "Invalid credentials" }); }\`;
        } else if (commentText.includes('try/catch')) {
          suggestionBlock = \`try {\\n  const result = await db.query(...);\\n} catch (err) {\\n  return res.status(500).json({ error: "Database error" });\\n}\`;
        }

        return \`
          <div class="rounded-lg bg-[#0a0c12] border border-zinc-800/90 overflow-hidden shadow-sm space-y-3 p-4">
            <!-- Finding Header -->
            <div class="flex items-center justify-between text-xs font-mono">
              <div class="flex items-center gap-2 text-zinc-200">
                <svg class="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span class="font-semibold">\${escapeHtml(f.path)}</span>
                <span class="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 text-[11px]">:L\${f.line}</span>
              </div>
              <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border \${badgeClass}">
                \${f.severity}
              </span>
            </div>

            <!-- Code Context Preview with Line Numbering -->
            <div class="bg-[#050608] rounded border border-zinc-800/80 font-mono text-[11px] overflow-x-auto">
              <div class="px-3 py-1.5 border-b border-zinc-800/60 bg-[#090b10] text-[10px] text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                <span>Affected Code Segment</span>
                <span>Line \${f.line}</span>
              </div>
              <div class="p-3 text-zinc-300 space-y-1">
                <div class="flex items-center gap-3 text-zinc-600 select-none">
                  <span class="w-6 text-right">\${Math.max(1, f.line - 1)}</span>
                  <span class="text-zinc-500">// Context</span>
                </div>
                <div class="flex items-center gap-3 bg-rose-950/40 text-rose-200 -mx-3 px-3 py-0.5 border-l-2 border-rose-500">
                  <span class="w-6 text-right text-rose-400 font-bold">\${f.line}</span>
                  <span class="font-semibold">\${escapeHtml(commentText.split(':')[0] || 'Defect line')}</span>
                </div>
                <div class="flex items-center gap-3 text-zinc-600 select-none">
                  <span class="w-6 text-right">\${f.line + 1}</span>
                  <span class="text-zinc-500">// Context</span>
                </div>
              </div>
            </div>

            <!-- AI Explanation -->
            <div class="text-xs text-zinc-300 font-sans leading-relaxed">
              <span class="font-semibold text-zinc-100 font-mono text-[11px]">Explanation:</span> \${escapeHtml(commentText)}
            </div>

            <!-- Remediation Suggestion -->
            \${suggestionBlock ? \`
              <div class="rounded bg-[#0d101a] border border-indigo-900/40 p-3 space-y-1.5">
                <div class="flex items-center gap-1.5 text-[10px] font-mono uppercase text-indigo-400 font-semibold tracking-wider">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                  <span>Recommended Fix</span>
                </div>
                <pre class="font-mono text-xs text-indigo-200 overflow-x-auto p-2 bg-[#060810] rounded border border-indigo-950/60"><code>\${escapeHtml(suggestionBlock)}</code></pre>
              </div>
            \` : ''}
          </div>
        \`;
      }).join('');
    }

    // 4. System Specs Modal
    function openSystemModal() {
      document.getElementById('systemModal').classList.remove('hidden');
    }

    function closeSystemModal() {
      document.getElementById('systemModal').classList.add('hidden');
    }

    // 5. Sync Action
    function syncData() {
      const icon = document.getElementById('syncIcon');
      icon.classList.add('animate-spin');
      setTimeout(() => {
        window.location.reload();
      }, 400);
    }

    // Keyboard listener (Esc closes drawers/modals)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDrawer();
        closeSystemModal();
      }
    });

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  </script>
</body>
</html>`;

    res.send(html);
  } catch (error: any) {
    const errorHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <title>PR Reviewer — Telemetry Error</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>body { font-family: 'Inter', sans-serif; } code, .font-mono { font-family: 'JetBrains Mono', monospace; }</style>
</head>
<body class="bg-[#08090d] text-zinc-100 min-h-screen flex items-center justify-center p-6">
  <div class="max-w-md w-full bg-[#0f1118] border border-zinc-800 rounded-lg p-6 space-y-4 shadow-xl">
    <div class="flex items-center gap-2.5 text-rose-400">
      <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <h2 class="text-sm font-semibold">Telemetry Service Interruption</h2>
    </div>
    <p class="text-xs text-zinc-400 leading-relaxed">
      Unable to query the review datastore. Check your database connectivity and ensure the local SQLite file is accessible.
    </p>
    <div class="bg-zinc-950 p-3 rounded border border-zinc-800/80 font-mono text-[11px] text-rose-300 break-all">
      ${escapeHtml(error.message || "Unknown datastore exception")}
    </div>
    <div class="pt-2 flex justify-end gap-2">
      <button onclick="window.location.reload()" class="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition-colors">Retry Connection</button>
    </div>
  </div>
</body>
</html>`;
    res.status(500).send(errorHtml);
  }
});

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
