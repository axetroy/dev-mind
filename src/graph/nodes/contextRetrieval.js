/**
 * dev-mind Context Retrieval Node
 *
 * 将结构化 diff 转换为带行号的 unified diff 文本，
 * 供 llmReviewNode 直接使用。不再注入上下文到提示词，
 * 模型如需查看上下文将通过 needs_more_info 工具调用来获取。
 */

import { diffToUnifiedText } from "./llmReview.js";
import { getLogger } from "../../logger/index.js";

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function contextRetrievalNode(state) {
  const { diff, file_contents } = state;
  const fileCount = Object.keys(file_contents).length;
  const log = getLogger(state.run_id);

  // 将结构化 diff 转换为标准 Git Unified Diff 文本（带统计摘要 + <details> 折叠）
  const diffText = diffToUnifiedText(diff);

  log.info(`Converted ${diff.length} diff files to unified diff text (${diffText.length} chars)`);

  return {
    diff_text: diffText,
    decisions: [
      `Converted ${diff.length} diff file(s) to unified diff text`,
      ...(fileCount > 0
        ? [`${fileCount} file(s) available for tool-based context retrieval`]
        : ["No file contents available — LLM must use tools to read files if needed"]),
    ],
  };
}
