#!/usr/bin/env node
// token-rate MCP 服务器（stdio，JSON-RPC 2.0 / MCP 协议）。
// 暴露工具 token_rate：当前/指定 ZCode 会话的 token 用量与速率统计，
// 数据实时来自 ~/.zcode/cli/rollout 的 model_io 会话记录。
import { createInterface } from "node:readline";
import {
  detectLang,
  resolveRolloutFile,
  readRecords,
  computeStats,
  formatReport,
  formatSessionList,
  listSessions,
  loadSettings,
} from "./token-stats.mjs";

const LANG = detectLang();
const SETTINGS = loadSettings();
const SERVER_INFO = { name: "token-rate", version: "0.3.0" };

const TOOL_DESC = {
  zh: "实时统计 ZCode 会话的 token 用量与速率：生成速率（tok/s，纯模型输出）、吞吐（墙钟）、累计输入/输出、缓存命中率、思考 token、会话时长。数据来自本机 ~/.zcode/cli/rollout 的会话记录，随会话进行实时更新。",
  en: "Live token usage & rate stats for the current ZCode session: generation rate (tok/s, pure model output), throughput (wall clock), cumulative in/out tokens, cache hit ratio, reasoning tokens, and session duration. Computed from local session records in ~/.zcode/cli/rollout, updated in real time.",
};

const ERR_TEXT = {
  zh: { notFound: (s) => `找不到会话记录${s ? `：${s}` : ""}。可用 list: true 查看历史会话。`, noUsage: (f) => `会话文件没有可用的 usage 记录：${f}`, prefix: "错误：" },
  en: { notFound: (s) => `Session record not found${s ? `: ${s}` : ""}. Use list: true to see available sessions.`, noUsage: (f) => `No usable usage records in session file: ${f}`, prefix: "Error: " },
};

const PARAM_DESC = {
  zh: {
    session: "会话 ID（可先用 list=true 查看）。默认：环境变量中的当前会话，否则最新的会话。",
    window: `吞吐统计的时间窗口（分钟），默认取插件设置（当前 ${SETTINGS.windowMinutes}）。`,
    list: "为 true 时不做统计，列出本机可用的历史会话。",
  },
  en: {
    session: "Session id (run list=true first to see them). Default: the current session from the environment, else the newest.",
    window: `Throughput window in minutes, defaults to the plugin setting (currently ${SETTINGS.windowMinutes}).`,
    list: "When true, skip stats and list available sessions.",
  },
};

const TOKEN_RATE_TOOL = {
  name: "token_rate",
  description: TOOL_DESC[LANG] ?? TOOL_DESC.zh,
  inputSchema: {
    type: "object",
    properties: {
      session: {
        type: "string",
        description: (PARAM_DESC[LANG] ?? PARAM_DESC.zh).session,
      },
      windowMinutes: {
        type: "number",
        description: (PARAM_DESC[LANG] ?? PARAM_DESC.zh).window,
      },
      list: {
        type: "boolean",
        description: (PARAM_DESC[LANG] ?? PARAM_DESC.zh).list,
      },
    },
    additionalProperties: false,
  },
};

function listText() {
  const sessions = listSessions();
  if (!sessions.length) return LANG === "en" ? "No session records found (~/.zcode/cli/rollout is empty)." : "没有找到会话记录（~/.zcode/cli/rollout 为空）。";
  return formatSessionList(sessions, LANG);
}

async function callTokenRate(args = {}) {
  const E = ERR_TEXT[LANG] ?? ERR_TEXT.zh;
  if (args.list) return listText();
  const file = resolveRolloutFile(args.session);
  if (!file) {
    throw new Error(E.notFound(args.session));
  }
  const stats = computeStats(await readRecords(file), args.windowMinutes ?? SETTINGS.windowMinutes);
  if (!stats) throw new Error(E.noUsage(file));
  return formatReport(stats, file, LANG);
}

function rpcReply(id, payload) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...payload }) + "\n");
}

for await (const line of createInterface({ input: process.stdin })) {
  const raw = line.trim();
  if (!raw) continue;
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    continue; // 无效行直接忽略
  }
  if (message.id === undefined) continue; // 通知（如 initialized）无需响应

  try {
    if (message.method === "initialize") {
      rpcReply(message.id, {
        result: {
          protocolVersion: message.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      });
    } else if (message.method === "tools/list") {
      rpcReply(message.id, { result: { tools: [TOKEN_RATE_TOOL] } });
    } else if (message.method === "tools/call") {
      try {
        const text = await callTokenRate(message.params?.arguments);
        rpcReply(message.id, {
          result: { content: [{ type: "text", text }] },
        });
      } catch (e) {
        rpcReply(message.id, {
          result: {
            content: [{ type: "text", text: `${(ERR_TEXT[LANG] ?? ERR_TEXT.zh).prefix}${e?.message || e}` }],
            isError: true,
          },
        });
      }
    } else if (message.method === "ping") {
      rpcReply(message.id, { result: {} });
    } else {
      rpcReply(message.id, {
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });
    }
  } catch (e) {
    rpcReply(message.id, { error: { code: -32603, message: String(e?.message || e) } });
  }
}
