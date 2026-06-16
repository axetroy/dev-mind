/**
 * dev-mind LLM Review Node（核心推理）
 *
 * 对应 design.md §4.6 LLM Review Node。
 * 将 diff + context + tool results 送入 LLM，生成结构化 issues。
 */

import { llmCallJSON } from "../../llm/client.js";
import { REVIEW_SYSTEM_PROMPT, buildReviewPrompt } from "../../llm/prompts.js";
import { getLogger } from "../../logger/index.js";

// ─── Diff → Git Unified Diff ─────────────────────────────────────────────────

/**
 * 将 GitLab 结构化 Diff 对象转换为标准 Git Unified Diff 文本，
 * 并配以统计摘要和 <details> 折叠的文件块。
 *
 * 格式：
 *   ## Summary: N file(s) changed, X insertions(+), Y deletions(-)
 *
 *   <details>
 *   <summary>path/to/file.js</summary>
 *
 *   --- a/path/to/file.js
 *   +++ b/path/to/file.js
 *   @@ -1,5 +1,7 @@
 *    line1
 *   -old_line2
 *   +new_line2
 *   </details>
 *
 * @param {import("../../state.js").Diff[]} diff
 * @returns {string}
 */
export function diffToUnifiedText(diff) {
  if (!diff || diff.length === 0) return "";

  let totalAdditions = 0;
  let totalDeletions = 0;
  const fileSections = [];

  for (const d of diff) {
    const oldPath = d.oldPath && d.oldPath !== "" ? d.oldPath : "/dev/null";
    const newPath = d.newPath && d.newPath !== "" ? d.newPath : "/dev/null";

    // ── 统计 ──
    for (const hunk of d.hunks) {
      for (const line of hunk.content.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) totalAdditions++;
        else if (line.startsWith("-") && !line.startsWith("---")) totalDeletions++;
      }
    }

    // ── 构建标准 Unified Diff ──
    const lines = [`--- a/${oldPath}`, `+++ b/${newPath}`];
    for (const hunk of d.hunks) {
      lines.push(hunk.header);
      // hunk.content 已经是 unified diff 格式（+、-、空格前缀），直接使用
      // 去掉末尾多余的换行避免空行
      lines.push(hunk.content.replace(/\n$/, ""));
    }

    const displayPath =
      d.type === "renamed"
        ? `${d.oldPath} → ${d.newPath}`
        : newPath !== "/dev/null"
          ? newPath
          : oldPath;

    fileSections.push({ displayPath, diff: lines.join("\n") });
  }

  const summary = `## Summary: ${diff.length} file(s) changed, ${totalAdditions} insertions(+), ${totalDeletions} deletions(-)`;

  const details = fileSections
    .map((f) => `<details>\n<summary>${f.displayPath}</summary>\n\n${f.diff}\n</details>`)
    .join("\n\n");

  return `${summary}\n\n${details}`;
}



/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function llmReviewNode(state) {
  const { diff_text, tool_calls } = state;
  const log = getLogger(state.run_id);

  // ── 1. Build text representations ───────────────────────────────────────
  // diff_text 由 contextRetrievalNode 提前转换并存入 state
  // 若为空（如首次直接从 llmReview 入口进来），再回退转换
  const diffText = diff_text || diffToUnifiedText(state.diff);

  // Truncate large diffs
  const truncatedDiff = diffText.length > 20000
    ? diffText.slice(0, 20000) + "\n... (diff truncated)"
    : diffText;

  const planResults = tool_calls
    .map((tc) => `[${tc.success ? "OK" : "FAIL"}] ${tc.tool}(${JSON.stringify(tc.args)})\n${String(tc.result).slice(0, 500)}`)
    .join("\n\n");

  log.info(`Prompt sizes: diff=${truncatedDiff.length}, tool_results=${planResults.length}`);

  // ── 2. Call LLM ─────────────────────────────────────────────────────────
  const userPrompt = buildReviewPrompt(truncatedDiff, planResults);
  let raw

  let issues;
  try {
    // LLM tracing via logger
    log.llmCall("review", userPrompt, { diff_length: truncatedDiff.length });
    const startTime = Date.now();
    raw = await llmCallJSON(REVIEW_SYSTEM_PROMPT, userPrompt, log);
    const latency = Date.now() - startTime;
    issues = (raw.issues ?? []).map(normalizeIssue);
    log.llmResponse("review", JSON.stringify(raw), latency, { issue_count: issues.length });
  } catch (err) {
    log.error(`LLM review failed: ${err.message}`, { diff_length: truncatedDiff.length });
    return {
      errors: [`LLM review failed: ${err.message}`],
      decisions: ["LLM review failed — falling back to empty issues"],
    };
  }

  const critical = issues.filter((i) => i.severity === "critical").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const suggestions = issues.filter((i) => i.severity === "suggestion").length;
  log.info(`done | issues: ${issues.length} (critical:${critical}, warning:${warnings}, suggestion:${suggestions})`);

  // 检测 LLM 是否需要更多信息（闭环循环）
  const needsMoreInfo = raw.needs_more_info === true && Array.isArray(raw.next_plan) && raw.next_plan.length > 0;

  if (needsMoreInfo) {
    log.info(`LLM requested more info: ${raw.next_plan.length} additional tool steps`);
    return {
      issues,
      needs_more_info: true,
      next_plan: raw.next_plan,   // reviewRouter 检查此字段决定是否循环
      plan: { steps: raw.next_plan },     // toolExecutionNode 从此读取新步骤
      tool_calls: [],                      // 重置让新 plan 从头执行
      iteration: 0,                        // 重置 iteration 计数器
      decisions: [
        `LLM review complete: ${issues.length} issues found, but needs more info`,
        `Requested ${raw.next_plan.length} additional tool steps: ${raw.next_plan.map((s) => s.action).join(", ")}`,
      ],
    };
  }

  return {
    issues,
    needs_more_info: false,
    next_plan: null,
    decisions: [`LLM review complete: found ${issues.length} issues (${critical} critical, ${warnings} warnings, ${suggestions} suggestions)`],
  };
}

/**
 * 标准化 issue 对象，确保所有必填字段存在。
 */
function normalizeIssue(raw) {
  return {
    type: raw.type ?? "maintainability",
    file: raw.file ?? "",
    line: raw.line ?? 0,
    message: raw.message ?? "(no message)",
    suggestion: raw.suggestion ?? "",
    severity: raw.severity ?? "suggestion",
  };
}
