---
description: 实时展示当前会话的 token 速率与用量 / Live token rate & usage stats for this session
argument-hint: "[会话ID | list | session-id]"
allowed-tools: Bash, mcp__token-rate__token_rate
---

【中文】用户想查看 token 速率统计，参数：$ARGUMENTS（可能为空、会话 ID 或 list）。

1. 优先调用 MCP 工具 `token_rate`：参数为空 → 直接调用（当前会话）；`list` → 传 `list: true`；其他 → 作为 `session` 传入。
2. 若 MCP 工具不可用，用 Bash 定位并运行插件安装副本里的脚本（开发机上也可改用源码仓库路径）：

```bash
node "$(find ~/.zcode/cli/plugins/cache -ipath '*token-rate*token-stats.mjs' 2>/dev/null | head -1)" $ARGUMENTS
```

3. 呈现要求：原样保留返回的数字，不编造、不补全；用与当前对话一致的语言，按“生成速率 / 吞吐 / 累计用量 / 会话信息”小节展示；若用户问“现在生成有多快”，直接给“最近 5 次”的 tok/s 并说明该值不含工具执行间隙。

[English] The user wants token rate stats; arguments: $ARGUMENTS (empty, a session id, or "list").

1. Prefer the `token_rate` MCP tool: no args → current session; "list" → pass `list: true`; anything else → pass as `session`.
2. If the tool is unavailable, locate and run the script from the installed plugin copy via Bash (on a dev machine, a local clone path works too):

```bash
node "$(find ~/.zcode/cli/plugins/cache -ipath '*token-rate*token-stats.mjs' 2>/dev/null | head -1)" $ARGUMENTS
```

3. Present the returned numbers verbatim — never invent or pad data; reply in the conversation language with sections: generation rate / throughput / totals / session info. If asked "how fast right now", give the "last 5" tok/s and note it excludes tool-execution gaps.
