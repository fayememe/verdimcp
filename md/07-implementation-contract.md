# Verdi MCP — M1–M5 实现契约

> 2026-10-18（M1–M5）· 2026-10-27（v2 增量，见 §11）· 本文件是 M1–M5 + v2 的实现基准。若与 `md/03-mcp-plan.md` 冲突，以本文件为准，并回填 03。
> 宿主：f29（10.3.9.99），Verdi W-2024.09-SP1。运行时：Bun 1.3.14 + TypeScript + `@modelcontextprotocol/sdk`（stdio）。

## 0. 范围

| 阶段 | 交付 | 验收 |
|---|---|---|
| M0 | `bin/`：`cmdclient --json`、`verdi-session` 增强、`build.sh`、`install.sh` | 无 GUI 的 CLI smoke 通过 |
| M1 | `mcp/` 骨架 + 会话/窗口/截图 6 个工具 + `verdi` skill | 发现会话、建窗、截图 |
| M2 | 波形工具（开 FSDB / 信号列表 / 加删信号 / 游标）+ `verdi-waveform` | 一条链路摆好现场 |
| M3 | 值 / 跳变 / XZ（GUI + NPI）+ `verdi-bus-debug` | demo FSDB 上跑通逐跳检查 |
| M4 | 设计追踪 / source + `verdi-design-trace` | 有 `-f` 设计库时给结构；无库 `not_supported` |
| M5 | `verdi-evidence` + 端到端验收脚本 + 回归 | 证据可复现、标签正确 |

**M1–M5 不做**：`session_start/stop` MCP 工具、`window_raise`、raw Tcl、broker、SSH 远程模式、常驻 NPI Reader、大 FSDB P1 调优。

**v2（2026-10-27）已补**：`verdi_session_start/stop`、`verdi_window_raise`、`verdi_tcl_exec`（默认关闭）、`levels>1` 的 `*ByLevel` 语义、常驻 NPI Reader、SSH 远程模式验证、并发语义实测、正在写入的 FSDB 实测。仍未做：broker、>16 信号的无头渲染、`-dbdir` 下的 leafpin dump。

## 1. 目录

```
bin/
  verdi-session          # Python 3，从 poc/verdi-session 增强
  cmdclient.c            # C，从 poc/cmdclient.c 增强
  build.sh               # 编译 cmdclient 到 bin/cmdclient
  install.sh             # 安装到 ~/.local/libexec/verdi-session + ~/.local/bin
mcp/
  package.json
  tsconfig.json
  src/server.ts          # 入口：注册全部工具
  src/backend.ts         # 调 verdi-session / cmdclient / import / npi_worker
  src/context.ts         # ToolContext / Backend 接口
  src/errors.ts          # AppError + 错误码
  src/time.ts            # 时间单位换算
  src/tools/sessions.ts  # M1
  src/tools/windows.ts   # M1
  src/tools/waveform.ts  # M2
  src/tools/values.ts    # M3
  src/tools/design.ts    # M4
  npi/npi_worker.py      # M3 NPI 短进程 worker
  test/smoke.ts          # MCP 协议 smoke（SDK client）
skills/
  verdi/SKILL.md
  verdi-waveform/SKILL.md
  verdi-bus-debug/SKILL.md
  verdi-design-trace/SKILL.md
  verdi-evidence/SKILL.md
scripts/
  acceptance.sh          # M1–M5 端到端验收
md/adr/                  # 决策记录（按需）
```

## 2. CLI 契约

### 2.1 `cmdclient`

```
cmdclient <port> [--json] [--hold <sec>] <cmd> [cmd...]
```

- 默认输出保持 TSV：`OK|ERR \t <command> \t <result>`，事件 `EVENT \t <event> \t <data>`。
- `--json` 输出 **JSONL**（每行一个对象）：
  ```
  {"type":"connect","ok":true,"port":11066}
  {"type":"result","ok":true,"command":"wvCreateWindow","result":"372eb2e0"}
  {"type":"event","event":"wvCreateWindow","data":"35857850"}
  {"type":"error","code":"connect_failed","message":"..."}
  ```
