#!/usr/bin/env node
// token-rate 核心统计模块 + CLI。
// 数据源（按优先级）：
//   1. ~/.zcode/cli/db/db.sqlite 的 model_usage 表：ZCode 运行时的正常记账数据，
//      每次模型请求一行，含 first_token_at / time_to_first_token_ms；不需要开发者工具面板。
//   2. ~/.zcode/cli/rollout/model-io-session_<sessionId>.jsonl：旧版 ZCode 或当前 Node
//      不支持 node:sqlite 时的回退。每行一条 model_io 记录。
// 可用 TOKEN_RATE_SOURCE=db|jsonl|auto（或 --source）强制指定，默认 auto（DB 优先）。
// 被 CLI（默认/--json/--list）、hook（--hook，输出严格 JSON additionalContext）、
// 以及 scripts/mcp-server.mjs（MCP 工具 token_rate）共用。
// 插件设置（plugin.json userConfig）：用户在客户端“插件详情 → Advanced”里填写，
// 持久化于 ~/.zcode/cli/config.json 的 plugins.options["token-rate@<市场>"]；
// 读取优先级 TOKEN_RATE_* 环境变量 > plugins.options > userConfig 默认值。
// 输出语言：TOKEN_RATE_LANG 环境变量 > config.json 的 ui.locale（ZCode 界面语言）> 系统 locale。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROLLOUT_DIR = path.join(os.homedir(), '.zcode', 'cli', 'rollout');
const DB_PATH = path.join(path.dirname(ROLLOUT_DIR), 'db', 'db.sqlite');
const RECENT_CALLS = 5; // “最近速率”取最近 N 次模型调用
const SOURCE_AUTO = 'auto';
const SOURCE_DB = 'db';
const SOURCE_JSONL = 'jsonl';

// node:sqlite 是 Node 22.5+ 的实验特性（22.13+/23.4+ 默认可用）。老版本 Node 上
// require 会抛错，此时 loadSqlite() 返回 null，所有 DB 读取自动回退到 rollout JSONL。
let sqliteModule; // undefined=未探测，null=不可用
function loadSqlite() {
  if (sqliteModule !== undefined) return sqliteModule;
  try {
    const { DatabaseSync } = require('node:sqlite');
    sqliteModule = { DatabaseSync };
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

// hook 的 stdin JSON 里有 session_id；优先使用它，避免新会话首轮误读上一个会话。
let runtimeSessionId = null;
export function setRuntimeSessionId(id) {
  runtimeSessionId = id ? String(id).trim() : null;
}
function currentSessionId() {
  return runtimeSessionId || process.env.CLAUDE_SESSION_ID || process.env.ZCODE_SESSION_ID || null;
}

let cachedConfig; // undefined=未读，null=读取失败
function readZcodeConfig() {
  if (cachedConfig === undefined) {
    try {
      cachedConfig = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.zcode', 'cli', 'config.json'), 'utf8'));
    } catch {
      cachedConfig = null;
    }
  }
  return cachedConfig;
}

// 插件配置值挂在 plugins.options["token-rate@<市场ID"] 下，市场 ID 与安装来源有关，按前缀匹配。
function pluginOptions(cfg) {
  const options = cfg?.plugins?.options;
  if (!options || typeof options !== 'object') return null;
  const key = Object.keys(options).find((k) => /^token-rate@/.test(k));
  return key ? options[key] : null;
}

export const DEFAULT_SETTINGS = {
  injectLine: true, // 是否每轮注入速率行
  lineStyle: 'compact', // compact=极简一行 | detailed=完整统计
  windowMinutes: 10, // 吞吐滑动窗口（分钟）
  language: 'auto', // auto=跟随 ZCode 界面语言 | zh | en
};

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  const o = pluginOptions(readZcodeConfig());
  if (o && typeof o === 'object') {
    if (typeof o.inject_line === 'boolean') s.injectLine = o.inject_line;
    // detailed_line 是设置页的开关；line_style 是旧版文本键，继续兼容已保存的值。
    if (typeof o.detailed_line === 'boolean') s.lineStyle = o.detailed_line ? 'detailed' : 'compact';
    else if (typeof o.line_style === 'string' && o.line_style.trim()) s.lineStyle = o.line_style.trim().toLowerCase();
    const w = Number(o.window_minutes);
    if (Number.isFinite(w) && w > 0) s.windowMinutes = w;
    if (typeof o.language === 'string' && o.language.trim()) s.language = o.language.trim().toLowerCase();
  }
  // 环境变量覆盖（无 UI 或脚本化场景）
  const inject = String(process.env.TOKEN_RATE_INJECT || '').trim().toLowerCase();
  if (['0', 'false', 'off'].includes(inject)) s.injectLine = false;
  if (['1', 'true', 'on'].includes(inject)) s.injectLine = true;
  const style = String(process.env.TOKEN_RATE_STYLE || '').trim().toLowerCase();
  if (style) s.lineStyle = style;
  const envWin = Number(process.env.TOKEN_RATE_WINDOW);
  if (Number.isFinite(envWin) && envWin > 0) s.windowMinutes = envWin;
  if (s.lineStyle !== 'detailed') s.lineStyle = 'compact'; // 未知取值一律回退 compact
  return s;
}

// ZCode 界面语言持久化在 config.json 的 ui.locale（zh-CN / en-US / auto）。
// auto 时按 ZCode 自身的解析顺序回退：LC_ALL / LC_MESSAGES / LANG / LANGUAGE → 系统 locale。
function systemLang() {
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE']) {
    const raw = String(process.env[key] || '').trim();
    if (!raw) continue;
    const parts = key === 'LANGUAGE' ? raw.split(':') : [raw];
    for (const part of parts) {
      const l = part.trim().toLowerCase();
      if (l.startsWith('zh')) return 'zh';
      if (l.startsWith('en')) return 'en';
    }
  }
  const loc = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
  return loc.startsWith('zh') ? 'zh' : 'en';
}

