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
  console.log("[graph] ▶️ gitlabOutput | project:", project_id, "mr:", mr_id);

  if (!project_id || !mr_id) {
    console.warn("[graph]    └─ Skipping — missing project/MR info");
    return { errors: ["gitlabOutputNode: missing project_id or mr_id"], decisions: ["Skipped GitLab output — missing project/MR info"] };
  }

  const results = [];

  // 1. Post main review comment
  console.log("[graph]    └─ Posting review comment...");
  try {
    const comment = await gitlab.createComment(project_id, mr_id, review_report);
    console.log("[graph]    └─ ✅ Comment posted, id:", comment.id);
    results.push(`Posted review comment (id: ${comment.id})`);
  } catch (err) {
    console.error("[graph]    └─ ❌ Failed to post comment:", err.message);
    results.push(`Failed to post review comment: ${err.message}`);
  }

  // 2. Post inline comments (for issues with file + line)
  const diffRefs = state.diff_refs;
  const inlineComments = formatInlineComments(issues);
  console.log("[graph]    └─ Inline comments to post:", inlineComments.length);

  if (inlineComments.length > 0 && !diffRefs) {
    console.warn("[graph]    └─ ⚠️  No diff_refs available, skipping inline comments");
    results.push(`Inline comments: 0 posted (missing diff_refs from MR metadata)`);
  } else {
    let inlineSuccess = 0;
    let inlineFail = 0;

    for (const ic of inlineComments) {
      console.log(`[graph]       └─ Posting inline on ${ic.path}:${ic.line}...`);
      try {
        await gitlab.createInlineComment(project_id, mr_id, {
          body: ic.body,
          path: ic.path,
          line: ic.line,
          position: {
            base_sha: diffRefs.base_sha,
            start_sha: diffRefs.start_sha,
            head_sha: diffRefs.head_sha,
          },
        });
        inlineSuccess++;
      } catch (err) {
        inlineFail++;
        console.error(`[graph]       └─ ❌ Inline failed: ${err.message}`);
      }
    }
    results.push(`Inline comments: ${inlineSuccess} posted, ${inlineFail} failed`);
  }

  // 3. Set label based on risk score
  try {
    const label = getRiskLabel(risk_score);
    if (label) {
      console.log("[graph]    └─ Setting MR label:", label);
      await gitlab.setMRLabels(project_id, mr_id, [label]);
      results.push(`Set MR label: "${label}"`);
    }
  } catch (err) {
    console.error("[graph]    └─ ❌ Label failed:", err.message);
    results.push(`Failed to set MR label: ${err.message}`);
  }

  console.log("[graph] ◀️ gitlabOutput done");
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
