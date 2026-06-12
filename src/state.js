/**
 * dev-mind LangGraph 状态定义
 *
 * 对应 design.md §2.1 ReviewState — 核心数据结构，
 * 同时定义 LangGraph StateGraph 所需的 channels（含 reducer）。
 */

// ─── 子类型 ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Hunk
 * @property {string} header      - unified diff header (e.g. "@@ -1,5 +1,8 @@")
 * @property {string} content     - raw diff lines
 * @property {number} oldStart    - start line in old file
 * @property {number} newStart    - start line in new file
 */

/**
 * @typedef {Object} Diff
 * @property {string} oldPath
 * @property {string} newPath
 * @property {"added"|"modified"|"deleted"|"renamed"} type
 * @property {Hunk[]} hunks
 */

/**
 * @typedef {Object} Issue
 * @property {"bug"|"security"|"performance"|"maintainability"|"architecture"} type
 * @property {string} file
 * @property {number} line               - 新文件行号（new_line）
 * @property {number} [oldLine]           - 旧文件行号（old_line，可选）
 * @property {string} message
 * @property {string} [suggestion]
 * @property {"critical"|"warning"|"suggestion"} severity
 */

/**
 * @typedef {Object} CodeChunk
 * @property {string} file
 * @property {string} functionName
 * @property {string} code
 * @property {number} startLine
 * @property {number} endLine
 * @property {number} [relevanceScore]
 */

/**
 * @typedef {Object} ToolCall
 * @property {string} tool
 * @property {Object} args
 * @property {string} result
 * @property {boolean} success
 */

/**
 * @typedef {Object} ReviewPlanStep
 * @property {string} action  - 工具名称（对应 TOOL_REGISTRY 中的 key）
 * @property {Object<string,*>} args - 工具的参数
 */

/**
 * @typedef {Object} ReviewPlan
 * @property {ReviewPlanStep[]} steps - ordered list of tool execution steps
 * @property {number} [estimatedSteps]
 */

// ─── 主 State ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DiffRefs
 * @property {string} base_sha
 * @property {string} start_sha
 * @property {string} head_sha
 */

/**
 * @typedef {Object} ReviewState
 * @property {string}            mr_id
 * @property {string}            project_id
 * @property {Diff[]}            diff
 * @property {string[]}          files
 * @property {string|null}       source_branch    - MR 的源分支（用于读取文件）
 * @property {string|null}       current_file
 * @property {Record<string,string>} file_contents
 * @property {CodeChunk[]}       context_chunks
 * @property {Issue[]}           issues
 * @property {string[]}          decisions
 * @property {string|null}       review_report
 * @property {ToolCall[]}        tool_calls
 * @property {number|null}       risk_score
 * @property {ReviewPlan|null}   plan
 * @property {number}            iteration
 * @property {string[]}          errors
 * @property {DiffRefs|null}     diff_refs         - GitLab diff SHA references for inline comments
 */

// ─── 初始状态工厂 ──────────────────────────────────────────────────────────

/**
 * 创建初始 ReviewState
 * @param {Object} [opts]
 * @param {string} [opts.mr_id]
 * @param {string} [opts.project_id]
 * @returns {ReviewState}
 */
export function createInitialState(opts = {}) {
  return {
    mr_id: opts.mr_id ?? "",
    project_id: opts.project_id ?? "",
    diff: [],
    files: [],
    source_branch: null,
    current_file: null,
    file_contents: {},
    context_chunks: [],
    issues: [],
    decisions: [],
    review_report: null,
    tool_calls: [],
    risk_score: null,
    plan: null,
    iteration: 0,
    errors: [],
    diff_refs: null,
  };
}

// ─── LangGraph Channel 定义 ─────────────────────────────────────────────────
// 每个 channel 对应 state 中的一个 key，reducer 控制值如何更新。

const overwrite = (_prev, next) => (next ?? undefined);
const append = (prev, next) => [...(prev ?? []), ...(next ?? [])];
const mergeRecord = (prev, next) => ({ ...(prev ?? {}), ...(next ?? {}) });

/** @type {Record<string, {value: Function}>} */
export const CHANNELS = {
  mr_id:         { value: overwrite },
  project_id:    { value: overwrite },
  diff:          { value: overwrite },
  files:         { value: overwrite },
  source_branch: { value: overwrite },
  current_file:  { value: overwrite },
  file_contents: { value: mergeRecord },
  context_chunks:{ value: append },
  issues:        { value: append },
  decisions:     { value: append },
  review_report: { value: overwrite },
  tool_calls:    { value: append },
  risk_score:    { value: overwrite },
  plan:          { value: overwrite },
  iteration:     { value: overwrite },
  errors:        { value: append },
  diff_refs:     { value: overwrite },
};
