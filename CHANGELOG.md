# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
