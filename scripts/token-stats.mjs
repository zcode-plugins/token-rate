#!/usr/bin/env node
// token-rate 核心统计模块 + CLI。
// 数据源：~/.zcode/cli/rollout/model-io-session_<sessionId>.jsonl
// 每行一条 model_io 记录：{ startedAt, completedAt, durationMs, model: {modelId}, usage: {...} }
// usage 可能在记录顶层，也可能在 response.usage（不同版本兼容）。
// 被 CLI（默认/--json/--list）、hook（--hook，输出严格 JSON additionalContext）、
// 以及 scripts/mcp-server.mjs（MCP 工具 token_rate）共用。
// 输出语言：TOKEN_RATE_LANG 环境变量 > ~/.zcode/cli/config.json 的 locale/language 键 > 系统 locale（zh* → 中文，否则英文）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const ROLLOUT_DIR = path.join(os.homedir(), '.zcode', 'cli', 'rollout');
const RECENT_CALLS = 5; // “最近速率”取最近 N 次模型调用

export function detectLang() {
  const env = (process.env.TOKEN_RATE_LANG || '').trim().toLowerCase();
  if (env.startsWith('zh')) return 'zh';
  if (env.startsWith('en')) return 'en';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.zcode', 'cli', 'config.json'), 'utf8'));
    const l = String(cfg.locale || cfg.language || '').trim().toLowerCase();
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('en')) return 'en';
  } catch {
    /* 无配置文件或无该键 */
  }
  const loc = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
  return loc.startsWith('zh') ? 'zh' : 'en';
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
  const env = process.env.CLAUDE_SESSION_ID || process.env.ZCODE_SESSION_ID;
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

export function listSessions() {
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
    listRow: (id, t, s) => `  ${id}  ${t}  ${s}MB`,
    errNoSession: (s) => `找不到会话记录：${s ?? '（rollout 目录无记录）'}`,
    errDir: (d) => `查找目录：${d}`,
    errHint: '用 --list 查看可用会话。',
    errNoUsage: (f) => `会话文件没有可用的 usage 记录：${f}`,
    // hook 行
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
    listRow: (id, t, s) => `  ${id}  ${t}  ${s}MB`,
    errNoSession: (s) => `Session record not found: ${s ?? '(no records in rollout dir)'}`,
    errDir: (d) => `Search dir: ${d}`,
    errHint: 'Use --list to see available sessions.',
    errNoUsage: (f) => `No usable usage records in session file: ${f}`,
    hGen: (r, a) => `⚡gen ${r} tok/s (avg ${a})`,
    hThr: (w, o) => ` · ${w}-min throughput out ${o}/s`,
    hTot: (i, p, o) => ` · total in ${i} (cache ${p}%) / out ${o}`,
    hCalls: (n, d) => ` · ${n} calls ${d}`,
    hInstruction: '(Instruction: after finishing this reply, append the [token-rate] line above verbatim as the last line of your reply, for the user; do not alter numbers, explain, or omit.)',
  },
};

export function formatReport(stats, file, lang = detectLang()) {
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
  if (file) lines.push(t.srcLine(path.basename(file)));
  return lines.join('\n');
}

// hook 注入两行：数据行（供原样展示给用户）+ 指令行（要求模型在回复结尾复述数据行）
export function hookLine(stats, lang = detectLang()) {
  const t = L[lang] ?? L.zh;
  const u = stats.totals;
  const data =
    `[token-rate] ` +
    t.hGen(fmtRate(stats.generation.recentTps), fmtRate(stats.generation.avgTps)) +
    t.hThr(stats.windowMinutes, fmtRate(stats.throughput.outTps)) +
    t.hTot(fmtCompact(u.input), u.cacheHitPct.toFixed(0), fmtCompact(u.output)) +
    t.hCalls(stats.calls, fmtDur(stats.spanMs));
  return data + '\n' + t.hInstruction;
}

export function formatSessionList(sessions, lang = detectLang()) {
  const t = L[lang] ?? L.zh;
  const lines = [t.listHead(ROLLOUT_DIR)];
  for (const s of sessions) {
    lines.push(t.listRow(s.id, new Date(s.mtimeMs).toISOString(), (s.sizeBytes / 1048576).toFixed(1)));
  }
  if (!sessions.length) lines.push(t.listNone);
  return lines.join('\n');
}

// ---------- CLI ----------

function parseArgs(argv) {
  const out = { session: undefined, window: 10, json: false, hook: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--hook') out.hook = true;
    else if (a === '--list') out.list = true;
    else if (a === '--session') out.session = argv[++i];
    else if (a === '--window') out.window = Number(argv[++i]) || 10;
    else out.session = a;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lang = detectLang();
  const T = L[lang] ?? L.zh;

  if (args.list) {
    if (args.json) {
      console.log(JSON.stringify({ rolloutDir: ROLLOUT_DIR, sessions: listSessions() }, null, 2));
    } else {
      console.log(formatSessionList(listSessions(), lang));
    }
    return;
  }

  const file = resolveRolloutFile(args.session);

  // hook 模式：任何失败都静默退出，绝不阻塞会话；stdout 必须是严格 JSON
  if (args.hook) {
    try {
      if (!file) return;
      const stats = computeStats(await readRecords(file), args.window);
      if (stats) console.log(JSON.stringify({ additionalContext: hookLine(stats, lang) }));
    } catch {
      /* 静默 */
    }
    return;
  }

  if (!file) {
    console.error(T.errNoSession(args.session));
    console.error(T.errDir(ROLLOUT_DIR));
    console.error(T.errHint);
    process.exit(1);
  }
  const stats = computeStats(await readRecords(file), args.window);
  if (!stats) {
    console.error(T.errNoUsage(file));
    process.exit(1);
  }
  if (args.json) {
    console.log(JSON.stringify({ file, lang, ...stats }, null, 2));
  } else {
    console.log(formatReport(stats, file, lang));
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