- 事件可出现在对应 result 之后；`events` 由 `CmdCltCheckForEvents` 泵出。事件不保证与命令一一对应，调用方按顺序保留即可。
- 退出码：0 全部成功；1 任一 `ERR`；2 连接失败；64 用法错误；75 被上层标记为 busy（由 `verdi-session` 使用）。
- 必须对 command/result/event/data 做 JSON 字符串转义（引号、反斜杠、控制字符）。

### 2.2 `verdi-session`

在 `poc/verdi-session` 基础上增强，保持现有子命令兼容。

- `list --json`：数组，每项包含完整 entry + `state`：
  `id, port, pid, uid, host, started, cwd, label, verdi, display, cmd, fsdb, design, status, state`
- `info <id>`：保持 JSON，含 `state`。
- `exec <selector> [--json] [--lock-timeout <sec>] <cmd...>`：
  - 解析 session，要求 `state == "up"`。
  - 获取 **per-session flock**：`$VERDI_SESSION_DIR/<sid>.lock`；`LOCK_EX`，最多等待 `--lock-timeout`（默认 5 秒）。超时：`--json` 时打印 `{"type":"error","code":"busy","message":"session <sid> is busy"}`，退出 75；非 JSON 时 stderr + 退出 75。
  - `--json` 透传给 `cmdclient --json`。
  - 保持现有 `--hold` 透传。
- `start` / `stop` / `prune`：保持现有行为；`start` 仍要求 `DISPLAY`。
- 安装路径：
  - `~/.local/libexec/verdi-session/verdi-session`
  - `~/.local/libexec/verdi-session/cmdclient`
  - `~/.local/bin/verdi-session` → 上述脚本的软链
  - `verdi-session` 的 `CLIENT_CANDIDATES` 仍优先 `VERDI_CMDCLIENT`，其次同目录，再次旧路径。

### 2.3 `build.sh` / `install.sh`

- `bin/build.sh`：`gcc -I$VERDI_HOME/share/libcmd "$(dirname $0)/cmdclient.c" -L$VERDI_HOME/share/libcmd/linux64 -lnclt -lnsys -o "$(dirname $0)/cmdclient"`。
- `bin/install.sh`：调用 `build.sh`，创建目录，`install -m 755` 两个文件，`ln -sfn` 到 `~/.local/bin/verdi-session`；打印安装路径与 `verdi-session list` 自检。

## 3. MCP server

- Bun + TypeScript，ESM，stdio。
- `server.ts` 创建 `McpServer`，依次调用：
  `registerSessions`, `registerWindows`, `registerWaveform`, `registerValues`, `registerDesign`。
- 每个模块导出 `registerX(server: McpServer, ctx: ToolContext): void`。
- `ToolContext`：
  ```ts
  export interface ToolContext {
    backend: Backend;
    capabilities: CapabilityMatrix;
  }
  export interface Backend {
    cliPath(): string;
    listSessions(): Promise<SessionEntry[]>;
    resolveSession(sessionId?: string): Promise<SessionEntry>;
    exec(sessionId: string, commands: string[], opts?: { lockTimeoutSec?: number; timeoutMs?: number }): Promise<ExecResult>;
    screenshot(sessionId: string, windowId: string, opts?: { inline?: boolean }): Promise<ScreenshotResult>;
  }
  ```
- 工具注册使用 zod schema；每个工具返回 `content`，失败时 `isError: true`。
- 成功内容：`[{ type: "text", text: JSON.stringify(envelope) }]`；截图可追加 `{ type: "image", data: base64, mimeType: "image/png" }`。

## 4. 工具面

统一 envelope：

```json
{"ok":true,"data":{},"meta":{"tool":"verdi_...","sid":"...","elapsed_ms":12,"source":"gui"}}
{"ok":false,"error":{"code":"...","message":"...","details":{}},"meta":{...}}
```

