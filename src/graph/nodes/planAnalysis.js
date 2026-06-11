/**
 * dev-mind Plan Analysis Node
 *
 * 对应 design.md §4.3 Planning Node（非常关键🔥）。
 * 调用 LLM 生成 tool execution plan，指导后续的 Tool Execution Loop。
 */

import { llmCallJSON } from "../../llm/client.js";
import { PLAN_SYSTEM_PROMPT, buildPlanPrompt } from "../../llm/prompts.js";
import { getToolDescriptions } from "../../tools/index.js";

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function planAnalysisNode(state) {
  const { diff, files } = state;

  // Build a concise diff summary for the planner
  const diffSummary = diff.map((d) => {
    const path = d.newPath || d.oldPath;
    const hunkCount = d.hunks.length;
    const totalLines = d.hunks.reduce((acc, h) => acc + h.content.split("\n").length, 0);
    return `  ${path} (${d.type}, ${hunkCount} hunks, ~${totalLines} lines)`;
  }).join("\n");

  const toolsDesc = getToolDescriptions();

  const systemPrompt = `${PLAN_SYSTEM_PROMPT}\n\nAvailable tools:\n${toolsDesc}`;
  const userPrompt = buildPlanPrompt(diffSummary, files);

  let plan;
  try {
    const raw = await llmCallJSON(systemPrompt, userPrompt);
    // Support both { steps: [...] } and direct array
    plan = {
      steps: Array.isArray(raw) ? raw : Array.isArray(raw.steps) ? raw.steps : [],
    };
  } catch (err) {
    // Fallback: generate a default plan based on changed files
    plan = {
      steps: files.slice(0, 5).map((f) => ({
        action: "read_file",
        args: { path: f },
      })),
    };
  }

  return {
    plan,
    decisions: [
      `Generated analysis plan with ${plan.steps.length} steps`,
    ],
  };
}
