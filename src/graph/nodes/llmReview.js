/**
 * dev-mind LLM Review Node（核心推理）
 *
 * 对应 design.md §4.6 LLM Review Node。
 * 将 diff + context + tool results 送入 LLM，生成结构化 issues。
 */

import { llmCallJSON } from "../../llm/client.js";
import { REVIEW_SYSTEM_PROMPT, buildReviewPrompt } from "../../llm/prompts.js";
import { chunksToText } from "../../context/retriever.js";

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function llmReviewNode(state) {
  const { diff, context_chunks, tool_calls } = state;

  // ── 1. Build text representations ───────────────────────────────────────
  const diffText = diff
    .map((d) => {
      const path = d.newPath || d.oldPath;
      const hunks = d.hunks.map((h) => `${h.header}\n${h.content}`).join("");
      return `--- ${path} (${d.type}) ---\n${hunks}`;
    })
    .join("\n");

  // Truncate large diffs
  const truncatedDiff = diffText.length > 20000
    ? diffText.slice(0, 20000) + "\n... (diff truncated)"
    : diffText;

  const contextText = chunksToText(context_chunks, 12);

  const planResults = tool_calls
    .map((tc) => `[${tc.success ? "OK" : "FAIL"}] ${tc.tool}(${JSON.stringify(tc.args)})\n${String(tc.result).slice(0, 500)}`)
    .join("\n\n");

  // ── 2. Call LLM ─────────────────────────────────────────────────────────
  const userPrompt = buildReviewPrompt(truncatedDiff, contextText, planResults);

  let issues;
  try {
    const raw = await llmCallJSON(REVIEW_SYSTEM_PROMPT, userPrompt);
    issues = (raw.issues ?? []).map(normalizeIssue);
  } catch (err) {
    console.error("[llmReview] LLM review failed:");
    console.error("  Error:", err.message);
    if (err.stack) console.error("  Stack:", err.stack.split("\n").slice(0, 4).join("\n"));
    console.error("  Diff length:", truncatedDiff.length, "Context length:", contextText.length);

    return {
      errors: [`LLM review failed: ${err.message}`],
      decisions: ["LLM review failed — falling back to empty issues"],
    };
  }

  return {
    issues,
    decisions: [
      `LLM review complete: found ${issues.length} issues ` +
        `(${issues.filter((i) => i.severity === "critical").length} critical, ` +
        `${issues.filter((i) => i.severity === "warning").length} warnings, ` +
        `${issues.filter((i) => i.severity === "suggestion").length} suggestions)`,
    ],
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
