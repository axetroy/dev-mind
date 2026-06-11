import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatReviewReport,
  formatInlineComments,
  groupIssuesByFile,
  groupIssuesBySeverity,
  calculateRiskScore,
  deduplicateIssues,
} from "./formatter.js";

// ─── Test fixtures ──────────────────────────────────────────────────────────

const sampleIssues = [
  { type: "bug",        file: "src/auth.ts", line: 23, message: "JWT secret hardcoded",   suggestion: "Use env var",   severity: "critical" },
  { type: "security",   file: "src/auth.ts", line: 45, message: "SQL injection risk",      suggestion: "Use parameterized query", severity: "critical" },
  { type: "performance",file: "src/api.ts",  line: 88, message: "N+1 query in loop",       suggestion: "Batch fetch", severity: "warning" },
  { type: "maintainability", file: "src/utils.ts", line: 15, message: "Unused import",     suggestion: "Remove it",    severity: "suggestion" },
  { type: "architecture",file: "src/app.ts", line: 1,  message: "Circular dependency",     suggestion: "Extract interface", severity: "warning" },
];

// ─── deduplicateIssues ─────────────────────────────────────────────────────

describe("deduplicateIssues", () => {
  it("should remove exact duplicates by (file, line, message)", () => {
    const issues = [
      { file: "a.ts", line: 1, message: "dup" },
      { file: "a.ts", line: 1, message: "dup" },
      { file: "a.ts", line: 2, message: "unique" },
    ];
    // Fill required fields
    const full = issues.map((i) => ({ type: "bug", severity: "warning", suggestion: "", ...i }));

    const result = deduplicateIssues(full);
    assert.equal(result.length, 2);
    assert.equal(result[0].line, 1);
    assert.equal(result[1].line, 2);
  });

  it("should keep issues with same file/line but different messages", () => {
    const issues = [
      { file: "a.ts", line: 1, message: "first",  severity: "critical", type: "bug" },
      { file: "a.ts", line: 1, message: "second", severity: "warning", type: "performance" },
    ];

    const result = deduplicateIssues(issues);
    assert.equal(result.length, 2);
  });

  it("should return empty array for empty input", () => {
    assert.deepEqual(deduplicateIssues([]), []);
  });
});

// ─── calculateRiskScore ─────────────────────────────────────────────────────

describe("calculateRiskScore", () => {
  it("should return 0 for no issues", () => {
    assert.equal(calculateRiskScore([]), 0);
  });

  it("should score critical=25, warning=10, suggestion=3", () => {
    const issues = [
      { severity: "critical" },
      { severity: "warning" },
      { severity: "suggestion" },
    ];
    assert.equal(calculateRiskScore(issues), 38); // 25 + 10 + 3
  });

  it("should cap score at 100", () => {
    const manyCritical = Array.from({ length: 5 }, () => ({ severity: "critical" }));
    assert.equal(calculateRiskScore(manyCritical), 100); // 125 capped to 100
  });

  it("should handle mixed severities", () => {
    assert.equal(calculateRiskScore(sampleIssues), 73); // 2×25 + 2×10 + 1×3
  });
});

// ─── groupIssuesByFile ──────────────────────────────────────────────────────

describe("groupIssuesByFile", () => {
  it("should group issues by file path", () => {
    const groups = groupIssuesByFile(sampleIssues);

    assert.ok(groups["src/auth.ts"]);
    assert.ok(groups["src/api.ts"]);
    assert.equal(groups["src/auth.ts"].length, 2);
    assert.equal(groups["src/api.ts"].length, 1);
  });

  it("should return empty object for empty input", () => {
    assert.deepEqual(groupIssuesByFile([]), {});
  });
});

// ─── groupIssuesBySeverity ──────────────────────────────────────────────────

describe("groupIssuesBySeverity", () => {
  it("should group issues by severity level", () => {
    const groups = groupIssuesBySeverity(sampleIssues);

    assert.equal(groups.critical.length, 2);
    assert.equal(groups.warning.length, 2);
    assert.equal(groups.suggestion.length, 1);
  });

  it("should return empty arrays per severity when no issues", () => {
    const groups = groupIssuesBySeverity([]);
    assert.deepEqual(groups.critical, []);
    assert.deepEqual(groups.warning, []);
    assert.deepEqual(groups.suggestion, []);
  });
});

// ─── formatReviewReport ─────────────────────────────────────────────────────

describe("formatReviewReport", () => {
  it("should include AI Code Review header", () => {
    const report = formatReviewReport([], 0);
    assert.ok(report.includes("AI Code Review"));
    assert.ok(report.includes("Risk Score"));
  });

  it("should show 🟢 OK for low risk score", () => {
    const report = formatReviewReport([{ severity: "suggestion", type: "maintainability", file: "a.ts", line: 1, message: "tip", suggestion: "" }], 15);
    assert.ok(report.includes("OK"));
    assert.ok(report.includes("15"));
  });

  it("should show 🟡 WARNING for medium risk score", () => {
    const report = formatReviewReport(sampleIssues, 53);
    assert.ok(report.includes("WARNING"));
    assert.ok(report.includes("53"));
  });

  it("should show 🔴 HIGH RISK for high risk score", () => {
    const manyCritical = Array.from({ length: 3 }, (_, i) => ({
      severity: "critical", type: "bug", file: "x.ts", line: i + 1,
      message: `Issue ${i}`, suggestion: "Fix it",
    }));
    const report = formatReviewReport(manyCritical, 75);
    assert.ok(report.includes("HIGH RISK"));
  });

  it("should include critical, warning, suggestion sections", () => {
    const report = formatReviewReport(sampleIssues, 53);
    assert.ok(report.includes("Critical Issues"));
    assert.ok(report.includes("Warnings"));
    assert.ok(report.includes("Suggestions"));
  });

  it("should show ✅ when no issues found", () => {
    const report = formatReviewReport([], 0);
    assert.ok(report.includes("No issues found"));
  });
});

// ─── formatInlineComments ───────────────────────────────────────────────────

describe("formatInlineComments", () => {
  it("should create inline comment objects from issues", () => {
    const comments = formatInlineComments(sampleIssues);

    assert.equal(comments.length, 5); // All have file + line
    assert.ok(comments[0].body);
    assert.ok(comments[0].path);
    assert.ok(comments[0].line);
  });

  it("should skip issues without file or line", () => {
    const issues = [
      { file: "", line: 0, message: "no position", severity: "warning", type: "bug" },
      { file: "a.ts", line: 5, message: "has position", severity: "warning", type: "bug" },
    ];
    const comments = formatInlineComments(issues);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].line, 5);
  });

  it("should include commitSha when provided", () => {
    const comments = formatInlineComments(sampleIssues, "abc123");
    for (const c of comments) {
      assert.equal(c.commitSha, "abc123");
    }
  });
});
