/**
 * dev-mind Tool Execution Node
 *
 * 对应 design.md §4.4 Tool Execution Loop。
 * 这是 LangGraph 最核心能力：按 plan 执行工具并更新 state。
 *
 * 本 node 在 LangGraph loop 中反复调用，
 * 直到所有 plan step 执行完毕或达到最大迭代次数。
 */

import { callTool, TOOL_REGISTRY } from "../../tools/index.js";
import { getConfig } from "../../config.js";
import { getLogger } from "../../logger/index.js";

/**
 * @param {import("../../state.js").ReviewState} state
 * @returns {Promise<Partial<import("../../state.js").ReviewState>>}
 */
export async function toolExecutionNode(state) {
  const { plan, tool_calls, iteration } = state;
  const maxIter = getConfig().MAX_TOOL_ITERATIONS;
  const log = getLogger(state.run_id);

  // ── Guard: stop conditions ────────────────────────────────────────────
  if (!plan || iteration >= maxIter) {
    const reason = !plan ? "No plan to execute" : `Reached max tool iterations (${maxIter})`;
    log.info(`skip — ${reason}`);
    return { decisions: [reason] };
  }

  const remainingSteps = plan.steps.slice(tool_calls.length);

  if (remainingSteps.length === 0) {
    log.info(`all steps completed (total: ${tool_calls.length})`);
    return { decisions: ["All plan steps completed"] };
  }

  // ── Execute next step ─────────────────────────────────────────────────
  const step = remainingSteps[0];
  const total = plan.steps.length;
  const current = iteration + 1;

  log.progress(`[${current}/${total}] ${step.action}(${formatArgs(step.args)})`);

  // Tool call tracing
  log.toolCall(step.action, step.args);
  const startTime = Date.now();
  const result = await callTool(step.action, state, step.args ?? {});
  const elapsed = Date.now() - startTime;
  log.toolResult(step.action, result.result, elapsed);

  // ── If read_file succeeds, cache the content ───────────────────────────
  const fileContentsUpdate = {};
  let resultPreview = "";

  if (step.action === "read_file" && result.success && step.args.path) {
    fileContentsUpdate[step.args.path] = result.result;
    resultPreview = ` (${result.result.length} chars)`;
  }

  const newIteration = iteration + 1;

  return {
    tool_calls: [result],
    file_contents: fileContentsUpdate,
    iteration: newIteration,
    current_file: step.args?.path || state.current_file,
    decisions: [
      result.success
        ? `[${current}/${total}] ✅ ${step.action}(${formatArgs(step.args)})`
        : `[${current}/${total}] ❌ ${step.action}(${formatArgs(step.args)}): ${result.result}`,
    ],
  };
}

function formatArgs(args) {
  if (!args) return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}
