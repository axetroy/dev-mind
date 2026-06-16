/**
 * logger 模块测试
 *
 * 覆盖：
 *   - createRunLogger / getLogger 实例管理
 *   - createSilentLogger 测试辅助
 *   - 所有日志方法输出正确的 LogEntry 结构
 *   - _node 自动标记
 *   - withNodeLogging 自动包装（成功、失败、无 run_id）
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createRunLogger,
  getLogger,
  createSilentLogger,
  withNodeLogging,
} from "./index.js";

// ─── 辅助 ───────────────────────────────────────────────────────────────────

/**
 * 创建一个用于测试的 logger，通过 collect 数组捕获所有条目。
 * @param {string} [runId]
 * @returns {{ logger: import("./index.js").RunLogger, collect: import("./index.js").LogEntry[] }}
 */
function testLogger(runId = "test") {
  const collect = [];
  const logger = createRunLogger(runId, {
    silent: true,
    onWrite: (entry) => collect.push(entry),
  });
  return { logger, collect };
}

function last(collect) {
  return collect[collect.length - 1];
}

// 每个测试用不同 runId，避免单例缓存干扰
let seq = 0;
function uniqueId(prefix = "test") {
  return `${prefix}-${++seq}`;
}

// ─── createRunLogger ────────────────────────────────────────────────────────

describe("createRunLogger", () => {
  after(() => {
    // 清理
    for (const [id] of getLogger._map?.entries?.() ?? []) {
      getLogger(id)?.close?.();
    }
  });

  it("should create a logger with given runId", () => {
    const { logger, collect } = testLogger("my-run");
    assert.ok(logger);
    assert.equal(typeof logger.nodeStart, "function");
    assert.equal(typeof logger.nodeEnd, "function");
    assert.equal(typeof logger.info, "function");
    assert.equal(typeof logger.close, "function");
    // 创建时写入一条 run_start
    assert.ok(collect.some((e) => e.event === "run_start"));
  });

  it("should auto-generate runId when not provided", () => {
    const id = `auto-${uniqueId()}`;
    // 不能直接调用 createRunLogger()，因为会使用默认 runId 的缓存
    // 测试：不传 runId，看是否生成
    const collect = [];
    const logger = createRunLogger(undefined, {
      silent: true,
      onWrite: (e) => collect.push(e),
    });
    assert.ok(logger);
    // 自动生成的 runId 以 "review-" 开头
    const startEntry = collect.find((e) => e.event === "run_start");
    assert.ok(startEntry, "should have run_start entry");
    assert.ok(startEntry.runId.startsWith("review-"), `runId should start with 'review-', got: ${startEntry.runId}`);
  });

  it("should return the same instance for same runId (singleton)", () => {
    const id = uniqueId("singleton");
    const a = createRunLogger(id, { silent: true });
    const b = createRunLogger(id, { silent: true });
    assert.equal(a, b);
  });

  it("should not output to stdout when silent:true", () => {
    const id = uniqueId("silent");
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);
    try {
      const logger = createRunLogger(id, { silent: true });
      logger.info("should not appear");
      assert.equal(logs.length, 0, "silent logger should not call console.log");
    } finally {
      console.log = origLog;
    }
  });
});

// ─── getLogger ──────────────────────────────────────────────────────────────

describe("getLogger", () => {
  it("should return null for unknown runId", () => {
    assert.equal(getLogger("nonexistent-run-id"), null);
  });

  it("should return the logger created by createRunLogger", () => {
    const id = uniqueId("get");
    const { logger } = testLogger(id);
    assert.equal(getLogger(id), logger);
  });

  it("should return the logger created by createSilentLogger", () => {
    const id = uniqueId("silent-get");
    const logger = createSilentLogger(id);
    assert.equal(getLogger(id), logger);
  });
});

// ─── createSilentLogger ──────────────────────────────────────────────────────

describe("createSilentLogger", () => {
  it("should create a no-op logger with all methods", () => {
    const logger = createSilentLogger(uniqueId("noop"));
    const methods = ["nodeStart", "nodeEnd", "info", "warn", "error", "debug",
      "progress", "llmCall", "llmResponse", "toolCall", "toolResult", "close"];
    for (const m of methods) {
      assert.equal(typeof logger[m], "function", `${m} should be a function`);
    }
    // 调用所有方法不应抛出
    for (const m of methods) {
      logger[m]("test", "data");
    }
  });

  it("should set _node to 'test'", () => {
    const logger = createSilentLogger();
    assert.equal(logger._node, "test");
  });
});

// ─── 日志方法 — 条目结构 ────────────────────────────────────────────────────

