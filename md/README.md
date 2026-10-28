# Verdi MCP — 文档索引与交接

> 本目录是项目的**权威文档**（见根目录 `AGENTS.md` §0.4）。代码是实现，不是来源。
> 最后更新：2026-10-27（v2：生命周期 / 并发 / 远程 / 实时 FSDB；验收 83 项）

## 一句话

让 OpenCode 等 AI agent 通过 MCP 安全地观察并操作 f29 上正在运行的 Verdi/nWave 会话：发现/选择会话、打开 FSDB、摆放信号、移动游标、查询值/跳变/X-Z、追踪设计结构、截图取证。**不替换 Verdi GUI，不把 RTL/FSDB 传到外部服务。**

## 当前状态（2026-10-27）

| 层 | 状态 | 依据 |
|---|---|---|
| 传输：`-serverPort` + `libnclt` | ✅ VERIFIED | `01-test-progress.md` §3 |
| nWave：建窗 / 开库 / 加信号 / 游标 / 信号枚举 | ✅ VERIFIED | `01-test-progress.md` §3–4 |
| 事件回调 / 截图 / 会话注册表 / 多会话启动 | ✅ VERIFIED | `01-test-progress.md` §4–5 |
| 多 client 并发连接同一会话 | ✅ VERIFIED（4×15=60 次无错配；抢锁 rc=75 busy；长等待串行成功） | `01-test-progress.md` §13B、`poc/evidence/concurrency/` |
| 波形值 / 跳变 / X-Z 查询 | ✅ VERIFIED（GUI + NPI；X/Z 均验证） | `01-test-progress.md` §5A–5E |
| 设计追踪 / schematic / source | ✅ VERIFIED（driver/load/fan-in/X/source；`-f` 与 `-dbdir` 均验证） | `01-test-progress.md` §5D、`poc/evidence/diff-levers/kdb/` |
| NPI / FSDB Reader 无头查询 | ✅ P0 可用；常驻 Reader 已实测（热查询 0.6–1.3 s）；正在写入的 FSDB 可读（需 flush） | `04-npi-research.md` §P1b、`poc/evidence/writing-fsdb/` |
| 大 FSDB / 全量 XZ 扫描 | ⚠️ 903 MB/128 信号实测：NPI 30.6 s vs GUI 27.0 s（同窗口 9.7 s）；headless 范围需收窄 | `poc/evidence/diff-levers/npi-p1/`、`10-visual-evidence.md` §8 |
| SSH 远程模式 | ✅ VERIFIED（临时 sshd + stdio MCP；37 工具、握手 294 ms） | `01-test-progress.md` §13C、`poc/evidence/remote/` |
| 多用户隔离 | ✅ 按设计（只操作本用户 registry 中带 `-serverPort` 的会话） | `AGENTS.md` §5.1 |
| 会话生命周期（MCP 启停） | ✅ VERIFIED（start 31 s / stop 0.6 s） | `poc/evidence/lifecycle/` |
| MCP server | ✅ 已实现（37 工具：M1–M5 + Phase 2 + v2） | `07-implementation-contract.md` / `08-implementation-status.md` |
| Skills | ✅ 已实现 7 个（verdi / waveform / bus-debug / xz-debug / design-trace / evidence / performance-v2-stub） | `skills/`、`11-domain-skills.md` |
| 端到端验收 | ✅ 83 项检查通过（demo `sync_fifo`，真实 GUI；含 primitives + evidence + v2） | `poc/evidence/m1-m5/` |
| Phase 2 差异化 | ✅ v1 已实现（原语 + evidence；render 收窄） | `09/10/11-*.md`、`poc/evidence/diff-levers/` |
| 仓库 / 文档初始化 | ✅ 完成（已 commit 并 push 到 Forgejo `faye/verdimcp`，private） | `progress.md` |
| demo（`sync_fifo`） | ✅ VCS 仿真 + FSDB + Verdi/libnclt 全链路已验证 | `demo/README.md`、`01-test-progress.md` §11 |

## 文档索引

| 文件 | 内容 | 性质 |
|---|---|---|
| `00-recon.md` | 可行性报告、环境盘点、能力矩阵、PoC 证据 | 已验证事实 + 未验证项 |
| `01-test-progress.md` | 实测进展、传输/GUI/会话细节、踩坑、未验证清单 | 活文档（随测试更新） |
| `02-architecture.md` | 整体架构 v0.1、部署模式、会话发现、并发与安全 | 草案 |
| `03-mcp-plan.md` | 三层架构、MCP 工具面、Skills、里程碑 M1–M5 | 方案 |
| `04-npi-research.md` | NPI / verdi_bridge 调研、性能、验证计划 P0–P2 | 调研 + P0 实测 |
| `05-web-api-reference.md` | 本地 HTTP/JSON API 参考设计（若后端做成服务） | 参考设计 |
| `06-vs-verdi-bridge.md` | 与 RuihongY/verdi_bridge 的对比、差异化策略 | 分析 |
| `07-implementation-contract.md` | M0–M5 + v2 实现契约：CLI JSON、37 个工具、错误码、并发、验收 | 已实现 |
| `08-implementation-status.md` | M0–M5 状态、偏差、未验证项 | 状态 |
| `09-protocol-analysis.md` | 协议级分析定稿：协议无关原语 + Verdi 通道 + skill 判断（方案 C） | 设计定稿（已实现 v1） |
| `10-visual-evidence.md` | 视觉证据定稿：双渲染后端 + 共享标注层 + 证据工件 | 设计定稿（已实现 v1，渲染收窄） |
| `11-domain-skills.md` | 领域 skills 定稿：7 个决策流程 | 设计定稿（已实现） |

