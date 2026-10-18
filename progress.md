# progress.md — 推进基准

> 最后更新：2026-10-17 · session：初始化 + demo/NPI + 邻目录进展同步
> 规则见 `AGENTS.md` §0.2。下个 session 只读本文件 + `md/README.md` 即可接手。

## 1. 当前状态

- **仓库**：`~/mydrv/aiwork/verdimcp`，`main` 跟随 `origin/main`；Forgejo `faye/verdimcp`（private）。
- **文档**：`md/` 已归档 7 份设计文档；`md/README.md` 为索引/交接；`AGENTS.md` 为 verdimcp / f29 口径。
- **opencode**：`opencode.json` 的 `instructions` 加载 `progress.md` 与 `md/README.md`；`AGENTS.md` 自动生效。
- **git 认证**：全局 `credential.helper = store --file=/home/faye/mycreds/.git_fayehome_cred`；`push` 正常。
- **代码**：MCP server / skills **尚未开始**；PoC 与证据在 `poc/`。
- **demo**：`demo/` 的 `sync_fifo` 已跑通 **VCS → FSDB → Verdi/libnclt**；`make sim` 输出 `TEST PASSED`；`make verdi-server` + libnclt 成功加入 11 个信号并看到 X。
- **NPI**：P0 已通——`pynpi`（系统 Python 3.11 / Verdi Python 3.8）、license、打开 FSDB、单点值/X/VC count 均正确；短进程 ~3.1 s（`npisys.init()` ~3.03 s）、峰值 RSS ~106 MB。脚本 `demo/npi/`。
- **邻目录同步**：`/home/faye/mydrv/aiwork/opencode` 于 16:42 更新，新增 GUI 值/跳变/X-Z、设计追踪、NPI 结论；已合并到 `md/01-test-progress.md` §5A–5E，证据归档到 `poc/evidence/`。
- **实测基线（f29）**：socket、nWave、事件、截图、会话注册表、**GUI 值/跳变/XZ、设计追踪、NPI** 均已验证；剩余：SSH/多用户、大 FSDB、并发语义、全量 XZ 扫描封装。

## 2. 研发计划（checklist）

- [x] 项目初始化：git / opencode / 文档归档
- [x] demo 骨架 + VCS/FSDB/Verdi 全链路
- [x] 邻目录新进展同步（GUI 值/跳变/XZ、设计追踪、NPI）
- [ ] **M0** PoC 固化
  - [x] 归档到 `poc/`（源码 / 脚本 / 证据）
  - [ ] 固定 `verdi-session` 安装路径与一键构建/复现入口
- [ ] **M1** MCP 骨架：会话 / 窗口 / 截图 + `verdi` skill
- [ ] **M2** 波形工具：开 FSDB / 加信号 / 游标 / 信号列表 / dump + `verdi-waveform`
  - [x] 后端能力已验证
  - [ ] MCP 工具 + skill
- [ ] **M3** 值 / 跳变 / XZ + `verdi-bus-debug`
  - [x] 后端能力：GUI 值/跳变、NPI 值/X/Z 已验证
  - [ ] MCP 工具 + skill（含预算/续查/截断）
- [ ] **M4** 设计追踪 / source + `verdi-design-trace`
  - [x] 后端能力：driver/load/fan-in/X/source 已验证（需 `-f` 设计库）
  - [ ] MCP 工具 + skill
- [ ] **M5** `verdi-evidence` + 端到端回归
- [x] NPI P0：`pynpi`、license、demo FSDB 单点值/X
- [ ] NPI P1：大 FSDB、常驻 Reader 决策（GUI 对比已做）
- [ ] 远程模式（本地 OpenCode → SSH → 远端 MCP）验证
- [ ] 多 agent 并发语义确认 / broker 决策

## 3. pending issues / blocker

1. **M0 未收口**：`verdi-session` 仍假定 `cmdclient` 位于 `~/.local/libexec/verdi-session/cmdclient`。
2. **代码布局未定**：`mcp/`、`skills/`、`bin/` 是否按 `03-mcp-plan.md` §3 放在仓库根。
3. **全量 X/Z 扫描未封装**：GUI 逐点 3240 次查询超时；NPI 路径可用，但还没有预算/续查/截断的工具层。
4. **设计追踪依赖 `-f` 设计库**；无库时需要明确的降级/`not_supported` 行为。
5. **NPI P1 未做**：GB 级 FSDB、正在写入的 FSDB、常驻 Reader 的内存/延迟/崩溃恢复。
6. **多 client 并发结论不明确**（实测返回错配）→ 确认前保持每会话 `flock` / 单 broker。
7. **安全边界**：只操作自己注册的会话；f29 上可能有工程师正在使用，默认只读。
8. **`poc/scan_xz.py` 是原型**：`scan_out.txt` 是缺 `libnclt` 的失败记录，不代表 XZ 能力结论。

## 4. NEXT（下一步）

1. 收口 M0：固定 `verdi-session` 安装路径，跑通 `poc/build.sh` + `run_poc.sh`。
2. 确认代码布局，创建 MCP 目录骨架，锁定 Bun + `@modelcontextprotocol/sdk`。
3. 开始 M1：`verdi_sessions_list` / `session_info` / `windows_list` / `window_screenshot` 四个只读工具 + `verdi` skill。
4. 做 M3/M4 工具层：值/跳变/XZ 预算与续查；driver/fan-in/source 的 `-f` 依赖与降级。
5. NPI P1：128 signals 批量、大 FSDB、常驻 Reader 决策。
6. 封装 NPI XZ 扫描（分页 + `resume_from` + `truncated`）。
7. 后续每次逻辑单元：commit + `git push`。

## 5. 本 session 交接

- 本 session 做了三件事：初始化/归档、demo + NPI P0、同步邻目录新测试进展；没有触碰其他用户的 Verdi 会话。
- **邻目录新增结论**（已并入 `md/01-test-progress.md`）：
  - GUI 值：`wvGetSigValueByTime` / `wvGetCurValueString`；`-lz` 定宽；X/Z 保留字符串；总线名用 `{}`；信号须先加入窗口。
  - 跳变：`wvSearchNextBySignal` 是“找下一个”，需循环；glitch 会跳过。
  - X/Z：`vcd2fsdb` 自制 `tri.vcd`，x/0/z/1 与全 Z 总线均能读出。
  - 设计追踪：`srcCreateWindow` / `srcGetCaretFile` / `schCreateWindow` / `schTraceDriver` / `schTraceFanIn` / `schTraceLoad` / `schDumpTracedLeafPin` / `schCreateWindow -X` / `schQueryObj`；需 `-f` 设计库。
  - NPI：点分隔、无前导斜杠；GUI ~0.22 s/查询 vs NPI 进程内 <0.1 ms/查询。
- **新增归档**：`poc/scan_xz.py`、`poc/evidence/{scan_out.txt,nschema_x.png,source_window.png,tri.vcd,tri.vcd.fsdb,leafpin.rpt}`。
- **下个 session 接手**：先读 `md/README.md`，再执行 §4 NEXT；后端能力已足够开始 M1，不要再重复验证值/跳变/XZ。