describe("logger entry structure", () => {
  it("nodeStart should write event=node_start with correct fields", () => {
    const { logger, collect } = testLogger(uniqueId("ns"));
    logger.nodeStart("fetchMR", { project_id: "g/r", mr_id: "42" });
    const e = last(collect);
    assert.equal(e.event, "node_start");
    assert.equal(e.node, "fetchMR");
    assert.equal(e.level, "info");
    assert.equal(e.msg, "▶️ fetchMR");
    assert.deepEqual(e.data, { project_id: "g/r", mr_id: "42" });
    assert.equal(e.duration_ms, null);
    assert.ok(e.ts);
    assert.ok(Number.isInteger(e.seq));
  });

  it("nodeEnd should write event=node_end with duration", () => {
    const { logger, collect } = testLogger(uniqueId("ne"));
    logger.nodeEnd("fetchMR", { diff: [], files: ["a.js"] }, 1234);
    const e = last(collect);
    assert.equal(e.event, "node_end");
    assert.equal(e.node, "fetchMR");
    assert.equal(e.level, "info");
    assert.ok(e.msg.includes("fetchMR"));
    assert.ok(e.msg.includes("diff"));
    assert.equal(e.duration_ms, 1234);
  });

  it("nodeEnd should handle null result", () => {
    const { logger, collect } = testLogger(uniqueId("ne2"));
    logger.nodeEnd("someNode", null, 0);
    const e = last(collect);
    assert.ok(e.msg.includes("∅"), "should show empty keys for null result");
  });

  it("info should write the correct entry", () => {
    const { logger, collect } = testLogger(uniqueId("info"));
    logger.info("hello world", { count: 42 });
    const e = last(collect);
    assert.equal(e.event, "log");
    assert.equal(e.level, "info");
    assert.equal(e.msg, "hello world");
    assert.deepEqual(e.data, { count: 42 });
  });

  it("warn/error/debug should set correct level", () => {
    const { logger, collect } = testLogger(uniqueId("levels"));
    logger.warn("caution");
    assert.equal(last(collect).level, "warn");
    logger.error("boom");
    assert.equal(last(collect).level, "error");
    logger.debug("verbose");
    assert.equal(last(collect).level, "debug");
  });

  it("progress should write event=log with info level", () => {
    const { logger, collect } = testLogger(uniqueId("prog"));
    logger.progress("working...");
    const e = last(collect);
    assert.equal(e.event, "log");
    assert.equal(e.level, "info");
    assert.equal(e.msg, "working...");
  });

  it("info/warn/error should use _node as node name", () => {
    const { logger, collect } = testLogger(uniqueId("node"));
    logger._node = "myNode";
    logger.info("from myNode");
    assert.equal(last(collect).node, "myNode");
    logger._node = null;
    logger.info("from system");
    assert.equal(last(collect).node, "system");
  });

  it("llmCall should write event=llm_call with input length", () => {
    const { logger, collect } = testLogger(uniqueId("llmc"));
    logger.llmCall("gpt-4", "some prompt text", { extra: true });
    const e = last(collect);
    assert.equal(e.event, "llm_call");
    assert.equal(e.node, "llm");
    assert.equal(e.data.model, "gpt-4");
    assert.equal(e.data.input_length, 16);
    assert.equal(e.data.extra, true);
  });

  it("llmResponse should write event=llm_response with latency", () => {
    const { logger, collect } = testLogger(uniqueId("llmr"));
    logger.llmResponse("gpt-4", "output text", 2500, { tokens: 100 });
    const e = last(collect);
    assert.equal(e.event, "llm_response");
    assert.equal(e.node, "llm");
    assert.equal(e.data.model, "gpt-4");
    assert.equal(e.data.output_length, 11);
    assert.equal(e.duration_ms, 2500);
    assert.equal(e.data.tokens, 100);
  });

  it("toolCall should write event=tool_call with args and metadata", () => {
    const { logger, collect } = testLogger(uniqueId("tc"));
    logger.toolCall("read_file", { path: "src/a.js" }, { iteration: 1 });
    const e = last(collect);
    assert.equal(e.event, "tool_call");
    assert.equal(e.node, "read_file");
    assert.equal(e.data._type, "tool_input");
    assert.deepEqual(e.data.args, { path: "src/a.js" });
    assert.equal(e.data.iteration, 1);
  });

  it("toolResult should write event=tool_result with full output", () => {
    const { logger, collect } = testLogger(uniqueId("tr"));
    logger.toolResult("read_file", "file content here", 500, true);
    const e = last(collect);
    assert.equal(e.event, "tool_result");
    assert.equal(e.node, "read_file");
    assert.equal(e.duration_ms, 500);
    assert.equal(e.data._type, "tool_output");
    assert.equal(e.data.success, true);
    assert.equal(e.data.result_length, 17);
    assert.equal(e.data.result_type, "string");
    assert.equal(e.data.summary, "file content here");
    assert.equal(e.data.output, "file content here");
  });

  it("toolResult should truncate long strings in summary and output", () => {
    const { logger, collect } = testLogger(uniqueId("tr-long"));
    const longResult = "x".repeat(500);
    logger.toolResult("searchCode", longResult, 100, true);
    const e = last(collect);
    // summary truncated at 300
    assert.ok(e.data.summary.endsWith("…"), "long summary should be truncated");
    assert.ok(e.data.summary.length <= 305);
    // output truncated at 5000 (500 < 5000, so not truncated here)
    assert.equal(e.data.output.length, 500);
    assert.equal(e.data.output, longResult);
    // metadata
    assert.equal(e.data.result_length, 500);
    assert.equal(e.data.success, true);
  });

  it("toolResult should handle non-string results with JSON serialization", () => {
    const { logger, collect } = testLogger(uniqueId("tr-obj"));
    logger.toolResult("parseCode", { lines: 42 }, 200, false);
    const e = last(collect);
    assert.equal(e.data.result_type, "object");
    assert.equal(e.data.success, false);
    assert.ok(e.data.summary.includes("lines"));
    assert.ok(e.data.output.includes("lines"));
  });

  it("close should write finish log and remove from registry", () => {
    const id = uniqueId("close");
    const { logger, collect } = testLogger(id);
    logger.close();
    const e = last(collect);
    assert.equal(e.msg.includes("finished"), true);
    assert.equal(getLogger(id), null, "logger should be removed after close");
  });

  it("seq should increment for each log entry", () => {
    const { logger, collect } = testLogger(uniqueId("seq"));
    logger.info("first");
    logger.info("second");
    logger.info("third");
    // run_start = seq 0, 三条 info = seq 1,2,3
    const logSeqs = collect.filter((e) => e.event === "log").map((e) => e.seq);
    assert.deepEqual(logSeqs, [1, 2, 3]);
  });
});

