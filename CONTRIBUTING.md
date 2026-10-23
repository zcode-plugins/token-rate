# Contributing to Token Pulse / 贡献指南

English | [简体中文](#简体中文)

Thanks for your interest in improving Token Pulse!

## Getting started

```bash
git clone https://github.com/zcode-plugins/token-rate
cd token-rate
node scripts/smoke-test.mjs   # must pass before every commit
```

No npm dependencies are used by design — the plugin runs on plain Node.js (≥ 18) so it stays trivial to install anywhere ZCode runs.

## Repository layout

```
.zcode-plugin/plugin.json   plugin manifest (id, version, component pointers)
.mcp.json                   MCP server registration (runs scripts/mcp-server.mjs)
hooks/hooks.json            UserPromptSubmit hook definition
commands/token-rate.md      /token-rate slash command
scripts/token-stats.mjs     shared core: parsing, metrics, i18n, CLI (also used by the hook)
scripts/mcp-server.mjs      stdio MCP server exposing the token_rate tool
scripts/smoke-test.mjs      dependency-free smoke checks (run by CI)
marketplace.json            root marketplace manifest so this repo is a valid marketplace source
```

## Conventions

- **Versioning** — SemVer. Bump `.zcode-plugin/plugin.json`, keep the repo `marketplace.json` (and the parent dev marketplace's catalog) in sync, and add a `CHANGELOG.md` entry in the same change.
- **Language** — runtime user-visible strings live in the `L` dictionary in `scripts/token-stats.mjs` plus the description maps in `mcp-server.mjs`; update both `zh` and `en` together. Static texts (command, manifest) are bilingual by design.
- **No secrets, no telemetry, no network calls** — the plugin only reads local ZCode records (`~/.zcode/cli/db/db.sqlite` read-only, plus `~/.zcode/cli/rollout`). Keep it that way.
- **The hook must never block a session** — any failure path in hook mode stays silent with exit code 0.
- **Commit style** — short imperative subject line (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`).

## Pull requests

1. Fork / create a branch, make your change.
2. Run `node scripts/smoke-test.mjs` — all checks green.
3. Open a PR against `main` following the template; CI must pass.

## Reporting bugs

Open an issue using the bug report template. 中文反馈同样欢迎。

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

---

## 简体中文

感谢你为 Token 脉冲贡献代码！

- 克隆仓库后运行 `node scripts/smoke-test.mjs`，提交前必须全绿；本插件**零 npm 依赖**，仅需 Node.js ≥ 18（DB 数据源需运行时支持 `node:sqlite`，缺失时自动回退 JSONL）。
- **版本**：遵循 SemVer；同时更新 `.zcode-plugin/plugin.json`、根 `marketplace.json`（以及上级 dev marketplace 的 `marketplace.json`）并补充 `CHANGELOG.md`。
- **语言**：运行时文案集中在 `scripts/token-stats.mjs` 的 `L` 字典与 `mcp-server.mjs` 的描述表，中英文必须成对更新；静态文本保持中英并列。
- **红线**：不引入密钥、遥测或网络请求（只读 `~/.zcode/cli/db/db.sqlite` 与 `~/.zcode/cli/rollout` 本地记录）；hook 失败必须静默（退出码 0），绝不阻塞会话。
- **提交**：`feat:` / `fix:` / `docs:` / `ci:` / `chore:` 简洁祈使句。
- PR 请基于 `main` 分支并使用模板；CI 通过是合入前提。提交即表示同意以 [MIT](LICENSE) 授权。
