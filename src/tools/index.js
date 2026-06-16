/**
 * dev-mind 工具注册表
 *
 * 统一导出所有工具，供 graph 中的 tool execution node 使用。
 * 工具按名称映射，方便 LLM 通过字符串调用。
 */

import * as gitlab from "./gitlab.js";
import * as ci from "./codeIntelligence.js";

/**
 * 所有可用工具的映射表。
 * key    — 工具名（供 LLM plan 引用）
 * value — { description, run: (...args) => Promise<any> }
 */
export const TOOL_REGISTRY = {
  // ── GitLab Tools ─────────────────────────────────────────────────────────
  get_merge_request: {
    description: "获取 GitLab MR 的元数据信息",
    run: (state, args) => gitlab.getMergeRequest(state.project_id, state.mr_id),
  },
  get_diff: {
    description: "获取 MR 的 diff / changes",
    run: (state, args) => gitlab.getMergeRequestDiff(state.project_id, state.mr_id),
  },
  read_file: {
    description: "从仓库读取文件的完整内容（使用 MR 源分支）",
    run: (state, args) => gitlab.getFile(state.project_id, args.path, state.source_branch ?? "main"),
  },
  search_code: {
    description: "在仓库中搜索代码片段（搜索 MR 源分支）",
    run: (state, args) => gitlab.searchCode(state.project_id, args.query),
  },
  get_directory_tree: {
    description: "获取仓库目录结构（MR 源分支）",
    run: (state, args) => gitlab.getDirectoryTree(state.project_id, args.path ?? "", state.source_branch ?? "main"),
  },
  get_commits: {
    description: "获取 MR 的 commit 历史",
    run: (state, args) => gitlab.getMergeRequestCommits(state.project_id, state.mr_id),
  },

  // ── Code Intelligence Tools ──────────────────────────────────────────────
  get_symbol_definition: {
    description: "获取某个符号的定义位置",
    run: (state, args) => ci.getSymbolDefinition(args.path, args.symbol),
  },
  get_references: {
    description: "搜索某个符号在仓库中的所有引用",
    run: (state, args) => ci.getReferences(args.repoRoot ?? ".", args.symbol),
  },
  get_call_graph: {
    description: "获取某个文件的导入依赖",
    run: (state, args) => ci.getDependencies(args.path),
  },
};

/**
 * 调用注册表中的某个工具。
 * @param {string} toolName
 * @param {Object} state  - 当前的 ReviewState
 * @param {Object} args   - 工具参数
 * @returns {Promise<{tool:string, args:Object, result:any, success:boolean}>}
 */
export async function callTool(toolName, state, args = {}) {
  const entry = TOOL_REGISTRY[toolName];
  if (!entry) {
    return {
      tool: toolName,
      args,
      result: `Unknown tool: ${toolName}`,
      success: false,
    };
  }

  try {
    const result = await entry.run(state, args);
    const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return { tool: toolName, args, result: resultStr, success: true };
  } catch (err) {
    return { tool: toolName, args, result: err.message, success: false };
  }
}

/**
 * 获取工具列表的描述（供 LLM planning prompt 使用）。
 */
export function getToolDescriptions() {
  return Object.entries(TOOL_REGISTRY).map(
    ([name, entry]) => `- ${name}: ${entry.description}`,
  ).join("\n");
}