// ─── withNodeLogging ────────────────────────────────────────────────────────

describe("withNodeLogging", () => {
  it("should call the wrapped function and return its result", async () => {
    const runId = uniqueId("wnl-ok");
    const { logger, collect } = testLogger(runId);
    const fn = withNodeLogging("testNode", async (state) => {
      return { result: "ok", count: 1 };
    });
    const output = await fn({ run_id: runId });
    assert.deepEqual(output, { result: "ok", count: 1 });
  });

  it("should log nodeStart and nodeEnd on success", async () => {
    const runId = uniqueId("wnl-lifecycle");
    const { logger, collect } = testLogger(runId);
    const fn = withNodeLogging("myNode", async () => {
      return { data: 42 };
    });
    await fn({ run_id: runId, project_id: "g/r", mr_id: "5" });

    const starts = collect.filter((e) => e.event === "node_start");
    const ends = collect.filter((e) => e.event === "node_end");

    assert.equal(starts.length, 1);
    assert.equal(starts[0].node, "myNode");
    assert.equal(starts[0].data.project_id, "g/r");

    assert.equal(ends.length, 1);
    assert.equal(ends[0].node, "myNode");
    assert.ok(ends[0].duration_ms >= 0);
    assert.ok(ends[0].msg.includes("data"));
  });

  it("should set _node during node execution and restore it after", async () => {
    const runId = uniqueId("wnl-node");
    const { logger } = testLogger(runId);
    let nodeDuringExecution = null;

    const fn = withNodeLogging("activeNode", async (state) => {
      nodeDuringExecution = getLogger(runId)._node;
      return {};
    });
    await fn({ run_id: runId });

    assert.equal(nodeDuringExecution, "activeNode", "_node should be set inside node");
    assert.equal(logger._node, undefined, "_node should be restored after node ends");
  });

  it("should log error when the wrapped function throws", async () => {
    const runId = uniqueId("wnl-err");
    const { logger, collect } = testLogger(runId);

    const fn = withNodeLogging("failingNode", async () => {
      throw new Error("something went wrong");
    });

    await assert.rejects(
      () => fn({ run_id: runId }),
      /something went wrong/,
    );

    const errors = collect.filter((e) => e.event === "log" && e.level === "error");
    assert.ok(errors.length > 0, "should log at least one error");
    const errEntry = errors[errors.length - 1];
    assert.ok(errEntry.msg.includes("something went wrong"), `msg should contain error, got: ${errEntry.msg}`);
  });

  it("should not fail when run_id is missing (no logger available)", async () => {
    const fn = withNodeLogging("orphan", async (state) => {
      return { survived: true };
    });
    // state 中没有 run_id，getLogger 返回 null，withNodeLogging 应跳过日志
    const result = await fn({});
    assert.deepEqual(result, { survived: true });
  });

  it("should not fail when run_id is empty string", async () => {
    const fn = withNodeLogging("emptyRunId", async (state) => {
      return { ok: true };
    });
    const result = await fn({ run_id: "" });
    assert.deepEqual(result, { ok: true });
  });

  it("should pass through the original state keys in nodeStart data", async () => {
    const runId = uniqueId("wnl-state");
    const { collect } = testLogger(runId);
    const fn = withNodeLogging("richNode", async (s) => ({ done: true }));
    await fn({
      run_id: runId,
      project_id: "p1",
      mr_id: "99",
      files: ["a.js", "b.js"],
      diff: [{}, {}],
      issues: [{}, {}, {}],
      iteration: 3,
    });
    const start = collect.find((e) => e.event === "node_start");
    assert.equal(start.data.project_id, "p1");
    assert.equal(start.data.mr_id, "99");
    assert.equal(start.data.files, 2);
    assert.equal(start.data.diff_files, 2);
    assert.equal(start.data.issues, 3);
    assert.equal(start.data.iteration, 3);
  });
});
