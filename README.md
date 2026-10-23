# Token Pulse (token-rate)

在 ZCode 会话中实时展示 token 速率与用量。数据源为本机 `~/.zcode/cli/rollout/model-io-session_<sessionId>.jsonl`（每次模型调用的 usage 与耗时记录），随会话进行实时更新。

> 说明：ZCode 客户端目前没有应用内状态栏扩展点（无 statusLine 配置、无 VS Code 扩展宿主、插件 UI 字段”记录但不执行”），因此本插件只提供会话内入口，不含界面常驻元素。

## 安装 / Install

- **GitHub**（`zcode-plugins/token-rate`）：插件市场 → 添加 → 添加插件市场，粘贴仓库地址 `https://github.com/zcode-plugins/token-rate`。仓库根目录含 `marketplace.json`（插件 `source: “./”`），可整仓作为市场源；该安装路径以 ZCode 实际支持为准。
- **本地开发**：`<workspace>/plugins/marketplace.json`（市场名 `dev-ods-72371c6c`）指向本目录。

## 三个使用入口

1. **MCP 工具 `token_rate`**（agent 可随时调用）
   - 无参数：统计当前/最新会话
   - `list: true`：列出本机历史会话
   - `session: “<id>”` / `windowMinutes: 30`：指定会话与吞吐窗口
2. **斜杠命令 `/token-rate`**：让 agent 调用上面的工具并按固定版式汇报（支持参数，如 `/token-rate list`）
3. **UserPromptSubmit hook**：每次用户发送消息时静默统计，把一行速率摘要注入会话上下文（agent 被问”现在多快”时可直接回答）；任何失败都静默跳过，绝不阻塞会话

## 指标口径

- **生成速率（tok/s）**：`Σ输出token / Σ模型调用耗时`，不含工具执行间隙；”峰值”仅统计耗时 ≥2s 的调用
- **吞吐（tok/s）**：窗口内（默认 10 分钟）墙钟速率，含工具间隙
- **输入缓存命中率**：`cacheReadTokens / inputTokens`（inputTokens 含缓存读）
- **输出含思考 token**（reasoningTokens 计入 outputTokens）

## 本地调试

```bash
node scripts/token-stats.mjs            # 当前/最新会话报告
node scripts/token-stats.mjs --json     # JSON 输出
node scripts/token-stats.mjs --list     # 历史会话
node scripts/token-stats.mjs --hook     # hook 模式（输出 {“additionalContext”:...}）
CLAUDE_SESSION_ID=session_xxx node scripts/token-stats.mjs
powershell -File scripts/token-bar.ps1 -TestOnce   # 悬浮条统计逻辑单测
```

依赖：Node.js（MCP 服务器与 hook 通过 `node` 启动）。

## 输出语言 / Output language

全部用户可见输出（hook 行、报告、会话列表、错误信息、MCP 工具与参数描述）统一按三级探测选择语言：

1. 环境变量 `TOKEN_RATE_LANG`（`zh` / `en`，手动覆盖）
2. `~/.zcode/cli/config.json` 的 `locale` / `language` 键（当前版本 ZCode 未写入；出现后自动优先）
3. 系统 locale（`zh*` → 中文，否则英文）

静态文本保持双语一致：`/token-rate` 命令描述与正文、AGENTS.md 规则、清单描述均为中英并列，不随运行时切换。

All user-visible output (hook line, report, session list, errors, MCP tool & parameter descriptions) picks one language via: `TOKEN_RATE_LANG` env → `locale`/`language` key in `~/.zcode/cli/config.json` → system locale (`zh*` → Chinese, else English). Static texts (command description/body, AGENTS.md rule, manifest description) are bilingual by design.

