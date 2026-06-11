import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkFiles, rankChunksByRelevance, chunksToText } from "./retriever.js";

// ─── chunkFiles ─────────────────────────────────────────────────────────────

describe("chunkFiles", () => {
  it("should return empty array for empty file contents", () => {
    assert.deepEqual(chunkFiles({}), []);
  });

  it("should create line-based chunks when no functions detected", () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    const chunks = chunkFiles({ "plain.txt": content }, { maxChunkSize: 5 });

    assert.equal(chunks.length, 2); // 10 lines / 5 per chunk
    assert.equal(chunks[0].file, "plain.txt");
    assert.equal(chunks[0].functionName, null);
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[0].endLine, 5);
    assert.equal(chunks[1].startLine, 6);
    assert.equal(chunks[1].endLine, 10);
  });

  it("should detect function boundaries in JS code", () => {
    const content = [
      "const helper = () => {",
      "  return 1;",
      "};",
      "",
      "function foo() {",
      "  const x = 1;",
      "  return x;",
      "}",
      "",
      "function bar() {",
      "  return 2;",
      "}",
      "",
      "const x = 1;",
    ].join("\n");

    const chunks = chunkFiles({ "app.js": content });

    // Should have function chunks for helper, foo, bar
    const funcChunks = chunks.filter((c) => c.functionName);
    assert.equal(funcChunks.length, 3);
    assert.equal(funcChunks[0].functionName, "helper");
    assert.equal(funcChunks[1].functionName, "foo");
    assert.equal(funcChunks[2].functionName, "bar");
  });

  it("should handle multiple files", () => {
    const contents = {
      "a.js": "function a() { return 1; }",
      "b.js": "function b() { return 2; }",
    };
    const chunks = chunkFiles(contents);
    const files = new Set(chunks.map((c) => c.file));
    assert.ok(files.has("a.js"));
    assert.ok(files.has("b.js"));
  });

  it("should skip empty content", () => {
    const chunks = chunkFiles({ "empty.js": "" });
    assert.equal(chunks.length, 0);
  });
});

// ─── rankChunksByRelevance ──────────────────────────────────────────────────

describe("rankChunksByRelevance", () => {
  const chunks = [
    { file: "a.js", functionName: "auth",   code: "function auth() { checkToken(); }", startLine: 1, endLine: 3, relevanceScore: null },
    { file: "b.js", functionName: "helper", code: "function helper() { return 0; }",    startLine: 1, endLine: 3, relevanceScore: null },
    { file: "c.js", functionName: "config", code: "const PORT = 3000;",                 startLine: 1, endLine: 1, relevanceScore: null },
  ];

  it("should return all chunks with score 0 when keyword list is empty", () => {
    const result = rankChunksByRelevance(chunks, []);
    assert.equal(result.length, 3);
    for (const c of result) {
      assert.equal(c.relevanceScore, 0);
    }
  });

  it("should rank function name match highest", () => {
    const result = rankChunksByRelevance(chunks, ["auth"]);
    assert.equal(result[0].functionName, "auth");
    assert.ok(result[0].relevanceScore > result[1].relevanceScore);
  });

  it("should rank by keyword occurrence in code", () => {
    const result = rankChunksByRelevance(chunks, ["token"]);
    assert.equal(result[0].functionName, "auth");
    assert.ok(result[0].relevanceScore > 0);
  });

  it("should not mutate original chunks", () => {
    const copy = [...chunks];
    rankChunksByRelevance(chunks, ["auth"]);
    assert.equal(chunks[0].relevanceScore, null); // original unchanged
  });
});

// ─── chunksToText ───────────────────────────────────────────────────────────

describe("chunksToText", () => {
  it("should return empty string for empty chunks", () => {
    assert.equal(chunksToText([]), "");
  });

  it("should format chunks with file and line range", () => {
    const chunks = [
      { file: "a.js", functionName: "foo", code: "function foo() {}", startLine: 1, endLine: 3, relevanceScore: 5 },
    ];
    const text = chunksToText(chunks);
    assert.ok(text.includes("a.js:1-3"));
    assert.ok(text.includes("function: foo"));
    assert.ok(text.includes("function foo() {}"));
  });

  it("should respect maxChunks limit", () => {
    const chunks = Array.from({ length: 20 }, (_, i) => ({
      file: `${i}.js`, code: `// file ${i}`, startLine: 1, endLine: 1, relevanceScore: 1,
    }));
    const text = chunksToText(chunks, 5);
    // Each chunk produces a line like "--- X.js:1-1 ---", count by file references
    const files = [...text.matchAll(/--- (\d+)\.js/g)];
    assert.equal(files.length, 5);
    assert.equal(files[0][1], "0");
    assert.equal(files[4][1], "4");
  });

  it("should filter out chunks with relevanceScore 0", () => {
    const chunks = [
      { file: "a.js", code: "keep", startLine: 1, endLine: 1, relevanceScore: 5 },
      { file: "b.js", code: "skip", startLine: 1, endLine: 1, relevanceScore: 0 },
    ];
    const text = chunksToText(chunks);
    assert.ok(text.includes("keep"));
    assert.ok(!text.includes("skip"));
  });

  it("should include chunks with null relevanceScore", () => {
    const chunks = [
      { file: "a.js", code: "content", startLine: 1, endLine: 1, relevanceScore: null },
    ];
    const text = chunksToText(chunks);
    assert.ok(text.includes("content"));
  });
});
