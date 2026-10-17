# AGENTS.md — verdimcp

> 本文件是本仓库的 **项目宪法（constitution）**。任何 agent / 协作者在动手前必须先读它，再读 `md/` 下的设计文档。
> 若本文件与 `md/` 文档冲突，以 `md/` 中**已标记为「已定稿（frozen）」**的设计文档为准，并回填本文件。
>
> 远程仓库：`https://git.softkitty.me/faye/verdimcp`（homelab Forgejo，**private**）。
>
> 项目：**Verdi MCP** — 让 AI agent 通过 MCP 观察并操作正在运行的 Verdi/nWave 会话（目标宿主 f29，Verdi W-2024.09-SP1）。不替换 Verdi GUI，不把 RTL/FSDB 传到外部服务。背景见 `md/README.md`。

---

## 0. 工作原则：会话是一次性的，文档是持久的 ★

> 这是本仓库最高优先级的工作纪律。**每次 session 都默认「随时可能中断、且不会再继续」**。

### 0.1 第一原则

- 每一次 agent chat session 都**随时可能中断、且不会再继续**。只存在于对话里的结论 = 丢失。
- 因此：**结论必须「边走边写（on the go）」进 `md/` / `progress.md`**，不要攒到最后。
- 每完成一个决策 / 发现 / 讨论，**立刻**更新对应文档。
- **默认下一个 session 对本对话一无所知**——它只能读到本文件与仓库里的文档。据此保证文档**自洽、可独立接手**。

### 0.2 `progress.md` 是推进的唯一基准 ★

- **从此刻起，所有推进以根目录 `progress.md` 为准**，随时更新。
- 内容固定五段：**当前状态** / **研发计划（checklist：TODO + 打勾，不讲细节）** / **pending issues / blocker** / **NEXT（下一步）** / **本 session 交接**。
- 下个 session 只读 `progress.md` + `md/README.md` 即可接手。

### 0.3 结束 session 前的 checklist（或任何时候可能被中断前）

1. 新决策已进对应 `md/` 文档（含决策台账，若适用）；
2. 开放问题 / 待办已写进文档；
3. `md/README.md` 的「当前状态 / 交接」是最新的；
4. `progress.md` 的 checklist / pending / NEXT / 交接 是最新的；
5. 记清 session 状态后，即可**回收 session**。

### 0.4 文档先行

- **`md/` 是权威来源**。代码是文档的实现，不是反过来。改了行为要同步改文档。
- 先改 `md/` → 评审通过 → 再落代码。

---

## 5. 编码与协作规范

### 5.1 硬约束

- **禁止** 用 `as any` / `@ts-ignore` / `# type: ignore` 等抑制类型/错误检查。
- **禁止** 空 `except` / 静默吞异常（至少 log + 明确降级行为）。
- 隐私：任何真实 API key / token / 个人数据**绝不入库**，走 `.env`（已在 `.gitignore`）。
- **登录凭据（密码 / 挑战码）绝不落盘、绝不写入任何文件或提交**；需要的登录由人工完成。
- **禁止** 自动化 / 绕过任何访问控制（license、认证、验证码）。
- ★ **只操作自己的 Verdi 会话**：仅可控制本项目注册表（`~/.local/state/verdi-sessions/`）中由自己启动、且 cmdline 含匹配 `-serverPort` 的进程；**禁止** attach、修改或杀死其他用户的会话。
- ★ **f29 上的 Verdi 可能正被工程师使用：默认只读观测**。改变 GUI 状态（开窗、加信号、移游标、关会话）前先确认目标会话与影响；禁止压测、批量请求或破坏性动作。
- 破坏性操作（`force-push`、改历史、删分支/仓库）需**明确要求**后才可执行。

### 5.2 工作方式

- **边走边写**（见 §0）：决策一旦形成就落文档。
- **维护 `progress.md`**（见 §0 ★）：随时更新，收工前记清 session 状态。
- **文档先行**：先改 `md/`，评审通过，再落代码。
- **小步提交**：一个逻辑单元一次提交；提交信息说明「做了什么 + 为什么」。
- 每次改动后：跑 lint / 测试 / 类型检查（若已建立），并给出证据。

---

## 6. 参考

- **homelab git 服务**：`https://git.softkitty.me`（Forgejo，private 仓库）；凭据走 `git credential.helper`，不写进 remote URL。
