/**
 * dev-mind GitLab 工具层
 *
 * 使用 @gitbeaker/rest 替代原始 fetch 调用。
 * 对应 design.md §5.1 GitLab Tool API。
 *
 * @module tools/gitlab
 */

import { Gitlab } from "@gitbeaker/rest";
import { getConfig } from "../config.js";

// ═══════════════════════════════════════════════════════════════════════
// 类型引用（JSDoc import types, 用于 IDE 智能提示 & TypeScript 检查）
// ═══════════════════════════════════════════════════════════════════════

/**
 * GitLab MR API 返回的完整 MR 对象（含 `diff_refs`、`source_branch` 等扩展字段）。
 * @typedef {import('@gitbeaker/rest').ExpandedMergeRequestSchema} MergeRequest
 */

/**
 * GitLab MR `/changes` 端点返回的对象，包含 `changes` 数组和 `overflow` 字段。
 * @typedef {import('@gitbeaker/rest').MergeRequestChangesSchema} MergeRequestChanges
 */

/**
 * 单个文件的 diff 变更（`CommitDiffSchema`）。
 * @typedef {import('@gitbeaker/rest').CommitDiffSchema} CommitDiff
 */

/**
 * 单个 commit 对象。
 * @typedef {import('@gitbeaker/rest').CommitSchema} Commit
 */

/**
 * GitLab diff 引用，用于 inline comment 定位。
 * @typedef {import('@gitbeaker/rest').DiffRefsSchema} DiffRefs
 */

/**
 * 仓库目录树中的一个条目。
 * @typedef {import('@gitbeaker/rest').RepositoryTreeSchema} TreeEntry
 */

/**
 * MR Discussion（包含多条 notes）。
 * @typedef {import('@gitbeaker/rest').DiscussionSchema} Discussion
 */

/**
 * Discussion 中的一条 note（含 position 信息）。
 * @typedef {import('@gitbeaker/rest').MergeRequestDiscussionNoteSchema} DiscussionNote
 */

/**
 * MR 普通评论。
 * @typedef {import('@gitbeaker/rest').NoteSchema} Note
 */

/**
 * 代码搜索结果中的 blob。
 * @typedef {import('@gitbeaker/rest').BlobSchema} SearchBlob
 */

/**
 * Inline comment 的位置参数（不含 SHA，SHA 由 position.diffRefs 提供）。
 * @typedef {Object} InlineCommentOptions
 * @property {string}   body               - 评论内容
 * @property {string}   path               - 文件路径
 * @property {number}   line               - 行号（new_line）
 * @property {DiffRefs} position           - diff 引用 (base/start/head sha)
 */

/**
 * @typedef {'getDiff'|'getMR'|'getCommits'|'getFile'|'getTree'|
 *   'searchCode'|'createComment'|'createInline'|'setLabels'|'?'} PathHint
 * 用于错误消息中的路径提示。
 */

// ═══════════════════════════════════════════════════════════════════════
// 内部实现
// ═══════════════════════════════════════════════════════════════════════

/** @type {import('@gitbeaker/rest').Gitlab<false> | null} */
let _api = null;

/**
 * 获取 Gitlab API 单例。
 *
 * 首次调用时从 `getConfig()` 读取 token / host 创建实例；
 * 进程生命周期内复用同一实例。
 *
 * @returns {import('@gitbeaker/rest').Gitlab<false>}
 */
function getApi() {
  const cfg = getConfig();
  if (!_api) {
    _api = new Gitlab({
      token: cfg.GITLAB_TOKEN,
      host: cfg.GITLAB_URL,
    });
  }
  return _api;
}

/**
 * 将 @gitbeaker/rest 抛出的错误格式化为一致字符串，
 * 保持与旧 gitlabFetch 相同的报错风格。
 *
 * @param {unknown}  err  - 捕获的异常
 * @param {string}   path - 请求路径描述（用于错误消息）
 * @returns {string} 格式化后的错误消息
 */
function formatError(err, path) {
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return `GitLab 网络错误: ${err.message}`;
  }

  // @gitbeaker/rest 错误通常具有 .response、.description 属性
  const gitlabErr = /** @type {{ response?: { status?: number }; description?: string; cause?: { description?: string }; message?: string }} */ (err);

  const status = gitlabErr.response?.status ?? "?";
  const description = gitlabErr.description ?? gitlabErr.cause?.description ?? gitlabErr.message ?? String(err);

  return `GitLab API ${status} on ${path}: ${description}`;
}

