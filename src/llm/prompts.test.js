import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReviewReport, buildPlanPrompt, buildReviewPrompt } from "./prompts.js";

// ─── buildReviewReport ──────────────────────────────────────────────────────

describe("buildReviewReport", () => {
  it("should include AI Code Review header and risk score", () => {
    const report = buildReviewReport([], 0);
    assert.ok(report.includes("AI Code Review"));
    assert.ok(report.includes("Risk Score"));
    assert.ok(report.includes("0"));
  });

  it("should show 🟢 OK for score < 30", () => {
    const report = buildReviewReport([], 15);
    assert.ok(report.includes("OK"));
  });

  it("should show 🟡 WARNING for score 30-69", () => {
    const report = buildReviewReport([], 45);
    assert.ok(report.includes("WARNING"));
  });

  it("should show 🔴 HIGH RISK for score >= 70", () => {
    const report = buildReviewReport([], 85);
    assert.ok(report.includes("HIGH RISK"));
  });

  it("should show N/A when riskScore is null", () => {
    const report = buildReviewReport([], null);
    assert.ok(report.includes("N/A"));
  });

  it("should include section headers for each severity present", () => {
    const issues = [
      { type: "bug",         file: "a.ts", line: 1, message: "critical issue", suggestion: "fix", severity: "critical" },
      { type: "performance", file: "b.ts", line: 2, message: "warning issue",  suggestion: "opt", severity: "warning" },
      { type: "maintainability", file: "c.ts", line: 3, message: "suggestion", suggestion: "",  severity: "suggestion" },
    ];
    const report = buildReviewReport(issues, 50);
    assert.ok(report.includes("Critical Issues"));
    assert.ok(report.includes("Warnings"));
    assert.ok(report.includes("Suggestions"));
    assert.ok(report.includes("critical issue"));
    assert.ok(report.includes("warning issue"));
    assert.ok(report.includes("suggestion"));
  });

  it("should include issue file:line notation", () => {
    const issues = [
      { type: "bug", file: "src/auth.ts", line: 23, message: "JWT secret", suggestion: "", severity: "critical" },
    ];
    const report = buildReviewReport(issues, 25);
    assert.ok(report.includes("src/auth.ts:23"));
  });

  it("should include suggestion text when present", () => {
    const issues = [
      { type: "bug", file: "a.ts", line: 1, message: "issue", suggestion: "use env var", severity: "warning" },
    ];
    const report = buildReviewReport(issues, 10);
    assert.ok(report.includes("use env var"));
  });

  it("should display ✅ when no issues", () => {
    const report = buildReviewReport([], 0);
    assert.ok(report.includes("No issues found"));
    assert.ok(report.includes("looks good"));
  });

  it("should not include any section when no issues", () => {
    const report = buildReviewReport([], 0);
    assert.ok(!report.includes("Critical Issues"));
    assert.ok(!report.includes("Warnings"));
    assert.ok(!report.includes("Suggestions"));
  });

  it("should sort sections: critical first, then warnings, then suggestions", () => {
    const issues = [
      { type: "bug",  file: "a.ts", line: 1, message: "suggestion", suggestion: "", severity: "suggestion" },
      { type: "bug",  file: "b.ts", line: 2, message: "warning",    suggestion: "", severity: "warning" },
      { type: "bug",  file: "c.ts", line: 3, message: "critical",   suggestion: "", severity: "critical" },
    ];
    const report = buildReviewReport(issues, 38);
    const critIdx = report.indexOf("Critical Issues");
    const warnIdx = report.indexOf("Warnings");
    const suggIdx = report.indexOf("Suggestions");
    assert.ok(critIdx < warnIdx, "Critical should come before Warnings");
    assert.ok(warnIdx < suggIdx, "Warnings should come before Suggestions");
  });
});

// ─── buildPlanPrompt ────────────────────────────────────────────────────────

describe("buildPlanPrompt", () => {
  it("should include changed files list", () => {
    const prompt = buildPlanPrompt("diff summary", ["a.js", "b.js"]);
    assert.ok(prompt.includes("a.js"));
    assert.ok(prompt.includes("b.js"));
  });

  it("should include diff overview", () => {
    const prompt = buildPlanPrompt("+++ new file\n@@ ... @@", []);
    assert.ok(prompt.includes("Diff Overview"));
    assert.ok(prompt.includes("@@ ... @@"));
  });
});

// ─── buildReviewPrompt ──────────────────────────────────────────────────────

describe("buildReviewPrompt", () => {
  it("should include diff, context, and plan results sections", () => {
    const prompt = buildReviewPrompt("diff-content", "ctx-content", "plan-results");
    assert.ok(prompt.includes("Diff"));
    assert.ok(prompt.includes("Retrieved Context"));
    assert.ok(prompt.includes("Tool Execution Results"));
  });

  it("should show fallback text when context is empty", () => {
    const prompt = buildReviewPrompt("diff", "", "");
    assert.ok(prompt.includes("No additional context retrieved"));
  });
});