错误码：`session_not_found`、`ambiguous_session`、`session_down`、`window_not_found`、`not_supported`、`not_tested`、`timeout`、`busy`、`backend_error`、`invalid_argument`。

### 4.1 M1

| 工具 | 输入 | 输出 |
|---|---|---|
| `verdi_capabilities` | — | `{verdi_home, engines:{gui:true,npi:boolean}, tools:[{name,status,notes}]}` |
| `verdi_sessions_list` | — | `{sessions:[SessionEntry]}`（只列当前用户 registry） |
| `verdi_session_info` | `{session_id?}` | 完整 entry + `state` |
| `verdi_session_start` | `{label?, fsdb?, design?:string[], top?, args?:string[], cwd?, display?, port?, timeout_sec?, settle_sec?}` | `{session_id,port,pid,label,cwd,fsdb,design,state}` |
| `verdi_session_stop` | `{session_id?\|label?}` | `{session_id,port,stopped:true}` |
| `verdi_windows_list` | `{session_id?}` | `{windows:[{window_id,xid,kind:"nwave"}]}` |
| `verdi_window_create` | `{session_id?}` | `{window_id,xid?}` |
| `verdi_window_raise` | `{session_id?, window_id?}` | `{window_id,xid,raised:true}` |
| `verdi_window_screenshot` | `{session_id?, window_id, inline?=true}` | `{path,width,height,bytes,sha256,xid}` + 可选 image |

实现：
- `sessions_list` → `verdi-session list --json`；只返回本用户 registry 内的条目。
- `resolveSession`：`session_id` 给定则 `info`；否则 `list` 中 `state=="up"`：1 个自动、0 个 `session_not_found`、>1 个 `ambiguous_session`（details 带候选）。
- `windows_list` → `wvGetAllWindows`；对每个 wid 调 `wvGetXWindowId -id <wid>`；`xid` 加 `0x` 前缀。
- `window_create` → `wvCreateWindow`，再取 xid。
- `window_raise` → `wvRaiseWindow -win <wid>`（Verdi 原生命令；不需要 xdotool/wmctrl）。
- `session_start` → `verdi-session start --detach`，只允许启动新会话，绝不 attach 现有 GUI；`DISPLAY` 取参数、进程环境或 `VERDI_DISPLAY`，缺省 `localhost:10.0`。`fsdb`/`design`/`cwd` 受 `assertAllowedPath` 约束（`$HOME`、cwd、`VERDI_ALLOWED_ROOTS`）。
- `session_stop` → 只接受 registry 中的 id/label，调 `verdi-session stop`（SIGTERM → 2 s → SIGKILL），不会触碰其他用户的进程。
- `window_screenshot`：
  - `wvGetXWindowId -id <wid>` → xid。
  - 环境：`DISPLAY = entry.display`（若空则 `localhost:10.0`），`XAUTHORITY = process.env.XAUTHORITY ?? ~/.Xauthority`。
  - `import -window 0x<xid> <path>`；路径 `~/.local/state/verdi-mcp/screenshots/<sid>-<wid>-<ts>.png`（目录 0700）。
  - `identify -format "%w %h"`、文件大小、`sha256sum`。
  - `inline` 默认 true 且文件 ≤ 2 MB 时附带 `image` content；否则只返回路径。

### 4.2 M2

| 工具 | 输入 | 输出 |
|---|---|---|
| `verdi_fsdb_open` | `{session_id?, window_id, path, time_unit?}` | `{path,time_unit}` |
| `verdi_signals_list` | `{session_id?, window_id?, kind?="signal"\|"scope", delim?="/", search?, limit?=500, offset?=0}` | `{items,total,truncated,next_offset}` |
| `verdi_signals_add` | `{session_id?, window_id?, signals:string[]}` | `{requested,ok,result,events}` |
| `verdi_signals_remove` | `{session_id?, window_id?, signals:string[]}` | `{requested,ok,result}` |
| `verdi_cursor_set` | `{session_id?, window_id?, time?, begin?, end?, unit?}` | `{time,unit}` |

