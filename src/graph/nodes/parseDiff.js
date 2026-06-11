/**
 * dev-mind Parse Diff Node
 *
 * 对应 design.md §4.2 Diff Parser Node。
 * 将 raw diff 解析为结构化信息：提取关键变更块、受影响的符号。
 */

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function parseDiffNode(state) {
  const { diff } = state;
  console.log("[graph] ▶️ parseDiff | files:", diff.length);

  // 收集变更摘要
  const summary = { added: [], modified: [], deleted: [], renamed: [] };

  for (const d of diff) {
    switch (d.type) {
      case "added":    summary.added.push(d.newPath);    break;
      case "modified": summary.modified.push(d.newPath); break;
      case "deleted":  summary.deleted.push(d.oldPath);  break;
      case "renamed":
        summary.renamed.push(`${d.oldPath} → ${d.newPath}`);
        break;
    }
  }

  console.log("[graph]    └─ Summary:", summary.added.length + " added,", summary.modified.length + " modified,",
    summary.deleted.length + " deleted,", summary.renamed.length + " renamed");

  // 提取每个 diff 中的受影响的符号/函数名
  const affectedSymbols = new Set();
  const symbolRe = /^\+\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/;

  for (const d of diff) {
    for (const hunk of d.hunks) {
      for (const line of hunk.content.split("\n")) {
        if (line.startsWith("+")) {
          const m = line.match(symbolRe);
          if (m) affectedSymbols.add(m[1]);
        }
      }
    }
  }

  const symList = [...affectedSymbols];
  if (symList.length) console.log("[graph]    └─ Affected symbols:", symList.join(", "));

  // 构建 diff 文本摘要（用于 LLM prompts）
  const diffSummary = buildDiffSummary(diff);
  console.log("[graph]    └─ Diff summary length:", diffSummary.length, "chars");

  console.log("[graph] ◀️ parseDiff done");

  return {
    decisions: [
      `Parsed ${diff.length} changed files: ${summary.added.length} added, ${summary.modified.length} modified, ${summary.deleted.length} deleted, ${summary.renamed.length} renamed`,
      symList.length > 0 ? `Affected symbols: ${symList.join(", ")}` : "No new symbols detected in diff",
    ],
    context_chunks: [],
  };
}

/**
 * 构建易于 LLM 理解的 diff 摘要。
 */
function buildDiffSummary(diff) {
  const parts = [];

  for (const d of diff) {
    const label = d.type === "renamed" ? `${d.oldPath} → ${d.newPath}` : d.newPath || d.oldPath;
    parts.push(`\n## ${label} (${d.type})`);

    for (const hunk of d.hunks) {
      parts.push(hunk.header);
      // Show only first 30 lines per hunk to keep context manageable
      const lines = hunk.content.split("\n").slice(0, 30);
      for (const line of lines) {
        parts.push(line);
      }
      if (lines.length > 30) {
        parts.push("... (truncated)");
      }
    }
  }

  return parts.join("\n");
}
