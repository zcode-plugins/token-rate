## What & why / 改动内容与动机

<!-- What does this PR change, and why is it needed? -->

## Type / 类型

- [ ] feat
- [ ] fix
- [ ] docs
- [ ] ci / chore

## Checklist / 自查

- [ ] `node scripts/smoke-test.mjs` passes locally（本地冒烟测试全绿）
- [ ] Runtime strings updated in **both** `zh` and `en`（运行时文案中英成对更新）
- [ ] Version bumped in `.zcode-plugin/plugin.json` **and** root `marketplace.json`, with a `CHANGELOG.md` entry（版本与变更日志同步）
- [ ] No network calls, no telemetry, no secrets; hook failure paths stay silent（不引入网络/遥测/密钥；hook 静默失败语义未破坏）
