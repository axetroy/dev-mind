# 🧠 dev-mind — AI Code Review Agent

基于 **LangGraph** 构建的 GitLab 集成 AI 代码审查智能体。自动解析 Merge Request，深度理解 diff 和项目上下文，多轮推理代码问题，输出结构化 review 报告 + inline comments。

## 架构总览

```
GitLab MR Event
       │ webhook / POST /review
       ▼
┌──────────────────────┐
│   Agent API Service  │  ← Express HTTP 服务
└──────────┬───────────┘
           ▼
┌──────────────────────────────────┐
│     LangGraph Orchestrator       │  ← State Machine / Control Flow
│  (START → fetchMR → parseDiff    │
│   → planAnalysis → toolLoop      │
│   → contextRetrieval → llmReview │
│   → postProcess → gitlabOutput)  │
└──────────┬───────────┬───────────┘
           ▼           ▼
┌──────────────────┐  ┌──────────────────┐
│   Tool Layer     │  │  Context Layer   │
│ (GitLab APIs)    │  │ (Code Index)     │
│ (Code Intel)     │  │ (Chunk + Rank)   │
└──────────────────┘  └──────────────────┘
           ▼
┌──────────────────────┐
│   LLM Reasoning      │  ← GPT-4o / Claude
└──────────────────────┘
           ▼
┌──────────────────────┐
│  Review Generator    │  ← Markdown + Inline Comments
└──────────────────────┘
           ▼
┌──────────────────────┐
│ GitLab Comment Bot   │  ← 评论 + 标签
└──────────────────────┘
```

## 核心流程

```
START → fetchMR → parseDiff → planAnalysis
                                    │
                           ┌─────── toolExecution (loop) ───────┐
                           │         │                          │
                           │   contextRetrieval                 │
                           │         │                          │
                           │    llmReview ──────────────────────┘
                           │         │
                           ▼   postProcess
                                    │
                              gitlabOutput → END
```

| 节点 | 对应设计 | 职责 |
|------|---------|------|
| `fetchMR` | §4.1 | 从 GitLab 拉取 MR 信息、diff、变更文件列表 |
| `parseDiff` | §4.2 | 解析 diff → hunks、受影响符号、变更类型分类 |
| `planAnalysis` | §4.3 | LLM 生成 tool execution plan（最关键的智能分水岭） |
| `toolExecution` | §4.4 | 按 plan 执行工具，循环直到 plan 完成 |
| `contextRetrieval` | §4.5 | 文件分块、关键词相关性排序、构建 LLM 上下文 |
| `llmReview` | §4.6 | 核心推理：diff + context → 结构化 issues |
| `postProcess` | §4.7 | 去重、风险评分、Markdown 报告生成 |
| `gitlabOutput` | §4.8 | 回写 GitLab：主评论 + inline comments + 标签 |

## 快速开始

### 前置条件

- Node.js >= 18
- GitLab Personal Access Token（`api` 权限）
- OpenAI API Key（或 Anthropic API Key）

### 安装

```bash
# 克隆项目
git clone <repo-url> && cd dev-mind

# 安装依赖
npm install
```

### 配置

```bash
cp .env.example .env
# 编辑 .env 填入必要的密钥
```

最小配置示例（`.env`）：

```env
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
```

### 启动 API 服务

```bash
# 生产模式
npm start

# 开发模式（文件修改自动重启）
npm run dev
```

服务默认监听 `http://localhost:3000`。

---

## Docker 部署

### 前置条件

- Docker Engine >= 24
- Docker Compose >= 2.20

### 方式一：Docker Compose（推荐）

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 GITLAB_TOKEN 和 OPENAI_API_KEY

# 2. 构建并启动
docker compose up -d

# 3. 查看日志
docker compose logs -f

# 4. 停止
docker compose down
```

### 方式二：纯 Docker

```bash
# 构建镜像
docker build -t dev-mind:latest .

# 运行容器
docker run -d \
  --name dev-mind \
  -p 3000:3000 \
  -e GITLAB_URL=https://gitlab.com \
  -e GITLAB_TOKEN=glpat-xxxxxxxxxxxx \
  -e OPENAI_API_KEY=sk-xxxxxxxxxxxx \
  -e NODE_ENV=production \
  --restart unless-stopped \
  dev-mind:latest
```

### 验证部署

```bash
# 健康检查
curl http://localhost:3000/health

# 手动触发 review
curl -X POST http://localhost:3000/review \
  -H "Content-Type: application/json" \
  -d '{"project_id": "my-group/my-project", "mr_iid": "42"}'
```

### Docker 镜像说明

| 层面 | 说明 |
|------|------|
| **基础镜像** | `node:23-alpine`（轻量，~130 MB） |
| **多阶段构建** | deps → build → production，仅复制运行时必需文件 |
| **非 root 用户** | 使用 `appuser` 运行，增强安全性 |
| **健康检查** | 每 30s 检测 `/health` 端点，自动重启异常容器 |
| **资源限制** | docker-compose 预设 CPU 1 核 / 内存 512 MB |

### 自定义构建

```bash
# 修改 Node 版本（Dockerfile 中替换 FROM 行）
# 例：使用 slim 版本的 node:23-slim

# 调整资源限制（docker-compose.yml → deploy.resources）

# 重新构建
docker compose build --no-cache
docker compose up -d
```

---

### 手动触发 Review

**通过 CLI：**

```bash
node src/cli.js --project my-group/my-project --mr 42
```

**通过 HTTP：**

```bash
curl -X POST http://localhost:3000/review \
  -H "Content-Type: application/json" \
  -d '{"project_id": "my-group/my-project", "mr_iid": "42"}'