实现：
- `fsdb_open` → `wvOpenFile -win <wid> <path>`；随后 `wvGetWindowTimeUnit -win <wid>` 返回 `1ns` 等。更新 MCP 内存中 `sid → fsdb` 映射。
- `signals_list` → `wvDumpSignalListToFile -win <wid> [-signal|-scope] -delim <delim> -file <tmp>`；读文件，按 `search` 子串过滤（不区分大小写），slice `[offset, offset+limit]`；`total` 为过滤后总数。临时文件放 `~/.local/state/verdi-mcp/tmp/`，用完删除。
- `signals_add` → `wvAddSignal -win <wid> <signals...>`；返回 `ok` 与 events（用于确认）。
- `signals_remove` → `wvDeleteSignal -win <wid> <signals...>`。
- `cursor_set` → `wvSetCursor -win <wid> <time|begin|end>`；返回请求值 + 窗口单位。

### 4.3 M3

| 工具 | 输入 | 输出 |
|---|---|---|
| `verdi_value_get` | `{session_id?, window_id?, signal, time?, unit?, format?="Hex", leading_zeros?=true}` | `{signal,time,value,unit,source}` |
| `verdi_transitions_get` | `{session_id?, window_id?, signal, start?, end?, unit?, max?=1000, with_values?=true, engine?="auto"}` | `{signal,transitions:[{time,value?}],truncated,source}` |
| `verdi_xz_scan` | `{session_id?, window_id?, fsdb?, signals?, scope?, start?, end?, unit?, max?=100, engine?="auto"}` | `{candidates:[{signal,time,value}],truncated,source}` |

实现：
- 时间：`time` 是数字，`unit` 默认窗口单位；用 `wvGetWindowTimeUnit` 解析。GUI 命令使用窗口单位，NPI 使用 FSDB 单位（`scale_unit()`，如 `1ps`）。
- 信号名：GUI 用 `/` 分隔；NPI 用 `.` 分隔且无前导 `/`。转换函数 `toNpiName`。
- `value_get`：GUI `wvGetSigValueByTime -win <wid> [-delim /] <signal> -time <t> [-lz] [-format <fmt>]`；无 `time` 时 `wvGetCurValueString -win <wid> <signal>`。
- `transitions_get`：
  - `engine=gui` 或 `auto` 且 `max<=200`：循环 `wvSearchNextBySignal -win <wid> -delim / <signal> -time <t>`；返回 `1 <time>` 或 `0`；每次把 `t` 设为返回值；同一时间不前进则 `t+1`；可选用 `wvGetSigValueByTime` 补 value。
  - `engine=npi` 或 `auto` 且 `max>200`：调用 `mcp/npi/npi_worker.py` 的 `transitions`。
- `xz_scan`：
  - `engine=auto` 默认走 NPI；NPI 不可用/失败时回退 GUI 采样（step 默认 `(end-start)/max`，最多 `max*2` 次查询），并在 `meta.degraded=true`、`details.reason` 说明。
  - NPI：`sig_value_between(fsdb, signal, start, end, VctFormat_e.HexStrVal)`，过滤含 `x`/`z`（大小写）的值。
  - 若给 `scope`，先用 GUI dump `-scope` 得到 scope 下信号列表（限制 `max` 个信号），再查询。
- NPI worker 环境：
  `VERDI_HOME`、`SNPSLMD_LICENSE_FILE`、`PYTHONPATH=$VERDI_HOME/share/NPI/python`、`LD_LIBRARY_PATH=$VERDI_HOME/share/NPI/lib/linux64:$VERDI_HOME/platform/linux64/lib/Qt5/lib`；Python 用 `python3`。超时 30 s；失败返回 `not_supported`/`backend_error`，不伪造结果。

