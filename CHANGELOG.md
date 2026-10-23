# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-10-23

### Changed

- Restored the plugin `language` setting (`auto` / `zh` / `en`): `auto` (default) follows the ZCode UI language (`ui.locale`), while `zh` / `en` force a language. `TOKEN_RATE_LANG` still overrides everything. The setting's description now states the `auto` behavior explicitly.
- Replaced the free-text `line_style` option (`compact` / `detailed`) with the `detailed_line` switch. ZCode's plugin settings form renders only text/number inputs and switches — the manifest schema has no `enum`/`select` type — so a dropdown cannot be declared; two-state options are exposed as switches instead. Values previously saved under `line_style` are still honored.

## [0.3.2] - 2026-10-23

### Changed

- Output language now follows the ZCode UI language. `detectLang()` reads `ui.locale` (`zh-CN` / `en-US` / `auto`) from `~/.zcode/cli/config.json`, the key ZCode itself writes; `auto` resolves through `LC_ALL` / `LC_MESSAGES` / `LANG` / `LANGUAGE` and then the system locale, matching ZCode's own behavior.
- Removed the plugin `language` setting (`zh` / `en` / `auto`): the output simply follows ZCode, so there is nothing to configure. `TOKEN_RATE_LANG` remains as an explicit scripting override.

### Fixed

- Language detection previously looked for `locale` / `language` keys that ZCode never writes, so a UI language different from the system locale was ignored.

## [0.3.1] - 2026-10-23

### Fixed

- Removed the explicit `hooks` declaration from the manifest: the loader already auto-registers the conventional `hooks/hooks.json`, so declaring it registered the same file twice and surfaced the warning "Duplicate plugin hooks file ignored: ./hooks/hooks.json" on the plugin settings page. Hook behavior is unchanged (same file, registered once).

## [0.3.0] - 2026-10-23

### Added

- Plugin settings via `userConfig` (editable in **Settings → Plugin Management → Installed → plugin details → Advanced**): `inject_line` (toggle the per-turn line), `line_style` (`compact`/`detailed`), `window_minutes` (throughput window), `language` (`zh`/`en`/`auto`). Values persist under `plugins.options` in `~/.zcode/cli/config.json`.

### Changed

- **Breaking (default)**: the per-turn rate line now defaults to a minimal one-liner (`[token-rate] ⚡24.7 tok/s · 入 1.30M / 出 7.8k`); the previous full line is available as `line_style: detailed`.
- All runtimes (hook, MCP tool, CLI) read the same settings: `TOKEN_RATE_*` env vars > plugin settings > `userConfig` defaults; invalid values fall back to `compact`.
- Language detection adds the plugin `language` setting between the `TOKEN_RATE_LANG` env var and the config-file locale.

## [0.2.5] - 2026-10-23

### Added

- Project scaffolding for the `zcode-plugins` organization: MIT `LICENSE`, root `marketplace.json` (the repo itself can be added as a marketplace source), `homepage`/`license` manifest fields.
- Portable command fallback (locate the installed copy under the plugin cache) replacing a machine-specific path.

### Changed

- Author metadata changed to `zcode-plugins`; display name is **Token Pulse / Token 脉冲**.

## [0.2.4] - 2026-10-23

### Changed

- Display name renamed to **Token Pulse / Token 脉冲** (marketplace presentation only; plugin id stays `token-rate`).

## [0.2.3] - 2026-10-23

### Changed

- Language consistency across the whole plugin: MCP parameter descriptions now follow the same language detection as the tool description; the `/token-rate` command description/body, the reply-tail rule and the manifest description are bilingual by design.

## [0.2.2] - 2026-10-23

### Added

- Bilingual output (Chinese / English) for all user-visible surfaces: hook line, report, session list, errors and the MCP tool description.
- 3-tier language detection: `TOKEN_RATE_LANG` env var → `locale`/`language` key in `~/.zcode/cli/config.json` → system locale.

## [0.2.1] - 2026-10-23

### Added

- Reply-tail rate line: the hook now injects a data line plus an instruction so the agent appends a one-line rate summary at the end of every reply (for the user, not just the model).

### Removed

- Experimental topmost floating desktop bar introduced in 0.2.0 (rejected approach; ZCode-independent UI was out of scope for this plugin).

## [0.2.0] - 2026-10-23

### Added

- Experimental Windows topmost floating rate bar (PowerShell + WPF, incremental file tailing).

## [0.1.0] - 2026-10-23

### Added

- Initial release: `token_rate` MCP tool, `/token-rate` slash command, `UserPromptSubmit` hook injecting a one-line session summary, live computation from `~/.zcode/cli/rollout` records (generation rate excluding tool gaps, sliding-window throughput, cumulative usage with cache-hit ratio).

Entries before 0.2.5 were developed before the repository was published; per-version comparison links are available from [v0.2.5](https://github.com/zcode-plugins/token-rate/releases/tag/v0.2.5) onward.
