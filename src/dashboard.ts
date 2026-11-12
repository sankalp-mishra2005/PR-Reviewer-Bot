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

// HTML Dashboard UI - 100% Dynamic, 0% Hardcoded
dashboardRouter.get("/dashboard", async (_req, res) => {
  try {
    const stats = await getReviewStats();
    const reviews = await getRecentReviews(50);

    const total = stats.totalReviews;
    const approvalRate = total > 0 ? Math.round((stats.approved / total) * 100) : 0;
    const changesRate = total > 0 ? Math.round((stats.changesRequested / total) * 100) : 0;
    const commentsRate = total > 0 ? Math.round((stats.commentsOnly / total) * 100) : 0;

    const totalIssues = stats.totalComments;
    const critRate = totalIssues > 0 ? Math.round((stats.totalCritical / totalIssues) * 100) : 0;

    const rowsHtml =
      reviews.length === 0
        ? `
        <tr>
          <td colspan="7" class="py-16 text-center">
            <div class="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
              <div class="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <svg class="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <p class="font-semibold text-gray-200">Waiting for your first PR review</p>
              <p class="text-xs text-gray-500 leading-relaxed">
                Open a Pull Request or push code to your repository. The bot will review it with Gemini and telemetry will stream here automatically.
              </p>
            </div>
          </td>
        </tr>
      `
        : reviews
            .map((r) => {
              const isApproved = r.assessment === "APPROVE";
              const isChanges = r.assessment === "REQUEST_CHANGES";

              const badgeColor = isApproved
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : isChanges
                ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                : "bg-blue-500/10 text-blue-400 border-blue-500/30";

              const dotColor = isApproved
                ? "bg-emerald-400"
                : isChanges
                ? "bg-rose-400"
                : "bg-blue-400";

              const verdictText = isApproved
                ? "Approved"
                : isChanges
                ? "Changes Requested"
                : "Commentary";

              return `
              <tr class="border-b border-gray-800/60 hover:bg-gray-900/50 transition">
                <td class="py-4 px-5">
                  <div class="flex flex-col">
                    <span class="text-xs font-mono text-gray-400">${escapeHtml(r.repo)}</span>
                    <a href="https://github.com/${r.repo}/pull/${r.pr_number}" target="_blank" class="text-sm font-medium text-white hover:text-indigo-400 transition mt-0.5">
                      #${r.pr_number} ${escapeHtml(String(r.pr_title))}
                    </a>
                  </div>
                </td>
                <td class="py-4 px-5">
                  <span class="text-xs font-mono text-gray-300">@${escapeHtml(r.author)}</span>
                </td>
                <td class="py-4 px-5">
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${badgeColor}">
                    <span class="w-1.5 h-1.5 rounded-full ${dotColor}"></span>
                    ${verdictText}
                  </span>
                </td>
                <td class="py-4 px-5">
                  <div class="flex items-center gap-1.5 text-xs font-mono">
                    <span class="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 font-semibold">${r.critical_count} Crit</span>
                    <span class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">${r.suggestion_count} Sug</span>
                    <span class="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">${r.nit_count} Nit</span>
                  </div>
                </td>
                <td class="py-4 px-5 font-mono text-xs text-gray-400">
                  ${(r.duration_ms / 1000).toFixed(1)}s
                </td>
                <td class="py-4 px-5 font-mono text-xs text-gray-500">
                  ${new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td class="py-4 px-5 text-right">
                  <a href="https://github.com/${r.repo}/pull/${r.pr_number}" target="_blank" class="inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition">
                    View on GitHub
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                  </a>
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
  <title>PR Reviewer Bot — Observability</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <meta http-equiv="refresh" content="8">
  <style>
    body { font-family: 'Geist', sans-serif; }
    code, .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-[#0b0c10] text-[#e3e1e9] min-h-screen">
  <!-- Top Navigation -->
  <header class="border-b border-[#1e2029] bg-[#0f1016]/80 backdrop-blur sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
            <line x1="6" y1="9" x2="6" y2="21"></line>
          </svg>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-bold text-base tracking-tight text-white">PR Reviewer Bot</span>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#1b1d28] border border-[#2b2e40] text-indigo-300">
            Gemini 3.5 Flash
          </span>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Gateway Active</span>
        </div>
        <span class="text-xs text-gray-500 font-mono">Auto 8s</span>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">
    <!-- Header Title -->
    <div>
      <h1 class="text-2xl font-bold text-white tracking-tight">Review Telemetry & Performance</h1>
      <p class="text-sm text-gray-400 mt-1">Real-time execution metrics and feedback logs from your GitHub repositories.</p>
    </div>

    <!-- 5 KPI Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      <!-- Total PRs -->
      <div class="p-5 rounded-xl bg-[#12131a] border border-[#1e202b] shadow-sm">
        <span class="text-xs uppercase font-mono text-gray-400 tracking-wider">Total Reviewed</span>
        <div class="text-3xl font-bold text-white mt-2">${total}</div>
        <span class="text-xs font-mono text-gray-500 mt-1 block">${total} webhook runs</span>
      </div>

      <!-- Changes Requested -->
      <div class="p-5 rounded-xl bg-[#12131a] border border-[#1e202b] shadow-sm">
        <span class="text-xs uppercase font-mono text-rose-400 tracking-wider">Changes Requested</span>
        <div class="text-3xl font-bold text-rose-400 mt-2">${stats.changesRequested}</div>
        <span class="text-xs font-mono text-gray-500 mt-1 block">${changesRate}% of all PRs</span>
      </div>

      <!-- Approvals -->
      <div class="p-5 rounded-xl bg-[#12131a] border border-[#1e202b] shadow-sm">
        <span class="text-xs uppercase font-mono text-emerald-400 tracking-wider">Approved</span>
        <div class="text-3xl font-bold text-emerald-400 mt-2">${stats.approved}</div>
        <span class="text-xs font-mono text-gray-500 mt-1 block">${approvalRate}% clean rate</span>
      </div>

      <!-- Critical Caught -->
      <div class="p-5 rounded-xl bg-[#12131a] border border-[#1e202b] shadow-sm">
        <span class="text-xs uppercase font-mono text-amber-400 tracking-wider">Critical Flaws</span>
        <div class="text-3xl font-bold text-amber-400 mt-2">${stats.totalCritical}</div>
        <span class="text-xs font-mono text-gray-500 mt-1 block">Security & crash bugs</span>
      </div>

      <!-- Avg Latency -->
      <div class="p-5 rounded-xl bg-[#12131a] border border-[#1e202b] shadow-sm">
        <span class="text-xs uppercase font-mono text-indigo-400 tracking-wider">Avg Latency</span>
        <div class="text-3xl font-bold text-indigo-300 mt-2">${stats.avgDurationMs > 0 ? (stats.avgDurationMs / 1000).toFixed(1) + "s" : "0s"}</div>
        <span class="text-xs font-mono text-gray-500 mt-1 block">End-to-end turnaround</span>
      </div>
    </div>

    <!-- Analytics Breakdown Cards -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Decisions Breakdown -->
      <div class="p-6 rounded-xl bg-[#12131a] border border-[#1e202b] space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-white">Review Decisions Breakdown</h2>
          <span class="text-xs font-mono text-gray-400">${total} evaluations</span>
        </div>

        <div class="space-y-3 pt-2">
          <!-- Approvals Bar -->
          <div>
            <div class="flex justify-between text-xs font-mono mb-1">
              <span class="text-emerald-400">Approved</span>
              <span class="text-gray-300">${stats.approved} (${approvalRate}%)</span>
            </div>
            <div class="w-full h-2 rounded-full bg-[#1e202b] overflow-hidden">
              <div class="h-full bg-emerald-400 rounded-full transition-all" style="width: ${approvalRate}%"></div>
            </div>
          </div>

          <!-- Changes Requested Bar -->
          <div>
            <div class="flex justify-between text-xs font-mono mb-1">
              <span class="text-rose-400">Changes Requested</span>
              <span class="text-gray-300">${stats.changesRequested} (${changesRate}%)</span>
            </div>
            <div class="w-full h-2 rounded-full bg-[#1e202b] overflow-hidden">
              <div class="h-full bg-rose-400 rounded-full transition-all" style="width: ${changesRate}%"></div>
            </div>
          </div>

          <!-- Commentary Bar -->
          <div>
            <div class="flex justify-between text-xs font-mono mb-1">
              <span class="text-blue-400">Comments Only</span>
              <span class="text-gray-300">${stats.commentsOnly} (${commentsRate}%)</span>
            </div>
            <div class="w-full h-2 rounded-full bg-[#1e202b] overflow-hidden">
              <div class="h-full bg-blue-400 rounded-full transition-all" style="width: ${commentsRate}%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Severity Distribution -->
      <div class="p-6 rounded-xl bg-[#12131a] border border-[#1e202b] space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-white">Issue Severity Distribution</h2>
          <span class="text-xs font-mono text-gray-400">${totalIssues} total issues detected</span>
        </div>

        <div class="grid grid-cols-3 gap-3 pt-2">
          <div class="p-4 rounded-lg bg-[#181922] border border-rose-500/20 text-center">
            <span class="text-xs font-mono text-rose-400 block uppercase">Critical</span>
            <span class="text-2xl font-bold text-rose-400 mt-1 block">${stats.totalCritical}</span>
            <span class="text-[10px] font-mono text-gray-500">${critRate}% of findings</span>
          </div>

          <div class="p-4 rounded-lg bg-[#181922] border border-amber-500/20 text-center">
            <span class="text-xs font-mono text-amber-400 block uppercase">Suggestions</span>
            <span class="text-2xl font-bold text-amber-400 mt-1 block">${stats.totalComments - stats.totalCritical}</span>
            <span class="text-[10px] font-mono text-gray-500">Refactoring & logic</span>
          </div>

          <div class="p-4 rounded-lg bg-[#181922] border border-gray-700/40 text-center">
            <span class="text-xs font-mono text-gray-400 block uppercase">Nits</span>
            <span class="text-2xl font-bold text-gray-300 mt-1 block">${reviews.reduce((acc, r) => acc + (r.nit_count || 0), 0)}</span>
            <span class="text-[10px] font-mono text-gray-500">Non-blocking</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Reviews Table -->
    <div class="rounded-xl bg-[#12131a] border border-[#1e202b] overflow-hidden">
      <div class="p-5 border-b border-[#1e202b] flex items-center justify-between">
        <div>
          <h2 class="text-base font-semibold text-white">Live PR Review Stream</h2>
          <p class="text-xs text-gray-400 mt-0.5">Execution logs captured directly from repository webhooks</p>
        </div>
        <span class="text-xs font-mono text-gray-500">${reviews.length} total entries</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="bg-[#181922] text-[11px] uppercase font-mono text-gray-400 border-b border-[#1e202b]">
            <tr>
              <th class="py-3 px-5">Repository & Pull Request</th>
              <th class="py-3 px-5">Author</th>
              <th class="py-3 px-5">Verdict</th>
              <th class="py-3 px-5">Findings</th>
              <th class="py-3 px-5">Latency</th>
              <th class="py-3 px-5">Time</th>
              <th class="py-3 px-5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#1e202b]/40">
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