```

**检查服务状态：**

```bash
curl http://localhost:3000/health
```

## GitLab Webhook 集成

在 GitLab 项目 → Settings → Webhooks 中添加：

| 字段 | 值 |
|------|-----|
| **URL** | `https://your-server.com/webhook/gitlab` |
| **Secret Token** | 可选 |
| **Trigger** | ✅ Merge Request events |

Webhook 端点会自动处理 `open`、`update`、`reopen` 事件，异步触发 review 并返回 `202 Accepted`。

## 输出示例

MR review 评论输出格式：

```markdown
## 🤖 AI Code Review

**Risk Score:** 45 — 🟡 WARNING

### 🔴 Critical Issues
- **`src/auth/login.ts:23`** — JWT secret 硬编码在源码中
  - *Suggestion:* 使用环境变量 `process.env.JWT_SECRET`

### 🟡 Warnings
- **`src/api/users.ts:88`** — N+1 查询：循环中调用 User.find()
  - *Suggestion:* 使用 eager loading 或 batch 查询

### 💡 Suggestions
- **`src/utils/helper.ts:15`** — 未使用的导入 `lodash`
```

## 项目结构

```
dev-mind/
├── package.json                # 项目依赖与脚本
├── .env.example                # 环境变量模板
├── .gitignore
├── .dockerignore               # Docker 构建上下文排除列表
├── Dockerfile                  # 多阶段构建（deps → build → production）
├── docker-compose.yml          # Docker Compose 编排（env + 资源 + 健康检查）
├── design.md                   # 原始架构白皮书（设计文档）
├── README.md                   # 本文件
│
└── src/
    ├── index.js                # Express API 服务入口
    ├── cli.js                  # CLI 命令行入口
    ├── config.js               # Zod 校验的环境变量配置
    ├── state.js                # ReviewState + LangGraph Channels
    │
    ├── graph/
    │   ├── index.js            # Graph 组装 + 编译 + 条件路由
    │   └── nodes/
    │       ├── fetchMR.js
    │       ├── parseDiff.js
    │       ├── planAnalysis.js
    │       ├── toolExecution.js
    │       ├── contextRetrieval.js
    │       ├── llmReview.js
    │       ├── postProcess.js
    │       └── gitlabOutput.js
    │
    ├── tools/
    │   ├── gitlab.js           # GitLab REST API 封装
    │   ├── codeIntelligence.js # 符号索引、引用、依赖分析
    │   └── index.js            # 工具注册表
    │
    ├── llm/
    │   ├── client.js           # LLM 统一调用（OpenAI / Anthropic）
    │   └── prompts.js          # System + User 提示词模板
    │
    ├── context/
    │   └── retriever.js        # 代码分块 + 相关性排序
    │
    └── output/
        └── formatter.js        # 报告格式化 + 评分 + 去重
```

## 配置参考

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `GITLAB_URL` | `https://gitlab.com` | GitLab 实例地址 |
| `GITLAB_TOKEN` | — | Personal Access Token |
| `OPENAI_API_KEY` | — | OpenAI 兼容 API 的 Key |
| `OPENAI_MODEL` | `gpt-4o` | 模型名（由 API 服务决定） |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容 API 的基础 URL。可指向任何兼容服务 |
| `LLM_MAX_TOKENS` | `16384` | 每次 LLM 调用的最大 token 数。推理模型（如 DeepSeek R1）需更大值 |
| `LLM_LANGUAGE` | `""` (auto) | 模型输出语言偏好。设 `中文` / `English` / `日本語` 等使模型用指定语言回答 |
| `ANTHROPIC_API_KEY` | — | Anthropic API Key（可选） |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Anthropic 模型名 |
| `PORT` | `3000` | HTTP 服务端口 |
| `NODE_ENV` | `development` | 运行环境 |
| `MAX_TOOL_ITERATIONS` | `10` | 最大工具迭代次数 |
| `RISK_THRESHOLD_LOW` | `30` | 低风险阈值 |
| `RISK_THRESHOLD_HIGH` | `70` | 高风险阈值 |
| `HTTP_PROXY` | — | HTTP 代理地址，如 `http://127.0.0.1:7890` |
| `HTTPS_PROXY` | — | HTTPS 代理地址（通常同 HTTP_PROXY） |
| `NO_PROXY` | — | 不走代理的白名单，逗号分隔 |

> **注意：**
> - OpenAI 和 Anthropic 只需配置其一即可，默认优先读取 `OPENAI_API_KEY`。
> - `OPENAI_BASE_URL` 可指向**任意兼容 OpenAI Chat API 的服务**，例如：
>   - 官方 OpenAI: 留空或填 `https://api.openai.com/v1`
>   - OpenRouter: `https://openrouter.ai/api/v1`
>   - Groq: `https://api.groq.com/openai/v1`
>   - Ollama (本地): `http://localhost:11434/v1`
>   - LocalAI: `http://localhost:8080/v1`

## 技术栈

- **运行时：** Node.js (ESM)
- **Agent 框架：** LangGraph (`@langchain/langgraph`)
- **LLM SDK：** LangChain (`@langchain/openai`)
- **HTTP 服务：** Express
- **配置校验：** Zod
- **代码解析：** 内置正则解析器（JS/TS/Python/Go/Rust/Java）

## 扩展能力

参见 `design.md` §9 企业级扩展：

- **Multi-Agent 架构：** 拆分为 Security / Performance / Architecture 子 Agent + Aggregator
- **Memory 系统：** 仓库规则缓存、历史 review 决策记忆
- **向量检索：** 接入 Qdrant / Milvus 实现语义级代码搜索
- **CI 集成：** 将 ESLint / 测试结果输入 LLM 增强 review

## License

MIT
