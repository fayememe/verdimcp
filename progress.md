# progress.md — 推进基准

> 最后更新：2026-10-17 · session：项目初始化（git / opencode / 文档归档）
> 规则见 `AGENTS.md` §0.2。下个 session 只读本文件 + `md/README.md` 即可接手。

## 1. 当前状态

- **仓库**：`~/mydrv/aiwork/verdimcp`，git 已初始化（branch `main`），remote `origin` = `https://git.softkitty.me/faye/verdimcp.git`；初始 commit 已建立。
- **文档**：inbox 原有 7 份文档已归档进 `md/` 并编号；`md/README.md` 为索引与交接；`AGENTS.md` 已改为 verdimcp / f29 规则。
- **opencode**：项目级 `opencode.json` 已建立，`instructions` 加载 `progress.md` 与 `md/README.md`；`AGENTS.md` 自动生效。
- **git 认证**：全局 `credential.helper = store --file=/home/faye/mycreds/.git_fayehome_cred` 已配置；**该文件当前不存在**，push 仍被阻塞（详见 pending #1）。
- **代码**：MCP server / skills 尚未开始；PoC 源码、脚本与证据已归档到 `poc/`（来自 `/tmp/opencode/verdi_poc/`）。
- **实测基线（f29）**：socket 传输、nWave 建窗/开库/加信号/游标/枚举、事件回调、截图、会话注册表已验证；值/跳变/XZ、设计追踪、NPI 未验证。详见 `md/01-test-progress.md`。

## 2. 研发计划（checklist）

- [x] 项目初始化：git / opencode / 文档归档
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

1. **push 被凭据阻塞**：按 `~/matrix/homelab/services/git.md` 已配置全局 `credential.helper = store --file=/home/faye/mycreds/.git_fayehome_cred`，但**该文件不存在**（该目录下只有 `.nas19_cred`，格式也不是 git credential-store）。→ 需 faye 放置该凭据文件（0600），不要自行生成。补充：LAN `10.3.9.19:2222` 可达但当前 SSH key 未被 Forgejo 授权；HTTPS 未认证访问仓库返回 404（可能 private）。
2. **M0 未收口**：`verdi-session` 仍假定 `cmdclient` 位于 `~/.local/libexec/verdi-session/cmdclient`，安装路径与一键构建未固定。
3. **代码布局未定**：`mcp/`、`skills/`、`bin/` 是否按 `03-mcp-plan.md` §3 放在仓库根；该文档里的 `~/mydrv/aiwork/verdi-tools/` 建议已过时。
4. **值 / 跳变 / XZ 查询未验证**（M3 前置）。
5. **设计追踪依赖 design DB**，可用性未知（M4 前置）。
6. **NPI `pynpi` 是否可导入、license 是否可用**未验证（`04-npi-research.md` P0）。
7. **多 client 并发连接结论不明确**（实测出现返回错配）→ 确认前保持每会话 `flock` / 单 broker。
8. **安全边界**：只操作自己注册的会话；f29 上可能有工程师正在使用，默认只读。

## 4. NEXT（下一步）

1. faye 放置 `~/mycreds/.git_fayehome_cred`（0600）；然后 `GIT_TERMINAL_PROMPT=0 git fetch origin` 验证，成功后 `git push -u origin main`。若仓库尚未创建，先在 Forgejo 建 `faye/verdimcp`（private）。
2. 收口 M0：固定 `verdi-session` 安装路径，跑一遍 `poc/build.sh` + `run_poc.sh` 验证归档副本可用。
3. 确认代码布局后创建目录骨架，锁定 Bun + `@modelcontextprotocol/sdk`。
4. 开始 M1：先做 `verdi_sessions_list` / `session_info` / `windows_list` / `window_screenshot` 四个只读工具。
5. 同步 `md/03-mcp-plan.md` 的目录与里程碑状态。

## 5. 本 session 交接

- 本次只做初始化与归档：**没有**改任何 Verdi 进程、**没有**对 f29 发请求、**没有** push。
- 首次 commit 已建立：`chore: initialize verdimcp project`。
- 变更文件：`.gitignore`、`opencode.json`、`README.md`、`md/`（7 份归档 + `README.md`）、`progress.md`、`AGENTS.md`（标题与 §5.1 安全条款改为 verdimcp / f29 口径）、`poc/`（源码 / 脚本 / 证据）。
- 验证方式与结果：
  - `opencode debug config` → exit 0，`instructions` 解析为 `["progress.md","md/README.md"]`；
  - `python3 -m json.tool opencode.json` → 合法 JSON；
  - `git remote -v` → origin = `https://git.softkitty.me/faye/verdimcp.git`；
  - `git check-ignore` → `.env`、`node_modules/`、`.omo/`、`artifacts/`、`verdiLog/` 均被忽略；
  - `grep` → 旧项目名 / 旧域名 / 旧文件名仅出现在本文件的变更说明和 `inbox/README.md` 的归档映射中。
- 下个 session 接手：先读 `md/README.md`，再执行 §4 NEXT 第 1–2 项。
