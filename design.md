# 🧠 AI Code Review Agent（LangGraph版）架构白皮书

## 0. 系统目标

构建一个 GitLab 集成的 AI Code Review Agent，支持：

- 自动解析 MR（Merge Request）
- 深度理解 diff + 项目上下文
- 自动调用工具（读文件 / 搜索 / 图分析）
- 多轮推理代码问题
- 输出结构化 review + inline comment
- 支持扩展到安全 / 性能 / 架构多维审查

---

# 1. 总体架构

## 🧩 核心架构图（逻辑分层）

```
                ┌────────────────────┐
                │   GitLab MR Event  │
                └─────────┬──────────┘
                          │ webhook / /review
                          ↓
                ┌────────────────────┐
                │  Agent API Service │
                └─────────┬──────────┘
                          ↓
        ┌──────────────────────────────────┐
        │        LangGraph Orchestrator     │
        │  (State Machine / Control Flow)   │
        └─────────┬───────────┬────────────┘
                  ↓           ↓
     ┌────────────────┐  ┌────────────────┐
     │ Tool Layer     │  │ Context Layer  │
     │ (GitLab APIs)  │  │ (Code Index)   │
     └────────────────┘  └────────────────┘
                  ↓
        ┌────────────────────┐
        │   LLM Reasoning    │
        │ (GPT / Claude etc) │
        └────────────────────┘
                  ↓
        ┌────────────────────┐
        │ Review Generator   │
        └────────────────────┘
                  ↓
        ┌────────────────────┐
        │ GitLab Comment Bot │
        └────────────────────┘
```

---

# 2. LangGraph 核心设计

LangGraph 用来实现 **“可控的多步骤 Agent 流程图”**

---

## 2.1 State 定义（核心数据结构）

```ts
type ReviewState = {
  mr_id: string;
  project_id: string;

  diff: Diff[];

  files: string[];
  current_file?: string;

  file_contents: Record<string, string>;

  context_chunks: CodeChunk[];

  issues: Issue[];

  decisions: string[];

  review_report?: string;

  tool_calls: ToolCall[];

  risk_score?: number;
};
```

---

# 3. Graph 节点设计（核心）

## 🧭 主 Graph

```
START
  ↓
Fetch MR
  ↓
Parse Diff
  ↓
Plan Analysis
  ↓
Tool Execution Loop
  ↓
Context Retrieval
  ↓
LLM Code Review
  ↓
Post-process Review
  ↓
GitLab Output
  ↓
END
```

---

# 4. LangGraph 节点详细设计

---

## 4.1 Fetch MR Node

### 职责：

- 拉 GitLab MR 信息
- 获取 diff
- 获取 changed files

### Tool：

```ts
get_merge_request();
get_diff();
```

---

## 4.2 Diff Parser Node

### 职责：

- 解析 diff
- 识别：
  - 新增文件
  - 修改函数
  - 删除逻辑

- 提取关键变更块

输出：

```ts
changed_files;
hunks;
symbols_affected;
```

---

## 4.3 Planning Node（非常关键🔥）

👉 这是 Agent “是否聪明”的分水岭

### 输入：

- diff
- file list

### 输出：

```ts
plan = [
  "fetch file context for auth module",
  "search usage of JWT decode",
  "get dependencies of changed service",
];
```

### 本质：

👉 一个 “tool execution plan generator”

---

## 4.4 Tool Execution Loop（LangGraph loop）

这是 LangGraph 最核心能力：

```
Plan → Tool Call → Observation → Update State → Repeat
```

### 可调用工具：

#### GitLab Tools

```ts
get_file(path);
search_repo(query);
get_directory_tree();
get_commit_history();
```

#### Code Intelligence Tools

```ts
get_symbol_definition();
get_references();
get_call_graph();
```

---

## 4.5 Context Retrieval Node

### 职责：

把工具结果变成 LLM 可用上下文

做三件事：

