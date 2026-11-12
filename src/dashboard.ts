import { Router } from "express";
import { getRecentReviews, getReviewStats, ReviewStats } from "./db";

export const dashboardRouter = Router();

// JSON API: stats
dashboardRouter.get("/api/stats", async (_req, res) => {
  try {
    const stats = await getReviewStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// JSON API: recent reviews
dashboardRouter.get("/api/reviews", async (_req, res) => {
  try {
    const reviews = await getRecentReviews();
    res.json(reviews);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// HTML Dashboard UI - Linear, Vercel & GitHub Inspired Developer SaaS Console
dashboardRouter.get("/dashboard", async (_req, res) => {
  try {
    const stats = await getReviewStats();
    const reviews = await getRecentReviews(50);

    const total = stats.totalReviews;
    const approvalRate = total > 0 ? Math.round((stats.approved / total) * 100) : 0;
    const changesRate = total > 0 ? Math.round((stats.changesRequested / total) * 100) : 0;
    const commentsRate = total > 0 ? Math.round((stats.commentsOnly / total) * 100) : 0;

    const totalIssues = stats.totalComments;
    const avgLatencySec = stats.avgDurationMs > 0 ? (stats.avgDurationMs / 1000).toFixed(1) : "0.0";

    const rowsHtml =
      reviews.length === 0
        ? `
        <tr id="emptyStateRow">
          <td colspan="7" class="py-16 text-center">
            <div class="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
              <div class="w-9 h-9 rounded-md bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-400">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <circle cx="18" cy="18" r="3"></circle>
                  <circle cx="6" cy="6" r="3"></circle>
                  <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
                  <line x1="6" y1="9" x2="6" y2="21"></line>
                </svg>
              </div>
              <div>
                <p class="text-sm font-medium text-zinc-200">No pull request reviews recorded</p>
                <p class="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Open a pull request on your connected repository to stream real-time code reviews, defect analysis, and execution telemetry.
                </p>
              </div>
              <div class="pt-2 flex items-center gap-2 text-xs font-mono text-zinc-400">
                <span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Gateway active on /webhook</span>
              </div>
            </div>
          </td>
        </tr>
      `
        : reviews
            .map((r, idx) => {
              const isApproved = r.assessment === "APPROVE";
              const isChanges = r.assessment === "REQUEST_CHANGES";

              const badgeClass = isApproved
                ? "bg-emerald-950/40 text-emerald-300 border-emerald-800/50"
                : isChanges
                ? "bg-rose-950/40 text-rose-300 border-rose-800/50"
                : "bg-zinc-800/60 text-zinc-300 border-zinc-700/60";

              const dotClass = isApproved
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

              // Parse findings JSON if available
              let findingsList: Array<{ path: string; line: number; severity: string; comment: string }> = [];
              try {
                if (r.findings) {
                  findingsList = typeof r.findings === "string" ? JSON.parse(r.findings) : r.findings;
                }
              } catch {
                findingsList = [];
              }

              const findingsHtml =
                findingsList.length === 0
                  ? `<div class="p-3 rounded bg-[#0b0d13] border border-zinc-800 text-xs text-zinc-400 italic">No line-specific defects found in this diff.</div>`
                  : findingsList
                      .map((f, fIdx) => {
                        const sevBadge =
                          f.severity === "CRITICAL"
                            ? "bg-rose-950/70 text-rose-300 border-rose-800/60"
                            : f.severity === "SUGGESTION"
                            ? "bg-amber-950/60 text-amber-300 border-amber-800/50"
                            : "bg-zinc-800 text-zinc-300 border-zinc-700/60";

                        const sevDot =
                          f.severity === "CRITICAL"
                            ? "bg-rose-400"
                            : f.severity === "SUGGESTION"
                            ? "bg-amber-400"
                            : "bg-zinc-400";

                        return `
                        <div class="p-3 rounded-md bg-[#0a0c12] border border-zinc-800/80 hover:border-zinc-700/80 transition-colors space-y-2 finding-item" data-severity="${escapeHtml(f.severity.toLowerCase())}">
                          <div class="flex items-center justify-between text-xs font-mono">
                            <div class="flex items-center gap-2 text-zinc-200 font-medium">
                              <svg class="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                              <span>${escapeHtml(f.path)}<span class="text-zinc-500">:L${f.line}</span></span>
                            </div>
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${sevBadge}">
                              <span class="w-1 h-1 rounded-full ${sevDot}"></span>
                              ${escapeHtml(f.severity)}
                            </span>
                          </div>
                          <p class="text-xs text-zinc-300 leading-relaxed font-sans pl-1">${escapeHtml(f.comment)}</p>
                        </div>
                      `;
                      })
                      .join("\n");

              return `
              <!-- Main Review Row -->
              <tr class="border-b border-zinc-800/60 hover:bg-zinc-900/40 transition-colors group cursor-pointer review-row" 
                  id="row-${idx}" 
                  data-repo="${escapeHtml(r.repo.toLowerCase())}" 
                  data-author="${escapeHtml(r.author.toLowerCase())}" 
                  data-decision="${escapeHtml(r.assessment.toLowerCase())}"
                  data-critical="${r.critical_count}"
                  data-suggestion="${r.suggestion_count}"
                  data-nit="${r.nit_count}"
                  onclick="toggleDetails(${idx})">
                <td class="py-3 px-4">
                  <div class="flex flex-col">
                    <span class="text-[11px] font-mono text-zinc-400">${escapeHtml(r.repo)}</span>
                    <a href="https://github.com/${r.repo}/pull/${r.pr_number}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-zinc-100 hover:text-indigo-400 transition-colors mt-0.5 flex items-center gap-1.5" onclick="event.stopPropagation()">
                      <span>#${r.pr_number} ${escapeHtml(String(r.pr_title))}</span>
                      <svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </a>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <span class="text-xs font-mono text-zinc-300">@${escapeHtml(r.author)}</span>
                </td>
                <td class="py-3 px-4">
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border ${badgeClass}">
                    <span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span>
                    ${verdictLabel}
                  </span>
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center gap-1.5 text-xs font-mono">
                    <span class="px-2 py-0.5 rounded ${r.critical_count > 0 ? "bg-rose-950/50 text-rose-300 border border-rose-900/40 font-semibold" : "bg-zinc-800/40 text-zinc-500 border border-zinc-800"}" title="Critical bugs & security flaws">${r.critical_count} Crit</span>
                    <span class="px-2 py-0.5 rounded ${r.suggestion_count > 0 ? "bg-amber-950/40 text-amber-300 border border-amber-900/30 font-medium" : "bg-zinc-800/40 text-zinc-500 border border-zinc-800"}" title="Suggestions & best practices">${r.suggestion_count} Sug</span>
                    <span class="px-2 py-0.5 rounded ${r.nit_count > 0 ? "bg-zinc-800 text-zinc-300 border border-zinc-700/40" : "bg-zinc-800/40 text-zinc-500 border border-zinc-800"}" title="Minor code nits">${r.nit_count} Nit</span>
                  </div>
                </td>
                <td class="py-3 px-4 font-mono text-xs text-zinc-300">
                  ${(r.duration_ms / 1000).toFixed(1)}s
                </td>
                <td class="py-3 px-4 font-mono text-xs text-zinc-400">
                  ${dateStr}
                </td>
                <td class="py-3 px-4 text-right">
                  <button type="button" class="inline-flex items-center gap-1 text-xs font-medium text-zinc-300 hover:text-white px-2.5 py-1 rounded border border-zinc-700/80 hover:border-zinc-500 transition-colors">
                    <span id="btn-label-${idx}">Inspect (${findingsList.length})</span>
                    <svg class="w-3 h-3 transform transition-transform" id="arrow-${idx}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path></svg>
                  </button>
                </td>
              </tr>

              <!-- Detailed PR Review Drawer (File names, Line numbers, AI Explanations) -->
              <tr id="details-${idx}" class="hidden border-b border-zinc-800/80 bg-[#0c0d12]/95 details-row">
                <td colspan="7" class="p-4 sm:p-5">
                  <div class="space-y-4 max-w-5xl">
                    <!-- Executive Summary -->
                    <div class="space-y-1.5 bg-[#0e1017] p-3.5 rounded border border-zinc-800/70">
                      <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                        <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        <span>Executive Review Assessment</span>
                      </div>
                      <p class="text-xs text-zinc-200 leading-relaxed font-sans pl-5 border-l-2 border-indigo-500/50 py-0.5">
                        ${escapeHtml(r.summary)}
                      </p>
                    </div>

                    <!-- Line-by-Line Findings List -->
                    <div class="space-y-2">
                      <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                        <span>Code Findings & Remediations (${findingsList.length})</span>
                        <a href="https://github.com/${r.repo}/pull/${r.pr_number}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:text-indigo-300 font-normal lowercase flex items-center gap-1">
                          <span>view on github</span>
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                        </a>
                      </div>
                      <div class="space-y-2">
                        ${findingsHtml}
                      </div>
                    </div>
                  </div>
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
  <title>PR Reviewer — Developer Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    code, .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-[#090a0f] text-[#e1e4ea] min-h-screen antialiased">
  <!-- Minimal Top Navigation (Linear Inspired) -->
  <header class="border-b border-zinc-800/80 bg-[#0d0e14]/90 backdrop-blur sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 h-13 flex items-center justify-between py-2.5">
      <div class="flex items-center gap-3">
        <!-- Git Pull Request Brand Icon -->
        <div class="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
            <line x1="6" y1="9" x2="6" y2="21"></line>
          </svg>
        </div>
        <div class="flex items-center gap-2 text-xs font-medium text-white">
          <span class="font-semibold">PR Reviewer</span>
          <span class="text-zinc-600 font-normal">/</span>
          <span class="text-zinc-400 font-mono">Console</span>
        </div>
      </div>

      <!-- System Health Indicator -->
      <div class="flex items-center gap-3 text-xs font-mono">
        <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>Gateway Active</span>
        </div>
        <div class="hidden sm:flex items-center gap-1.5 text-zinc-400">
          <span>Engine:</span>
          <span class="text-zinc-200">Gemini 3.5 Flash</span>
        </div>
        <button onclick="window.location.reload()" class="text-zinc-400 hover:text-zinc-200 text-xs font-mono flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-zinc-800/60" title="Refresh Telemetry">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          <span class="hidden sm:inline">Sync</span>
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
    <!-- Header Title Bar -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/70 pb-4">
      <div>
        <h1 class="text-lg font-bold tracking-tight text-white">Pull Request Observability & Findings</h1>
        <p class="text-xs text-zinc-400 mt-0.5">Automated code reviews, defect detection rates, and autonomous feedback telemetry.</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-mono text-zinc-400 px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
          GitHub App ID: 5726031
        </span>
      </div>
    </div>

    <!-- 4 High-Impact KPI Cards (Clean Vercel/Linear Metric Cards) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      <!-- Total PRs Evaluated -->
      <div onclick="filterBySeverity('all')" class="p-4 rounded-md bg-[#10121a] border border-zinc-800/80 hover:border-zinc-700/80 cursor-pointer transition-all">
        <div class="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Total PRs Evaluated</div>
        <div class="text-2xl font-bold text-white mt-1 font-mono tracking-tight">${total}</div>
        <div class="text-xs text-zinc-400 mt-1 flex items-center gap-1.5 font-sans">
          <span class="text-rose-400">${stats.changesRequested} changes req</span>
          <span class="text-zinc-600">•</span>
          <span class="text-emerald-400">${stats.approved} approved</span>
        </div>
      </div>

      <!-- Critical Issues Detected -->
      <div onclick="filterBySeverity('critical')" class="p-4 rounded-md bg-[#10121a] border border-zinc-800/80 hover:border-rose-900/60 cursor-pointer transition-all">
        <div class="text-[11px] font-mono text-rose-400 uppercase tracking-wider">Critical Issues Detected</div>
        <div class="text-2xl font-bold text-rose-400 mt-1 font-mono tracking-tight">${stats.totalCritical}</div>
        <div class="text-xs text-zinc-400 mt-1 font-sans">
          Security flaws & runtime crashes
        </div>
      </div>

      <!-- Clean Pass Rate -->
      <div onclick="filterBySeverity('approved')" class="p-4 rounded-md bg-[#10121a] border border-zinc-800/80 hover:border-emerald-900/60 cursor-pointer transition-all">
        <div class="text-[11px] font-mono text-emerald-400 uppercase tracking-wider">Clean Pass Rate</div>
        <div class="text-2xl font-bold text-emerald-400 mt-1 font-mono tracking-tight">${approvalRate}%</div>
        <div class="text-xs text-zinc-400 mt-1 font-sans">
          PRs approved without blocking defects
        </div>
      </div>

      <!-- Mean Review Latency -->
      <div class="p-4 rounded-md bg-[#10121a] border border-zinc-800/80">
        <div class="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Mean Review Latency</div>
        <div class="text-2xl font-bold text-zinc-100 mt-1 font-mono tracking-tight">${avgLatencySec}s</div>
        <div class="text-xs text-zinc-400 mt-1 font-sans">
          From webhook ingestion to inline comment
        </div>
      </div>
    </div>

    <!-- Review Activity Trends & Defect Breakdown (2 Columns) -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
      <!-- Decisions Breakdown -->
      <div class="p-4 rounded-md bg-[#10121a] border border-zinc-800/80 space-y-2.5">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">Review Decision Distribution</h2>
          <span class="text-xs font-mono text-zinc-500">${total} evaluations</span>
        </div>

        <div class="space-y-2 pt-1 font-mono text-xs">
          <!-- Changes Requested -->
          <div>
            <div class="flex justify-between mb-1">
              <span class="text-rose-400">Changes Requested (Blockers)</span>
              <span class="text-zinc-300">${stats.changesRequested} <span class="text-zinc-500">(${changesRate}%)</span></span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div class="h-full bg-rose-500 rounded-full" style="width: ${changesRate}%"></div>
            </div>
          </div>

          <!-- Approved -->
          <div>
            <div class="flex justify-between mb-1">
              <span class="text-emerald-400">Approved (Clean)</span>
              <span class="text-zinc-300">${stats.approved} <span class="text-zinc-500">(${approvalRate}%)</span></span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div class="h-full bg-emerald-500 rounded-full" style="width: ${approvalRate}%"></div>
            </div>
          </div>

          <!-- Commentary -->
          <div>
            <div class="flex justify-between mb-1">
              <span class="text-zinc-400">Commentary (Advisory)</span>
              <span class="text-zinc-300">${stats.commentsOnly} <span class="text-zinc-500">(${commentsRate}%)</span></span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div class="h-full bg-zinc-400 rounded-full" style="width: ${commentsRate}%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Defect Severity Categorization (Interactive inspection) -->
      <div class="p-4 rounded-md bg-[#10121a] border border-zinc-800/80 space-y-2.5">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">Defect Severity Categorization</h2>
          <span class="text-xs font-mono text-zinc-500">${totalIssues} total issues detected</span>
        </div>

        <div class="grid grid-cols-3 gap-2 pt-1">
          <!-- Critical Button -->
          <button type="button" onclick="filterBySeverity('critical')" id="btn-filter-critical" class="p-2.5 rounded bg-[#0b0d13] border border-zinc-800/90 hover:border-rose-800/80 transition-all text-center group cursor-pointer">
            <span class="text-[10px] font-mono text-rose-400 uppercase block font-semibold group-hover:text-rose-300">Critical</span>
            <span class="text-lg font-bold text-rose-400 mt-0.5 block font-mono">${stats.totalCritical}</span>
            <span class="text-[10px] text-zinc-500 mt-0.5 block">Security & crash</span>
          </button>

          <!-- Suggestions Button -->
          <button type="button" onclick="filterBySeverity('suggestion')" id="btn-filter-suggestion" class="p-2.5 rounded bg-[#0b0d13] border border-zinc-800/90 hover:border-amber-800/80 transition-all text-center group cursor-pointer">
            <span class="text-[10px] font-mono text-amber-400 uppercase block font-semibold group-hover:text-amber-300">Suggestions</span>
            <span class="text-lg font-bold text-amber-400 mt-0.5 block font-mono">${stats.totalSuggestions}</span>
            <span class="text-[10px] text-zinc-500 mt-0.5 block">Logic & perf</span>
          </button>

          <!-- Nits Button -->
          <button type="button" onclick="filterBySeverity('nit')" id="btn-filter-nit" class="p-2.5 rounded bg-[#0b0d13] border border-zinc-800/90 hover:border-zinc-700 transition-all text-center group cursor-pointer">
            <span class="text-[10px] font-mono text-zinc-400 uppercase block font-semibold group-hover:text-zinc-300">Nits</span>
            <span class="text-lg font-bold text-zinc-300 mt-0.5 block font-mono">${stats.totalNits}</span>
            <span class="text-[10px] text-zinc-500 mt-0.5 block">Style & docs</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Live PR Review Stream Table -->
    <div class="rounded-md bg-[#10121a] border border-zinc-800/80 overflow-hidden shadow-sm">
      <div class="p-3.5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0d0e14]">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-200 font-mono">Review Audit Log</h2>
            <span id="activeFilterBadge" class="hidden text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/50"></span>
          </div>
          <p class="text-xs text-zinc-400 mt-0.5">Click any row to inspect line numbers, severity tags, and AI remediation advice.</p>
        </div>
        <div class="flex items-center gap-2">
          <!-- Filter Search -->
          <input type="text" id="filterInput" onkeyup="applyFilters()" placeholder="Filter repo, author, PR..." class="bg-[#12141c] border border-zinc-700/80 rounded px-2.5 py-1 text-xs text-zinc-200 font-mono placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500">
          <button type="button" onclick="filterBySeverity('all')" id="resetFilterBtn" class="hidden text-xs font-mono text-zinc-400 hover:text-white px-2 py-1 rounded border border-zinc-800 hover:border-zinc-700">Clear</button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left" id="reviewsTable">
          <thead class="bg-zinc-900/80 text-[11px] font-mono uppercase text-zinc-400 border-b border-zinc-800">
            <tr>
              <th class="py-2.5 px-4 font-medium">Repository & Pull Request</th>
              <th class="py-2.5 px-4 font-medium">Author</th>
              <th class="py-2.5 px-4 font-medium">Decision</th>
              <th class="py-2.5 px-4 font-medium">Findings Breakdown</th>
              <th class="py-2.5 px-4 font-medium">Latency</th>
              <th class="py-2.5 px-4 font-medium">Timestamp</th>
              <th class="py-2.5 px-4 font-medium text-right">Details</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800/40">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    let currentSeverityFilter = 'all';

    function toggleDetails(idx) {
      const detailsRow = document.getElementById('details-' + idx);
      const arrow = document.getElementById('arrow-' + idx);

      if (detailsRow) {
        if (detailsRow.classList.contains('hidden')) {
          detailsRow.classList.remove('hidden');
          if (arrow) arrow.classList.add('rotate-180');
        } else {
          detailsRow.classList.add('hidden');
          if (arrow) arrow.classList.remove('rotate-180');
        }
      }
    }

    function filterBySeverity(type) {
      currentSeverityFilter = type;
      const badge = document.getElementById('activeFilterBadge');
      const resetBtn = document.getElementById('resetFilterBtn');

      if (type !== 'all') {
        badge.textContent = 'Filtered: ' + type.toUpperCase();
        badge.classList.remove('hidden');
        resetBtn.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
        resetBtn.classList.add('hidden');
      }

      applyFilters();
    }

    function applyFilters() {
      const search = (document.getElementById('filterInput').value || '').toLowerCase();
      const rows = document.querySelectorAll('.review-row');

      rows.forEach(row => {
        const idx = row.id.replace('row-', '');
        const detailsRow = document.getElementById('details-' + idx);

        const repo = row.getAttribute('data-repo') || '';
        const author = row.getAttribute('data-author') || '';
        const decision = row.getAttribute('data-decision') || '';
        const critCount = parseInt(row.getAttribute('data-critical') || '0', 10);
        const sugCount = parseInt(row.getAttribute('data-suggestion') || '0', 10);
        const nitCount = parseInt(row.getAttribute('data-nit') || '0', 10);

        const textMatches = !search || repo.includes(search) || author.includes(search) || row.textContent.toLowerCase().includes(search);

        let severityMatches = true;
        if (currentSeverityFilter === 'critical') {
          severityMatches = critCount > 0;
        } else if (currentSeverityFilter === 'suggestion') {
          severityMatches = sugCount > 0;
        } else if (currentSeverityFilter === 'nit') {
          severityMatches = nitCount > 0;
        } else if (currentSeverityFilter === 'approved') {
          severityMatches = decision === 'approve';
        }

        if (textMatches && severityMatches) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
          if (detailsRow) detailsRow.style.display = 'none';
        }
      });
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
<body class="bg-[#090a0f] text-zinc-100 min-h-screen flex items-center justify-center p-6">
  <div class="max-w-md w-full bg-[#10121a] border border-zinc-800 rounded-lg p-6 space-y-4 shadow-xl">
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
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
