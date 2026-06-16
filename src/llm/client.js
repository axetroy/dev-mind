/**
 * dev-mind LLM 客户端
 *
 * 统一的 LLM 调用抽象层，支持：
 *   - 任意 OpenAI Chat API 兼容服务（OpenAI / Azure / OpenRouter / Groq / LocalAI 等）
 *   - Anthropic（需安装 @langchain/anthropic）
 *
 * 所有 graph node 都通过此模块访问 LLM，而非直接调用 SDK。
 */

import { ChatOpenAI } from "@langchain/openai";
import { getConfig, getLLMProvider, getModelName } from "../config.js";

// ─── Cached model instances ────────────────────────────────────────────────

let _model = null;

/**
 * 获取（并缓存）当前配置的 LangChain ChatModel 实例。
 * 根据环境变量自动选择 OpenAI / Anthropic。
 *
 * @returns {import("@langchain/core/language_models/chat_models").BaseChatModel}
 */
export function getModel() {
  if (_model) return _model;

  const cfg = getConfig();
  const provider = getLLMProvider();

  if (provider === "openai") {
    const maxTokens = cfg.LLM_MAX_TOKENS;
    const requestTimeout = 300_000; // 5 分钟超时，避免无限挂起

    const openAIOptions = {
      openAIApiKey: cfg.OPENAI_API_KEY,
      modelName: getModelName(),
      temperature: 0.1,          // low temp for deterministic review
      maxTokens,
      streaming: false,           // 关闭流式，某些兼容 API 流式实现有问题会导致挂起
      timeout: requestTimeout,    // 请求超时
      maxRetries: 2,              // 最多重试 2 次
    };

    // 如果配置了自定义 base URL，传递给 ChatOpenAI
    if (cfg.OPENAI_BASE_URL) {
      openAIOptions.configuration = {
        baseURL: cfg.OPENAI_BASE_URL,
      };
    }

    _model = new ChatOpenAI(openAIOptions);

    console.log("[llm] OpenAI-compatible client initialized:");
    console.log("  Model:", getModelName());
    console.log("  Base URL:", cfg.OPENAI_BASE_URL || "https://api.openai.com/v1 (default)");
    console.log("  Max tokens:", maxTokens);
    console.log("  Streaming: false, Timeout: 5m, Max retries: 2");
    console.log("  API Key set:", !!cfg.OPENAI_API_KEY);
  } else if (provider === "anthropic") {
    // Dynamic import to avoid hard dependency on @langchain/anthropic
    // when only OpenAI is configured.
    // NOTE: In ESM, use top-level await or dynamic import().
    throw new Error(
      "Anthropic provider requires @langchain/anthropic. " +
      "Install it: npm install @langchain/anthropic, and then update " +
      "the throw statement in src/llm/client.js to use dynamic import()."
    );
  }

  return _model;
}

/**
 * 直接调用 LLM 并返回文本输出。
 *
 * @param {string} systemPrompt - System message content
 * @param {string} userPrompt   - Human message content
 * @param {object} [logger]     - Optional logger instance for structured logging
 * @returns {Promise<string>}   - Model text response
 */
export async function llmCall(systemPrompt, userPrompt, logger) {
  const cfg = getConfig();
  const model = getModel();
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "human", content: userPrompt },
  ];

  const log = logger?.info ?? console.log;
  const logWarn = logger?.warn ?? console.warn;
  const logErr = logger?.error ?? console.error;

  log("Calling model: " + getModelName());
  log("System prompt length: " + systemPrompt.length + ", User prompt length: " + userPrompt.length);

  const startTime = Date.now();

  // 心跳：每 15 秒打印一次等待状态，避免看起来像卡死
  const heartbeat = setInterval(() => {
    const waited = ((Date.now() - startTime) / 1000).toFixed(0);
    log("Still waiting for model response... (" + waited + "s elapsed)");
  }, 15000);

  try {
    const response = await model.invoke(messages);
    clearInterval(heartbeat);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    log("Response received in " + elapsed + "s");

    // 检查是否被截断
    const finishReason = response.response_metadata?.finish_reason;
    if (finishReason === "length") {
      logWarn("Response was TRUNCATED (finish_reason='length'). Max tokens: " + cfg.LLM_MAX_TOKENS + ", Consider increasing LLM_MAX_TOKENS.");
    }

    // 提取文本内容
    let textContent = "";
    if (typeof response.content === "string") {
      textContent = response.content;
    } else if (Array.isArray(response.content)) {
      textContent = response.content
        .filter((b) => b.type === "text" || b.text)
        .map((b) => b.text ?? "")
        .join("\n");
    }

    if (!textContent) {
      logErr("Model returned empty content!");
      throw new Error(
        "Model returned empty response. " +
        "Model: " + getModelName() + ", " +
        "Content type: " + typeof response.content + ", " +
        "Raw: " + JSON.stringify(response.content).slice(0, 200)
      );
    }

    log("Extracted text length: " + textContent.length);
    return textContent;
  } catch (err) {
    clearInterval(heartbeat);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logErr("API call failed after " + elapsed + "s: " + err.message);
    throw err;
  }
}

/**
 * 调用 LLM 并尝试将输出解析为 JSON。
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [logger]     - Optional logger instance for structured logging
 * @returns {Promise<Object>}
 */
export async function llmCallJSON(systemPrompt, userPrompt, logger) {
  const text = await llmCall(systemPrompt, userPrompt, logger);

  const log = logger?.info ?? console.log;
  const logErr = logger?.error ?? console.error;

  // Try to extract JSON from markdown fence if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(raw);
    log("JSON parsed successfully, issues count: " + (parsed.issues?.length ?? 0));
    return parsed;
  } catch {
    logErr("Failed to parse LLM output as JSON");
    logErr("Raw text length: " + text.length);
    logErr("Attempted JSON input (first 500 chars): " + raw.slice(0, 500));
    throw new Error("LLM output is not valid JSON.\nRaw output:\n" + raw);
  }
}
