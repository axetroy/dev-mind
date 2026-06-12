/**
 * dev-mind 结构化日志系统
 *
 * 每条 review run 有一个唯一 runId，所有日志以 JSONL 格式持久化到文件，
 * 同时输出彩色格式化日志到 stdout。
 *
 * @module logger
 *
 * @example
 * // 在入口创建
 * const logger = createRunLogger('review-abc123');
 *
 * // 节点使用（通过 withNodeLogging 自动包装）
 * export async function fetchMRNode(state) {
 *   return withNodeLogging('fetchMR', state, async (log, state) => {
 *     log.info('Fetching MR metadata...', { project_id: state.project_id });
 *     const mr = await gitlab.getMergeRequest(...);
 *     log.info('MR title:', { title: mr.title });
 *     return { diff, files, diff_refs };
 *   });
 * }
 *
 * // 或手动使用
 * const logger = getLogger(state.runId);
 * logger.nodeStart('myNode', { key: 'val' });
 * logger.nodeEnd('myNode', { result: 'ok' }, 1234);
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

// ─── Constants ──────────────────────────────────────────────────────────────

const LOG_DIR = join(process.cwd(), "logs");
const LEVEL_NUM = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_PAD = { debug: "DEBUG", info: "INFO ", warn: "WARN ", error: "ERROR" };

// ─── Module-scoped loggers ──────────────────────────────────────────────────

/** @type {Map<string, RunLogger>} */
const _loggers = new Map();

/**
 * 获取已创建的 logger 实例。
 * @param {string} runId
 * @returns {RunLogger|null}
 */
export function getLogger(runId) {
  return _loggers.get(runId) ?? null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString();
}

function shortId(runId) {
  return runId.length > 8 ? runId.slice(0, 8) : runId;
}

/**
 * 格式化 stdout 输出（带颜色）。
 * @param {LogEntry} entry
 * @returns {string}
 */
function formatStdout(entry) {
  const time = new Date(entry.ts).toLocaleTimeString("zh-CN", { hour12: false });

  // 节点生命周期 — 特殊格式
  if (entry.event === "node_start") {
    return `\x1b[36m[${time}]\x1b[0m \x1b[1;97m${entry.node}\x1b[0m ▶️  ${entry.msg}`;
  }
  if (entry.event === "node_end") {
    const dur = entry.duration_ms != null ? ` \x1b[90m(${entry.duration_ms}ms)\x1b[0m` : "";
    return `\x1b[36m[${time}]\x1b[0m \x1b[1;97m${entry.node}\x1b[0m ◀️  ${entry.msg}${dur}`;
  }

  // LLM / Tool 调用 — 高亮
  if (entry.event === "llm_call") {
    return `\x1b[35m[${time}]\x1b[0m \x1b[35m🤖 LLM ${entry.msg}\x1b[0m`;
  }
  if (entry.event === "llm_response") {
    const dur = entry.duration_ms != null ? ` \x1b[90m(${entry.duration_ms}ms)\x1b[0m` : "";
    return `\x1b[35m[${time}]\x1b[0m \x1b[35m✅ LLM ${entry.msg}\x1b[0m${dur}`;
  }
  if (entry.event === "tool_call") {
    return `\x1b[33m[${time}]\x1b[0m \x1b[33m🛠️  ${entry.msg}\x1b[0m`;
  }
  if (entry.event === "tool_result") {
    const dur = entry.duration_ms != null ? ` \x1b[90m(${entry.duration_ms}ms)\x1b[0m` : "";
    return `\x1b[33m[${time}]\x1b[0m \x1b[33m✅ ${entry.msg}\x1b[0m${dur}`;
  }

  // 普通日志
  const levelColor = entry.level === "error" ? "\x1b[31m"
    : entry.level === "warn" ? "\x1b[33m"
    : entry.level === "debug" ? "\x1b[90m"
    : "\x1b[37m";
  return `${levelColor}[${time}] [${shortId(entry.runId)}] [${entry.node}] ${entry.msg}\x1b[0m`;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} LogEntry
 * @property {string}  runId
 * @property {number}  seq
 * @property {string}  ts          - ISO 8601
 * @property {string}  level       - debug / info / warn / error
 * @property {string}  event       - node_start / node_end / llm_call / llm_response / tool_call / tool_result / log
 * @property {string}  node
 * @property {string}  msg
 * @property {*}       data
 * @property {number|null} duration_ms
 */

