/**
 * dev-mind 上下文检索器
 *
 * 对应 design.md §6 Context Layer。
 * 将工具执行结果转化为结构化的上下文块（CodeChunk），
 * 并支持基于 relevance 的过滤与排序。
 */

/**
 * 将文件内容分块并构建 CodeChunk 列表。
 *
 * @param {Record<string, string>} fileContents - 文件路径 → 内容映射
 * @param {Object} [opts]
 * @param {number} [opts.maxChunkSize=200]      - 每个 chunk 的最大行数
 * @returns {import("../state.js").CodeChunk[]}
 */
export function chunkFiles(fileContents, opts = {}) {
  const maxChunkSize = opts.maxChunkSize ?? 200;
  const chunks = [];

  for (const [filePath, content] of Object.entries(fileContents)) {
    if (!content) continue;

    const lines = content.split("\n");
    const functionBoundaries = detectFunctionBoundaries(lines);

    if (functionBoundaries.length === 0) {
      // No functions detected — chunk by line count
      for (let start = 0; start < lines.length; start += maxChunkSize) {
        const end = Math.min(start + maxChunkSize, lines.length);
        chunks.push({
          file: filePath,
          functionName: null,
          code: lines.slice(start, end).join("\n"),
          startLine: start + 1,
          endLine: end,
          relevanceScore: null,
        });
      }
    } else {
      // Chunk by function boundaries (fill gaps with small line-based chunks)
      let prevEnd = 0;
      for (const fb of functionBoundaries) {
        // Gap chunk (non-function code between functions)
        if (fb.startLine - 1 > prevEnd) {
          chunks.push({
            file: filePath,
            functionName: null,
            code: lines.slice(prevEnd, fb.startLine - 1).join("\n"),
            startLine: prevEnd + 1,
            endLine: fb.startLine - 1,
            relevanceScore: null,
          });
        }
        // Function chunk
        const fbEnd = Math.min(fb.endLine, lines.length);
        chunks.push({
          file: filePath,
          functionName: fb.name,
          code: lines.slice(fb.startLine - 1, fbEnd).join("\n"),
          startLine: fb.startLine,
          endLine: fbEnd,
          relevanceScore: null,
        });
        prevEnd = fbEnd;
      }
      // Trailing gap
      if (prevEnd < lines.length) {
        chunks.push({
          file: filePath,
          functionName: null,
          code: lines.slice(prevEnd).join("\n"),
          startLine: prevEnd + 1,
          endLine: lines.length,
          relevanceScore: null,
        });
      }
    }
  }

  return chunks;
}

/**
 * 根据与 diff/query 的相关性对 chunks 进行评分和排序。
 *
 * 实现简单的关键词匹配得分，后续可升级为 embedding 向量检索。
 *
 * @param {import("../state.js").CodeChunk[]} chunks
 * @param {string[]} keywords - 从 diff 中提取的关键词（函数名、变量名等）
 * @returns {import("../state.js").CodeChunk[]} - 排序后的 chunks（高分在前）
 */
export function rankChunksByRelevance(chunks, keywords) {
  if (!keywords || keywords.length === 0) {
    return chunks.map((c) => ({ ...c, relevanceScore: 0 }));
  }

  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  const scored = chunks.map((chunk) => {
    const codeLower = chunk.code.toLowerCase();
    let score = 0;

    for (const kw of lowerKeywords) {
      // Exact match in function name: high boost
      if (chunk.functionName && chunk.functionName.toLowerCase().includes(kw)) {
        score += 10;
      }
      // Count occurrences in code
      const count = (codeLower.match(new RegExp(escapeRegex(kw), "g")) || []).length;
      score += count;
    }

    // Normalise: longer chunks have natural advantage; cap at 50
    score = Math.min(score, 50);

    return { ...chunk, relevanceScore: score };
  });

  // Sort descending by relevanceScore
  scored.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));

  return scored;
}

/**
 * 将高分的 chunk 拼接为 LLM 可读的上下文文本。
 * @param {import("../state.js").CodeChunk[]} chunks
 * @param {number} [maxChunks=15]
 * @returns {string}
 */
export function chunksToText(chunks, maxChunks = 15) {
  const top = chunks
    .filter((c) => c.relevanceScore === null || c.relevanceScore > 0)
    .slice(0, maxChunks);

  if (top.length === 0) return "";

  const parts = top.map((c) => {
    const funcTag = c.functionName ? ` (function: ${c.functionName})` : "";
    return `--- ${c.file}:${c.startLine}-${c.endLine}${funcTag} ---\n${c.code}`;
  });

  return parts.join("\n\n");
}

// ─── 内部辅助 ───────────────────────────────────────────────────────────────

/**
 * 简易函数边界检测（JS/TS/Python/Go/Rust）。
 * 识别函数/类定义并确定其结束行。
 */
function detectFunctionBoundaries(lines) {
  const boundaries = [];

  // Heuristic: find lines that start a function/class, then find matching "}" or dedent
  const funcStartRe = /^\s*(?:(?:export\s+)?(?:async\s+)?function\s+\w+|const\s+\w+\s*=\s*(?:\(|async\s*\()|class\s+\w+|def\s+\w+|func\s+(?:\([^)]*\)\s+)?\w+)/;

  let braceDepth = 0;
  let currentFn = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!currentFn && funcStartRe.test(line)) {
      const nameMatch = line.match(/(?:function|def|func|class|const)\s+(\w+)/);
      currentFn = {
        name: nameMatch ? nameMatch[1] : "anonymous",
        startLine: i + 1,
      };
      // Count opening braces in this line
      braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      continue;
    }

    if (currentFn) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceDepth += opens - closes;

      // Python / dedent based (no braces)
      if (braceDepth <= 0) {
        currentFn.endLine = i + 1;
        boundaries.push(currentFn);
        currentFn = null;
        braceDepth = 0;
      }
    }
  }

  // Close any unclosed function at EOF
  if (currentFn) {
    currentFn.endLine = lines.length;
    boundaries.push(currentFn);
  }

  return boundaries;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
