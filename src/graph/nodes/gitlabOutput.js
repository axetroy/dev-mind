/**
 * dev-mind GitLab Output Node
 *
 * 对应 design.md §4.8 GitLab Output Node。
 * 将 review 结果输出回 GitLab：创建评论、inline comments、设置标签。
 */

import { getConfig } from "../../config.js";
import { getLogger } from "../../logger/index.js";
import * as gitlab from "../../tools/gitlab.js";
import { formatInlineComments } from "../../output/formatter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 在 diff hunks 中查找 new_line 对应的 old_line。
 *
 * 在 unified diff 中，由于存在增删行，new_line 和 old_line 不一定相等。
 * 例如 hunk "@@ -10,7 +10,8 @@" 中间插了一行，则 new_line=16 对应 old_line=15。
 *
 * @param {import("../../state.js").Diff[]} diff - 解析后的 diff 列表
 * @param {string} filePath - 文件路径
 * @param {number} newLine - 新文件行号
 * @returns {number|null} old_line，若该行为新增行则返回 null
 */
function findOldLine(diff, filePath, newLine) {
  const entry = diff.find(
    (d) => d.newPath === filePath || d.oldPath === filePath,
  );
  if (!entry) return null;

  // 新增文件 → 没有 old_line
  if (entry.type === "added") return null;
  // 删除文件 → old_line = new_line（但 issues 不会出现在删除行上）
  if (entry.type === "deleted") return newLine;

  // modified / renamed: 逐 hunk 遍历构建映射
  for (const hunk of entry.hunks) {
    let oldLine = hunk.oldStart;
    let curNewLine = hunk.newStart;
    const rawLines = hunk.content.split("\n");

    for (const line of rawLines) {
      // 跳过 split("\n") 产生的尾部空串以及 "\\ No newline" 标记
      if (line === "" || line.startsWith("\\")) continue;

      const ch = line.charAt(0);

      if (curNewLine === newLine) {
        // 目标行是新增行 → 没有 old_line
        if (ch === "+") return null;
        // 上下文行或删除行 → 返回当前 old_line
        return oldLine;
      }

      if (ch === "+") {
        curNewLine++; // 新增行：只影响新行号
      } else if (ch === "-") {
        oldLine++; // 删除行：只影响旧行号
      } else {
        // 上下文行（以空格开头）：都+1
        oldLine++;
        curNewLine++;
      }
    }
  }

  // 该 new_line 不在任何 hunk 范围内
  return null;
}

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function gitlabOutputNode(state) {
  const { project_id, mr_id, issues, review_report, risk_score } = state;
  const log = getLogger(state.run_id);

  if (!project_id || !mr_id) {
    log.warn("Skipping — missing project/MR info");
    return { errors: ["gitlabOutputNode: missing project_id or mr_id"], decisions: ["Skipped GitLab output — missing project/MR info"] };
  }

  const results = [];

  // 1. Post main review comment
  log.progress("Posting review comment...");
  try {
    const comment = await gitlab.createComment(project_id, mr_id, review_report);
    log.info(`Comment posted, id: ${comment.id}`);
    results.push(`Posted review comment (id: ${comment.id})`);
  } catch (err) {
    log.error(`Failed to post comment: ${err.message}`);
    results.push(`Failed to post review comment: ${err.message}`);
  }

  // 2. Post inline comments (for issues with file + line)
  const inlineCommentsEnabled = getConfig().INLINE_COMMENTS_ENABLED;

  if (!inlineCommentsEnabled) {
    log.info("Inline comments disabled (INLINE_COMMENTS_ENABLED=false), skipping");
    results.push(`Inline comments: 0 posted (disabled by config)`);
  } else {
    const diffRefs = state.diff_refs;
    const diff = state.diff;
    const inlineComments = formatInlineComments(issues);
    log.info(`Inline comments to post: ${inlineComments.length}`);

    if (inlineComments.length > 0 && !diffRefs) {
      log.warn("No diff_refs available, skipping inline comments");
      results.push(`Inline comments: 0 posted (missing diff_refs from MR metadata)`);
    } else if (inlineComments.length === 0) {
      results.push("Inline comments: 0 to post");
    } else {
      let inlineSuccess = 0;
      let inlineFail = 0;

      for (const ic of inlineComments) {
        // 从 diff hunks 计算正确的 old_line（新增行返回 null）
        const resolvedOldLine = findOldLine(diff, ic.path, ic.line);

        // 如果 oldLine 为 null 且文件不是新增（added），说明该行可能不在 diff hunk 范围内
        const entry = diff ? diff.find((d) => d.newPath === ic.path || d.oldPath === ic.path) : null;
        if (resolvedOldLine === null && entry && entry.type !== "added") {
          log.warn(`Line ${ic.path}:${ic.line} is not in any diff hunk (or is an added line). Sending without oldLine — GitLab may reject if not a valid added line.`);
        }

        log.progress(`Posting inline on ${ic.path}:${ic.line} (oldLine: ${resolvedOldLine ?? "null"})`);
        try {
          await gitlab.createInlineComment(project_id, mr_id, {
            body: ic.body,
            path: ic.path,
            line: ic.line,
            oldLine: resolvedOldLine,
            position: diffRefs,
          });
          inlineSuccess++;
        } catch (err) {
          inlineFail++;
          log.error(`Inline failed on ${ic.path}:${ic.line}: ${err.message}`);
        }
      }
      results.push(`Inline comments: ${inlineSuccess} posted, ${inlineFail} failed`);
    }
  }

  // 3. Set label based on risk score
  try {
    const label = getRiskLabel(risk_score);
    if (label) {
      log.progress(`Setting MR label: ${label}`);
      await gitlab.setMRLabels(project_id, mr_id, [label]);
      results.push(`Set MR label: "${label}"`);
    }
  } catch (err) {
    log.error(`Label failed: ${err.message}`);
    results.push(`Failed to set MR label: ${err.message}`);
  }

  return { decisions: results };
}

/**
 * 根据风险分数返回对应 GitLab label。
 */
function getRiskLabel(riskScore) {
  if (riskScore === null || riskScore === undefined) return null;
  if (riskScore >= 70) return "AI Review: High Risk";
  if (riskScore >= 30) return "AI Review: Warning";
  return "AI Review: OK";
}
