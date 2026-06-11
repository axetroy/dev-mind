/**
 * dev-mind Agent API Service
 *
 * 对应 design.md §1 总体架构中的 Agent API Service。
 * 提供 HTTP 接口，接收 GitLab webhook 或手动触发 review。
 */

import express from "express";
import { getConfig } from "./config.js";
import { buildGraph, runReview } from "./graph/index.js";

// ─── App Setup ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

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

  // Respond immediately; run review in background
  res.status(202).json({ status: "accepted", project_id: projectId, mr_iid: mrIid });

  // Async review (fire-and-forget with error logging)
  runReview({ projectId, mrIid: String(mrIid) }).catch((err) => {
    console.error(`[webhook] Review failed for !${mrIid}:`, err);
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

// ─── Start Server ───────────────────────────────────────────────────────────

const PORT = getConfig().PORT;

app.listen(PORT, () => {
  console.log(`🧠 dev-mind AI Code Review Agent`);
  console.log(`   Server listening on http://localhost:${PORT}`);
  console.log(`   Environment: ${getConfig().NODE_ENV}`);
});