/**
 * @typedef {Object} RunLogger
 * @property {(node:string, data?:*)=>void}   nodeStart
 * @property {(node:string, result?:*, durationMs?:number)=>void} nodeEnd
 * @property {(msg:string, data?:*)=>void}    info
 * @property {(msg:string, data?:*)=>void}    warn
 * @property {(msg:string, data?:*)=>void}    error
 * @property {(msg:string, data?:*)=>void}    debug
 * @property {(msg:string, data?:*)=>void}    progress   - 节点内部的进度日志
 * @property {(model:string, input:string, meta?:*)=>void} llmCall
 * @property {(model:string, output:string, latencyMs:number, meta?:*)=>void} llmResponse
 * @property {(toolName:string, params:*)=>void} toolCall
 * @property {(toolName:string, result:*, durationMs:number)=>void} toolResult
 * @property {()=>void} close
 */

/**
 * 创建一个 per-run logger。
 * 日志写入 `logs/run-<runId>.ndjson`，同时输出到 stdout。
 *
 * @param {string}  [runId]  - 不传则自动生成 UUID
 * @param {object}  [options]
 * @param {boolean} [options.silent] - 设置为 true 可关闭 stdout 输出（测试用）
 * @returns {RunLogger}
 */
export function createRunLogger(runId, options = {}) {
  runId = runId ?? `review-${randomUUID().slice(0, 8)}`;
  if (_loggers.has(runId)) return _loggers.get(runId);

  const logFile = join(LOG_DIR, `run-${runId}.ndjson`);
  let seq = 0;
  let fileReady = false;

  // 确保日志目录存在
  mkdir(LOG_DIR, { recursive: true }).then(() => { fileReady = true; }).catch(() => {});

  /**
   * 写入一条日志。
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string}  event
   * @param {string}  node
   * @param {string}  msg
   * @param {*}       [data]
   * @param {number}  [durationMs]
   */
  function write(level, event, node, msg, data, durationMs) {
    const entry = {
      runId,
      seq: seq++,
      ts: ts(),
      level,
      event,
      node,
      msg,
      data: data ?? null,
      duration_ms: durationMs ?? null,
    };

    // 测试钩子：捕获日志条目用于断言
    if (options.onWrite) options.onWrite(entry);

    // JSONL 文件（静默写入，不阻塞）
    if (fileReady) {
      appendFile(logFile, JSON.stringify(entry) + "\n").catch(() => {});
    }

    // stdout
    if (!options.silent) {
      console.log(formatStdout(entry));
    }
  }

  const logger = {
    // ── 节点生命周期 ──────────────────────────────────────────────────
    nodeStart(node, data) {
      write("info", "node_start", node, `▶️ ${node}`, data);
    },

    nodeEnd(node, result, durationMs) {
      const keys = result ? Object.keys(result).filter((k) => k !== "runId").join(", ") : "∅";
      write("info", "node_end", node, `◀️ ${node} → {${keys}}`, null, durationMs);
    },

    // ── 通用日志 ──────────────────────────────────────────────────────
    info(msg, data) { write("info", "log", this._node || "system", msg, data); },
    warn(msg, data) { write("warn", "log", this._node || "system", msg, data); },
    error(msg, data) { write("error", "log", this._node || "system", msg, data); },
    debug(msg, data) { write("debug", "log", this._node || "system", msg, data); },

    // 节点内部进度（免去重复写 node 名）
    progress(msg, data) { write("info", "log", this._node || "system", msg, data); },

    // ── LLM Tracing ───────────────────────────────────────────────────
    llmCall(model, input, meta) {
      write("info", "llm_call", "llm", `🤖 ${model} (${(input?.length ?? 0).toLocaleString()} chars)`, {
        ...meta,
        model,
        input_length: input?.length ?? 0,
      });
    },

    llmResponse(model, output, latencyMs, meta) {
      write("info", "llm_response", "llm", `✅ ${model} (${latencyMs}ms, ${(output?.length ?? 0).toLocaleString()} chars)`, {
        ...meta,
        model,
        output_length: output?.length ?? 0,
      }, latencyMs);
    },

    // ── Tool Tracing ──────────────────────────────────────────────────
    toolCall(toolName, params) {
      write("info", "tool_call", toolName, `🛠️  ${toolName}`, params);
    },

    toolResult(toolName, result, durationMs) {
      const summary = typeof result === "string"
        ? (result.length > 300 ? result.slice(0, 300) + "…" : result)
        : `[${typeof result}]`;
      write("info", "tool_result", toolName, `✅ ${toolName} (${durationMs}ms)`, { summary }, durationMs);
    },

    // ── 清理 ──────────────────────────────────────────────────────────
    close() {
      write("info", "log", "system", `🏁 Run finished: ${runId}`);
      _loggers.delete(runId);
    },
  };

  // 写入 run_start（通过 write，确保 onWrite 测试钩子与文件写入一致）
  write("info", "run_start", "system", `🚀 Run started: ${runId}`);

  _loggers.set(runId, logger);
  return logger;
}

