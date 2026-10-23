# Token 脉冲（Token Pulse）

[English](README.md) | 简体中文

[ZCode](https://zhipu-ai.github.io/ZCode/) 会话的实时 Token 速率与用量监视器。

[![CI](https://github.com/zcode-plugins/token-rate/actions/workflows/ci.yml/badge.svg)](https://github.com/zcode-plugins/token-rate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![ZCode Plugin](https://img.shields.io/badge/ZCode-plugin-7c3aed)](.zcode-plugin/plugin.json)
[![Version](https://img.shields.io/badge/version-0.2.5-green)](CHANGELOG.md)

Token 脉冲读取 ZCode 的本地会话记录（`~/.zcode/cli/rollout/model-io-session_*.jsonl`，其中记载了每次模型调用的 token 用量与耗时），并将其转化为实时指标：

- **生成速率** —— 输出 token ÷ 模型调用耗时，不含工具执行间隙，即"模型此刻写得多快"。
- **吞吐** —— 滑动窗口（默认 10 分钟）内按墙钟时间计算的每秒 token 数，含工具间隙。
- **累计用量** —— 输入（含缓存命中率与新增 token）、输出（含思考 token）、合计、调用次数与会话时长。

## 功能特性

- **回复尾部的速率行** —— `UserPromptSubmit` hook 随每条消息注入最新统计，由 agent 在每轮回复结尾追加一行摘要，无需询问即可看到当前速率。
- **`token_rate` MCP 工具** —— 按需输出当前会话或任一历史会话的完整报告；`list: true` 枚举历史会话。
- **`/token-rate` 斜杠命令** —— 一键获取版式统一的完整报告。
- **中英双语输出** —— 全部用户可见输出走同一套三级语言探测：`TOKEN_RATE_LANG` 环境变量 → `~/.zcode/cli/config.json` 的 `locale`/`language` 键 → 系统 locale（`zh*` 中文，否则英文）。
- **默认不影响会话** —— hook 任何错误都静默跳过，绝不阻塞会话。

> 说明：ZCode 客户端目前没有应用内状态栏扩展点（无 `statusLine` 配置、无扩展宿主、插件 UI 字段"记录但不执行"），因此本插件只提供会话内入口，也不提供常驻屏幕的悬浮窗。

## 环境要求

- ZCode 桌面客户端
- `PATH` 中有 Node.js ≥ 18（MCP 服务器与 hook 通过 `node` 启动）

## 安装

**从本仓库安装（GitHub 市场源）** —— 仓库根目录含 `marketplace.json`，可直接作为插件市场添加：

1. 打开 **插件市场 → 添加 → 添加插件市场**；
2. 粘贴 `https://github.com/zcode-plugins/token-rate`；
3. 在 **个人** 中找到 **Token 脉冲**，点击 **安装**。

**本地开发** —— 克隆仓库后，把包含开发用 `marketplace.json` 的上级目录作为市场添加，再从那里安装/更新。

## 使用

| 入口 | 效果 |
| --- | --- |
| 正常发送消息 | 每轮回复结尾出现速率行：`[token-rate] ⚡生成 64.4 tok/s（均值 49.2）· …` |
| `/token-rate` | 完整报告：生成速率 / 吞吐 / 累计用量 / 会话信息 |
| `/token-rate list` | 枚举历史会话 |
| `/token-rate <会话ID>` | 查看指定会话 |

也可以直接问"现在多快"——注入的统计让 agent 能立即作答。

## 指标口径

| 指标 | 定义 |
| --- | --- |
| 生成速率（tok/s） | `Σ 输出 token ÷ Σ 模型调用耗时`。"最近"取最近 5 次；"峰值"仅统计耗时 ≥ 2 秒的调用 |
| 吞吐（tok/s） | 窗口内（默认 10 分钟）按墙钟时间每秒 token 数，含工具间隙 |
| 缓存命中 | `cacheReadTokens ÷ inputTokens`（`inputTokens` 含缓存读） |
| 输出 | `outputTokens`，其中已包含 `reasoningTokens` |

## 数据来源与隐私

所有指标均来自 `~/.zcode/cli/rollout` 下的本地文件计算。插件**不发起任何网络请求**，数据不出本机；MCP 服务器通过 stdio 本地运行；hook 脚本限时 8 秒，任何失败静默退出。

## 开发

```bash
git clone https://github.com/zcode-plugins/token-rate
cd token-rate
node scripts/smoke-test.mjs   # 9 项检查：语法、MCP 握手、隔离环境下的 hook/CLI 行为
```

CI 会在每次 push 与 pull request 上运行同一组冒烟测试（Node 20 / 22 矩阵）。

目录结构、版本与发布约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © zcode-plugins
