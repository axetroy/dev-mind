/**
 * dev-mind GitLab Output Node
 *
 * 对应 design.md §4.8 GitLab Output Node。
 * 将 review 结果输出回 GitLab：创建评论、inline comments、设置标签。
 */

import * as gitlab from "../../tools/gitlab.js";
import { formatInlineComments } from "../../output/formatter.js";

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function gitlabOutputNode(state) {
  const { project_id, mr_id, issues, review_report, risk_score } = state;

  if (!project_id || !mr_id) {
    return {
      errors: ["gitlabOutputNode: missing project_id or mr_id"],
      decisions: ["Skipped GitLab output — missing project/MR info"],
    };
  }

  const results = [];

  // 1. Post main review comment
  try {
    const comment = await gitlab.createComment(project_id, mr_id, review_report);
    results.push(`Posted review comment (id: ${comment.id})`);
  } catch (err) {
    results.push(`Failed to post review comment: ${err.message}`);
  }

  // 2. Post inline comments (for issues with file + line)
  const inlineComments = formatInlineComments(issues);
  let inlineSuccess = 0;
  let inlineFail = 0;

  // Batch inline comments — GitLab may rate-limit, so we send sequentially
  for (const ic of inlineComments) {
    try {
      await gitlab.createInlineComment(project_id, mr_id, {
        body: ic.body,
        path: ic.path,
        line: ic.line,
        commitSha: ic.commitSha,
      });
      inlineSuccess++;
    } catch (err) {
      inlineFail++;
      // Log but continue with other comments
    }
  }
  results.push(`Inline comments: ${inlineSuccess} posted, ${inlineFail} failed`);

  // 3. Set label based on risk score
  try {
    const label = getRiskLabel(risk_score);
    if (label) {
      await gitlab.setMRLabels(project_id, mr_id, [label]);
      results.push(`Set MR label: "${label}"`);
    }
  } catch (err) {
    results.push(`Failed to set MR label: ${err.message}`);
  }

  return {
    decisions: results,
  };
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