### 4.4 M4

| 工具 | 输入 | 输出 |
|---|---|---|
| `verdi_scopes_list` | `{session_id?, window_id?, root?, limit?=500}` | `{scopes:[string],truncated}` |
| `verdi_drivers_get` | `{session_id?, signal, scope?, levels?=1}` | `{leaf_pins:[string],report_path}` |
| `verdi_fanin_get` | `{session_id?, signal, scope?, levels?=1}` | `{leaf_pins:[string],report_path}` |
| `verdi_fanout_get` | `{session_id?, signal, scope?, levels?=1}` | `{leaf_pins:[string],report_path}` |
| `verdi_source_get` | `{session_id?, signal?, file?, line?, lines?=40}` | `{file,line,snippet}` |

实现：
- `scopes_list` → `wvDumpSignalListToFile -win <wid> -scope -file <tmp>`；去重、按 `root` 前缀过滤、limit。
- `drivers/fanin/fanout`：
  1. 若 `scope` 未给，从 `signal` 去掉最后一段得到 scope（点分隔）。
  2. `schCreateWindow -delim . -scope {<scope>}` → sch_wid；失败/返回 0 → `not_supported`（提示需要 `-f` 设计库）。
  3. `schTraceDriver|schTraceFanIn|schTraceLoad -win <sch_wid> -delim . -signal {<signal>}`。
  4. `schDumpTracedLeafPin -delim .`。
  5. 读 `<entry.cwd>/verdiLog/leafpin.rpt` 或 `<entry.cwd>/.verdiLog/leafpin.rpt`（取存在且最新的），按行返回。
  6. `schCloseWindow -win <sch_wid>`。
  - `levels > 1`：改走 `schTraceDriverByLevel` / `schTraceFanInByLevel` / `schTraceLoadByLevel`。**实测**：`*ByLevel` 的结果不会进入 `schDumpTracedLeafPin`（返回 "previous action was not tracing driver, load or connectivity"），`schTraceReport -showOn text` 也不落盘。因此 `levels>1` 返回 `cone_paths`（Verdi 给出的路径段）+ `leaf_pins: []` + `degraded: true`，不伪造叶子引脚。
  - `verdi_fanin_get` 的 `levels=1`：`schTraceFanIn` 同样不能 dump；1 层 fan-in 等价于直接 driver 集合，故映射到 `schTraceDriver` 并在结果里带 `note`。
- `source_get`：
  - 有 `file`：直接读文件 `line` 附近 `lines` 行；返回。
  - 有 `signal`：`srcCreateWindow -scope {<scope>}` → src_wid；`srcGetCaretFile -win <src_wid>`、`srcGetCaretLine -win <src_wid>`；读文件片段；`srcCloseWindow -win <src_wid>`。
  - 无设计库时命令失败 → `not_supported`。

### 4.5 M5

- `skills/verdi-evidence/SKILL.md`：证据标签、可复现命令、结论强度、禁止编造；引用 `md/README.md` 的证据标签定义。
- `scripts/acceptance.sh`：见 §8。
- `scripts/mcp-smoke.ts`：SDK client 启动 server，依次调用 M1–M4 工具；无 Verdi 时允许 `session_not_found`，但工具必须已注册。

### 4.6 v2 逃生口：raw Tcl

| 工具 | 输入 | 输出 |
|---|---|---|
| `verdi_tcl_exec` | `{session_id?, commands:string[1..20]}` | `{results:[{command,ok,result}], events}` |

- 仅当 MCP server 进程环境 `VERDI_ALLOW_RAW=1` 时启用；否则 `not_supported` + hint。
- 禁止多行命令；每条命令经 `verdi-session exec` 落 `audit.jsonl`。
- 存在的理由：Verdi Tcl 面远大于本项目的 typed 工具；Tcl 可 `exec` 任意进程，因此这是运维决策而非 agent 默认能力。