## 接手顺序

1. 根目录 `AGENTS.md`（宪法、安全红线、文档纪律）
2. 本文件（状态 + 索引）
3. 根目录 `progress.md`（checklist / pending / NEXT / 交接）
4. 需要细节时再读 `01-test-progress.md`、`03-mcp-plan.md`

## 代码布局（已定）

- `bin/`：`verdi-session`（JSON/flock）、`cmdclient.c`、`build.sh`、`install.sh`。
- `mcp/`：Bun + TypeScript MCP server（`src/server.ts`、19 个工具、`npi/npi_worker.py`、`test/acceptance.ts`）。
- `skills/`：`verdi`、`verdi-waveform`、`verdi-bus-debug`、`verdi-design-trace`、`verdi-evidence`。
- `scripts/`：`acceptance.sh`（M1–M5 端到端）。
- `poc/`：PoC 源码与证据；`demo/`：`sync_fifo` VCS/FSDB/Verdi/NPI。
- 安装：`bash bin/install.sh` → `~/.local/libexec/verdi-session/` + `~/.local/bin/verdi-session`。
- MCP 注册：`opencode.json` 的 `mcp.verdi`（stdio，`bun run mcp/src/server.ts`）。

## 运行 Verdi / VCS（项目内已知）

- **VCS（VERIFIED）**：`cd demo/sim && make sim`；`synenv.sh` 会 source `/opt/synopsys/env.synopsys.rc`，flags 对应 `.rc` 的 `vcscmd` alias。demo 实测 `TEST PASSED`。
- **Verdi（VERIFIED）**：`make verdi` 或 `make verdi-server PORT=11066`；底层为 `verdi --full64 ... -f filelist.f -ssf sync_fifo.fsdb`。需要 `DISPLAY`/`XAUTHORITY` 与 license（`.rc` 已提供 `SNPSLMD_LICENSE_FILE`）。
- **NPI（VERIFIED）**：`cd demo/npi && ./run_npi.sh`；`pynpi` 用系统 Python 3.11，需 `PYTHONPATH=$VERDI_HOME/share/NPI/python` 和 NPI/Qt5 的 `LD_LIBRARY_PATH`。demo 输出 `NPI SMOKE PASSED`。
- **关键细节**：FSDB 时间单位是 `1ps`；40 ns 的游标值是 `40000`。`-ssf` 打开的窗口不一定是新建的 nWave 窗口，操作前先 `wvOpenFile`。
- **NPI 性能**：短进程 ~3.1 s，其中 `npisys.init()` ~3.03 s；批量查询前需评估常驻 Reader。

## 证据标签

- **VERIFIED**：在本机（f29）实际执行并观察到结果。
- **DOCUMENTED_ONLY**：仅见本地文档，未执行。
- **NOT_TESTED**：既未执行、也无可信文档结论。
- **INFERRED / PROPOSED**：推理或设计提案。

## 交接（2026-10-27）

- **完成**：M0–M5 + Phase 2 v1 + **v2**——`bin/`、`mcp/`（37 工具）、`skills/`（7 个）、`scripts/`（acceptance / lifecycle / concurrency / writing-fsdb / remote-smoke）；真实 GUI 验收 **83 项检查**通过。
- **v2 新增**：`verdi_session_start/stop`、`verdi_window_raise`、`verdi_tcl_exec`（默认关闭）、`levels>1`（`cone_paths`，degraded）、常驻 NPI Reader、并发/远程/实时 FSDB 验证。
- **证据**：`poc/evidence/m1-m5/`、`poc/evidence/{lifecycle,concurrency,remote,writing-fsdb}/`、`poc/evidence/diff-levers/`。
- **仍未做**：broker；>16 信号无头渲染；`-dbdir` 下 fan-in leafpin；重载 opencode 让新工具在 agent 里可见。
- **下一步**：见 `progress.md` §4 NEXT；细节见 `md/08-implementation-status.md`。
- **差异化 3 前提（2026-10-18 实测）**：
  - KDB / `-dbdir` design-trace：**VERIFIED**（需 `VCS_HOME`；fan-in 不能 leafpin dump）。
  - Verdi 原生标注：**VERIFIED**（`wvSetMarker` / `wvAddCommentBox` / `verdiHighlightSignal`）；Protocol Analyzer 命令面 VERIFIED，解码 NOT_TESTED。
  - NPI P1：**VERIFIED negative**（903 MB / 128 信号：NPI 30.6 s vs GUI 27.0 s；同窗口 9.7 s；RSS ~8 GB）。`waveform_render` 必须收窄。
- **Phase 2 状态**：**v1 已实现**（按 `md/10` §8 收窄）：8 个协议无关原语 + 6 个 evidence 工具 + 7 个 skill；server 内无协议语义；`waveform_render` 限制 ≤16 信号 / ≤1000 bins。
- **有用的本地资料**：Verdi Tcl 官方参数库在 `$VERDI_HOME/etc/verdiTcl/linux64/verdi_tcl.db`（SQLite，`function_table.content` 为 JSON schema）；`info commands` 可枚举运行时命令。
