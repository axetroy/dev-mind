/**
 * dev-mind LangGraph Graph Builder
 *
 * 对应 design.md §3 Graph 节点设计 & §7 LangGraph 运行模式。
 * 组装所有 node 为 Hybrid Loop Graph，提供 compile() 入口。
 *
 * 流程图：
 *   START → fetchMR → parseDiff → planAnalysis
 *                                       ↓
 *                              ┌── toolExecution ←┐
 *                              ↓                   │
 *                         contextRetrieval         │ (loop if steps remain)
 *                              ↓                   │
 *                         llmReview ───────────────┘
 *                              ↓
 *                         postProcess
 *                              ↓
 *                         gitlabOutput
 *                              ↓
 *                             END
 */

import { randomUUID } from "node:crypto";
import { StateGraph, END } from "@langchain/langgraph";
import { CHANNELS, createInitialState } from "../state.js";
import { fetchMRNode } from "./nodes/fetchMR.js";
import { parseDiffNode } from "./nodes/parseDiff.js";
import { planAnalysisNode } from "./nodes/planAnalysis.js";
import { toolExecutionNode } from "./nodes/toolExecution.js";
import { contextRetrievalNode } from "./nodes/contextRetrieval.js";
import { llmReviewNode } from "./nodes/llmReview.js";
import { postProcessNode } from "./nodes/postProcess.js";
import { gitlabOutputNode } from "./nodes/gitlabOutput.js";
import { getConfig } from "../config.js";
import { withNodeLogging, createRunLogger, getLogger } from "../logger/index.js";

// ─── Node Names ─────────────────────────────────────────────────────────────

const N = {
  FETCH_MR: "fetchMR",
  PARSE_DIFF: "parseDiff",
  PLAN: "planAnalysis",
  TOOL_EXEC: "toolExecution",
  CONTEXT: "contextRetrieval",
  LLM_REVIEW: "llmReview",
  POST_PROCESS: "postProcess",
  GITLAB_OUTPUT: "gitlabOutput",
};

// ─── Router Functions ───────────────────────────────────────────────────────

/**
 * 在 toolExecution 后决定下一步。
 * 如果 plan 中还有未执行的 step → 继续 toolExecution (loop)
 * 如果 plan 已经执行完毕        → 进入 contextRetrieval
 */
function toolRouter(state) {
  const { plan, tool_calls, iteration } = state;

  if (!plan || plan.steps.length === 0) {
    return N.CONTEXT; // No plan needed, go straight to review
  }

  const remaining = plan.steps.length - tool_calls.length;

  if (remaining > 0 && iteration < getConfig().MAX_TOOL_ITERATIONS) {
    return N.TOOL_EXEC; // More tools to run
  }

  return N.CONTEXT; // Plan complete → gather context
}

/**
 * 在 llmReview 后决定下一步。
 * 如果 LLM 标记 needs_more_info 且有 next_plan → 回 toolExecution 继续收集
 * 否则 → postProcess
 */
function reviewRouter(state) {
  if (state.needs_more_info === true && state.next_plan?.length > 0) {
    return N.TOOL_EXEC;
  }
  return N.POST_PROCESS;
}

/**
 * 在 postProcess 后决定：是否输出到 GitLab？
 * 如果只有 mr_id 和 project_id，则执行 gitlabOutput。
 */
function outputRouter(state) {
  if (state.mr_id && state.project_id) {
    return N.GITLAB_OUTPUT;
  }
  return END;
}

// ─── Build Graph ────────────────────────────────────────────────────────────

let _compiledGraph = null;

/**
 * 构建并编译 LangGraph 图。
 *
 * @returns {import("@langchain/langgraph").CompiledGraph}
 */
