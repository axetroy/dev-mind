/**
 * gitlabOutput node 单元测试
 *
 * 主要测试 findOldLine 函数。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findOldLine } from "./gitlabOutput.js";

/**
 * 快速构建一个 Diff 对象用于测试。
 */
function makeFile(opts) {
  return {
    oldPath: opts.oldPath ?? "a.js",
    newPath: opts.newPath ?? "a.js",
    type: opts.type ?? "modified",
    hunks: opts.hunks ?? [],
  };
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

// ─── findOldLine ────────────────────────────────────────────────────────────

describe("findOldLine", () => {
  it("should return null for unknown file", () => {
    const diff = [makeFile({})];
    assert.equal(findOldLine(diff, "nonexistent.js", 1), null);
  });

  it("should return null for added files", () => {
    const diff = [makeFile({ type: "added" })];
    assert.equal(findOldLine(diff, "a.js", 1), null);
  });

  it("should return newLine for deleted files", () => {
    const diff = [makeFile({ type: "deleted" })];
    assert.equal(findOldLine(diff, "a.js", 5), 5);
  });

  it("should map a context line to its old line number", () => {
    // @@ -5,3 +5,3 @@
    //  line5    (context)
    //  line6    (context)
    //  line7    (context)
    const diff = [makeFile({
      hunks: [makeHunk("@@ -5,3 +5,3 @@", [
        " line5",
        " line6",
        " line7",
      ])],
    })];
    assert.equal(findOldLine(diff, "a.js", 5), 5);
    assert.equal(findOldLine(diff, "a.js", 6), 6);
    assert.equal(findOldLine(diff, "a.js", 7), 7);
  });

  it("should return null for added lines (+)", () => {
    // @@ -5,0 +6,2 @@
    // +line6    (addition)
    // +line7    (addition)
    const diff = [makeFile({
      hunks: [makeHunk("@@ -5,0 +6,2 @@", [
        "+line6",
        "+line7",
      ])],
    })];
    assert.equal(findOldLine(diff, "a.js", 6), null);
    assert.equal(findOldLine(diff, "a.js", 7), null);
  });

  it("should skip deletion lines when curNewLine matches (fix regression)", () => {
    // @@ -45,6 +46,9 @@
    //   context46        (context, old:45→46, new:46→47)
    //   context47        (context, old:46→47, new:47→48)
    //   context48        (context, old:47→48, new:48→49)
    // - deletion48      (deletion, curNewLine=49 → 跳过，matched on deletion!)
    // + addition49      (addition, curNewLine=49 → null)
    // + addition50      (addition)
    // + addition51      (addition)
    //   context52       (context)
    const diff = [makeFile({
      hunks: [makeHunk("@@ -45,6 +46,9 @@", [
        "  46",
        "  47",
        "  48",
        "-48",
        "+49",
        "+50",
        "+51",
        " 52",
      ])],
    })];
    // 上下文行映射：newLine=48 → oldLine=47
    assert.equal(findOldLine(diff, "a.js", 48), 47);
    // 之前的 bug: newLine=49 匹配到删除行返回 oldLine=48
    // 修复后：跳过了删除行，继续到新增行，返回 null
    assert.equal(findOldLine(diff, "a.js", 49), null);
    assert.equal(findOldLine(diff, "a.js", 50), null);
    assert.equal(findOldLine(diff, "a.js", 51), null);
    // 上下文行 newLine=52 → oldLine=49
    assert.equal(findOldLine(diff, "a.js", 52), 49);
  });

  it("should handle deletion followed by another deletion", () => {
    // @@ -5,4 +5,2 @@
    //  context5         (context, curNew=5→6)
    // -del6             (deletion, curNew=6 match → skip, oldLine=6→7)
    // -del7             (deletion, curNew=6 match → skip, oldLine=7→8)
    //  context8         (context, curNew=6 match → oldLine=8)
    //
    // 旧文件: line5(5), del6(6), del7(7), line8(8)
    // 新文件: line5(5), line8(6)
    // 因此新文件行6 对应 旧文件行8
    const diff = [makeFile({
      hunks: [makeHunk("@@ -5,4 +5,2 @@", [
        " line5",
        "-del6",
        "-del7",
        " line8",
      ])],
    })];
    assert.equal(findOldLine(diff, "a.js", 5), 5);
    assert.equal(findOldLine(diff, "a.js", 6), 8); // line6 in new file = old line 8
  });

  it("should handle multiple hunks", () => {
    // Hunk 1: @@ -1,2 +1,2 @@
    //   line1
    //   line2
    // Hunk 2: @@ -10,1 +11,2 @@
    //   context10
    //   +new_line_between
    const diff = [makeFile({
      hunks: [
        makeHunk("@@ -1,2 +1,2 @@", [" line1", " line2"]),
        makeHunk("@@ -10,1 +11,2 @@", [" line10", "+new_between"]),
      ],
    })];
    // First hunk
    assert.equal(findOldLine(diff, "a.js", 1), 1);
    assert.equal(findOldLine(diff, "a.js", 2), 2);
    // Second hunk — curNew resets per hunk
    assert.equal(findOldLine(diff, "a.js", 11), 10);
    assert.equal(findOldLine(diff, "a.js", 12), null);
  });

  it("should handle context line right after additions", () => {
    // @@ -5,1 +6,2 @@
    //  line6
    //  +new7
    //  line8
    const diff = [makeFile({
      hunks: [makeHunk("@@ -5,1 +6,2 @@", [
        " line6",
        "+new7",
        " line8",
      ])],
    })];
    assert.equal(findOldLine(diff, "a.js", 6), 5);  // context → old=5
    assert.equal(findOldLine(diff, "a.js", 7), null); // addition → null
    assert.equal(findOldLine(diff, "a.js", 8), 6);  // context → old=6
  });

  it("should return null for lines beyond diff range", () => {
    // @@ -1,1 +1,1 @@
    //  line1
    const diff = [makeFile({
      hunks: [makeHunk("@@ -1,1 +1,1 @@", [" line1"])],
    })];
    assert.equal(findOldLine(diff, "a.js", 1), 1);
    assert.equal(findOldLine(diff, "a.js", 999), null);
  });

  it("should skip \\ No newline markers", () => {
    // @@ -1,2 +1,3 @@
    //  line1
    // -old2
    // +new2
    // +new3
    // \ No newline at end of file
    const diff = [makeFile({
      hunks: [makeHunk("@@ -1,2 +1,3 @@", [
        " line1",
        "-old2",
        "+new2",
        "+new3",
        "\\ No newline at end of file",
      ])],
    })];
    assert.equal(findOldLine(diff, "a.js", 1), 1);
    assert.equal(findOldLine(diff, "a.js", 2), null);
    assert.equal(findOldLine(diff, "a.js", 3), null);
  });

  it("should match file by oldPath when newPath differs (renamed)", () => {
    const diff = [{
      oldPath: "old_name.js",
      newPath: "new_name.js",
      type: "renamed",
      hunks: [makeHunk("@@ -1,2 +1,2 @@", [" line1", " line2"])],
    }];
    assert.equal(findOldLine(diff, "new_name.js", 1), 1);
    assert.equal(findOldLine(diff, "old_name.js", 1), 1);
  });
});
