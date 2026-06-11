/**
 * dev-mind Fetch MR Node
 *
 * 对应 design.md §4.1 Fetch MR Node。
 * 从 GitLab 拉取 MR 信息、diff 和 changed files，写入 state。
 */

import * as gitlab from "../../tools/gitlab.js";

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function fetchMRNode(state) {
  const { project_id, mr_id } = state;

  if (!project_id || !mr_id) {
    throw new Error("fetchMRNode: project_id and mr_id are required in state");
  }

  // 1. Fetch MR metadata
  const mr = await gitlab.getMergeRequest(project_id, mr_id);

  // 2. Fetch diff (changes)
  const changesData = await gitlab.getMergeRequestDiff(project_id, mr_id);
  const changes = changesData?.changes ?? [];

  // 3. Parse diff into our Diff structure
  const diff = changes.map((change) => ({
    oldPath: change.old_path,
    newPath: change.new_path,
    type: classifyChange(change),
    hunks: parseUnifiedDiff(change.diff ?? ""),
  }));

  // 4. Collect changed files (new paths, falling back to old for deletions)
  const files = changes.map((c) => c.new_path || c.old_path);

  return {
    diff,
    files,
    source_branch: mr.source_branch ?? null,
    file_contents: {},      // will be filled by tool execution
    current_file: files[0] ?? null,
    decisions: [`Fetched MR !${mr_id}: "${mr.title ?? "(no title)"}" (source: ${mr.source_branch ?? "?"})`],
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * 根据 GitLab change 对象判断变更类型。
 */
function classifyChange(change) {
  if (change.new_file) return "added";
  if (change.deleted_file) return "deleted";
  if (change.renamed_file) return "renamed";
  return "modified";
}

/**
 * 简易 unified diff 解析器。
 * 从 GitLab 返回的 diff 字符串中提取 hunks。
 *
 * @param {string} diffText
 * @returns {Array<{header:string, content:string, oldStart:number, newStart:number}>}
 */
function parseUnifiedDiff(diffText) {
  const lines = diffText.split("\n");
  const hunks = [];
  let current = null;

  for (const line of lines) {
    const headerMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (headerMatch) {
      if (current) hunks.push(current);
      current = {
        header: line,
        content: "",
        oldStart: parseInt(headerMatch[1], 10),
        newStart: parseInt(headerMatch[2], 10),
      };
    } else if (current) {
      current.content += line + "\n";
    }
  }
  if (current) hunks.push(current);

  return hunks;
}
