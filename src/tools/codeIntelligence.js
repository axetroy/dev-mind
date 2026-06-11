/**
 * dev-mind Code Intelligence 工具层
 *
 * 对应 design.md §5.2 Code Intelligence Tool。
 * 提供符号索引、引用查找、调用图等智能代码分析能力。
 *
 * 当前实现基于本地文件系统扫描 + 简单 AST 解析。
 * 后续可升级为基于 treesitter / language server 的更精确实现。
 */

import fs from "node:fs/promises";
import path from "node:path";

// ─── 简易符号定义正则（按文件扩展名路由） ────────────────────────────────

const PARSERS = {
  ".js":   parseJSLike,
  ".jsx":  parseJSLike,
  ".ts":   parseJSLike,
  ".tsx":  parseJSLike,
  ".mjs":  parseJSLike,
  ".cjs":  parseJSLike,
  ".py":   parsePython,
  ".go":   parseGo,
  ".rs":   parseRust,
  ".java": parseJava,
};

/**
 * 尝试解析文件并提取符号（函数 / 类定义）。
 * @param {string} filePath - 本地绝对路径
 * @returns {Promise<{name:string, type:"function"|"class"|"variable", line:number}[]>}
 */
export async function getSymbols(filePath) {
  const ext = path.extname(filePath);
  const parse = PARSERS[ext];
  if (!parse) return [];

  const content = await fs.readFile(filePath, "utf-8");
  return parse(content);
}

/**
 * 在代码库中查找给定符号的所有引用（线性搜索）。
 * @param {string} repoRoot   - 仓库根目录
 * @param {string} symbolName - 要搜索的符号名称
 * @returns {Promise<{file:string, line:number, snippet:string}[]>}
 */
export async function getReferences(repoRoot, symbolName) {
  const { default: glob } = await import("glob");
  const files = await glob("**/*.{js,jsx,ts,tsx,py,go,rs,java}", {
    cwd: repoRoot,
    ignore: ["node_modules/**", ".git/**", "dist/**", "build/**"],
    absolute: true,
  });

  const results = [];
  const regex = new RegExp(`\\b${escapeRegex(symbolName)}\\b`, "g");

  for (const file of files.slice(0, 50)) {
    // limit to first 50 files
    const content = await fs.readFile(file, "utf-8").catch(() => "");
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lineStart = content.lastIndexOf("\n", match.index) + 1;
      const lineNum = content.slice(0, match.index).split("\n").length;
      const lineEnd = content.indexOf("\n", match.index);
      const snippet = content.slice(lineStart, lineEnd + 1).trim();
      results.push({ file, line: lineNum, snippet });
    }
  }

  return results;
}

/**
 * 获取某个符号的定义（粗略：找到第一个声明位置）。
 * @param {string} filePath
 * @param {string} symbolName
 * @returns {Promise<{line:number, snippet:string}|null>}
 */
export async function getSymbolDefinition(filePath, symbolName) {
  const content = await fs.readFile(filePath, "utf-8").catch(() => "");
  if (!content) return null;

  const lines = content.split("\n");
  const defPatterns = [
    new RegExp(`(function\\s+${escapeRegex(symbolName)}\\s*\\()`),
    new RegExp(`(const\\s+${escapeRegex(symbolName)}\\s*=)`),
    new RegExp(`(let\\s+${escapeRegex(symbolName)}\\s*=)`),
    new RegExp(`(class\\s+${escapeRegex(symbolName)})`),
    new RegExp(`(def\\s+${escapeRegex(symbolName)}\\s*\\()`),           // Python
    new RegExp(`(func\\s+${escapeRegex(symbolName)}\\s*\\()`),          // Go
    new RegExp(`(fn\\s+${escapeRegex(symbolName)}\\s*\\()`),            // Rust
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pat of defPatterns) {
      if (pat.test(lines[i])) {
        return { line: i + 1, snippet: lines[i].trim() };
      }
    }
  }
  return null;
}

/**
 * 获取两个 file 之间的简单依赖关系（只检测 import/require）。
 * @param {string} filePath
 * @returns {Promise<{importedFrom:string, line:number}[]>}
 */
export async function getDependencies(filePath) {
  const content = await fs.readFile(filePath, "utf-8").catch(() => "");
  if (!content) return [];

  const deps = [];
  const lines = content.split("\n");
  const importRe = /(?:import\s+(?:[\w*{},\s]+\s+from\s+)?['"]|require\s*\(\s*['"])([^'"]+)/g;

  let match;
  while ((match = importRe.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split("\n").length;
    deps.push({ importedFrom: match[1], line: lineNum });
  }

  return deps;
}

// ─── 简易解析器 ────────────────────────────────────────────────────────────

function parseJSLike(content) {
  const symbols = [];
  const lines = content.split("\n");

  // function name(…
  const funcRe = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/;
  // const name = (… =>  or  const name = function(
  const constRe = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:\(|async\s*\(|function)/;
  // class Name
  const classRe = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;
  // export default { name }
  const objMethodRe = /^\s*(\w+)\s*\([^)]*\)\s*\{/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;

    if ((m = line.match(funcRe))) {
      symbols.push({ name: m[1], type: "function", line: i + 1 });
    } else if ((m = line.match(classRe))) {
      symbols.push({ name: m[1], type: "class", line: i + 1 });
    } else if ((m = line.match(constRe))) {
      symbols.push({ name: m[1], type: "function", line: i + 1 });
    } else if ((m = line.match(objMethodRe))) {
      // Only pick methods inside an object literal
      symbols.push({ name: m[1], type: "function", line: i + 1 });
    }
  }
  return symbols;
}

function parsePython(content) {
  const symbols = [];
  const lines = content.split("\n");
  const defRe = /^\s*def\s+(\w+)\s*\(/;
  const classRe = /^\s*class\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(defRe))) {
      symbols.push({ name: m[1], type: "function", line: i + 1 });
    } else if ((m = line.match(classRe))) {
      symbols.push({ name: m[1], type: "class", line: i + 1 });
    }
  }
  return symbols;
}

function parseGo(content) {
  const symbols = [];
  const lines = content.split("\n");
  const funcRe = /^\s*func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/;
  const structRe = /^\s*type\s+(\w+)\s+struct/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(funcRe))) {
      symbols.push({ name: m[1], type: "function", line: i + 1 });
    } else if ((m = line.match(structRe))) {
      symbols.push({ name: m[1], type: "class", line: i + 1 });
    }
  }
  return symbols;
}

function parseRust(content) {
  const symbols = [];
  const lines = content.split("\n");
  const fnRe = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/;
  const structRe = /^\s*(?:pub\s+)?struct\s+(\w+)/;
  const implRe = /^\s*(?:pub\s+)?impl\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(fnRe))) {
      symbols.push({ name: m[1], type: "function", line: i + 1 });
    } else if ((m = line.match(structRe))) {
      symbols.push({ name: m[1], type: "class", line: i + 1 });
    } else if ((m = line.match(implRe))) {
      symbols.push({ name: m[1], type: "class", line: i + 1 });
    }
  }
  return symbols;
}

function parseJava(content) {
  const symbols = [];
  const lines = content.split("\n");
  const classRe = /^\s*(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/;
  const methodRe = /^\s*(?:public|private|protected)\s+(?:\w+\s+)*(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(classRe))) {
      symbols.push({ name: m[1], type: "class", line: i + 1 });
    } else if ((m = line.match(methodRe))) {
      // Filter out constructor-like methods that match class name
      symbols.push({ name: m[1], type: "function", line: i + 1 });
    }
  }
  return symbols;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
