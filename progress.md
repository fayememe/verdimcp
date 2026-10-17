# progress.md — 推进基准

> 最后更新：2026-10-17 · session：项目初始化（git / opencode / 文档归档）
> 规则见 `AGENTS.md` §0.2。下个 session 只读本文件 + `md/README.md` 即可接手。

## 1. 当前状态

- **仓库**：`~/mydrv/aiwork/verdimcp`，git 已初始化（branch `main`），remote `origin` = `https://git.softkitty.me/faye/verdimcp.git`；已 push，`main` 跟随 `origin/main`。Forgejo 仓库 `faye/verdimcp`（private）由本次 session 创建。
- **文档**：inbox 原有 7 份文档已归档进 `md/` 并编号；`md/README.md` 为索引与交接；`AGENTS.md` 已改为 verdimcp / f29 规则。
- **opencode**：项目级 `opencode.json` 已建立，`instructions` 加载 `progress.md` 与 `md/README.md`；`AGENTS.md` 自动生效。
- **git 认证**：全局 `credential.helper = store --file=/home/faye/mycreds/.git_fayehome_cred` 已配置，凭据文件由 faye 放置；`git ls-remote` / `push` 均成功。
- **代码**：MCP server / skills 尚未开始；PoC 源码、脚本与证据已归档到 `poc/`（来自 `/tmp/opencode/verdi_poc/`）。
- **demo**：`demo/` 的 `sync_fifo` 已跑通 **VCS 编译/仿真 → FSDB → Verdi**；`make sim` 输出 `TEST PASSED`，`make verdi-server` + libnclt 成功加入 11 个信号并看到 X。详见 `demo/README.md`。
- **实测基线（f29）**：socket 传输、nWave 建窗/开库/加信号/游标/枚举、事件回调、截图、会话注册表已验证；值/跳变/XZ、设计追踪、NPI 未验证。详见 `md/01-test-progress.md`。

## 2. 研发计划（checklist）

- [x] 项目初始化：git / opencode / 文档归档
- [x] demo 骨架：`demo/{rtl,tb,sim}` + `sync_fifo` DUT/TB
- [x] demo 跑通 VCS → FSDB → Verdi（`make sim` + `make verdi-server` + libnclt）
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
2. **代码布局未定**：`mcp/`、`skills/`、`bin/` 是否按 `03-mcp-plan.md` §3 放在仓库根；该文档里的 `~/mydrv/aiwork/verdi-tools/` 建议已过时。
3. **值 / 跳变 / XZ 查询未验证**（M3 前置）；demo 已提供 X 场景，可直接用来验证。
4. **设计追踪依赖 design DB**，可用性未知（M4 前置）。
5. **NPI `pynpi` 是否可导入、license 是否可用**未验证（`04-npi-research.md` P0）。
6. **多 client 并发连接结论不明确**（实测出现返回错配）→ 确认前保持每会话 `flock` / 单 broker。
7. **安全边界**：只操作自己注册的会话；f29 上可能有工程师正在使用，默认只读。

## 4. NEXT（下一步）

1. 收口 M0：固定 `verdi-session` 安装路径，跑一遍 `poc/build.sh` + `run_poc.sh` 验证归档副本可用。
2. 确认代码布局后创建目录骨架，锁定 Bun + `@modelcontextprotocol/sdk`。
3. 开始 M1：先做 `verdi_sessions_list` / `session_info` / `windows_list` / `window_screenshot` 四个只读工具。
4. 用 demo 的 X 场景做 M3 的第一个值/跳变/XZ 回归。
5. 同步 `md/03-mcp-plan.md` 的目录与里程碑状态。
6. 后续每次逻辑单元：commit + `git push`（凭据已就绪）。

## 5. 本 session 交接

- 本 session：建立 demo，并用 faye 提供的 VCS/Verdi 流程跑通。只启动了自己的 Verdi 会话（PID `3066447`，port `11066`），验证后已 kill；未触碰其他会话。
- 新增/修改：`demo/rtl/sync_fifo.v`、`demo/tb/tb_sync_fifo.v`、`demo/sim/{filelist.f,Makefile,synenv.sh}`、`demo/README.md`、`demo/evidence/nwave.png`。
- 验证结果：
  - `make sim` → `TEST PASSED`，`$finish` at 240 ns，生成 `sync_fifo.fsdb`（9677 bytes）；
  - `make verdi-server PORT=11066` → 19 s 后端口监听；
  - `wvCreateWindow` → `wvOpenFile` → `wvAddSignal`（11 个信号全部成功）→ `wvSetCursor 40000`；
  - `wvGetFileTimeUnit` → **1ps**（40 ns 对应 40000，不是 40）；
  - `rd_data` 在空 FIFO 阶段显示 X；截图见 `demo/evidence/nwave.png`。
- 重要细节：`-ssf` 打开的窗口不一定是新建的 nWave 窗口；必须对新窗口先 `wvOpenFile`，否则 `wvAddSignal` 返回 0。
- 下个 session 接手：先读 `md/README.md`，再执行 §4 NEXT；demo 已可作为 M3 的 X/跳变回归输入。