## 5. 时间与信号名

- GUI 窗口单位来自 `wvGetWindowTimeUnit`（如 `1ns`）。
- NPI FSDB 单位来自 `file_handle.scale_unit()`（如 `1ps`）。
- 内部统一用 `{value, unit}`；转换因子：ps=1, ns=1000, us=1e6, ms=1e9, s=1e12。
- GUI 信号：`/system/data[7:0]`；NPI 信号：`system.data[7:0]`。总线名在 Tcl 中必须用 `{}` 包住。
- `-lz` 默认开启，保留 X/Z 字符串与定宽。

## 6. 安全

- 只读 registry 中本用户、`state=="up"`、cmdline 含 `-serverPort <port>` 的会话。
- 不 attach / 不杀其他用户的 Verdi。
- raw Tcl 默认关闭（`VERDI_ALLOW_RAW=1` 才启用），逐条审计。
- 截图、临时文件、审计日志放 `~/.local/state/verdi-mcp/`（0700）。
- 审计：`audit.jsonl` 记录 `ts, tool, sid, wid, command, rc, elapsed_ms`；不记录 FSDB 内容。
- 改 GUI 的工具（`window_create`、`signals_add/remove`、`cursor_set`、`fsdb_open`）在 skill 中标注"会改变 GUI 状态"。

## 7. Skills

每个 skill 必须包含：适用/不适用、依赖工具与顺序、只读优先、失败降级、输出格式（证据标签）。

- `verdi`：M1 流程；能力 → 会话 → 窗口 → 截图；安全红线。
- `verdi-waveform`：M2；先 `fsdb_open`，再 `signals_add`，再游标/查值；时间单位与 `-lz`。
- `verdi-bus-debug`：M3；从 valid/ready 握手生成逐跳检查表，定位首个 `valid && !ready`；用 `value_get`/`transitions_get`。
- `verdi-design-trace`：M4；`-f` 设计库依赖；无库降级为时间相关候选。
- `verdi-evidence`：M5；证据包、标签、可复现命令。

## 8. 验收

环境：`DISPLAY=localhost:10.0`，`XAUTHORITY=$HOME/.Xauthority`（当前 ACP session 无 DISPLAY，必须显式设置）。

1. `bin/install.sh`。
2. `verdi-session start --detach --label acceptance -- -f demo/sim/filelist.f -top tb_sync_fifo -ssf demo/sim/sync_fifo.fsdb`（只操作自己启动的会话）。
3. `scripts/mcp-smoke.ts`：
   - M1：`sessions_list` 至少 1 个 up；`session_info`；`windows_list`；`window_create`；`window_screenshot`（PNG 存在且 >0）。
   - M2：`fsdb_open`；`signals_list` 含 `tb_sync_fifo.clk` 或 `/tb_sync_fifo/clk`；`signals_add`；`cursor_set 40ns`。
   - M3：`value_get rst_n @40ns == 1`；`transitions_get clk` 非空；`xz_scan rd_data` 至少 1 个 X 候选。
   - M4：有设计库时 `drivers_get tb_sync_fifo.clk` 或 `source_get` 成功；无设计库时必须是 `not_supported`，不能伪造。
4. 证据写 `poc/evidence/m1-m5/`：`mcp-smoke.log`、`screenshot.png`、`summary.json`。
5. `verdi-session stop --label acceptance`；确认进程消失、端口释放。

## 9. 已知风险

- 当前 ACP session 无 `DISPLAY`；截图的 `DISPLAY`/`XAUTHORITY` 必须从 session entry + `~/.Xauthority` 取。
- 启动 Verdi 需要 license 与 X；失败则验收停在 M1 之前，不伪造结果。
- 多 client 并发：所有 GUI 调用经 per-session `flock`；2026-10-27 已用 4×15 并发实测（见 §11）。
- `schTrace*` 需要 `-f` 设计库；无库必须 `not_supported`。
- XZ 全量扫描 GUI 逐点慢；NPI 短进程 ~3.1 s 启动成本，扫描走 NPI。
- NPI 命名用点分隔、无前导 `/`，与 GUI 不同。

