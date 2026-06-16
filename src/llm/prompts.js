/**
 * dev-mind 提示词模板
 *
 * 集中管理所有 LLM 调用所用的 system / human prompt。
 * 对应 design.md §4.6 Review Prompt 结构。 
 */

import { config } from "../config.js";

// ─── 语言偏好指令 ─────────────────────────────────────────────────────────────

/**
 * 根据 LLM_LANGUAGE 配置构建语言要求指令。
 * 如果未配置或为 "auto"，返回空字符串。
 */
function languageInstruction() {
  const lang = config.LLM_LANGUAGE;
  if (!lang || lang === "" || lang === "auto") return "";
  return `\n\n**Language requirement:** You MUST write ALL responses in ${lang}. Use ${lang} for all explanations, comments, suggestions, and review output.`;
}

// ─── Planning Prompt ────────────────────────────────────────────────────────

export const PLAN_SYSTEM_PROMPT = `You are a senior code review planner for GitLab Merge Requests.${languageInstruction()}

Your job is to generate a **tool execution plan** — an ordered list of steps the reviewer agent should take to deeply understand the code changes before writing a review.

Each step should be one of:
- read_file(<path>)                 — fetch full file content
- search_code(<query>)              — search the repo for usages / patterns
- get_symbol_definition(<path>, <symbol>)  — get definition of a symbol in a specific file
- get_references(<symbol>)          — search all references of a symbol in the repo
- get_directory_tree(<path>)        — list directory structure
- get_commits(<count>)              — check recent commit history for context

**Rules:**
1. First understand what the MR changes (files added/modified/deleted).
2. For each changed file, decide if you need to read the full file.
3. If the diff references a function/module you don't fully understand, plan to look it up.
4. Consider: imports, shared utilities, config files, test files.
5. Output ONLY a JSON array of step objects: { "action": "read_file", "args": { "path": "..." } }
6. Keep the plan to 3-8 steps — focused, not exhaustive.`;

export function buildPlanPrompt(diffSummary, changedFiles) {
  return `## Merge Request Summary

Changed files: ${changedFiles.join(", ")}

## Diff Overview

${diffSummary}

## Task

Generate a focused tool execution plan (3-8 steps) that will help the reviewer deeply understand these changes.`;
}

// ─── Code Review Prompt ─────────────────────────────────────────────────────

export const REVIEW_SYSTEM_PROMPT = `You are a senior GitLab code reviewer with deep expertise in:${languageInstruction()}
- **Correctness** — logic errors, edge cases, race conditions
- **Security** — injection, auth flaws, secret exposure, input validation
- **Performance** — unnecessary allocations, N+1 queries, sync blocking
- **Maintainability** — readability, duplication, consistency with codebase
- **Architecture** — layering violations, coupling, missing abstractions

**Rules:**
1. You MUST base your review ONLY on the provided diff and context.
2. Do NOT comment on formatting/style unless it creates a real bug risk.
3. Be precise: include file path, line number, and actionable suggestion.
4. Rate each issue: "critical", "warning", or "suggestion".
5. If you are not confident about something, say so.
6. If the diff and context are INSUFFICIENT to make a proper review (e.g., you need to read additional files or search for more code), you MAY set **"needs_more_info": true** and include a **"next_plan"** array of additional tool steps to gather more context. You can use: read_file(&lt;path&gt;), search_code(&lt;query&gt;), get_symbol_definition(&lt;path&gt;, &lt;symbol&gt;), get_references(&lt;symbol&gt;), get_directory_tree(&lt;path&gt;). Provide 1-5 focused steps.

You MUST output a JSON object (and nothing else) with this shape:
{
  "issues": [...],
  "needs_more_info": false,
  "next_plan": [
    { "action": "read_file", "args": { "path": "..." } }
  ]
}

Each issue in the "issues" array:
{
  "type": "bug|security|performance|maintainability|architecture",
  "file": "path/to/file.js",
  "line": 42,
  "message": "Short description of the problem",
  "suggestion": "How to fix it (code or explanation)",
  "severity": "critical|warning|suggestion"
}`;

export function buildReviewPrompt(diffText, planResultsText) {
  return `## Diff

\`\`\`diff
${diffText}
\`\`\`

## Tool Execution Results

${planResultsText || "(No prior tool calls)"}

## Task

Review the above Merge Request diff. For each issue, provide the file, line, message, suggestion, and severity.
If you need to read files, search code, or look up additional context to make a proper review, set "needs_more_info": true and provide a "next_plan" — you will have the opportunity to gather more information and re-review.
Output a JSON object with an "issues" array.`;
}

// ─── GitLab Comment Body Prompt ─────────────────────────────────────────────

export function buildReviewReport(issues, riskScore) {
  const critical = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const suggestions = issues.filter((i) => i.severity === "suggestion");

  const severityLabel = (score) => {
    if (score >= 70) return "🔴 HIGH RISK";
    if (score >= 30) return "🟡 WARNING";
    return "🟢 OK";
  };

  const lines = [];
  lines.push("## 🤖 AI Code Review");
  lines.push("");
  lines.push(`**Risk Score:** ${riskScore ?? "N/A"} — ${severityLabel(riskScore ?? 0)}`);
  lines.push("");

  if (critical.length) {
    lines.push("### 🔴 Critical Issues");
    for (const issue of critical) {
      lines.push(`- **\`${issue.file}:${issue.line}\`** — ${issue.message}`);
      if (issue.suggestion) lines.push(`  - *Suggestion:* ${issue.suggestion}`);
    }
    lines.push("");
  }

  if (warnings.length) {
    lines.push("### 🟡 Warnings");
    for (const issue of warnings) {
      lines.push(`- **\`${issue.file}:${issue.line}\`** — ${issue.message}`);
      if (issue.suggestion) lines.push(`  - *Suggestion:* ${issue.suggestion}`);
    }
    lines.push("");
  }

  if (suggestions.length) {
    lines.push("### 💡 Suggestions");
    for (const issue of suggestions) {
      lines.push(`- **\`${issue.file}:${issue.line}\`** — ${issue.message}`);
      if (issue.suggestion) lines.push(`  - *Suggestion:* ${issue.suggestion}`);
    }
    lines.push("");
  }

  if (!critical.length && !warnings.length && !suggestions.length) {
    lines.push("✅ No issues found. The code looks good!");
    lines.push("");
  }

  return lines.join("\n");
}