/**
 * 包装一个 @gitbeaker/rest 调用，统一错误处理和异常转换。
 *
 * @template T
 * @param {(...args: any[]) => Promise<T>} method - 要执行的 API 调用
 * @param {...any} args                            - 传给 method 的参数
 * @returns {Promise<T>} API 响应
 */
async function wrap(method, ...args) {
  try {
    return await method(...args);
  } catch (err) {
    const path = args.length >= 2 ? `${args[0]}/${args[1]}` : String(args[0] ?? "?");
    throw new Error(formatError(err, path));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MR Tools
// ═══════════════════════════════════════════════════════════════════════

/**
 * 获取 MR 的详细信息。
 *
 * 返回 GitLab API merge_requests/show 的完整响应，
 * 包含 `title`、`source_branch`、`target_branch`、`diff_refs` 等字段。
 *
 * @param {string} projectId - 项目 ID 或 namespace/path（如 `"group/repo"`）
 * @param {string} mrIid     - MR IID（不带 `!` 前缀的数字）
 * @returns {Promise<MergeRequest>}
 */
export async function getMergeRequest(projectId, mrIid) {
  return wrap(
    (/** @type {string} */ a, /** @type {string} */ b) => getApi().MergeRequests.show(a, b),
    projectId,
    mrIid,
  );
}

/**
 * 获取 MR 的 diff / changes。
 *
 * 返回包含 `changes` 数组的对象，每个元素是一个 `CommitDiffSchema`，
 * 包含 `diff`、`new_path`、`old_path`、`new_file`、`renamed_file`、`deleted_file` 等字段。
 *
 * > ⚠️ 此端点已在 GitLab API 15.7 标记为 deprecated，将在 API v5 移除。
 * > 当前仍可使用，迁移到 `allDiffs` 的时机待定。
 *
 * @param {string} projectId - 项目 ID
 * @param {string} mrIid     - MR IID
 * @returns {Promise<MergeRequestChanges>}
 */
export async function getMergeRequestDiff(projectId, mrIid) {
  return wrap(
    (/** @type {string} */ a, /** @type {string} */ b) => getApi().MergeRequests.showChanges(a, b),
    projectId,
    mrIid,
  );
}

/**
 * 获取 MR 的 commit 列表。
 *
 * 返回按时间顺序排列的 commit 对象数组，每个包含
 * `id`、`short_id`、`title`、`message`、`author_name`、`committed_date` 等。
 *
 * @param {string} projectId - 项目 ID
 * @param {string} mrIid     - MR IID
 * @returns {Promise<Commit[]>}
 */
export async function getMergeRequestCommits(projectId, mrIid) {
  return wrap(
    (/** @type {string} */ a, /** @type {string} */ b) => getApi().MergeRequests.allCommits(a, b),
    projectId,
    mrIid,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// File Tools
// ═══════════════════════════════════════════════════════════════════════

/**
 * 从仓库获取某个文件的原始内容。
 *
 * 返回文件内容的纯文本字符串。
 * 如果 API 返回的不是纯文本（如二进制文件），会执行 `JSON.stringify` 兜底。
 *
 * @param {string}  projectId - 项目 ID
 * @param {string}  filePath  - 文件路径（如 `"src/index.js"`）
 * @param {string}  [ref]     - 分支名或 commit SHA，默认 `"main"`
 * @returns {Promise<string>} 文件原始内容
 */
export async function getFile(projectId, filePath, ref = "main") {
  const data = await wrap(
    (/** @type {string} */ a, /** @type {string} */ b, /** @type {string} */ c) =>
      getApi().RepositoryFiles.showRaw(a, b, c),
    projectId,
    filePath,
    ref,
  );
  return typeof data === "string" ? data : JSON.stringify(data);
}

/**
 * 获取仓库目录树。
 *
 * 返回目录条目数组，每个条目包含 `id`、`name`、`type`（`"tree"` 或 `"blob"`）、`path`、`mode`。
 *
 * @param {string}  projectId - 项目 ID
 * @param {string}  [path]    - 子目录路径（默认空 = 根目录）
 * @param {string}  [ref]     - 分支名或 commit SHA，默认 `"main"`
 * @returns {Promise<TreeEntry[]>} 目录条目列表
 */
export async function getDirectoryTree(projectId, path = "", ref = "main") {
  return wrap(
    (/** @type {string} */ a, /** @type {{ path?: string; ref: string }} */ opts) =>
      getApi().Repositories.allRepositoryTrees(a, opts),
    projectId,
    { path: path || undefined, ref },
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Search Tools
// ═══════════════════════════════════════════════════════════════════════

/**
 * 在项目中搜索代码。
 *
 * 使用 GitLab Search API `scope=blobs` 进行全文搜索，
 * 返回匹配的 blob 条目（含 `filename`、`ref`、`startline`、`data` 等）。
 *
 * @param {string} projectId - 项目 ID
 * @param {string} query     - 搜索关键词
 * @returns {Promise<SearchBlob[]>} 搜索结果列表
 */
export async function searchCode(projectId, query) {
  return wrap(
    (/** @type {string} */ a, /** @type {string} */ b, /** @type {{ projectId: string }} */ opts) =>
      getApi().Search.all(a, b, opts),
    "blobs",
    query,
    { projectId },
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Comment Tools
// ═══════════════════════════════════════════════════════════════════════

/**
 * 在 MR 上创建一条普通评论。
 *
 * 评论会以 `Note` 的形式出现在 MR 的 Activity 中。
 *
 * @param {string} projectId - 项目 ID
 * @param {string} mrIid     - MR IID
 * @param {string} body      - 评论 Markdown 正文
 * @returns {Promise<Note>} 创建的评论对象
 */
export async function createComment(projectId, mrIid, body) {
  return wrap(
    (/** @type {string} */ a, /** @type {string} */ b, /** @type {string} */ c) =>
      getApi().MergeRequestNotes.create(a, b, c),
    projectId,
    mrIid,
    body,
  );
}

/**
 * 在 MR 上创建一条 inline / code 评论（discussion）。
 *
 * 评论会附着在指定文件的指定行上，显示在 MR 的 Changes 页面。
 * 需要传入 `position` 对象（含 `base_sha` / `start_sha` / `head_sha`），
 * 这些值应从 MR 元数据的 `diff_refs` 字段获取。
 *
 * @param {string}             projectId - 项目 ID
 * @param {string}             mrIid     - MR IID
 * @param {InlineCommentOptions} opts     - 评论参数
 * @returns {Promise<Discussion>} 创建的 discussion 对象
 *
 * @example
 * // 从 MR 响应中获取 diff_refs
 * const mr = await getMergeRequest("group/repo", "42");
 * const discussion = await createInlineComment("group/repo", "42", {
 *   body: "**Warning:** 请使用 `const` 代替 `let`",
 *   path: "src/index.js",
 *   line: 15,
 *   position: mr.diff_refs,
 * });
 */
export async function createInlineComment(projectId, mrIid, opts) {
  // Build position using camelCase keys to match @gitbeaker/rest's DiscussionNotePositionOptions (Camelize<schema>)
  // The library internally calls decamelizeKeys() and then qs.stringify() to produce position[...] form fields.
  // old_path must be explicitly set (same as new_path) — GitLab's line_code hash uses it.
  const position = {
    positionType: "text",
    baseSha: opts.position.base_sha,
    startSha: opts.position.start_sha,
    headSha: opts.position.head_sha,
    newPath: opts.path,
    oldPath: opts.path,
    newLine: opts.line,
  };

  // Debug: log the position being sent (first 500 chars)
  const posPreview = JSON.stringify(position);
  console.log(`[gitlab] createInlineComment position: ${posPreview.slice(0, 500)}`);

  return wrap(
    (
      /** @type {string} */ a,
      /** @type {string} */ b,
      /** @type {string} */ body,
      /** @type {{ position: import('@gitbeaker/rest').DiscussionNotePositionOptions }} */ options,
    ) => getApi().MergeRequestDiscussions.create(a, b, body, options),
    projectId,
    mrIid,
    opts.body,
    { position },
  );
}

/**
 * 设置 MR 标签。
 *
 * 通过 PUT merge_requests/:id 接口设置标签。
 * 已有标签会被替换（非追加）。
 *
 * @param {string}   projectId - 项目 ID
 * @param {string}   mrIid     - MR IID
 * @param {string[]} labels    - 标签名数组（如 `["AI Review: OK"]`）
 * @returns {Promise<MergeRequest>} 更新后的 MR 对象
 */
export async function setMRLabels(projectId, mrIid, labels) {
  return wrap(
    (/** @type {string} */ a, /** @type {string} */ b, /** @type {{ labels: string }} */ opts) =>
      getApi().MergeRequests.edit(a, b, opts),
    projectId,
    mrIid,
    { labels: labels.join(",") },
  );
}
