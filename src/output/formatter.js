/**
 * dev-mind 输出格式化层
 *
 * 对应 design.md §8 输出结构设计。
 * 将 ReviewState 中的 issues 转换成 Markdown 评论 + inline comments。
 */

import { buildReviewReport } from "../llm/prompts.js";

/**
 * 生成完整的 review report markdown。
 * @param {import("../state.js").Issue[]} issues
 * @param {number|null} riskScore
 * @returns {string} - Markdown 文本
 */
export function formatReviewReport(issues, riskScore) {
  return buildReviewReport(issues, riskScore);
}

/**
 * 生成 inline comments 列表，供 GitLab 逐个提交。
 * @param {import("../state.js").Issue[]} issues
 * @param {string} [commitSha] - 可选，关联到具体 commit
 * @returns {Array<{body:string, path:string, line:number, oldLine?:number, commitSha?:string}>}
 */
export function formatInlineComments(issues, commitSha) {
  return issues
    .filter((i) => i.file && i.line > 0)
    .map((issue) => ({
      body: `**${iconForType(issue.type)} ${capitalize(issue.severity)}:** ${issue.message}${
        issue.suggestion ? `\n\n> 💡 ${issue.suggestion}` : ""
      }`,
      path: issue.file,
      line: issue.line,
      oldLine: issue.oldLine,
      commitSha,
    }));
}

/**
 * 将 issues 按文件分组。
 * @param {import("../state.js").Issue[]} issues
 * @returns {Record<string, import("../state.js").Issue[]>}
 */
export function groupIssuesByFile(issues) {
  const groups = {};
  for (const issue of issues) {
    if (!groups[issue.file]) groups[issue.file] = [];
    groups[issue.file].push(issue);
  }
  return groups;
}

/**
 * 将 issues 按严重程度分组。
 * @param {import("../state.js").Issue[]} issues
 * @returns {{critical: Issue[], warning: Issue[], suggestion: Issue[]}}
 */
export function groupIssuesBySeverity(issues) {
  return {
    critical: issues.filter((i) => i.severity === "critical"),
    warning: issues.filter((i) => i.severity === "warning"),
    suggestion: issues.filter((i) => i.severity === "suggestion"),
  };
}

/**
 * 计算风险分数（0-100）。
 * @param {import("../state.js").Issue[]} issues
 * @returns {number}
 */
export function calculateRiskScore(issues) {
  if (issues.length === 0) return 0;

  let score = 0;
  for (const issue of issues) {
    switch (issue.severity) {
      case "critical":
        score += 25;
        break;
      case "warning":
        score += 10;
        break;
      case "suggestion":
        score += 3;
        break;
    }
  }

  return Math.min(score, 100);
}

/**
 * 合并去重：按 (file, line, message) 去重。
 * @param {import("../state.js").Issue[]} issues
 * @returns {import("../state.js").Issue[]}
 */
export function deduplicateIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.file}:${issue.line}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── 内部辅助 ───────────────────────────────────────────────────────────────

function iconForType(type) {
  switch (type) {
    case "bug":           return "🐛";
    case "security":      return "🔒";
    case "performance":   return "⚡";
    case "architecture":  return "🏗️";
    default:              return "💡";
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
