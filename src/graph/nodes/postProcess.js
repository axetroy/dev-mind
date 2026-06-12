/**
 * dev-mind Post Processing Node
 *
 * 对应 design.md §4.7 Post Processing Node。
 * 合并 issues、去重、评分、格式化输出。
 */

import { deduplicateIssues, calculateRiskScore, formatReviewReport } from "../../output/formatter.js";
import { getLogger } from "../../logger/index.js";

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function postProcessNode(state) {
  const { issues } = state;
  const log = getLogger(state.run_id);

  // 1. Deduplicate
  const unique = deduplicateIssues(issues);
  log.info(`Dedup: ${issues.length} → ${unique.length}`);

  // 2. Calculate risk score
  const riskScore = calculateRiskScore(unique);
  log.info(`Risk score: ${riskScore} / 100`);

  // 3. Build review report (markdown)
  const reviewReport = formatReviewReport(unique, riskScore);
  log.info(`Report length: ${reviewReport.length} chars`);

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
