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
  console.log("[graph] ▶️ postProcess | raw issues:", issues.length);

  // 1. Deduplicate
  const unique = deduplicateIssues(issues);
  console.log("[graph]    └─ Dedup:", issues.length, "→", unique.length);

  // 2. Calculate risk score
  const riskScore = calculateRiskScore(unique);
  console.log("[graph]    └─ Risk score:", riskScore, "/ 100");

  // 3. Build review report (markdown)
  const reviewReport = formatReviewReport(unique, riskScore);
  console.log("[graph]    └─ Report length:", reviewReport.length, "chars");

  console.log("[graph] ◀️ postProcess done");

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
