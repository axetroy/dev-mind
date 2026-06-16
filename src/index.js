/**
 * dev-mind Agent API Service
 *
 * 对应 design.md §1 总体架构中的 Agent API Service。
 * 提供 HTTP 接口，接收 GitLab webhook 或手动触发 review。
 */

import express from "express";
import { getConfig } from "./config.js";
import { buildGraph, runReview } from "./graph/index.js";

const app = express();
app.use(express.json());

// ─── MR 级别去重 ────────────────────────────────────────────────────────────

/**
 * 记录正在运行 review 的 MR 集合。
 * key = `${projectId}/${mrIid}`，防止同一 MR 并发执行多次 review。
 */
const _runningReviews = new Set();

/**
 * 检查并标记 MR 为"正在 review"。
 * @returns {boolean} true=可以开始 review；false=已在运行
 */
function tryAcquireMr(projectId, mrIid) {
  const key = `${projectId}/${mrIid}`;
  if (_runningReviews.has(key)) return false;
  _runningReviews.add(key);
  return true;
}

/**
 * 释放 MR 的 review 锁。
 */
function releaseMr(projectId, mrIid) {
  _runningReviews.delete(`${projectId}/${mrIid}`);
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /review
 *
 * 手动触发 MR review。
 *
 * Body:
 * {
 *   "project_id": "namespace/project" or 123,
 *   "mr_iid": "1"
 * }
 */
app.post("/review", async (req, res) => {
  const { project_id, mr_iid } = req.body;

  if (!project_id || !mr_iid) {
    return res.status(400).json({
      error: "Missing required fields: project_id, mr_iid",
    });
  }

  if (!tryAcquireMr(project_id, mr_iid)) {
    return res.status(409).json({
      error: "Review already in progress for this MR",
      project_id,
      mr_iid,
    });
  }

  try {
    const finalState = await runReview({
      projectId: project_id,
      mrIid: String(mr_iid),
    });

    res.json({
      status: "ok",
      report: finalState.review_report,
      issues: finalState.issues.length,
      risk_score: finalState.risk_score,
      decisions: finalState.decisions,
    });
  } catch (err) {
    console.error("[review] Error:", err);
    res.status(500).json({
      error: err.message,
    });
  } finally {
    releaseMr(project_id, mr_iid);
  }
});

/**
 * POST /webhook/gitlab
 *
 * GitLab webhook 接收端点。
 * 支持 Merge Request Events 自动触发 review。
 */
app.post("/webhook/gitlab", async (req, res) => {
  const event = req.headers["x-gitlab-event"];

  if (event !== "Merge Request Hook") {
    return res.status(200).json({ status: "ignored", event });
  }

  const mr = req.body?.object_attributes;
  if (!mr) {
    return res.status(400).json({ error: "Missing object_attributes" });
  }

  // Only review opened/updated merge requests
  const action = mr.action;
  if (action !== "open" && action !== "update" && action !== "reopen") {
    return res.status(200).json({ status: "ignored", action });
  }

  const projectId = req.body?.project?.path_with_namespace || req.body?.project?.id;
  const mrIid = mr.iid;

  if (!projectId || !mrIid) {
    return res.status(400).json({ error: "Cannot determine project_id or mr_iid" });
  }

  // 去重：如果该 MR 正在 review 中，跳过本次触发
  if (!tryAcquireMr(projectId, mrIid)) {
    return res.status(202).json({
      status: "skipped",
      reason: "review already in progress",
      project_id: projectId,
      mr_iid: mrIid,
    });
  }

  // Respond immediately; run review in background
  res.status(202).json({ status: "accepted", project_id: projectId, mr_iid: mrIid });

  // Async review (fire-and-forget with error logging + cleanup)
  runReview({ projectId, mrIid: String(mrIid) })
    .catch((err) => {
      console.error(`[webhook] Review failed for !${mrIid}:`, err);
    })
    .finally(() => {
      releaseMr(projectId, mrIid);
    });
});

/**
 * GET /health
 *
 * 健康检查端点。
 */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    provider: "openai", // or "anthropic" — will be resolved at first call
  });
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

/**
 * 优雅关闭 HTTP Server：
 * 1. 停止接受新连接
 * 2. 等待已有请求完成
 * 3. 超时强制退出（防止进程挂死）
 */
function gracefulShutdown(server, signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);

  server.close(() => {
    console.log("HTTP server closed. Goodbye!");
    process.exit(0);
  });

  // 10s 超时后强制退出
  setTimeout(() => {
    console.error("[shutdown] Forced exit after timeout.");
    process.exit(1);
  }, 10_000).unref();
}

// ─── Start Server ───────────────────────────────────────────────────────────

const PORT = getConfig().PORT;

const server = app.listen(PORT, () => {
  console.log(`🧠 dev-mind AI Code Review Agent`);
  console.log(`   Server listening on http://localhost:${PORT}`);
  console.log(`   Environment: ${getConfig().NODE_ENV}`);
});

// 跨平台信号处理
//   SIGINT   — Ctrl+C,  所有平台都支持
//   SIGTERM  — kill,    Unix-only（Windows 上注册无副作用，但不会触发）
//   SIGBREAK — Ctrl+Break, Windows-only
process.on("SIGINT",  () => gracefulShutdown(server, "SIGINT"));
process.on("SIGTERM", () => gracefulShutdown(server, "SIGTERM"));

if (process.platform === "win32") {
  process.on("SIGBREAK", () => gracefulShutdown(server, "SIGBREAK"));
}
