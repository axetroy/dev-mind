/**
 * dev-mind Post Processing Node
 *
 * 对应 design.md §4.7 Post Processing Node。
 * 合并 issues、去重、评分、格式化输出。
 */

import { deduplicateIssues, calculateRiskScore, formatReviewReport } from "../../output/formatter.js";

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function postProcessNode(state) {
  const { issues } = state;

  // 1. Deduplicate
  const unique = deduplicateIssues(issues);

  // 2. Calculate risk score
  const riskScore = calculateRiskScore(unique);

  // 3. Build review report (markdown)
  const reviewReport = formatReviewReport(unique, riskScore);

  return {
    issues: unique,
    risk_score: riskScore,
    review_report: reviewReport,
    decisions: [
      `Post-processed: ${issues.length} → ${unique.length} unique issues`,
      `Risk score: ${riskScore}/100`,
    ],
  };
}
