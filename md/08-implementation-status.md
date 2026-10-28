# 实现状态 — M0–M5 + Phase 2 + v2

> 2026-10-18（M0–M5 / Phase 2）· 2026-10-27（v2：生命周期、raw Tcl、levels、常驻 NPI、并发/远程/实时 FSDB）· f29
> 证据：`poc/evidence/m1-m5/`、`poc/evidence/{lifecycle,concurrency,remote,writing-fsdb}/` · 契约：`md/07-implementation-contract.md`

## 总览

| 阶段 | 状态 | 交付 | 验证 |
|---|---|---|---|
| M0 | ✅ VERIFIED | `bin/cmdclient --json`、`verdi-session` 全字段 JSON + per-session `flock`、`build.sh`、`install.sh` | CLI smoke、`install.sh`、`verdi-session list --json` |
| M1 | ✅ VERIFIED | 会话/窗口/截图工具 + `verdi` skill | 真实 GUI：list/info/windows/create/screenshot（含 inline image） |
| M2 | ✅ VERIFIED | 5 个波形工具 + `verdi-waveform` skill | 开 FSDB、信号列表、加/删信号、游标 |
| M3 | ✅ VERIFIED | 值/跳变/XZ + NPI worker + `verdi-bus-debug` skill | `rst_n@40ns=1`、clk 49 次跳变、rd_data X 命中 |
| M4 | ✅ VERIFIED | scopes/driver/fanin/fanout/source + `verdi-design-trace` skill | `-f` 设计库下 driver/fanout 返回 leaf pins；fanin 1 层映射到 driver；source 定位到 tb |
| M5 | ✅ VERIFIED | `verdi-evidence` skill + `scripts/acceptance.sh` + `mcp/test/acceptance.ts` | 83 项检查全部通过，证据落盘 |
| Phase 2 | ✅ VERIFIED（v1 收窄） | 8 个原语工具 + 6 个 evidence 工具 + 7 个 skill | demo GUI 全链路；headless render 限制 ≤16 信号 / ≤1000 bins |
| v2 | ✅ VERIFIED | `verdi_session_start/stop`、`verdi_window_raise`、`verdi_tcl_exec`（默认关）、`levels>1`、常驻 NPI Reader | 见 §v2 实测 |

**验收命令**：`bash scripts/acceptance.sh` → `ACCEPTANCE PASSED` (rc 0)，83 项检查。

## 工具面（37 个）

会话/窗口：`verdi_capabilities`、`verdi_sessions_list`、`verdi_session_info`、`verdi_session_start`、`verdi_session_stop`、`verdi_windows_list`、`verdi_window_create`、`verdi_window_raise`、`verdi_window_screenshot`

波形：`verdi_fsdb_open`、`verdi_signals_list`、`verdi_signals_add`、`verdi_signals_remove`、`verdi_cursor_set`

值/跳变/XZ：`verdi_value_get`、`verdi_transitions_get`、`verdi_xz_scan`

设计：`verdi_scopes_list`、`verdi_drivers_get`、`verdi_fanin_get`、`verdi_fanout_get`、`verdi_source_get`

协议无关原语（Phase 2）：`verdi_signal_map_put/get/list`、`verdi_handshake_beats`、`verdi_change_stats`、`verdi_window_scan`、`verdi_check_define/run`

证据（Phase 2）：`verdi_evidence_create`、`verdi_capture_annotate`、`verdi_waveform_render`、`verdi_evidence_add`、`verdi_evidence_compare`、`verdi_evidence_report`

逃生口（v2）：`verdi_tcl_exec`（`VERDI_ALLOW_RAW=1` 才启用，逐条审计）

## 实现要点

- **后端边界**：MCP → `verdi-session` CLI → `cmdclient`；GUI 调用按 session `flock` 串行化。
- **JSON**：`cmdclient --json` 输出 JSONL；`verdi-session exec --json` 透传；MCP 只解析 JSONL，不解析 TSV。
- **会话选择**：`session_id` 可选；恰好一个 `up` 时自动；0 个或 >1 个返回 `session_not_found` / `ambiguous_session`。
- **会话生命周期**：`verdi_session_start` 只走 `verdi-session start --detach`（永不 attach 现有 GUI）；`verdi_session_stop` 只接受本用户 registry 内的 id/label。
- **截图**：文件存 `~/.local/state/verdi-mcp/screenshots/`；≤2 MB 时附带 MCP image content；`DISPLAY` 取 session entry，`XAUTHORITY` 取环境或 `~/.Xauthority`。
- **NPI**：常驻 `npi_worker.py --serve`（`mcp/src/npi.ts`），一个 FSDB 句柄复用，空闲 10 min 自动退出；传输错误回退单次进程；`VERDI_MCP_NPI_RESIDENT=0` 可强制单次模式。
- **设计追踪**：`schCreateWindow` → `schTrace*` → `schDumpTracedLeafPin` → `schCloseWindow`；`levels>1` 走 `*ByLevel`，只返回 `cone_paths` + `degraded=true`（Verdi 不暴露其叶子引脚）。
- **审计**：`~/.local/state/verdi-mcp/audit.jsonl`（`ts/action/session_id/commands/results/exit_code/elapsed_ms`）。
- **安全**：只操作当前用户 registry 中 `state=up` 的会话；raw Tcl 默认关闭；不改他人会话；`assertAllowedPath` 支持 `VERDI_ALLOWED_ROOTS`。

