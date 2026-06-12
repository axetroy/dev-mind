import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInitialState, CHANNELS } from "./state.js";

describe("createInitialState", () => {
  it("should return default values when called without options", () => {
    const state = createInitialState();

    assert.equal(state.run_id, "");
    assert.equal(state.mr_id, "");
    assert.equal(state.project_id, "");
    assert.deepEqual(state.diff, []);
    assert.deepEqual(state.files, []);
    assert.equal(state.current_file, null);
    assert.deepEqual(state.file_contents, {});
    assert.deepEqual(state.context_chunks, []);
    assert.deepEqual(state.issues, []);
    assert.deepEqual(state.decisions, []);
    assert.equal(state.review_report, null);
    assert.deepEqual(state.tool_calls, []);
    assert.equal(state.risk_score, null);
    assert.equal(state.plan, null);
    assert.equal(state.iteration, 0);
    assert.deepEqual(state.errors, []);
    assert.equal(state.diff_refs, null);
    assert.equal(state.source_branch, null);
  });

  it("should set mr_id and project_id when provided", () => {
    const state = createInitialState({ mr_id: "42", project_id: "group/repo" });

    assert.equal(state.mr_id, "42");
    assert.equal(state.project_id, "group/repo");
    assert.equal(state.iteration, 0); // other fields still default
  });

  it("should not mutate across calls", () => {
    const a = createInitialState({ mr_id: "1" });
    const b = createInitialState({ mr_id: "2" });

    assert.equal(a.mr_id, "1");
    assert.equal(b.mr_id, "2");
  });
});

describe("CHANNELS", () => {
  it("should have entries for all state keys", () => {
    const requiredKeys = [
      "run_id", "mr_id", "project_id", "diff", "files", "current_file",
      "file_contents", "context_chunks", "issues", "decisions",
      "review_report", "tool_calls", "risk_score", "plan",
      "iteration", "errors", "source_branch", "diff_refs",
    ];

    for (const key of requiredKeys) {
      assert.ok(CHANNELS[key], `Missing channel: ${key}`);
      assert.equal(typeof CHANNELS[key].value, "function", `Channel ${key}.value is not a function`);
    }
  });

  it("should have correct reducer semantics for append channels", () => {
    // issues, decisions, tool_calls, context_chunks, errors use append
    const appendKeys = ["issues", "decisions", "tool_calls", "context_chunks", "errors"];

    for (const key of appendKeys) {
      const reducer = CHANNELS[key].value;
      const prev = [{ id: 1 }];
      const next = [{ id: 2 }];
      const result = reducer(prev, next);
      assert.deepEqual(result, [{ id: 1 }, { id: 2 }], `${key} should append`);
    }
  });

  it("should have correct reducer semantics for overwrite channels", () => {
    const overwriteKeys = ["run_id", "mr_id", "project_id", "diff", "files", "current_file",
      "review_report", "risk_score", "plan", "iteration", "source_branch", "diff_refs"];

    for (const key of overwriteKeys) {
      const reducer = CHANNELS[key].value;
      const result = reducer("old", "new");
      assert.equal(result, "new", `${key} should overwrite`);
    }
  });

  it("should have correct reducer semantics for mergeRecord (file_contents)", () => {
    const reducer = CHANNELS.file_contents.value;
    const prev = { a: "content-a" };
    const next = { b: "content-b" };
    const result = reducer(prev, next);
    assert.deepEqual(result, { a: "content-a", b: "content-b" });
  });
});
