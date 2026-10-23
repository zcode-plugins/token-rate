# Token Pulse

English | [简体中文](README.zh-CN.md)

Real-time token rate & usage monitor for [ZCode](https://zhipu-ai.github.io/ZCode/) coding sessions.

[![CI](https://github.com/zcode-plugins/token-rate/actions/workflows/ci.yml/badge.svg)](https://github.com/zcode-plugins/token-rate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![ZCode Plugin](https://img.shields.io/badge/ZCode-plugin-7c3aed)](.zcode-plugin/plugin.json)
[![Version](https://img.shields.io/badge/version-0.2.5-green)](CHANGELOG.md)

Token Pulse reads ZCode's local session records (`~/.zcode/cli/rollout/model-io-session_*.jsonl`), which log the token usage and wall time of every model call, and turns them into live metrics:

- **Generation rate** — output tokens ÷ model call duration, excluding tool-execution gaps. This is "how fast the model is writing right now".
- **Throughput** — tokens per second over a sliding wall-clock window (default 10 min), including tool gaps.
- **Cumulative usage** — input (with cache-hit ratio and fresh tokens), output (with reasoning tokens), totals, call count and session duration.

## Features

- **Reply-tail rate line** — a `UserPromptSubmit` hook injects fresh stats with every message, and the agent appends a one-line summary at the end of each reply. You see the current rate without asking.
- **`token_rate` MCP tool** — on-demand full report for the current or any historical session; `list: true` enumerates sessions.
- **`/token-rate` slash command** — one-keystroke report with a consistent layout.
- **Bilingual output** — all user-visible output follows one 3-tier language detection: `TOKEN_RATE_LANG` env → `locale`/`language` key in `~/.zcode/cli/config.json` → system locale (`zh*` → Chinese, else English).
- **Fail-safe by design** — the hook never blocks the session: any error is swallowed silently and the turn proceeds.

> Note: ZCode currently has no in-app status-bar extension point (no `statusLine` setting, no extension host, plugin UI fields are recorded but not executed). That is why Token Pulse ships conversation-level entries only — there is deliberately no on-screen persistent overlay.

## Requirements

- ZCode desktop client
- Node.js ≥ 18 on `PATH` (used by the MCP server and the hook)

## Installation

**From this repository (GitHub marketplace source)** — the repo root contains a `marketplace.json`, so it can be added directly as a plugin marketplace:

1. Open **Plugin Marketplace → Add → Add Plugin Marketplace**.
2. Paste `https://github.com/zcode-plugins/token-rate`.
3. Find **Token Pulse** under **Personal** and click **Install**.

**Local development** — clone the repo, then add its parent directory (which contains the dev `marketplace.json`) as a marketplace, and install/update from there.

## Usage

| Entry | What you get |
| --- | --- |
| Send any message | A rate line appears at the end of each reply: `[token-rate] ⚡gen 64.4 tok/s (avg 49.2) · …` |
| `/token-rate` | Full report: generation rate / throughput / totals / session info |
| `/token-rate list` | Enumerate historical sessions |
| `/token-rate <session-id>` | Report for a specific session |

Or simply ask "how fast right now?" — the injected stats let the agent answer directly.

## Metrics reference

| Metric | Definition |
| --- | --- |
| Generation rate (tok/s) | `Σ output tokens ÷ Σ model-call durations`. "Recent" = last 5 calls; "peak" considers calls ≥ 2 s |
| Throughput (tok/s) | Tokens per wall-clock second inside the window (default 10 min), tool gaps included |
| Cache hit | `cacheReadTokens ÷ inputTokens` (`inputTokens` includes cache reads) |
| Output | `outputTokens`, which already includes `reasoningTokens` |

## Data source & privacy

All metrics are computed from local files under `~/.zcode/cli/rollout`. The plugin makes **no network requests** and sends data nowhere. The MCP server runs locally via stdio; the hook script runs with an 8 s timeout and exits silently on any failure.

## Development

```bash
git clone https://github.com/zcode-plugins/token-rate
cd token-rate
node scripts/smoke-test.mjs   # 9 checks: syntax, MCP handshake, isolated hook/CLI behavior
```

CI runs the same smoke matrix (Node 20 / 22) on every push and pull request.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the layout, versioning and release conventions.

## License

[MIT](LICENSE) © zcode-plugins
