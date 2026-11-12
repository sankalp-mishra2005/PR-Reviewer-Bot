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

// HTML Dashboard UI - Production-grade SaaS Developer Console
dashboardRouter.get("/dashboard", async (_req, res) => {
  try {
    const stats = await getReviewStats();
    const reviews = await getRecentReviews(50);

    const total = stats.totalReviews;
    const approvalRate = total > 0 ? Math.round((stats.approved / total) * 100) : 0;
    const changesRate = total > 0 ? Math.round((stats.changesRequested / total) * 100) : 0;
    const commentsRate = total > 0 ? Math.round((stats.commentsOnly / total) * 100) : 0;

    const totalIssues = stats.totalComments;
    const defectDensity = total > 0 ? (totalIssues / total).toFixed(1) : "0.0";
    const avgLatencySec = stats.avgDurationMs > 0 ? (stats.avgDurationMs / 1000).toFixed(1) : "0.0";

    const rowsHtml =
      reviews.length === 0
        ? `
        <tr>
          <td colspan="7" class="py-16 text-center">
            <div class="flex flex-col items-center justify-center max-w-md mx-auto space-y-3">
              <div class="w-10 h-10 rounded-lg bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-400">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <div>
                <p class="text-sm font-semibold text-zinc-200">No Pull Request Reviews Recorded</p>
                <p class="text-xs text-zinc-400 mt-1 leading-relaxed">
                  The webhook gateway is active and listening for pull request events. Open a PR on your repository to start streaming real-time review telemetry.
                </p>
              </div>
              <div class="pt-2 flex items-center gap-2 text-xs font-mono text-zinc-400">
                <span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Gateway ready on /webhook</span>
              </div>
            </div>
          </td>
        </tr>
      `
        : reviews
            .map((r) => {
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

              return `
              <tr class="border-b border-zinc-800/60 hover:bg-zinc-900/40 transition-colors">
                <td class="py-3.5 px-4">
                  <div class="flex flex-col">
                    <span class="text-[11px] font-mono text-zinc-400">${escapeHtml(r.repo)}</span>
                    <a href="https://github.com/${r.repo}/pull/${r.pr_number}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-zinc-100 hover:text-indigo-400 transition-colors mt-0.5 flex items-center gap-1.5">
                      <span>#${r.pr_number} ${escapeHtml(String(r.pr_title))}</span>
                      <svg class="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </a>
                  </div>
                </td>
                <td class="py-3.5 px-4">
                  <span class="text-xs font-mono text-zinc-300">@${escapeHtml(r.author)}</span>
                </td>
                <td class="py-3.5 px-4">
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded border ${badgeClass}">
                    <span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span>
                    ${verdictLabel}
                  </span>
                </td>
                <td class="py-3.5 px-4">
                  <div class="flex items-center gap-1.5 text-xs font-mono">
                    <span class="px-2 py-0.5 rounded bg-rose-950/50 text-rose-300 border border-rose-900/40 font-semibold" title="Critical bugs & security flaws">${r.critical_count} Crit</span>
                    <span class="px-2 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-900/30" title="Suggestions & best practices">${r.suggestion_count} Sug</span>
                    <span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/40" title="Minor code nits">${r.nit_count} Nit</span>
                  </div>
                </td>
                <td class="py-3.5 px-4 font-mono text-xs text-zinc-300">
                  ${(r.duration_ms / 1000).toFixed(1)}s
                </td>
                <td class="py-3.5 px-4 font-mono text-xs text-zinc-400">
                  ${dateStr}
                </td>
                <td class="py-3.5 px-4 text-right">
                  <a href="https://github.com/${r.repo}/pull/${r.pr_number}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs font-medium text-zinc-300 hover:text-white px-2.5 py-1 rounded border border-zinc-700 hover:border-zinc-500 transition-colors">
                    <span>Inspect PR</span>
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                  </a>
                </td>
              </tr>
              <!-- Inline Summary Accordion -->
              <tr class="border-b border-zinc-800/30 bg-zinc-950/30">
                <td colspan="7" class="py-2.5 px-4 text-xs text-zinc-400 font-mono">
                  <details class="cursor-pointer group">
                    <summary class="text-zinc-400 hover:text-zinc-200 select-none">
                      <span class="text-indigo-400 font-semibold">Review Executive Summary:</span> ${escapeHtml(r.summary.slice(0, 140))}${r.summary.length > 140 ? "..." : ""} <span class="text-zinc-500">(click to expand)</span>
                    </summary>
                    <div class="mt-2 pl-4 border-l-2 border-indigo-500/40 text-zinc-300 font-sans text-xs leading-relaxed py-1">
                      ${escapeHtml(r.summary)}
                    </div>
                  </details>
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
  <title>PR Reviewer — Observability Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <meta http-equiv="refresh" content="10">
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    code, .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-[#0c0d12] text-[#e1e4ea] min-h-screen">
  <!-- Top Application Header -->
  <header class="border-b border-zinc-800/80 bg-[#10121a]/95 sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <!-- Git Pull Request Brand Icon -->
        <div class="w-7 h-7 rounded bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-zinc-200">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
            <line x1="6" y1="9" x2="6" y2="21"></line>
          </svg>
        </div>
        <div class="flex items-center gap-2 text-sm font-semibold text-white">
          <span>PR Reviewer</span>
          <span class="text-zinc-600 font-normal">/</span>
          <span class="text-xs font-mono font-normal text-zinc-400">Observability & Telemetry</span>
        </div>
      </div>

      <!-- System Health Indicator -->
      <div class="flex items-center gap-4 text-xs font-mono">
        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>Gateway Active</span>
          <span class="text-zinc-600">|</span>
          <span class="text-zinc-400">Port 3000</span>
        </div>
        <div class="hidden sm:flex items-center gap-1.5 text-zinc-400">
          <span>Model:</span>
          <span class="text-zinc-200 font-medium">Gemini 3.5 Flash</span>
        </div>
        <div class="flex items-center gap-1 text-zinc-500">
          <span>Auto-sync</span>
          <span class="text-zinc-400">10s</span>
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-6 space-y-6">
    <!-- Header Title Bar -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/60 pb-5">
      <div>
        <h1 class="text-xl font-bold tracking-tight text-white">Pull Request Intelligence & Telemetry</h1>
        <p class="text-xs text-zinc-400 mt-1">Live metrics, defect detection rates, and autonomous review executions.</p>
      </div>
      <div class="flex items-center gap-2">
        <a href="https://github.com/settings/apps/pr-reviewer-sankalp" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700/80 transition-colors">
          <svg class="w-3.5 h-3.5 text-zinc-400" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          <span>GitHub App #5726031</span>
        </a>
      </div>
    </div>

    <!-- 4 High-Impact KPI Metric Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- PRs Evaluated -->
      <div class="p-4 rounded-lg bg-[#12141c] border border-zinc-800 shadow-sm">
        <div class="flex items-center justify-between text-xs font-mono text-zinc-400 uppercase">
          <span>PRs Evaluated</span>
          <span class="text-zinc-500">${stats.totalRepos} active repo</span>
        </div>
        <div class="text-2xl font-bold text-white mt-1.5 font-mono">${total}</div>
        <div class="text-xs text-zinc-400 mt-1 flex items-center gap-1.5">
          <span class="text-rose-400 font-semibold">${stats.changesRequested} changes req</span>
          <span class="text-zinc-600">•</span>
          <span class="text-emerald-400 font-semibold">${stats.approved} approved</span>
        </div>
      </div>

      <!-- Critical Vulnerabilities Blocked -->
      <div class="p-4 rounded-lg bg-[#12141c] border border-zinc-800 shadow-sm">
        <div class="flex items-center justify-between text-xs font-mono text-zinc-400 uppercase">
          <span>Critical Flaws Prevented</span>
          <span class="text-rose-400 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-900/50">Blockers</span>
        </div>
        <div class="text-2xl font-bold text-rose-400 mt-1.5 font-mono">${stats.totalCritical}</div>
        <div class="text-xs text-zinc-400 mt-1">
          SQL injections, hardcoded secrets & crashes
        </div>
      </div>

      <!-- Clean Pass Rate -->
      <div class="p-4 rounded-lg bg-[#12141c] border border-zinc-800 shadow-sm">
        <div class="flex items-center justify-between text-xs font-mono text-zinc-400 uppercase">
          <span>Clean Pass Rate</span>
          <span class="text-emerald-400 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-900/50">Quality</span>
        </div>
        <div class="text-2xl font-bold text-emerald-400 mt-1.5 font-mono">${approvalRate}%</div>
        <div class="text-xs text-zinc-400 mt-1">
          ${stats.approved} PRs merged without blocking issues
        </div>
      </div>

      <!-- Mean Turnaround Latency -->
      <div class="p-4 rounded-lg bg-[#12141c] border border-zinc-800 shadow-sm">
        <div class="flex items-center justify-between text-xs font-mono text-zinc-400 uppercase">
          <span>Mean Review Latency</span>
          <span class="text-indigo-400 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-900/50">Speed</span>
        </div>
        <div class="text-2xl font-bold text-zinc-100 mt-1.5 font-mono">${avgLatencySec}s</div>
        <div class="text-xs text-zinc-400 mt-1">
          Webhook ingestion $\rightarrow$ inline comment post
        </div>
      </div>
    </div>

    <!-- Review Activity Trends & Defect Analysis (2 Columns) -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Decisions Breakdown -->
      <div class="p-4 rounded-lg bg-[#12141c] border border-zinc-800 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">Review Decision Distribution</h2>
          <span class="text-xs font-mono text-zinc-500">${total} total evaluations</span>
        </div>

        <div class="space-y-2.5 pt-1">
          <!-- Changes Requested -->
          <div>
            <div class="flex justify-between text-xs font-mono mb-1">
              <span class="text-rose-400 font-medium">Changes Requested (Blockers)</span>
              <span class="text-zinc-300">${stats.changesRequested} <span class="text-zinc-500">(${changesRate}%)</span></span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div class="h-full bg-rose-500 rounded-full" style="width: ${changesRate}%"></div>
            </div>
          </div>

          <!-- Approved -->
          <div>
            <div class="flex justify-between text-xs font-mono mb-1">
              <span class="text-emerald-400 font-medium">Approved (Clean)</span>
              <span class="text-zinc-300">${stats.approved} <span class="text-zinc-500">(${approvalRate}%)</span></span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div class="h-full bg-emerald-500 rounded-full" style="width: ${approvalRate}%"></div>
            </div>
          </div>

          <!-- Commentary -->
          <div>
            <div class="flex justify-between text-xs font-mono mb-1">
              <span class="text-zinc-400 font-medium">Commentary (Non-blocking)</span>
              <span class="text-zinc-300">${stats.commentsOnly} <span class="text-zinc-500">(${commentsRate}%)</span></span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div class="h-full bg-zinc-400 rounded-full" style="width: ${commentsRate}%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Finding Severity Breakdown -->
      <div class="p-4 rounded-lg bg-[#12141c] border border-zinc-800 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">Defect Severity Breakdown</h2>
          <span class="text-xs font-mono text-zinc-500">${totalIssues} total issues detected</span>
        </div>

        <div class="grid grid-cols-3 gap-2.5 pt-1">
          <div class="p-3 rounded bg-zinc-900 border border-zinc-800 text-center">
            <span class="text-[11px] font-mono text-rose-400 uppercase block font-semibold">Critical</span>
            <span class="text-xl font-bold text-rose-400 mt-1 block font-mono">${stats.totalCritical}</span>
            <span class="text-[10px] text-zinc-400 mt-0.5 block">Security & crashes</span>
          </div>

          <div class="p-3 rounded bg-zinc-900 border border-zinc-800 text-center">
            <span class="text-[11px] font-mono text-amber-400 uppercase block font-semibold">Suggestions</span>
            <span class="text-xl font-bold text-amber-400 mt-1 block font-mono">${stats.totalSuggestions}</span>
            <span class="text-[10px] text-zinc-400 mt-0.5 block">Refactoring & logic</span>
          </div>

          <div class="p-3 rounded bg-zinc-900 border border-zinc-800 text-center">
            <span class="text-[11px] font-mono text-zinc-400 uppercase block font-semibold">Nits</span>
            <span class="text-xl font-bold text-zinc-300 mt-1 block font-mono">${stats.totalNits}</span>
            <span class="text-[10px] text-zinc-400 mt-0.5 block">Style & docs</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Live PR Review Stream Table -->
    <div class="rounded-lg bg-[#12141c] border border-zinc-800 overflow-hidden shadow-sm">
      <div class="p-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#10121a]">
        <div>
          <h2 class="text-sm font-bold text-white tracking-tight">Live PR Review Audit Stream</h2>
          <p class="text-xs text-zinc-400 mt-0.5">Execution logs captured directly from repository webhook events.</p>
        </div>
        <div class="flex items-center gap-2 text-xs font-mono text-zinc-400">
          <span>Showing ${reviews.length} executions</span>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="bg-zinc-900/90 text-[11px] font-mono uppercase text-zinc-400 border-b border-zinc-800">
            <tr>
              <th class="py-2.5 px-4 font-medium">Repository & Pull Request</th>
              <th class="py-2.5 px-4 font-medium">Author</th>
              <th class="py-2.5 px-4 font-medium">Decision</th>
              <th class="py-2.5 px-4 font-medium">Findings Breakdown</th>
              <th class="py-2.5 px-4 font-medium">Latency</th>
              <th class="py-2.5 px-4 font-medium">Timestamp</th>
              <th class="py-2.5 px-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800/40 font-sans">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </main>
</body>
</html>`;

    res.send(html);
  } catch (error: any) {
    res.status(500).send(`Error loading dashboard: ${error.message}`);
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
