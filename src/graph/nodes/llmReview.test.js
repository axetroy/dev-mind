/**
 * llmReview node 单元测试
 *
 * 主要测试 diffToUnifiedText 函数。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffToUnifiedText } from "./llmReview.js";

/**
 * 快速构建一个 Diff 对象用于测试。
 */
function makeDiff(opts) {
  return [
    {
      oldPath: opts.oldPath ?? "a.js",
      newPath: opts.newPath ?? "b.js",
      type: opts.type ?? "modified",
      hunks: opts.hunks ?? [],
    },
  ];
}

function makeHunk(header, contentLines) {
  const m = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return {
    header,
    content: contentLines.join("\n") + "\n",
    oldStart: m ? parseInt(m[1], 10) : 1,
    newStart: m ? parseInt(m[2], 10) : 1,
  };
}

// ─── 基本场景 ────────────────────────────────────────────────────────────────

describe("diffToUnifiedText", () => {
  it("should output summary line with correct counts", () => {
    const diff = makeDiff({
      hunks: [
        makeHunk("@@ -5,7 +5,8 @@", [
          " line5",
          " line6",
          "-old_line7",
          "+new_line7",
          "+new_line8",
          " line9",
          " line10",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("## Summary: 1 file(s) changed, 2 insertions(+), 1 deletions(-)"));
  });

  it("should output standard git file headers (--- a/... / +++ b/...)", () => {
    const diff = makeDiff({
      oldPath: "src/old.js",
      newPath: "src/new.js",
      hunks: [
        makeHunk("@@ -1,2 +1,2 @@", [
          " line1",
          "+line2",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("--- a/src/old.js"));
    assert.ok(result.includes("+++ b/src/new.js"));
  });

  it("should output hunk header and content without inline line numbers", () => {
    const diff = makeDiff({
      hunks: [
        makeHunk("@@ -5,7 +5,8 @@", [
          " line5",
          " line6",
          "-old_line7",
          "+new_line7",
          "+new_line8",
          " line9",
          " line10",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("@@ -5,7 +5,8 @@"));
    // 行号不应该出现在行内容中
    assert.ok(result.includes("\n line5"));
    assert.ok(result.includes("\n line6"));
    assert.ok(result.includes("\n-old_line7"));
    assert.ok(result.includes("\n+new_line7"));
    assert.ok(result.includes("\n+new_line8"));
    assert.ok(result.includes("\n line9"));
    assert.ok(result.includes("\n line10"));
  });

  it("should wrap each file in <details><summary>", () => {
    const diff = makeDiff({
      oldPath: "a.js",
      newPath: "b.js",
      hunks: [
        makeHunk("@@ -1,2 +1,2 @@", [
          " line1",
          "+line2",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("<details>"));
    assert.ok(result.includes("<summary>b.js</summary>"));
    assert.ok(result.includes("</details>"));
  });

  it("should handle added files (--- /dev/null)", () => {
    const diff = makeDiff({
      type: "added",
      oldPath: "",
      newPath: "new_file.js",
      hunks: [
        makeHunk("@@ -0,0 +1,3 @@", [
          "+const x = 1;",
          "+const y = 2;",
          "+const z = 3;",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("--- a//dev/null"));
    assert.ok(result.includes("+++ b/new_file.js"));
    assert.ok(result.includes("<summary>new_file.js</summary>"));
    assert.ok(result.includes("## Summary: 1 file(s) changed, 3 insertions(+), 0 deletions(-)"));
  });

  it("should handle deleted files (+++ /dev/null)", () => {
    const diff = makeDiff({
      type: "deleted",
      oldPath: "old_file.js",
      newPath: "",
      hunks: [
        makeHunk("@@ -1,3 +0,0 @@", [
          "-const x = 1;",
          "-const y = 2;",
          "-const z = 3;",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("--- a/old_file.js"));
    assert.ok(result.includes("+++ b//dev/null"));
    assert.ok(result.includes("<summary>old_file.js</summary>"));
    assert.ok(result.includes("## Summary: 1 file(s) changed, 0 insertions(+), 3 deletions(-)"));
  });

  it("should handle empty diff", () => {
    const result = diffToUnifiedText([]);
    assert.equal(result, "");
  });

  it("should handle diff with no hunks", () => {
    const diff = makeDiff({ hunks: [] });
    const result = diffToUnifiedText(diff);
    assert.ok(result.includes("--- a/a.js"));
    assert.ok(result.includes("+++ b/b.js"));
    // No hunk content, just headers
    assert.ok(!result.includes("@@"));
  });

  it("should handle multiple hunks in one file", () => {
    const diff = makeDiff({
      hunks: [
        makeHunk("@@ -1,3 +1,3 @@", [
          " line1",
          " line2",
          "-old_line3",
          "+new_line3",
        ]),
        makeHunk("@@ -10,2 +11,3 @@", [
          " line10",
          "+line_between",
          " line11",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    // Both hunk headers present
    assert.ok(result.includes("@@ -1,3 +1,3 @@"));
    assert.ok(result.includes("@@ -10,2 +11,3 @@"));
    // Both hunk contents
    assert.ok(result.includes("\n line1"));
    assert.ok(result.includes("\n+line_between"));
  });

  it("should handle renamed files with arrow notation in summary", () => {
    const diff = makeDiff({
      type: "renamed",
      oldPath: "old_name.js",
      newPath: "new_name.js",
      hunks: [
        makeHunk("@@ -1,2 +1,2 @@", [
          " const x = 1;",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("--- a/old_name.js"));
    assert.ok(result.includes("+++ b/new_name.js"));
    assert.ok(result.includes("<summary>old_name.js → new_name.js</summary>"));
  });

  it("should preserve \\ No newline markers", () => {
    const diff = makeDiff({
      hunks: [
        makeHunk("@@ -1,2 +1,2 @@", [
          " line1",
          "-line2",
          "+line2_modified",
          "\\ No newline at end of file",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("\\ No newline at end of file"));
  });

  it("should preserve indented code correctly", () => {
    const diff = makeDiff({
      hunks: [
        makeHunk("@@ -10,4 +10,4 @@", [
          "   function foo() {",
          '     return "old";',
          '-    return "old_value";',
          '+    return "new_value";',
          "   }",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    // 没有行号前缀，前导空格保留
    assert.ok(result.includes("\n   function foo() {"));
    assert.ok(result.includes('\n-    return "old_value";'));
    assert.ok(result.includes('\n+    return "new_value";'));
  });

  it("should handle multiple files with combined summary", () => {
    const diff = [
      {
        oldPath: "a.js",
        newPath: "a.js",
        type: "modified",
        hunks: [makeHunk("@@ -1,2 +1,2 @@", [" line1", "+line2"])],
      },
      {
        oldPath: "b.js",
        newPath: "b.js",
        type: "modified",
        hunks: [makeHunk("@@ -5,1 +6,1 @@", ["+new_line", " context"])],
      },
    ];

    const result = diffToUnifiedText(diff);

    // Summary combines both files
    assert.ok(result.includes("## Summary: 2 file(s) changed, 2 insertions(+), 0 deletions(-)"));

    // Both files present
    assert.ok(result.includes("<summary>a.js</summary>"));
    assert.ok(result.includes("<summary>b.js</summary>"));
    assert.ok(result.includes("--- a/a.js"));
    assert.ok(result.includes("--- a/b.js"));
  });

  it("should count insertions and deletions correctly on mixed hunks", () => {
    const diff = makeDiff({
      hunks: [
        makeHunk("@@ -1,5 +1,7 @@", [
          " keep",
          "-del1",
          "+add1",
          "+add2",
          "-del2",
          "+add3",
          " keep",
        ]),
      ],
    });

    const result = diffToUnifiedText(diff);

    assert.ok(result.includes("## Summary: 1 file(s) changed, 3 insertions(+), 2 deletions(-)"));
  });
});
