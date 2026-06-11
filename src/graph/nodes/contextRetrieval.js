/**
 * dev-mind Context Retrieval Node
 *
 * 对应 design.md §4.5 Context Retrieval Node。
 * 将文件内容分块、按相关性排序，构建 LLM 可用的上下文。

 * 做三件事：
 * 1. chunk code
 * 2. embed (optional)
 * 3. filter relevant parts
 */

import { chunkFiles, rankChunksByRelevance, chunksToText } from "../../context/retriever.js";

/**
 * 从 diff 文本中提取关键词（用于相关性评分）。
 * @param {import("../../state.js").Diff[]} diff
 * @returns {string[]}
 */
function extractKeywords(diff) {
  const words = new Set();
  const keywordRe = /\b([A-Z]\w+|[a-z]+(?:[A-Z]\w+)+)\b/g; // camelCase & PascalCase
  // Also grab identifiers from added lines
  const identRe = /\b([a-zA-Z_$][\w$.]*)\b/g;

  for (const d of diff) {
    for (const hunk of d.hunks) {
      // Scan added lines for identifiers
      for (const line of hunk.content.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          let m;
          while ((m = identRe.exec(line)) !== null) {
            const word = m[1];
            // Filter out short/common words
            if (word.length > 2 && !["const","let","var","function","return","import","export","default","async","await"].includes(word)) {
              words.add(word);
            }
          }
        }
      }
    }
  }

  return [...words].slice(0, 30); // limit to top 30 keywords
}

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function contextRetrievalNode(state) {
  const { file_contents, diff, tool_calls } = state;

  if (Object.keys(file_contents).length === 0) {
    return {
      decisions: ["No file contents available for context retrieval"],
    };
  }

  // 1. Chunk files into CodeChunks
  const chunks = chunkFiles(file_contents, { maxChunkSize: 200 });

  // 2. Extract keywords from diff for relevance scoring
  const keywords = extractKeywords(diff);

  // 3. Also add any symbol names from tool execution results
  for (const tc of tool_calls) {
    if (tc.tool === "get_symbol_definition" && tc.args?.symbol) {
      keywords.push(tc.args.symbol);
    }
  }

  // 4. Rank by relevance
  const rankedChunks = rankChunksByRelevance(chunks, keywords);

  // 5. Convert to text (for LLM context)
  const contextText = chunksToText(rankedChunks, 15);

  return {
    context_chunks: rankedChunks.filter((c) => c.relevanceScore === null || c.relevanceScore > 0),
    decisions: [
      `Retrieved ${rankedChunks.length} chunks from ${Object.keys(file_contents).length} files`,
      `Top keywords: ${keywords.slice(0, 10).join(", ")}`,
    ],
  };
}
