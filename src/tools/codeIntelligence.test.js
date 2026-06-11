import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { getSymbols, getDependencies } from "./codeIntelligence.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ─── Helpers ────────────────────────────────────────────────────────────────

let tmpDir;

function createTempDir() {
  tmpDir = join(tmpdir(), `dev-mind-test-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function cleanupTempDir() {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

function writeTempFile(name, content) {
  if (!tmpDir) createTempDir();
  const filePath = join(tmpDir, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

before(() => createTempDir());
after(() => cleanupTempDir());

// ─── getSymbols ─────────────────────────────────────────────────────────────

describe("getSymbols — JavaScript", () => {
  it("should detect function declarations", async () => {
    const fp = writeTempFile("test.js", `
function foo() {}
function bar(a, b) { return a + b; }
`);
    const symbols = await getSymbols(fp);
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0].name, "foo");
    assert.equal(symbols[1].name, "bar");
    assert.equal(symbols[0].type, "function");
  });

  it("should detect class declarations", async () => {
    const fp = writeTempFile("test.js", `
class UserService {
  constructor() {}
  async find() { return []; }
}
`);
    const symbols = await getSymbols(fp);
    assert.ok(symbols.some((s) => s.name === "UserService" && s.type === "class"));
  });

  it("should detect const arrow functions", async () => {
    const fp = writeTempFile("test.js", `
const handler = () => {};
const compute = async (x) => x * 2;
`);
    const symbols = await getSymbols(fp);
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0].name, "handler");
    assert.equal(symbols[1].name, "compute");
  });

  it("should handle empty file", async () => {
    const fp = writeTempFile("empty.js", "");
    const symbols = await getSymbols(fp);
    assert.deepEqual(symbols, []);
  });

  it("should return empty for unknown extension", async () => {
    const fp = writeTempFile("data.csv", "a,b,c\n1,2,3");
    const symbols = await getSymbols(fp);
    assert.deepEqual(symbols, []);
  });

  it("should detect async function declarations", async () => {
    const fp = writeTempFile("test.js", `async function fetchData() { return []; }`);
    const symbols = await getSymbols(fp);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "fetchData");
  });

  it("should detect exported functions", async () => {
    const fp = writeTempFile("test.js", `export function exportedFn() {}`);
    const symbols = await getSymbols(fp);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "exportedFn");
  });
});

describe("getSymbols — Python", () => {
  it("should detect def and class", async () => {
    const fp = writeTempFile("test.py", `
def hello():
    print("hi")

class MyModel:
    pass
`);
    const symbols = await getSymbols(fp);
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0].name, "hello");
    assert.equal(symbols[0].type, "function");
    assert.equal(symbols[1].name, "MyModel");
    assert.equal(symbols[1].type, "class");
  });
});

describe("getSymbols — Go", () => {
  it("should detect func and struct", async () => {
    const fp = writeTempFile("main.go", `
package main

func Hello() string {
    return "hi"
}

type Config struct {
    Port int
}
`);
    const symbols = await getSymbols(fp);
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0].name, "Hello");
    assert.equal(symbols[0].type, "function");
    assert.equal(symbols[1].name, "Config");
    assert.equal(symbols[1].type, "class");
  });
});

// ─── getDependencies ────────────────────────────────────────────────────────

describe("getDependencies", () => {
  it("should detect ES import statements", async () => {
    const fp = writeTempFile("app.js", `
import express from "express";
import { readFile } from "node:fs";
import * as utils from "./utils.js";
`);
    const deps = await getDependencies(fp);
    assert.equal(deps.length, 3);
    assert.ok(deps.some((d) => d.importedFrom === "express"));
    assert.ok(deps.some((d) => d.importedFrom === "node:fs"));
    assert.ok(deps.some((d) => d.importedFrom === "./utils.js"));
  });

  it("should detect require calls", async () => {
    const fp = writeTempFile("app.cjs", `
const lodash = require("lodash");
const fs = require("node:fs");
`);
    const deps = await getDependencies(fp);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].importedFrom, "lodash");
  });

  it("should return empty for file with no imports", async () => {
    const fp = writeTempFile("simple.js", `
const x = 1;
function a() { return x; }
`);
    const deps = await getDependencies(fp);
    assert.deepEqual(deps, []);
  });

  it("should include line numbers", async () => {
    const fp = writeTempFile("app.js", [
      "// header",
      "",
      "import z from 'zod';",
      "import { join } from 'path';",
    ].join("\n"));
    const deps = await getDependencies(fp);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].line, 3);
    assert.equal(deps[1].line, 4);
  });
});
