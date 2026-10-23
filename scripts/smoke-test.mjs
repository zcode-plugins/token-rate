#!/usr/bin/env node
// 冒烟测试：不依赖本机 ZCode 会话数据，可在任意环境（含 CI）运行。
// 覆盖：语法检查、MCP 握手 + tools/list + tools/call（正常/错误路径）、
// hook 模式在无 rollout 数据时静默退出、输出语言切换、--list。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

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

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll smoke checks passed.');
process.exit(failures.length ? 1 : 0);