export function detectLang() {
  const env = (process.env.TOKEN_RATE_LANG || '').trim().toLowerCase();
  if (env.startsWith('zh')) return 'zh';
  if (env.startsWith('en')) return 'en';
  // 插件设置 language：zh / en 强制指定；auto（默认）继续跟随 ZCode 界面语言。
  const setting = String(pluginOptions(readZcodeConfig())?.language || '').trim().toLowerCase();
  if (setting.startsWith('zh')) return 'zh';
  if (setting.startsWith('en')) return 'en';
  const ui = String(readZcodeConfig()?.ui?.locale || '').trim().toLowerCase();
  if (ui.startsWith('zh')) return 'zh';
  if (ui.startsWith('en')) return 'en';
  return systemLang();
}

export function normalizeSessionId(id) {
  return String(id || '')
    .replace(/^session_/i, '')
    .replace(/-/g, '')
    .trim();
}

function sessionCandidate(id) {
  return path.join(ROLLOUT_DIR, `model-io-session_${normalizeSessionId(id)}.jsonl`);
}

function newestRolloutFile() {
  if (!fs.existsSync(ROLLOUT_DIR)) return null;
  const files = fs
    .readdirSync(ROLLOUT_DIR)
    .filter((f) => /^model-io-session_.+\.jsonl$/.test(f))
    .map((f) => ({ f, m: fs.statSync(path.join(ROLLOUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? path.join(ROLLOUT_DIR, files[0].f) : null;
}

// session 为空：优先环境变量里的当前会话，其次最新修改的 rollout 文件（即活动会话）。
// 显式传入但找不到时返回 null（CLI 据此报错）。
export function resolveRolloutFile(session) {
  if (session) {
    const s = String(session);
    if (fs.existsSync(s) && fs.statSync(s).isFile()) return s;
    return fs.existsSync(sessionCandidate(s)) ? sessionCandidate(s) : null;
  }
  const env = currentSessionId();
  if (env && fs.existsSync(sessionCandidate(env))) return sessionCandidate(env);
  return newestRolloutFile();
}

export async function readRecords(file) {
  const records = [];
  const rl = createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      continue; // 半行写入等损坏行直接跳过
    }
    const usage = rec.usage ?? rec.response?.usage;
    if (!usage || !rec.startedAt) continue;
    const t0 = Date.parse(rec.startedAt);
    if (!Number.isFinite(t0)) continue;
    const t1 = Number.isFinite(Date.parse(rec.completedAt)) ? Date.parse(rec.completedAt) : t0;
    const dur = Number.isFinite(rec.durationMs) ? rec.durationMs : Math.max(t1 - t0, 0);
    records.push({
      t0,
      t1,
      dur,
      model: rec.model?.modelId ?? rec.response?.modelId ?? 'unknown',
      in: usage.inputTokens ?? 0,
      cache: usage.cacheReadTokens ?? 0,
      out: usage.outputTokens ?? 0,
      reasoning: usage.reasoningTokens ?? 0,
      total: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    });
  }
  return records;
}

// ---------- SQLite 数据源（model_usage） ----------

function dbSessionId(id) {
  const s = String(id || '').trim();
  if (/^(session_|sess_)/i.test(s)) return s;
  return `session_${normalizeSessionId(s)}`;
}

function openDb() {
  const sqlite = loadSqlite();
  if (!sqlite || !fs.existsSync(DB_PATH)) return null;
  try {
    const db = new sqlite.DatabaseSync(DB_PATH, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 2000');
    return db;
  } catch {
    return null;
  }
}

// 读取某个会话的全部模型调用。字段名做兼容探测：旧/新版本 schema 缺列时回退默认值。
function readDbRecords(sessionId) {
  const db = openDb();
  if (!db) return null;
  try {
    const cols = new Set(db.prepare('PRAGMA table_info(model_usage)').all().map((c) => c.name));
    if (!['session_id', 'started_at', 'input_tokens', 'output_tokens'].every((c) => cols.has(c))) return null;
    const col = (name, fallback) => (cols.has(name) ? name : `${fallback} AS ${name}`);
    const rows = db
      .prepare(
        `SELECT started_at,
                ${col('completed_at', 'NULL')},
                ${col('duration_ms', 'NULL')},
                ${col('model_id', "'unknown'")},
                ${col('input_tokens', '0')},
                ${col('output_tokens', '0')},
                ${col('reasoning_tokens', '0')},
                ${col('cache_read_input_tokens', '0')},
                ${col('computed_total_tokens', 'NULL')},
                ${col('first_token_at', 'NULL')},
                ${col('time_to_first_token_ms', 'NULL')},
                ${col('status', "'completed'")}
           FROM model_usage
          WHERE session_id = ?
          ORDER BY started_at ASC`,
      )
      .all(sessionId);
    const records = [];
    for (const r of rows) {
      if (!Number.isFinite(r.started_at)) continue;
      const inTok = Number.isFinite(r.input_tokens) ? r.input_tokens : 0;
      const outTok = Number.isFinite(r.output_tokens) ? r.output_tokens : 0;
      // 取消/失败的请求通常是 0 用量；保留有部分用量的行，避免丢掉真实消耗。
      if (r.status && r.status !== 'completed' && inTok === 0 && outTok === 0) continue;
      const t0 = r.started_at;
      const dur = Number.isFinite(r.duration_ms) ? r.duration_ms : Math.max((r.completed_at || t0) - t0, 0);
      const t1 = Number.isFinite(r.completed_at) ? r.completed_at : t0 + dur;
      records.push({
        t0,
        t1,
        dur,
        model: r.model_id || 'unknown',
        in: inTok,
        cache: Number.isFinite(r.cache_read_input_tokens) ? r.cache_read_input_tokens : 0,
        out: outTok,
        reasoning: Number.isFinite(r.reasoning_tokens) ? r.reasoning_tokens : 0,
        total: Number.isFinite(r.computed_total_tokens) ? r.computed_total_tokens : inTok + outTok,
        firstTokenAt: Number.isFinite(r.first_token_at) ? r.first_token_at : null,
        ttftMs: Number.isFinite(r.time_to_first_token_ms) ? r.time_to_first_token_ms : null,
      });
    }
    return records;
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

function newestDbSession() {
  const db = openDb();
  if (!db) return null;
  try {
    const row = db
      .prepare('SELECT session_id FROM model_usage GROUP BY session_id ORDER BY MAX(completed_at) DESC LIMIT 1')
      .get();
    return row?.session_id ?? null;
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

function normalizeSource(value) {
  const s = String(value || '').trim().toLowerCase();
  return s === SOURCE_DB || s === SOURCE_JSONL ? s : SOURCE_AUTO;
}

// 统一的会话数据加载：DB 优先，rollout JSONL 回退。
// 指定了 session 但两边都没有记录时返回 null，绝不回退到“最新会话”，避免显示别人的数据。
export async function loadRecords(session, options = {}) {
  const requested = session ? String(session).trim() : '';
  const source = normalizeSource(options.source ?? process.env.TOKEN_RATE_SOURCE);

  if (requested && fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return { records: await readRecords(requested), file: requested, source: SOURCE_JSONL };
  }

  const explicitId = requested || currentSessionId();
  if (explicitId) {
    if (source !== SOURCE_JSONL) {
      const records = readDbRecords(dbSessionId(explicitId));
      if (records && records.length) return { records, file: DB_PATH, source: SOURCE_DB };
      if (source === SOURCE_DB) return null;
    }
    if (source !== SOURCE_DB) {
      const file = resolveRolloutFile(explicitId);
      if (file) return { records: await readRecords(file), file, source: SOURCE_JSONL };
    }
    return null;
  }

  if (source !== SOURCE_JSONL) {
    const newest = newestDbSession();
    if (newest) {
      const records = readDbRecords(newest);
      if (records && records.length) return { records, file: DB_PATH, source: SOURCE_DB };
    }
    if (source === SOURCE_DB) return null;
  }
  const file = newestRolloutFile();
  if (file) return { records: await readRecords(file), file, source: SOURCE_JSONL };
  return null;
}

// hook 的 stdin JSON：{ session_id, hook_event_name, cwd, ... }
function readHookInput() {
  try {
    if (process.stdin.isTTY) return null;
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return null;
    const input = JSON.parse(raw);
    return input && typeof input === 'object' ? input : null;
  } catch {
    return null;
  }
}

export function computeStats(records, windowMinutes = 10) {
  if (!records.length) return null;
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const inSum = sum(records, 'in');
  const cacheSum = sum(records, 'cache');
  const outSum = sum(records, 'out');
  const totalSum = sum(records, 'total');
  const durSum = sum(records, 'dur');
  const first = records[0];
  const last = records[records.length - 1];

  // 纯生成速率：输出 token / 模型调用耗时（不含工具执行间隙）
  const genAvg = durSum > 0 ? outSum / (durSum / 1000) : 0;
  const recentRecs = records.filter((r) => r.dur >= 500).slice(-RECENT_CALLS);
  const recentDur = sum(recentRecs, 'dur');
  const genRecent = recentDur > 0 ? sum(recentRecs, 'out') / (recentDur / 1000) : 0;
  let peak = 0;
  for (const r of records) {
    if (r.dur >= 2000) peak = Math.max(peak, r.out / (r.dur / 1000));
  }

  // 吞吐速率：窗口内墙钟时间（含工具间隙）
  const cutoff = last.t1 - windowMinutes * 60000;
  const winRecs = records.filter((r) => r.t1 >= cutoff);
  const winBase = winRecs.length ? winRecs : [last];
  const winStart = Math.min(...winBase.map((r) => r.t0));
  let denom = last.t1 - winStart;
  if (denom < 1000) denom = sum(winBase, 'dur');
  const thrOut = denom > 0 ? sum(winBase, 'out') / (denom / 1000) : 0;
  const thrTotal = denom > 0 ? sum(winBase, 'total') / (denom / 1000) : 0;

  const models = {};
  for (const r of records) {
    const m = (models[r.model] ??= { calls: 0, in: 0, out: 0 });
    m.calls++;
    m.in += r.in;
    m.out += r.out;
  }

  return {
    calls: records.length,
    windowMinutes,
    totals: {
      input: inSum,
      cacheRead: cacheSum,
      freshInput: inSum - cacheSum,
      cacheHitPct: inSum > 0 ? (cacheSum / inSum) * 100 : 0,
      output: outSum,
      reasoning: sum(records, 'reasoning'),
      total: totalSum,
    },
    spanMs: Math.max(last.t1 - first.t0, 0),
    firstAt: new Date(first.t0).toISOString(),
    lastAt: new Date(last.t1).toISOString(),
    generation: { avgTps: genAvg, recentTps: genRecent, peakTps: peak },
    throughput: { outTps: thrOut, totalTps: thrTotal, windowCalls: winBase.length },
    models,
  };
}

function listRolloutSessions() {
  if (!fs.existsSync(ROLLOUT_DIR)) return [];
  return fs
    .readdirSync(ROLLOUT_DIR)
    .filter((f) => /^model-io-session_.+\.jsonl$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(ROLLOUT_DIR, f));
      return { id: f.replace(/^model-io-session_/, '').replace(/\.jsonl$/, ''), mtimeMs: st.mtimeMs, sizeBytes: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function listDbSessions() {
  const db = openDb();
  if (!db) return null;
  try {
    const rows = db
      .prepare(
        `SELECT s.id,
                s.title,
                s.time_updated,
                COUNT(m.id) AS calls,
                MAX(m.completed_at) AS last_used
           FROM session s
           LEFT JOIN model_usage m ON m.session_id = s.id
          WHERE s.time_deleted IS NULL
            AND s.parent_id IS NULL
          GROUP BY s.id
         HAVING COUNT(m.id) > 0
          ORDER BY COALESCE(MAX(m.completed_at), s.time_updated) DESC
          LIMIT 50`,
      )
      .all();
    if (!rows.length) return null;
    return rows.map((r) => ({
      id: r.id,
      mtimeMs: r.last_used || r.time_updated || 0,
      sizeBytes: 0,
      title: String(r.title || '').replace(/\s+/g, ' ').trim(),
      calls: r.calls,
    }));
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// 历史会话：DB 优先；DB 不可用/为空时回退 rollout 文件列表。
export function listSessions() {
  const dbSessions = listDbSessions();
  if (dbSessions) return { source: SOURCE_DB, dir: DB_PATH, sessions: dbSessions };
  return { source: SOURCE_JSONL, dir: ROLLOUT_DIR, sessions: listRolloutSessions() };
}

// ---------- 格式化（中英双语） ----------

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}
function fmtCompact(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}k`;
  return `${(n / 1e6).toFixed(2)}M`;
}
function fmtRate(n) {
  return n.toFixed(1);
}
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h${m}m${sec}s` : m > 0 ? `${m}m${sec}s` : `${sec}s`;
}

const L = {
  zh: {
    title: (models) => `📊 Token 统计 — ${models}`,
    genHead: '⚡ 生成速率（纯模型输出，不含工具间隙）',
    genLine: (a, r, p) => `   平均 ${a} tok/s · 最近${RECENT_CALLS}次 ${r} tok/s · 峰值 ${p} tok/s`,
    thrHead: (w) => `⏱ 吞吐（近 ${w} 分钟墙钟，含工具间隙）`,
    thrLine: (o, t, c) => `   输出 ${o} tok/s · 合计 ${t} tok/s · ${c} 次调用`,
    totHead: (n) => `📦 累计用量（${n} 次调用）`,
    inLine: (i, p, f) => `   输入 ${i}（缓存命中 ${p}%，新增 ${f}）`,
    outLine: (o, r) => `   输出 ${o}（其中思考 ${r}）`,
    totalLine: (t) => `   合计 ${t}`,
    spanLine: (d, a, b) => `🕐 会话时长 ${d}（${a} → ${b}）`,
    srcLine: (f) => `📄 数据源 ${f}`,
    listHead: (d) => `历史会话（${d}）：`,
    listNone: '  （无）',
    listRow: (id, t, s) => `  ${id}  ${t}  ${s}`,
    listCalls: (n) => `${n} 次`,
    errNoSession: (s) => `找不到会话记录：${s ?? '（本地无记录）'}`,
    errDir: (d) => `查找目录：${d}`,
    errHint: '用 --list 查看可用会话。',
    errNoUsage: (f) => `会话没有可用的 usage 记录：${f}`,
    // hook 行
    hCompact: (r, i, o) => `⚡${r} tok/s · 入 ${i} / 出 ${o}`,
    hGen: (r, a) => `⚡生成 ${r} tok/s（均值 ${a}）`,
    hThr: (w, o) => ` · 近${w}分钟吞吐 出 ${o}/s`,
    hTot: (i, p, o) => ` · 累计 in ${i}（缓存 ${p}%）/ out ${o}`,
    hCalls: (n, d) => ` · ${n} 次 ${d}`,
    hInstruction: '（指令：本轮回复结束后，把上面 [token-rate] 开头的那一行原样追加为回复的最后一行，面向用户展示实时速率；不改写数字、不解释、不省略。）',
  },
  en: {
    title: (models) => `📊 Token stats — ${models}`,
    genHead: '⚡ Generation rate (pure model output, excl. tool gaps)',
    genLine: (a, r, p) => `   avg ${a} tok/s · last ${RECENT_CALLS} ${r} tok/s · peak ${p} tok/s`,
    thrHead: (w) => `⏱ Throughput (last ${w} min wall clock, incl. tool gaps)`,
    thrLine: (o, t, c) => `   out ${o} tok/s · total ${t} tok/s · ${c} calls`,
    totHead: (n) => `📦 Totals (${n} calls)`,
    inLine: (i, p, f) => `   input ${i} (cache hit ${p}%, fresh ${f})`,
    outLine: (o, r) => `   output ${o} (reasoning ${r})`,
    totalLine: (t) => `   total ${t}`,
    spanLine: (d, a, b) => `🕐 Session duration ${d} (${a} → ${b})`,
    srcLine: (f) => `📄 Source ${f}`,
    listHead: (d) => `Sessions (${d}):`,
    listNone: '  (none)',
    listRow: (id, t, s) => `  ${id}  ${t}  ${s}`,
    listCalls: (n) => `${n} call${n === 1 ? '' : 's'}`,
    errNoSession: (s) => `Session record not found: ${s ?? '(no local records)'}`,
    errDir: (d) => `Search dir: ${d}`,
    errHint: 'Use --list to see available sessions.',
    errNoUsage: (f) => `No usable usage records in session: ${f}`,
    hCompact: (r, i, o) => `⚡${r} tok/s · in ${i} / out ${o}`,
    hGen: (r, a) => `⚡gen ${r} tok/s (avg ${a})`,
    hThr: (w, o) => ` · ${w}-min throughput out ${o}/s`,
    hTot: (i, p, o) => ` · total in ${i} (cache ${p}%) / out ${o}`,
    hCalls: (n, d) => ` · ${n} calls ${d}`,
    hInstruction: '(Instruction: after finishing this reply, append the [token-rate] line above verbatim as the last line of your reply, for the user; do not alter numbers, explain, or omit.)',
  },
};

export function formatReport(stats, file, lang = detectLang(), source = SOURCE_JSONL) {
  const t = L[lang] ?? L.zh;
  const u = stats.totals;
  const lines = [];
  lines.push(t.title(Object.keys(stats.models).join(', ')));
  lines.push('');
  lines.push(t.genHead);
  lines.push(t.genLine(fmtRate(stats.generation.avgTps), fmtRate(stats.generation.recentTps), fmtRate(stats.generation.peakTps)));
  lines.push(t.thrHead(stats.windowMinutes));
  lines.push(t.thrLine(fmtRate(stats.throughput.outTps), fmtRate(stats.throughput.totalTps), stats.throughput.windowCalls));
  lines.push(t.totHead(stats.calls));
  lines.push(t.inLine(fmtInt(u.input), u.cacheHitPct.toFixed(1), fmtInt(u.freshInput)));
  lines.push(t.outLine(fmtInt(u.output), fmtInt(u.reasoning)));
  lines.push(t.totalLine(fmtInt(u.total)));
  lines.push(t.spanLine(fmtDur(stats.spanMs), stats.firstAt, stats.lastAt));
  if (file) {
    const src =
      source === SOURCE_DB
        ? lang === 'en'
          ? 'db.sqlite (model_usage)'
          : 'db.sqlite（model_usage）'
        : path.basename(file);
    lines.push(t.srcLine(src));
  }
  return lines.join('\n');
}

// hook 注入两行：数据行（供原样展示给用户）+ 指令行（要求模型在回复结尾复述数据行）。
// style：compact（默认，极简一行：速率 + 累计出入）| detailed（完整统计）。
export function hookLine(stats, lang = detectLang(), style = 'compact') {
  const t = L[lang] ?? L.zh;
  const u = stats.totals;
  let data;
  if (style === 'detailed') {
    data =
      `[token-rate] ` +
      t.hGen(fmtRate(stats.generation.recentTps), fmtRate(stats.generation.avgTps)) +
      t.hThr(stats.windowMinutes, fmtRate(stats.throughput.outTps)) +
      t.hTot(fmtCompact(u.input), u.cacheHitPct.toFixed(0), fmtCompact(u.output)) +
      t.hCalls(stats.calls, fmtDur(stats.spanMs));
  } else {
    data = `[token-rate] ` + t.hCompact(fmtRate(stats.generation.recentTps), fmtCompact(u.input), fmtCompact(u.output));
  }
  return data + '\n' + t.hInstruction;
}

export function formatSessionList(list, lang = detectLang()) {
  const t = L[lang] ?? L.zh;
  const { source, dir, sessions } = list;
  const lines = [t.listHead(dir)];
  for (const s of sessions) {
    const extra =
      source === SOURCE_DB
        ? `${t.listCalls(s.calls)}${s.title ? ` · ${s.title}` : ''}`
        : `${(s.sizeBytes / 1048576).toFixed(1)}MB`;
    lines.push(t.listRow(s.id, new Date(s.mtimeMs).toISOString(), extra));
  }
  if (!sessions.length) lines.push(t.listNone);
  return lines.join('\n');
}

// ---------- CLI ----------

function parseArgs(argv) {
  const out = { session: undefined, window: undefined, source: undefined, json: false, hook: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--hook') out.hook = true;
    else if (a === '--list') out.list = true;
    else if (a === '--session') out.session = argv[++i];
    else if (a === '--window') out.window = Number(argv[++i]);
    else if (a === '--source') out.source = argv[++i];
    else if (a.startsWith('--source=')) out.source = a.slice('--source='.length);
    else out.session = a;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = loadSettings();
  const window = Number.isFinite(args.window) && args.window > 0 ? args.window : settings.windowMinutes;
  const lang = detectLang();
  const T = L[lang] ?? L.zh;

  if (args.list) {
    const list = listSessions();
    if (args.json) {
      console.log(JSON.stringify({ source: list.source, dir: list.dir, rolloutDir: ROLLOUT_DIR, sessions: list.sessions }, null, 2));
    } else {
      console.log(formatSessionList(list, lang));
    }
    return;
  }

  // hook 模式：任何失败都静默退出，绝不阻塞会话；stdout 必须是严格 JSON
  if (args.hook) {
    try {
      if (!settings.injectLine) return; // 用户在插件设置里关闭了注入
      const input = readHookInput();
      if (input?.session_id) setRuntimeSessionId(input.session_id);
      const loaded = await loadRecords(undefined, { source: args.source });
      if (!loaded) return;
      const stats = computeStats(loaded.records, window);
      if (stats) console.log(JSON.stringify({ additionalContext: hookLine(stats, lang, settings.lineStyle) }));
    } catch {
      /* 静默 */
    }
    return;
  }

  const loaded = await loadRecords(args.session, { source: args.source });
  if (!loaded) {
    console.error(T.errNoSession(args.session));
    console.error(T.errDir(DB_PATH));
    console.error(T.errDir(ROLLOUT_DIR));
    console.error(T.errHint);
    process.exit(1);
  }
  const stats = computeStats(loaded.records, window);
  if (!stats) {
    console.error(T.errNoUsage(loaded.file));
    process.exit(1);
  }
  if (args.json) {
    console.log(JSON.stringify({ file: loaded.file, source: loaded.source, lang, ...stats }, null, 2));
  } else {
    console.log(formatReport(stats, loaded.file, lang, loaded.source));
  }
}

const isDirectRun = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (isDirectRun) {
  main().catch((e) => {
    console.error(String(e?.message || e));
    process.exit(1);
  });
}