## 10. 实现结果（2026-10-18）

- **验收**：`bash scripts/acceptance.sh` → `ACCEPTANCE PASSED`；2026-10-27 为 83 项检查（原 76 + 7 项 v2）；证据 `poc/evidence/m1-m5/`。
- **M4 设计追踪**：demo 用 `-f demo/sim/filelist.f -top tb_sync_fifo` 启动，driver/fanin/fanout/source 均成功。
- **偏差**：
  1. `scripts/mcp-smoke.ts` 实为 `mcp/test/acceptance.ts`（Bun 从 `mcp/node_modules` 解析 SDK）。
  2. `verdi_transitions_get.with_values` 默认 false；显式 true 时最多补 50 个值。
  3. `verdi-session` 的 `session_state` 用 `ss` 监听检查，避免 elaboration 期间 connect 超时误报 `down`。
  4. `verdi_fanout_get` = `schTraceLoad`。
  5. v2 补齐了 `session_start/stop`、`window_raise`、raw Tcl、`levels>1`（语义见 §4.4/§4.6）。
- **审计**：`~/.local/state/verdi-mcp/audit.jsonl` 已实现（exec / screenshot / session_start / session_stop）。
- **未验证（2026-10-18 时点）**：多 agent 并发、GB 级 FSDB、NPI P1、SSH 远程模式 —— 全部已在 §11 补齐。

## 11. v2 增量与实测结果（2026-10-27）

| 项 | 结果 | 证据 |
|---|---|---|
| `verdi_session_start` / `stop` | ✅ VERIFIED。start 31 s（含 10 s settle），stop 0.6 s；只操作自己的 registry | `poc/evidence/lifecycle/` |
| `verdi_window_raise` | ✅ VERIFIED（`wvRaiseWindow`，1.2 s） | `poc/evidence/lifecycle/` |
| `verdi_tcl_exec` | ✅ 默认关闭（`not_supported`）；`VERDI_ALLOW_RAW=1` 后 `expr {1+2}` → `3` | 本文件 §4.6；acceptance |
| `levels>1` | ⚠️ VERIFIED NEGATIVE（无叶子引脚）。`*ByLevel` 结果不进入 `schDumpTracedLeafPin`，也不写 report 文件；只返回 `cone_paths`，`degraded=true` | 实测于 demo `-f` 会话 |
| 常驻 NPI Reader | ✅ VERIFIED。`npi_worker.py --serve` 单进程常驻；xz_scan 冷启 5.4 s → 复用 1.3 s → change_stats 0.6 s（短进程每次 ~3.1 s init） | `md/04` §4 |
| 正在写入的 FSDB | ✅ VERIFIED。8 次采样全部能打开；`max_time` 单调增长；`is_completed()` 写入中 false、结束后 true；0 失败 | `poc/evidence/writing-fsdb/` |
| 并发语义 | ✅ VERIFIED。4 worker × 15 轮 = 60 次并发调用无错配；抢锁超时 rc=75 + `busy`；长 timeout 串行成功 | `poc/evidence/concurrency/` |
| SSH 远程模式 | ✅ VERIFIED。临时 sshd(127.0.0.1:2222) + stdio-only MCP：握手 294 ms，37 个工具可见，工具调用正常 | `poc/evidence/remote/` |
| 端到端验收 | ✅ 83 项检查通过（原 76 + 7 项 v2） | `poc/evidence/m1-m5/summary.json` |

环境注意（远程模式）：ssh 非交互 shell 不带 `DISPLAY`，GUI 工具需要远端 `~/.ssh/environment` 或 `AcceptEnv`/`SendEnv` 传递 `DISPLAY`/`XAUTHORITY`；`verdi_session_start` 已支持 `display` 参数兜底。