export function buildGraph() {
  if (_compiledGraph) return _compiledGraph;

  const workflow = new StateGraph({ channels: CHANNELS });

  // ── Add nodes (auto-wrapped with lifecycle logging) ─────────────────────
  workflow.addNode(N.FETCH_MR,      withNodeLogging(N.FETCH_MR,      fetchMRNode));
  workflow.addNode(N.PARSE_DIFF,    withNodeLogging(N.PARSE_DIFF,    parseDiffNode));
  workflow.addNode(N.PLAN,          withNodeLogging(N.PLAN,          planAnalysisNode));
  workflow.addNode(N.TOOL_EXEC,     withNodeLogging(N.TOOL_EXEC,     toolExecutionNode));
  workflow.addNode(N.CONTEXT,       withNodeLogging(N.CONTEXT,       contextRetrievalNode));
  workflow.addNode(N.LLM_REVIEW,    withNodeLogging(N.LLM_REVIEW,    llmReviewNode));
  workflow.addNode(N.POST_PROCESS,  withNodeLogging(N.POST_PROCESS,  postProcessNode));
  workflow.addNode(N.GITLAB_OUTPUT, withNodeLogging(N.GITLAB_OUTPUT, gitlabOutputNode));

  // ── Edges ──────────────────────────────────────────────────────────────
  workflow.setEntryPoint(N.FETCH_MR);

  workflow.addEdge(N.FETCH_MR,      N.PARSE_DIFF);
  workflow.addEdge(N.PARSE_DIFF,    N.PLAN);

  // Conditional: tool execution loop
  workflow.addConditionalEdges(N.TOOL_EXEC, toolRouter, {
    [N.TOOL_EXEC]:  N.TOOL_EXEC,
    [N.CONTEXT]:    N.CONTEXT,
  });

  workflow.addEdge(N.PLAN,          N.TOOL_EXEC);
  workflow.addEdge(N.CONTEXT,       N.LLM_REVIEW);

  // Conditional: review → post-process or loop back to tool execution
  workflow.addConditionalEdges(N.LLM_REVIEW, reviewRouter, {
    [N.POST_PROCESS]: N.POST_PROCESS,
    [N.TOOL_EXEC]:    N.TOOL_EXEC,
  });

  // Conditional: output or end
  workflow.addConditionalEdges(N.POST_PROCESS, outputRouter, {
    [N.GITLAB_OUTPUT]: N.GITLAB_OUTPUT,
    [END]: END,
  });

  workflow.addEdge(N.GITLAB_OUTPUT, END);

  // ── Compile ────────────────────────────────────────────────────────────
  _compiledGraph = workflow.compile();
  return _compiledGraph;
}

/**
 * 对指定的 MR 运行完整的 review 流程。
 *
 * @param {Object} opts
 * @param {string}  opts.projectId  - GitLab project ID (数字 或 "namespace/project")
 * @param {string}  opts.mrIid      - MR IID（数字字符串）
 * @param {AbortSignal} [opts.signal] - 可选 AbortSignal，支持外部取消（如 Ctrl+C）
 * @returns {Promise<import("../state.js").ReviewState>}
 */
export async function runReview({ projectId, mrIid, signal } = {}) {
  // ── 创建 per-run logger ───────────────────────────────────────────────
  const runId = `review-${randomUUID().slice(0, 8)}`;
  const logger = createRunLogger(runId);
  logger.info("🚀 runReview started", { projectId, mrIid });

  const graph = buildGraph();
  const initialState = createInitialState({
    run_id: runId,
    mr_id: mrIid,
    project_id: projectId,
  });

  const startTime = Date.now();

  try {
    const finalState = await graph.invoke(initialState, {
      recursionLimit: 50,
      signal,
    });

    const elapsed = Date.now() - startTime;
    logger.info(`✅ Review completed in ${elapsed}ms`, {
      duration_ms: elapsed,
      total_issues: finalState.issues?.length ?? 0,
      risk_score: finalState.risk_score,
    });

    return finalState;
  } catch (err) {
    logger.error(`❌ Review failed: ${err.message}`, {
      error: err.message,
      stack: err.stack,
      duration_ms: Date.now() - startTime,
    });
    throw err;
  } finally {
    logger.close();
  }
}
