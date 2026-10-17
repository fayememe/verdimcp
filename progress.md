# progress.md — 推进基准

> 最后更新：2026-10-17 · session：项目初始化（git / opencode / 文档归档）
> 规则见 `AGENTS.md` §0.2。下个 session 只读本文件 + `md/README.md` 即可接手。

## 1. 当前状态

- **仓库**：`~/mydrv/aiwork/verdimcp`，git 已初始化（branch `main`），remote `origin` = `https://git.softkitty.me/faye/verdimcp.git`；已 push，`main` 跟随 `origin/main`。Forgejo 仓库 `faye/verdimcp`（private）由本次 session 创建。
- **文档**：inbox 原有 7 份文档已归档进 `md/` 并编号；`md/README.md` 为索引与交接；`AGENTS.md` 已改为 verdimcp / f29 规则。
- **opencode**：项目级 `opencode.json` 已建立，`instructions` 加载 `progress.md` 与 `md/README.md`；`AGENTS.md` 自动生效。
- **git 认证**：全局 `credential.helper = store --file=/home/faye/mycreds/.git_fayehome_cred` 已配置，凭据文件由 faye 放置；`git ls-remote` / `push` 均成功。
- **代码**：MCP server / skills 尚未开始；PoC 源码、脚本与证据已归档到 `poc/`（来自 `/tmp/opencode/verdi_poc/`）。
- **demo**：`demo/` 已建立 `rtl/`、`tb/`、`sim/`；DUT 为 `sync_fifo`（valid/ready + 空读 X 场景）。**尚未跑过 VCS/仿真**。
- **实测基线（f29）**：socket 传输、nWave 建窗/开库/加信号/游标/枚举、事件回调、截图、会话注册表已验证；值/跳变/XZ、设计追踪、NPI 未验证。详见 `md/01-test-progress.md`。

## 2. 研发计划（checklist）

- [x] 项目初始化：git / opencode / 文档归档
- [x] demo 骨架：`demo/{rtl,tb,sim}` + `sync_fifo` DUT/TB
- [ ] demo 跑通 VCS → FSDB → Verdi（VCS 调用命令待 faye 提供）
- [ ] **M0** PoC 固化：把 `/tmp/opencode/verdi_poc/` 的源码与脚本收进仓库；固定构建与复现入口
  - [x] 归档到 `poc/`（源码 / 脚本 / 证据）
  - [ ] 固定 `verdi-session` 的安装路径与一键构建/复现入口
- [ ] **M1** MCP 骨架：会话 / 窗口 / 截图 + `verdi` skill
- [ ] **M2** 波形工具：开 FSDB / 加信号 / 游标 / 信号列表 / dump + `verdi-waveform`
- [ ] **M3** 值 / 跳变 / XZ + `verdi-bus-debug`
- [ ] **M4** 设计追踪 / source + `verdi-design-trace`
- [ ] **M5** `verdi-evidence` + 端到端回归
- [ ] NPI 调研验证（可与 M2/M3 并行）：f29 `import pynpi`、license、性能
- [ ] 远程模式（本地 OpenCode → SSH → 远端 MCP）验证
- [ ] 多 agent 并发语义确认 / broker 决策

## 3. pending issues / blocker

1. **M0 未收口**：`verdi-session` 仍假定 `cmdclient` 位于 `~/.local/libexec/verdi-session/cmdclient`，安装路径与一键构建未固定。
2. **VCS 调用方式未知**：项目内没有 VCS 编译/运行命令；`demo/sim/Makefile` 的 VCS 目标是占位，未验证。
3. **代码布局未定**：`mcp/`、`skills/`、`bin/` 是否按 `03-mcp-plan.md` §3 放在仓库根；该文档里的 `~/mydrv/aiwork/verdi-tools/` 建议已过时。
4. **值 / 跳变 / XZ 查询未验证**（M3 前置）。
5. **设计追踪依赖 design DB**，可用性未知（M4 前置）。
6. **NPI `pynpi` 是否可导入、license 是否可用**未验证（`04-npi-research.md` P0）。
7. **多 client 并发连接结论不明确**（实测出现返回错配）→ 确认前保持每会话 `flock` / 单 broker。
8. **安全边界**：只操作自己注册的会话；f29 上可能有工程师正在使用，默认只读。

## 4. NEXT（下一步）

1. 拿到 faye 的 VCS 命令后，跑通 `demo`：编译 → 生成 `sync_fifo.fsdb` → `verdi -ssf` 打开。
2. 收口 M0：固定 `verdi-session` 安装路径，跑一遍 `poc/build.sh` + `run_poc.sh` 验证归档副本可用。
3. 确认代码布局后创建目录骨架，锁定 Bun + `@modelcontextprotocol/sdk`。
4. 开始 M1：先做 `verdi_sessions_list` / `session_info` / `windows_list` / `window_screenshot` 四个只读工具。
5. 同步 `md/03-mcp-plan.md` 的目录与里程碑状态。
6. 后续每次逻辑单元：commit + `git push`（凭据已就绪）。

## 5. 本 session 交接

- 本 session 只加 demo 骨架：**没有**改任何 Verdi 进程、**没有**跑 VCS/仿真、**没有**对 f29 发请求。
- 新增：`demo/rtl/sync_fifo.v`、`demo/tb/tb_sync_fifo.v`、`demo/sim/filelist.f`、`demo/sim/Makefile`、`demo/README.md`。
- 已确认：项目内**没有** VCS 调用命令；Verdi 启动方式有记录（`md/README.md` 的「运行 Verdi / VCS」）。
- 验证：文件结构与 Makefile 目标已检查；本机 PATH 无 `vcs` / `iverilog` / `verilator`，因此**未做语法或仿真验证**。
- 下个 session 接手：先读 `md/README.md`；拿到 faye 的 VCS 命令后跑 demo，并把结果写进 `md/01-test-progress.md`。
