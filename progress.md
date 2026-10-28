# progress.md — 推进基准

> 最后更新：2026-10-27 · session：v2（生命周期 / 并发 / 远程 / 实时 FSDB / levels）
> 规则见 `AGENTS.md` §0.2。下个 session 只读本文件 + `md/README.md` 即可接手。

## 1. 当前状态

- **仓库**：`~/mydrv/aiwork/verdimcp`，`main`；Forgejo `faye/verdimcp`（private）。
- **文档**：`md/` 权威文档（00–11 + README）；`AGENTS.md` 为宪法；`progress.md` 为推进基准。
- **opencode**：f29 上 **1.18.23**（Zed remote，wex 只做 UI）；`opencode.json` 注册本地 MCP server `verdi`（stdio，`bun run mcp/src/server.ts`）。
- **代码**：**M0–M5 + Phase 2 v1 + v2** 全部实现——`bin/`、`mcp/`（**37 工具** + 常驻 NPI Reader）、`skills/`（7 个）、`scripts/`（acceptance / lifecycle / concurrency / writing-fsdb / remote-smoke）。
- **验收**：`bash scripts/acceptance.sh` → **83 项检查通过**（demo `sync_fifo`，真实 GUI）；证据 `poc/evidence/m1-m5/`。
- **v2 实测**：
  - 生命周期（MCP 启停）：start 31 s / stop 0.6 s —— `poc/evidence/lifecycle/`
  - 并发：4×15=60 次无错配，抢锁 rc=75 `busy` —— `poc/evidence/concurrency/`
  - SSH 远程 stdio：握手 294 ms、37 工具 —— `poc/evidence/remote/`
  - 写入中的 FSDB：8/8 可读，`max_time` 增长、`is_completed` 正确 —— `poc/evidence/writing-fsdb/`
  - `levels>1`：**VERIFIED NEGATIVE**（`*ByLevel` 结果无法 dump 叶子引脚，只给 `cone_paths`）
- **运行时**：Bun + `@modelcontextprotocol/sdk` 1.32.1 + zod 4.6.7；审计 `~/.local/state/verdi-mcp/audit.jsonl`。
- **demo**：`demo/sim`（sync_fifo）、`demo/bigfsdb`（903 MB 生成器）、`demo/writing`（长时间写入 FSDB）、`demo/npi`。
- **未提交**：v2 的代码与文档（本次 session 将按逻辑单元 commit）。

## 2. 研发计划（checklist）

- [x] 项目初始化：git / opencode / 文档归档
- [x] demo 骨架 + VCS/FSDB/Verdi 全链路
- [x] **M0–M5**：`bin/`、`mcp/`、`skills/`、端到端验收
- [x] **Phase 2 v1**：8 原语 + 6 evidence 工具 + 7 skill（render 收窄）
- [x] 差异化 3 前提：KDB / 原生标注 / NPI P1（negative）
- [x] **v2：会话生命周期工具**（`verdi_session_start/stop`）
- [x] **v2：`verdi_window_raise`**（`wvRaiseWindow`，无需 xdotool）
- [x] **v2：raw Tcl 逃生口**（`verdi_tcl_exec`，`VERDI_ALLOW_RAW=1`，逐条审计）
- [x] **v2：`levels>1`**（`*ByLevel`，返回 `cone_paths` + `degraded`；叶子引脚 negative）
- [x] **v2：常驻 NPI Reader**（`npi_worker.py --serve` + `mcp/src/npi.ts`）
- [x] **v2：并发语义实测**（`scripts/concurrency.sh`，60 次）
- [x] **v2：SSH 远程模式实测**（`scripts/remote-smoke.sh`，临时 sshd）
- [x] **v2：正在写入的 FSDB 实测**（`scripts/writing-fsdb.sh`，`demo/writing`）
- [x] **v2：验收扩展**（83 项）
- [ ] 重载 opencode，确认 37 个 `verdi_*` 工具在 agent 内可见（需人工/新会话）
- [ ] 真实 RTL/SoC bug 的端到端工作流（signal map → beats → scan → check → evidence）
- [ ] broker / 多 agent 排队策略（当前 flock 已够用）
- [ ] `-dbdir` 下 fan-in leafpin dump；>16 信号无头渲染

## 3. pending issues / blocker

1. **MCP 未在本会话重载**：`opencode.json` 已注册；新会话/重载后可见 37 个工具。
2. **`levels>1` 无叶子引脚**：Verdi W-2024.09 限制，已如实返回 `cone_paths` + `degraded`；不是 bug。
3. **实时 FSDB 依赖 flush**：VCS 不 `$fsdbDumpflush` 时结果只覆盖缓冲区；工具返回值含 `max_time`，agent 需自行判断完整性。
4. **远程 GUI 环境**：ssh 非交互 shell 无 `DISPLAY`；用 `~/.ssh/environment` 或 `verdi_session_start({display})`。
5. **无 broker**：并发靠 per-session `flock`；公平性/排队可观测性未做（非阻塞）。
6. **未被验证的机器上会话**：f29 上有 3 个他人的 Novas GUI（无 `-serverPort`），按红线从不触碰。
7. **未 commit**：v2 改动仍在工作区，本次 session 收尾时提交。

## 4. NEXT（下一步）

1. **重载 opencode**，确认 37 个工具可见；用真实会话跑一次 v2 工具。
2. **commit + push**（按逻辑单元拆分：tools / npi / scripts / docs / evidence）。
3. **真实 RTL bug 工作流**：signal map → handshake beats → window scan → check define/run → evidence report。
4. 视需要：`-dbdir` fan-in、>16 信号渲染、broker。

## 5. 本 session 交接

- **做了什么**：实现 v2 的 4 个工具（session_start/stop、window_raise、tcl_exec）+ `levels>1`；把 NPI 改造成常驻 Reader；新增 4 个验证脚本并跑出证据；扩展验收到 83 项；同步全部文档。
- **关键结论**：
  - 并发**不需要 broker**（flock 已实测正确）。
  - 远程 stdio **协议纯净**（ssh 跳板可用，注意 DISPLAY）。
  - 写入中的 FSDB 可读，但要 flush + 看 `is_completed`。
  - `levels>1` 拿不到叶子引脚（negative，已记录）。
- **证据目录**：`poc/evidence/{m1-m5,lifecycle,concurrency,remote,writing-fsdb,diff-levers}`。
- **有用资料**：`$VERDI_HOME/etc/verdiTcl/linux64/verdi_tcl.db`（SQLite，Verdi Tcl 官方参数 schema）。
- **下个 session 接手**：先读本文件 §4，再读 `md/08-implementation-status.md` §v2。