// ─── Node Wrapper ────────────────────────────────────────────────────────────

/**
 * 自动包装一个 node 函数，在调用前后自动记录 nodeStart / nodeEnd / 异常。
 *
 * @param {string}        nodeName
 * @param {(state:import("../state.js").ReviewState)=>Promise<Partial<import("../state.js").ReviewState>>} nodeFn
 * @returns {(state:import("../state.js").ReviewState)=>Promise<Partial<import("../state.js").ReviewState>>}
 */
export function withNodeLogging(nodeName, nodeFn) {
  return async (state) => {
    const logger = getLogger(state.run_id);
    // 设置 _node 使 logger.info/warn/error 自动标记节点名
    const prevNode = logger ? logger._node : null;
    if (logger) logger._node = nodeName;

    if (logger) {
      logger.nodeStart(nodeName, {
        ...(state.project_id ? { project_id: state.project_id, mr_id: state.mr_id } : {}),
        ...(state.files?.length ? { files: state.files.length } : {}),
        ...(state.diff?.length ? { diff_files: state.diff.length } : {}),
        ...(state.issues?.length ? { issues: state.issues.length } : {}),
        ...(state.iteration != null ? { iteration: state.iteration } : {}),
      });
    }

    const startTime = Date.now();
    try {
      const result = await nodeFn(state);
      if (logger) logger.nodeEnd(nodeName, result, Date.now() - startTime);
      // 恢复上一个 node 名
      if (logger) logger._node = prevNode;
      return result;
    } catch (err) {
      if (logger) logger._node = prevNode;
      if (logger) {
        logger.error(`❌ ${err.message}`, { error: err.message, stack: err.stack?.split("\n").slice(0, 4).join("\n") });
      }
      throw err;
    }
  };
}

// ─── Test helper ────────────────────────────────────────────────────────────

/**
 * 创建一个静默 logger（用于测试场景，不写文件、不输出）。
 * @param {string} [runId]
 * @returns {RunLogger}
 */
export function createSilentLogger(runId = "test") {
  const logger = {
    _node: "test",
    nodeStart: () => {},
    nodeEnd: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    progress: () => {},
    llmCall: () => {},
    llmResponse: () => {},
    toolCall: () => {},
    toolResult: () => {},
    close: () => {},
  };
  _loggers.set(runId, logger);
  return logger;
}
