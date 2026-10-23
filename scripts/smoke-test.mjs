#!/usr/bin/env node
// 冒烟测试：不依赖本机 ZCode 会话数据，可在任意环境（含 CI）运行。
// 覆盖：语法检查、MCP 握手 + tools/list + tools/call（正常/错误路径）、
// hook 模式在无 rollout 数据时静默退出、输出语言切换、--list、
// 插件设置加载（默认值/配置文件/环境变量覆盖）、compact/detailed 行样式、关闭注入。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hookLine, loadSettings, DEFAULT_SETTINGS } from './token-stats.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (name) => console.log(`  ok  ${name}`);
const fail = (name, detail) => { failures.push(name); console.error(`  FAIL ${name}: ${detail}`); };

// 1. 语法检查
for (const f of ['scripts/token-stats.mjs', 'scripts/mcp-server.mjs', 'scripts/smoke-test.mjs']) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
  r.status === 0 ? ok(`syntax ${f}`) : fail(`syntax ${f}`, r.stderr);
}

// 2. MCP 握手与工具调用
{
  const child = spawnSync(process.execPath, [path.join(root, 'scripts', 'mcp-server.mjs')], {
    input: [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'token_rate', arguments: { list: true } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'token_rate', arguments: { session: 'nonexistent-smoke' } } }),
      '',
    ].join('\n'),
    encoding: 'utf8',
    timeout: 20000,
  });
  const replies = new Map();
  for (const line of (child.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (m.id !== undefined) replies.set(m.id, m); } catch { /* ignore */ }
  }
  const init = replies.get(1);
  init?.result?.serverInfo?.name === 'token-rate' ? ok('mcp initialize') : fail('mcp initialize', JSON.stringify(init).slice(0, 200));
  const tools = replies.get(2);
  Array.isArray(tools?.result?.tools) && tools.result.tools.some((t) => t.name === 'token_rate')
    ? ok('mcp tools/list') : fail('mcp tools/list', JSON.stringify(tools).slice(0, 200));
  const listCall = replies.get(3);
  typeof listCall?.result?.content?.[0]?.text === 'string' && !listCall.result.isError
    ? ok('mcp tools/call list') : fail('mcp tools/call list', JSON.stringify(listCall).slice(0, 200));
  const badCall = replies.get(4);
  badCall?.result?.isError === true ? ok('mcp tools/call error path') : fail('mcp tools/call error path', JSON.stringify(badCall).slice(0, 200));
}

