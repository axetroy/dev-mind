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
  console.log("[graph] ▶️ fetchMR | project:", project_id, "mr:", mr_id);

  if (!project_id || !mr_id) {
    throw new Error("fetchMRNode: project_id and mr_id are required in state");
  }

  // 1. Fetch MR metadata
  console.log("[graph]    └─ Fetching MR metadata...");
  const mr = await gitlab.getMergeRequest(project_id, mr_id);
  console.log("[graph]    └─ MR title:", mr.title, "| source_branch:", mr.source_branch);

  // 2. Fetch diff (changes)
  console.log("[graph]    └─ Fetching MR diff...");
  const changesData = await gitlab.getMergeRequestDiff(project_id, mr_id);
  const changes = changesData?.changes ?? [];
  console.log("[graph]    └─ Changes count:", changes.length);

  // 3. Parse diff into our Diff structure
  const diff = changes.map((change) => ({
    oldPath: change.old_path,
    newPath: change.new_path,
    type: classifyChange(change),
    hunks: parseUnifiedDiff(change.diff ?? ""),
  }));

  // 4. Collect changed files (new paths, falling back to old for deletions)
  const files = changes.map((c) => c.new_path || c.old_path);

  // 5. Extract diff_refs (SHA references for inline comments)
  const diffRefs = mr.diff_refs ?? null;
  if (diffRefs) {
    console.log("[graph]    └─ diff_refs: base=", diffRefs.base_sha, "start=", diffRefs.start_sha, "head=", diffRefs.head_sha);
  } else {
    console.warn("[graph]    └─ diff_refs not available in MR response");
  }

  const decisions = [
    `Fetched MR !${mr_id}: "${mr.title ?? "(no title)"}" (source: ${mr.source_branch ?? "?"})`,
    `Total changes: ${files.length} files`,
  ];
  console.log("[graph] ◀️ fetchMR done | files:", files.length, "| hunks total:", diff.reduce((s, d) => s + d.hunks.length, 0));

  return { diff, files, source_branch: mr.source_branch ?? null, diff_refs: diffRefs, file_contents: {}, current_file: files[0] ?? null, decisions };
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
