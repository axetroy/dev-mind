#!/usr/bin/env node

/**
 * dev-mind CLI 入口
 *
 * 用于命令行直接触发 review，适合开发和 CI 环境。
 *
 * Usage:
 *   node src/cli.js --project <project_id> --mr <mr_iid>
 *
 * Examples:
 *   node src/cli.js --project axetroy/dev-mind --mr 1
 *   GITLAB_TOKEN=xxx node src/cli.js -p 123456 -m 1
 */

import { runReview } from "./graph/index.js";
import { getConfig } from "./config.js";

function printUsage() {
  console.log(`
Usage:
  node src/cli.js --project <project_id> --mr <mr_iid>

Options:
  -p, --project   GitLab project ID (数字或 namespace/project)
  -m, --mr        Merge Request IID
  -h, --help      Show this help

Environment:
  GITLAB_URL      GitLab instance URL (default: https://gitlab.com)
  GITLAB_TOKEN    GitLab Personal Access Token (required)
  OPENAI_API_KEY  OpenAI API Key (or ANTHROPIC_API_KEY)
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "-p":
      case "--project":
        opts.project = args[++i];
        break;
      case "-m":
      case "--mr":
        opts.mr = args[++i];
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!opts.project || !opts.mr) {
    console.error("Error: --project and --mr are required");
    printUsage();
    process.exit(1);
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  console.log(`🧠 dev-mind CLI — Reviewing !${opts.mr} in ${opts.project}`);
  console.log("");

  const startTime = Date.now();

  try {
    const finalState = await runReview({
      projectId: opts.project,
      mrIid: opts.mr,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✅ Review complete (${elapsed}s)`);
    console.log(`   Issues found: ${finalState.issues.length}`);
    console.log(`   Risk score:   ${finalState.risk_score ?? "N/A"}`);
    console.log("");

    if (finalState.review_report) {
      console.log("── Review Report ───────────────────────────────────────");
      console.log(finalState.review_report);
    }
  } catch (err) {
    console.error("❌ Review failed:", err.message);
    process.exit(1);
  }
}

main();
