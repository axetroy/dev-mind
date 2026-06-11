/**
 * dev-mind GitLab 工具层
 *
 * 对应 design.md §5.1 GitLab Tool API。
 * 通过 GitLab REST API 与项目交互。
 */

import { getConfig } from "../config.js";

// ─── 底层 HTTP 客户端 ──────────────────────────────────────────────────────

/**
 * 向 GitLab API 发起请求。
 * @param {string} path   - API 路径（如 "/api/v4/projects/1"）
 * @param {Object} [opts] - 选项
 * @param {string} [opts.method]
 * @param {Object} [opts.query]
 * @returns {Promise<any>}
 */
async function gitlabFetch(path, opts = {}) {
  const cfg = getConfig();
  const url = new URL(`${cfg.GITLAB_URL}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "PRIVATE-TOKEN": cfg.GITLAB_TOKEN,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab API ${res.status} on ${path}: ${text}`);
  }

  // Some endpoints return empty body (204)
  const ct = res.headers.get("content-type") ?? "";
  if (res.status === 204 || !ct.includes("json")) return null;

  return res.json();
}

/**
 * URL-encode project path (e.g. "group/subgroup/project" -> "group%2Fsubgroup%2Fproject")
 */
function encodeProject(projectId) {
  return encodeURIComponent(projectId);
}

// ─── MR Tools ──────────────────────────────────────────────────────────────

/**
 * 获取 MR 的详细信息。
 * @param {string} projectId
 * @param {string} mrIid
 * @returns {Promise<Object>}
 */
export async function getMergeRequest(projectId, mrIid) {
  return gitlabFetch(`/api/v4/projects/${encodeProject(projectId)}/merge_requests/${mrIid}`);
}

/**
 * 获取 MR 的 diff（changes）。
 * @param {string} projectId
 * @param {string} mrIid
 * @returns {Promise<Object[]>}
 */
export async function getMergeRequestDiff(projectId, mrIid) {
  return gitlabFetch(`/api/v4/projects/${encodeProject(projectId)}/merge_requests/${mrIid}/changes`);
}

/**
 * 获取 MR 的 commits。
 * @param {string} projectId
 * @param {string} mrIid
 * @returns {Promise<Object[]>}
 */
export async function getMergeRequestCommits(projectId, mrIid) {
  return gitlabFetch(`/api/v4/projects/${encodeProject(projectId)}/merge_requests/${mrIid}/commits`);
}

// ─── File Tools ─────────────────────────────────────────────────────────────

/**
 * 从仓库获取某个文件的原始内容（来自目标分支）。
 * @param {string} projectId
 * @param {string} filePath
 * @param {string} [ref] - branch / commit SHA
 * @returns {Promise<string>}
 */
export async function getFile(projectId, filePath, ref = "main") {
  const data = await gitlabFetch(
    `/api/v4/projects/${encodeProject(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw`,
    { query: { ref } },
  );
  return typeof data === "string" ? data : JSON.stringify(data);
}

/**
 * 获取仓库目录树。
 * @param {string} projectId
 * @param {string} [path]
 * @param {string} [ref]
 * @returns {Promise<Object[]>}
 */
export async function getDirectoryTree(projectId, path = "", ref = "main") {
  return gitlabFetch(
    `/api/v4/projects/${encodeProject(projectId)}/repository/tree`,
    { query: { path: path || undefined, ref, per_page: 100 } },
  );
}

// ─── Search Tools ───────────────────────────────────────────────────────────

/**
 * 在项目中搜索代码。
 * @param {string} projectId
 * @param {string} query
 * @returns {Promise<Object[]>}
 */
export async function searchCode(projectId, query) {
  return gitlabFetch(
    `/api/v4/projects/${encodeProject(projectId)}/search`,
    { query: { scope: "blobs", search: query } },
  );
}

// ─── Comment Tools ──────────────────────────────────────────────────────────

/**
 * 在 MR 上创建一条普通评论。
 * @param {string} projectId
 * @param {string} mrIid
 * @param {string} body
 * @returns {Promise<Object>}
 */
export async function createComment(projectId, mrIid, body) {
  return gitlabFetch(
    `/api/v4/projects/${encodeProject(projectId)}/merge_requests/${mrIid}/notes`,
    { method: "POST", body: { body } },
  );
}

/**
 * 在 MR 上创建一条 inline / code 评论。
 * @param {string} projectId
 * @param {string} mrIid
 * @param {Object} opts
 * @param {string} opts.body
 * @param {string} opts.path        - file path
 * @param {number} opts.line        - line number (new)
 * @param {Object} opts.position    - GitLab diff position refs
 * @param {string} opts.position.base_sha
 * @param {string} opts.position.start_sha
 * @param {string} opts.position.head_sha
 * @returns {Promise<Object>}
 */
export async function createInlineComment(projectId, mrIid, opts) {
  return gitlabFetch(
    `/api/v4/projects/${encodeProject(projectId)}/merge_requests/${mrIid}/discussions`,
    {
      method: "POST",
      body: {
        body: opts.body,
        position: {
          position_type: "text",
          base_sha: opts.position.base_sha,
          start_sha: opts.position.start_sha,
          head_sha: opts.position.head_sha,
          new_path: opts.path,
          new_line: opts.line,
        },
      },
    },
  );
}

/**
 * 设置 MR 标签。
 * @param {string} projectId
 * @param {string} mrIid
 * @param {string[]} labels
 * @returns {Promise<Object>}
 */
export async function setMRLabels(projectId, mrIid, labels) {
  return gitlabFetch(
    `/api/v4/projects/${encodeProject(projectId)}/merge_requests/${mrIid}`,
    { method: "PUT", body: { labels: labels.join(",") } },
  );
}