## Phase 2 实现（2026-10-18）

- **协议无关原语**：signal map（`~/.local/state/verdi-mcp/signal-maps.json`）、handshake beats、change stats、window scan（谓词 DSL `! && || ()` + `min_duration`）、check define/run（`checks.json`）。server 内没有协议字符串。
- **证据工件**：evidence JSON 存 `~/.local/state/verdi-mcp/evidence/`；原生 marker/comment/highlight 已实测；`waveform_render` 收窄为 ≤16 信号 / ≤1000 bins；compare 用 `convert +append`；report 生成 Markdown/HTML + `query_used`。
- **前提结论**：KDB `-dbdir` VERIFIED（需 `VCS_HOME`；fan-in 不能 leafpin dump）；原生标注 VERIFIED；NPI P1 **VERIFIED negative**（903 MB/128 信号：NPI 30.6 s vs GUI 27.0 s，同窗口 9.7 s，RSS ~8 GB）。
- **证据**：`poc/evidence/diff-levers/`、`poc/evidence/m1-m5/`（`annotated.png`、`waveform_render.png`、`evidence_report.md`、`evidence_compare.png`）。

## v2 实测（2026-10-27）

| 项 | 结论 | 证据 |
|---|---|---|
| `verdi_session_start` / `stop` | ✅ start 31 s（含 10 s settle）、stop 0.6 s；只动自己的 registry | `poc/evidence/lifecycle/` |
| `verdi_window_raise` | ✅ `wvRaiseWindow`，1.2 s | `poc/evidence/lifecycle/` |
| `verdi_tcl_exec` | ✅ 默认 `not_supported`；`VERDI_ALLOW_RAW=1` 后 `expr {1+2}` → `3` | acceptance `tcl_exec.*` |
| `levels>1` | ⚠️ VERIFIED NEGATIVE：`*ByLevel` 结果不进 `schDumpTracedLeafPin`、不写 report；只返回 `cone_paths`，`degraded=true` | 本文 §偏差 |
| 常驻 NPI Reader | ✅ xz_scan 冷启 5.4 s → 复用 1.3 s → change_stats 0.6 s（单次模式每次 ~3.1 s init） | `md/04` §4 |
| 实时（写入中）FSDB | ✅ 8/8 次打开成功；`max_time` 单调增长；写入中 `is_completed=false`，结束后 `true` | `poc/evidence/writing-fsdb/` |
| 多 agent 并发 | ✅ 4×15=60 次并发无错配；抢锁超时 rc=75 + `busy`；长 timeout 串行成功 | `poc/evidence/concurrency/` |
| SSH 远程模式 | ✅ 临时 sshd + stdio MCP：握手 294 ms、37 工具、调用正常 | `poc/evidence/remote/` |

## 与契约的偏差

1. `scripts/mcp-smoke.ts` 移到 `mcp/test/acceptance.ts`（Bun 从 `mcp/node_modules` 解析 SDK；`scripts/acceptance.sh` 调用新路径）。
2. `verdi_transitions_get` 的 `with_values` 默认关闭（GUI 逐点补值太慢）；需要值时显式传 `with_values: true`，最多补 50 个。
3. `verdi-session` 的 `session_state` 用 `ss` 监听检查，不再用短超时 connect（避免 Verdi elaboration 期间误报 `down`）。
4. `verdi_fanout_get` 映射到 `schTraceLoad`（Verdi 的 load/fan-out 语义）。
5. `verdi_fanin_get` 的 1 层映射到 `schTraceDriver`（`schTraceFanIn` 的结果不能被 `schDumpTracedLeafPin` 导出）。
6. `verdi_session_start` 在 `DISPLAY` 缺失时回退 `localhost:10.0`（可用 `display` 参数或 `VERDI_DISPLAY` 覆盖）。
7. `verdi_tcl_exec` 是逃生口而非默认能力：`VERDI_ALLOW_RAW=1` 才启用。

## 仍未做 / 后续

- broker / 多 agent 队列（当前靠 per-session `flock` 串行化，已实测）。
- >16 信号的无头渲染（`waveform_render` 有上限）、大 FSDB 聚合策略。
- `-dbdir`（KDB）下的 fan-in leafpin dump（NPI P1 negative 的余项）。
- GUI XZ 回退的预算与完整性；NPI 路径已验证，GUI 仅作降级。
- `opencode.json` 已注册 MCP server；需重载 opencode 才能在当前对话中看到新工具。

## 复现

```bash
cd /home/faye/mydrv/aiwork/verdimcp
bash bin/install.sh                  # 编译并安装 verdi-session/cmdclient
bash scripts/acceptance.sh           # 自建 acceptance 会话，跑 83 项检查，自动停止
bash scripts/lifecycle.sh            # （经 MCP）启动/检查/停止一个会话
bash scripts/concurrency.sh          # 并发 + 抢锁语义
bash scripts/writing-fsdb.sh         # 写入中的 FSDB
bash scripts/remote-smoke.sh         # SSH stdio 远程模式
```

> `lifecycle.sh` 是 `mcp/test/lifecycle.ts` 的薄封装；`remote-smoke.sh` 默认起临时 sshd，
> 也可用 `REMOTE_HOST=... scripts/remote-smoke.sh` 指向真实主机。

MCP server 单独启动：`/home/faye/.bun/bin/bun run mcp/src/server.ts`（stdio）。
