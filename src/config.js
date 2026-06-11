/**
 * dev-mind 配置模块
 *
 * 从环境变量加载所有配置，提供单一配置访问入口。
 */

import "dotenv/config";
import "global-agent/bootstrap.js";
import { z } from "zod";

// ─── Schema ────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // GitLab
  GITLAB_URL: z.string().default("https://gitlab.com"),
  GITLAB_TOKEN: z.string().min(1, "GITLAB_TOKEN is required"),

  // LLM — OpenAI / 兼容 OpenAI 接口的任意服务
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  OPENAI_BASE_URL: z.string().optional()
    .describe("OpenAI 兼容 API 的基础 URL，例如 https://api.openai.com/v1（默认值），或 https://openrouter.ai/api/v1，或 http://localhost:11434/v1"),
  LLM_MAX_TOKENS: z.coerce.number().default(16384)
    .describe("每次 LLM 调用的最大 token 数。推理模型（如 DeepSeek R1）需要更大的值才能同时容纳 reasoning + 可见输出"),
  LLM_LANGUAGE: z.string().default("")
    .describe("指定模型输出的语言。例如 '中文'、'English'、'日本語'。留空或 'auto' 表示由模型自行决定"),

  // LLM — Anthropic (alternative)
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),

  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Proxy
  HTTP_PROXY: z.string().optional()
    .describe("HTTP 代理地址，例如 http://127.0.0.1:7890"),
  HTTPS_PROXY: z.string().optional()
    .describe("HTTPS 代理地址，例如 http://127.0.0.1:7890"),
  NO_PROXY: z.string().optional()
    .describe("不走代理的地址白名单，逗号分隔"),

  // Agent behaviour
  MAX_TOOL_ITERATIONS: z.coerce.number().default(10),
  RISK_THRESHOLD_LOW: z.coerce.number().default(30),
  RISK_THRESHOLD_HIGH: z.coerce.number().default(70),
});

// ─── Parse ─────────────────────────────────────────────────────────────────

let _config = null;

/**
 * 获取解析后的配置对象（惰性单例）。
 * 在第一次调用时读取并校验 process.env。
 */
export function getConfig() {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("[config] Invalid environment variables:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

/**
 * 返回当前使用的 LLM 供应商类型（"openai" | "anthropic"）。
 *
 * "openai" 代表任意兼容 OpenAI Chat API 的服务，包括：
 *   - OpenAI 官方 API
 *   - Azure OpenAI
 *   - OpenRouter
 *   - Groq
 *   - LocalAI / Ollama (with openai-compatible endpoint)
 *   - 任何实现了 /v1/chat/completions 接口的服务
 */
export function getLLMProvider() {
  const cfg = getConfig();
  if (cfg.OPENAI_API_KEY) return "openai";
  if (cfg.ANTHROPIC_API_KEY) return "anthropic";
  throw new Error(
    "No LLM provider configured. " +
    "Set OPENAI_API_KEY (for OpenAI or compatible APIs) " +
    "or ANTHROPIC_API_KEY (for Anthropic)."
  );
}

/**
 * 返回当前使用的完整模型标识符。
 * 对 "openai" provider，可以是 OpenAI 模型名或其他兼容 API 的模型名。
 */
export function getModelName() {
  const cfg = getConfig();
  const provider = getLLMProvider();
  return provider === "openai" ? cfg.OPENAI_MODEL : cfg.ANTHROPIC_MODEL;
}

// ─── Shorthand accessors ───────────────────────────────────────────────────

export const config = new Proxy({}, {
  get(_, prop) {
    const cfg = getConfig();
    return prop in cfg ? cfg[prop] : undefined;
  },
});