- chunk code
- embed (optional)
- filter relevant parts

输出：

```ts
context_chunks = [{ file, content, relevance_score }];
```

---

## 4.6 LLM Review Node（核心推理）

输入：

- diff
- context_chunks
- plan execution results

输出：

```ts
issues = [
  {
    type: "bug | security | performance",
    file: "",
    line: 23,
    message: "",
    suggestion: "",
  },
];
```

---

### Review Prompt 结构

必须强约束：

```
You are a senior GitLab code reviewer.

Check:
- correctness
- security
- performance
- maintainability
- architecture consistency

You MUST use provided context only.
```

---

## 4.7 Post Processing Node

### 职责：

- 合并 issues
- 去重
- 评分 risk score
- 转 Markdown / inline comments

输出：

```ts
review_report;
risk_score;
inline_comments;
```

---

## 4.8 GitLab Output Node

调用：

```ts
create_comment(mr_id);
create_inline_comment();
set_mr_label();
```

---

# 5. Tool Layer 设计（关键工程部分）

## 5.1 GitLab Tool API

```ts
interface GitLabTools {
  getMR();
  getDiff();
  getFile(path);
  searchCode(query);
  getCommits();
}
```

---

## 5.2 Code Intelligence Tool（升级点）

### 推荐你一定做：

#### 1. Symbol Index

- function → file mapping

#### 2. Call Graph

- 谁调用谁

#### 3. Dependency Graph

- module dependency

---

## 5.3 Web Tool（可选）

```ts
web_search();
fetch_url();
```

用于：

- 框架规范
- CVE 查询
- API 文档补充

---

# 6. Context Layer（最关键能力之一）

## 6.1 两级上下文系统

### Level 1：即时上下文

- diff
- file content
- MR metadata

---

### Level 2：语义上下文（核心）

- embedding search
- symbol graph
- repo knowledge base

---

## 6.2 向量库结构

```
chunk:
  file_path
  function_name
  code
  embedding
```

---

# 7. LangGraph 运行模式

## 推荐模式：Hybrid Loop Graph

```
Planner → Tool Node → Context Node → LLM Node
        ↑_________________________________↓
```

---

## 为什么必须 loop？

因为：

- 一次 tool 不够理解 repo
- reviewer 需要“追问代码”

---

# 8. 输出结构设计（非常重要）

## GitLab comment

```md
## AI Code Review

### 🔴 Critical Issues (2)

### 🟡 Suggestions (5)

### 🧠 Architecture Observations

### ⚡ Performance Notes

### 🔐 Security Review

### 📌 Inline Comments

- file.ts:23 → ...
```

---

## risk score

```ts
0-30  OK
30-70 WARNING
70-100 HIGH RISK
```

---

# 9. 扩展能力（企业级）

---

## 9.1 Multi-Agent 架构（推荐升级）

```
                Planner Agent
                     ↓
   ┌────────────┬──────────────┬────────────┐
   ↓            ↓              ↓            ↓
Security     Performance   Architecture   Logic
Agent        Agent         Agent         Agent
   ↓            ↓              ↓            ↓
        Aggregator Agent
```

---

## 9.2 Memory System

- repo rules
- past PR decisions
- known anti-patterns

---

## 9.3 CI Integration

- ESLint / Test results → feed LLM

---

# 10. 技术选型建议

## Backend

- Node.js / Python FastAPI

## Agent

- LangGraph（核心）
- LangChain tools

## Storage

- Postgres
- Redis
- Qdrant / Milvus

## Code Index

- worker + cron sync repo

---

# 11. MVP → V1 路线图

## 🟢 MVP（1~2周）

- GitLab webhook
- diff review
- simple LLM call
- markdown comment

---

## 🟡 V1（2~4周）

- LangGraph workflow
- tool calling
- file reading
- inline comment

---

## 🔴 V2（企业级）

- code graph
- vector search
- multi-agent
- risk scoring
- CI integration

---