// 3. 隔离 HOME：hook/CLI 在无 rollout 数据时的行为
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'token-rate-smoke-'));
  const env = { ...process.env, HOME: tmp, USERPROFILE: tmp, TOKEN_RATE_LANG: 'en' };
  delete env.CLAUDE_SESSION_ID;
  delete env.ZCODE_SESSION_ID;

  const hook = spawnSync(process.execPath, [path.join(root, 'scripts', 'token-stats.mjs'), '--hook'], { env, encoding: 'utf8', timeout: 20000 });
  hook.status === 0 && (hook.stdout || '').trim() === ''
    ? ok('hook silent on empty environment') : fail('hook silent on empty environment', `exit=${hook.status} out=${JSON.stringify(hook.stdout).slice(0, 120)}`);

  const list = spawnSync(process.execPath, [path.join(root, 'scripts', 'token-stats.mjs'), '--list'], { env, encoding: 'utf8', timeout: 20000 });
  list.status === 0 && list.stdout.includes('Sessions (') && list.stdout.includes('(none)')
    ? ok('cli --list (en)') : fail('cli --list (en)', `exit=${list.status} out=${JSON.stringify(list.stdout).slice(0, 160)}`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// 4. 插件设置：默认值 / 配置文件 / 环境变量覆盖（隔离 HOME 的子进程里跑，避免污染本进程缓存）
function settingsProbe(env) {
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import { loadSettings } from ${JSON.stringify(pathToFileURL(path.join(root, 'scripts', 'token-stats.mjs')).href)}; console.log(JSON.stringify(loadSettings()));`],
    { env, encoding: 'utf8', timeout: 20000 },
  );
  try {
    return JSON.parse((r.stdout || '').trim());
  } catch {
    return null;
  }
}
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'token-rate-smoke-'));
  const mkEnv = (extra = {}) => {
    const env = { ...process.env, HOME: tmp, USERPROFILE: tmp };
    delete env.CLAUDE_SESSION_ID;
    delete env.ZCODE_SESSION_ID;
    for (const k of Object.keys(env)) if (k.startsWith('TOKEN_RATE_')) delete env[k];
    return { ...env, ...extra };
  };

  // 4.1 无配置 → 默认值
  const d = settingsProbe(mkEnv());
  JSON.stringify(d) === JSON.stringify(DEFAULT_SETTINGS)
    ? ok('settings defaults') : fail('settings defaults', JSON.stringify(d));

  // 4.2 config.json plugins.options → 生效
  fs.mkdirSync(path.join(tmp, '.zcode', 'cli'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.zcode', 'cli', 'config.json'),
    JSON.stringify({ plugins: { options: { 'token-rate@dev-test': { line_style: 'detailed', window_minutes: 30, inject_line: false, language: 'en' } } } }),
  );
  const c = settingsProbe(mkEnv());
  c?.lineStyle === 'detailed' && c?.windowMinutes === 30 && c?.injectLine === false && c?.language === 'en'
    ? ok('settings from config.json') : fail('settings from config.json', JSON.stringify(c));

  // 4.3 环境变量覆盖配置文件
  const e = settingsProbe(mkEnv({ TOKEN_RATE_STYLE: 'compact', TOKEN_RATE_INJECT: '1', TOKEN_RATE_WINDOW: '5' }));
  e?.lineStyle === 'compact' && e?.injectLine === true && e?.windowMinutes === 5
    ? ok('settings env overrides') : fail('settings env overrides', JSON.stringify(e));

  // 4.4 非法取值回退 compact
  const b = settingsProbe(mkEnv({ TOKEN_RATE_STYLE: 'bogus' }));
  b?.lineStyle === 'compact' ? ok('settings invalid style fallback') : fail('settings invalid style fallback', JSON.stringify(b));

  // 4.5 hook 行样式 + 关闭注入（端到端：伪造 rollout 数据）
  fs.mkdirSync(path.join(tmp, '.zcode', 'cli', 'rollout'), { recursive: true });
  const rec = (t0) => JSON.stringify({ startedAt: new Date(t0).toISOString(), completedAt: new Date(t0 + 4000).toISOString(), durationMs: 4000, model: { modelId: 'smoke-model' }, usage: { inputTokens: 1000, cacheReadTokens: 800, outputTokens: 200, totalTokens: 1200 } });
  fs.writeFileSync(path.join(tmp, '.zcode', 'cli', 'rollout', 'model-io-session_smoke.jsonl'), `${rec(Date.now() - 60000)}\n${rec(Date.now() - 30000)}\n`);
  const hookEnv = (extra = {}) => mkEnv({ TOKEN_RATE_LANG: 'zh', ...extra });

  const on = spawnSync(process.execPath, [path.join(root, 'scripts', 'token-stats.mjs'), '--hook'], { env: hookEnv({ TOKEN_RATE_INJECT: '1', TOKEN_RATE_STYLE: 'compact' }), encoding: 'utf8', timeout: 20000 });
  const onCtx = JSON.parse((on.stdout || '').trim() || '{}').additionalContext || '';
  onCtx.startsWith('[token-rate] ⚡') && onCtx.includes('tok/s · 入 ') && !onCtx.includes('均值')
    ? ok('hook compact line') : fail('hook compact line', JSON.stringify(onCtx.slice(0, 160)));

  const det = spawnSync(process.execPath, [path.join(root, 'scripts', 'token-stats.mjs'), '--hook'], { env: hookEnv({ TOKEN_RATE_INJECT: '1', TOKEN_RATE_STYLE: 'detailed' }), encoding: 'utf8', timeout: 20000 });
  const detCtx = JSON.parse((det.stdout || '').trim() || '{}').additionalContext || '';
  detCtx.includes('均值') && detCtx.includes('吞吐') && detCtx.includes('次')
    ? ok('hook detailed line') : fail('hook detailed line', JSON.stringify(detCtx.slice(0, 160)));

  const off = spawnSync(process.execPath, [path.join(root, 'scripts', 'token-stats.mjs'), '--hook'], { env: hookEnv({ TOKEN_RATE_INJECT: '0' }), encoding: 'utf8', timeout: 20000 });
  off.status === 0 && (off.stdout || '').trim() === ''
    ? ok('hook silent when inject_line off') : fail('hook silent when inject_line off', `exit=${off.status} out=${JSON.stringify(off.stdout).slice(0, 120)}`);

  // 4.6 hookLine 纯格式化（进程内，en/zh × compact/detailed）
  const fakeStats = { totals: { input: 1234, cacheHitPct: 80, output: 567 }, generation: { recentTps: 12.3, avgTps: 10 }, throughput: { outTps: 5 }, windowMinutes: 10, calls: 3, spanMs: 60000 };
  const zhC = hookLine(fakeStats, 'zh', 'compact');
  zhC.startsWith('[token-rate] ⚡12.3 tok/s · 入 1.2k / 出 567\n') ? ok('hookLine zh compact') : fail('hookLine zh compact', JSON.stringify(zhC));
  const enD = hookLine(fakeStats, 'en', 'detailed');
  enD.includes('(avg 10.0)') && enD.includes('total in 1.2k (cache 80%)') ? ok('hookLine en detailed') : fail('hookLine en detailed', JSON.stringify(enD));

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll smoke checks passed.');
process.exit(failures.length ? 1 : 0);
