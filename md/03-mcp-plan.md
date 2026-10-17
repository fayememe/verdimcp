# Verdi MCP 方案

> 状态：方案设计（MCP 尚未实现；后端已有一个可用的 PoC）
> 目标宿主：f29，Verdi W-2024.09-SP1
> 相关文档：`01-test-progress.md`、`06-vs-verdi-bridge.md`、`05-web-api-reference.md`

---

## 1. 目标

让 AI agent 在**工程师正在使用的 Verdi GUI** 上完成：

1. 发现并选择会话；
2. 打开 FSDB、摆放信号、移动游标、截图；
3. 查询波形值、跳变、X/Z；
4. 查询设计结构（driver / fan-in / fan-out / source）；
5. 按领域流程（总线调试、X/Z 定位、证据汇报）自动工作。

非目标：替代 Verdi、编辑 RTL、绕过 license、把 RTL/FSDB 传到外部服务。

---

## 2. 三层架构

```
Skills（怎么想）
   │  领域流程、验收标准、降级策略
   ▼
MCP（能调什么）
   │  强类型工具、参数校验、结构化返回
   ▼
后端（怎么连）
   │  会话注册表 + cmdclient + （后续）broker / NPI
   ▼
Verdi GUI（-serverPort）/ FSDB Reader（无 GUI）
```

分工原则：

- **Skills 负责判断**：什么算证据、先查什么、没有设计库时怎么降级。
- **MCP 负责动作**：一个工具一次明确的 Verdi 操作，参数和返回都可校验。
- **后端负责连接**：端口分配、进程守护、串行化、超时。

---

## 3. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| MCP 运行时 | **Bun + TypeScript** | 本机无 node/npm，但有 bun 1.3.14；npm registry 可达 |
| MCP SDK | `@modelcontextprotocol/sdk` | 官方 SDK，stdio 传输 |
| 会话管理 | 复用已验证的 `verdi-session`（Python） | 已实测端口分配、注册表、启停、stale 检测 |
| Verdi 命令 | 复用已验证的 `cmdclient`（C + libnclt） | 已实测连接、返回值、事件、nWave 操作 |
| 并发 | 每会话 `flock` 串行化 `cmdclient` 调用 | 规避"多 client 语义未证实"的风险 |
| broker | M1 不做；多 agent 并发时再加 | MCP 工具面不变，后端可替换 |
| 无头查询 | 后续接 NPI / FSDB Reader | 大 FSDB 不占 GUI |

目录结构（建议）：

> 注（2026-10-17）：仓库根已定为 `~/mydrv/aiwork/verdimcp/`；下图的 `verdi-tools/` 视为仓库根，`docs/` 由 `md/` 取代。子目录是否照此创建仍待确认（见 `progress.md` pending #4）。

```
~/mydrv/aiwork/verdi-tools/          # 待确认是否进 Syncthing
├── bin/
│   ├── verdi-session                # 会话管理（已实现）
│   ├── cmdclient                    # libnclt 客户端（已实现）
│   └── build.sh
├── mcp/
│   ├── package.json
│   ├── src/server.ts                # MCP 工具注册
│   └── src/backend.ts               # 调用 verdi-session / cmdclient
├── skills/
│   ├── verdi/SKILL.md
│   ├── verdi-waveform/SKILL.md
│   ├── verdi-bus-debug/SKILL.md
│   ├── verdi-design-trace/SKILL.md
│   └── verdi-evidence/SKILL.md
└── docs/
```

---

## 4. MCP 工具面

设计原则：

- **粗粒度**：一次调用可传多个信号/scope，减少 agent 往返。
- **强类型**：时间必须带单位；信号必须是绝对路径；枚举值显式。
- **能力诚实**：未验证的功能返回 `not_tested`，不假装成功。
- **只读优先**：查询类工具不改变 GUI 状态；改视图类工具单独标记。
- **逃生口受控**：原始 Tcl 默认关闭。

### 4.1 能力与会话

| 工具 | 输入 | 输出 | 后端状态 |
|---|---|---|---|
| `verdi_capabilities` | — | verified/documented/untested 矩阵 | 设计 |
| `verdi_sessions_list` | — | id/port/pid/fsdb/state | VERIFIED |
| `verdi_session_start` | fsdb, design, args, label | sid/port | VERIFIED |
| `verdi_session_stop` | sid | ok | VERIFIED |
| `verdi_session_info` | sid | 完整会话信息 | VERIFIED |

### 4.2 窗口与视觉

| 工具 | 输入 | 输出 | 后端状态 |
|---|---|---|---|
| `verdi_windows_list` | sid | wid / xid / kind | VERIFIED |
| `verdi_window_create` | sid | wid | VERIFIED |
| `verdi_window_screenshot` | sid, wid | PNG（MCP image content） | VERIFIED |
| `verdi_window_raise` | sid, wid | ok | DOCUMENTED |

### 4.3 波形

| 工具 | 输入 | 输出 | 后端状态 |
|---|---|---|---|
| `verdi_fsdb_open` | sid, wid, path, unit | ok | VERIFIED |
| `verdi_signals_list` | wid, scope/search, limit | 绝对路径列表 | 部分 VERIFIED |
| `verdi_signals_add` | wid, signals[] | 每信号结果 | VERIFIED |
| `verdi_signals_remove` | wid, signals[] | ok | DOCUMENTED |
| `verdi_cursor_set` | wid, time, unit | 实际时间 | VERIFIED |
| `verdi_value_get` | wid, signal, time, unit | value + X/Z | **NOT_TESTED** |
| `verdi_transitions_get` | wid, signal, start, end, unit, max | 跳变列表 | **NOT_TESTED** |
| `verdi_xz_scan` | wid, scope, start, end, max | 候选列表 | **NOT_TESTED** |

### 4.4 设计

| 工具 | 输入 | 输出 | 后端状态 |
|---|---|---|---|
| `verdi_scopes_list` | sid, root, limit | scope 列表 | DOCUMENTED |
| `verdi_drivers_get` | sid, signal | driver 列表 | **NOT_TESTED** |
| `verdi_fanin_get` | sid, signal, levels | cone | **NOT_TESTED** |
| `verdi_fanout_get` | sid, signal, levels | cone | **NOT_TESTED** |
| `verdi_source_get` | sid, signal/file, line | 源码片段 | **NOT_TESTED** |

### 4.5 逃生口

| 工具 | 条件 | 说明 |
|---|---|---|
| `verdi_command` | 环境变量 `VERDI_ALLOW_RAW=1` | 原始 Tcl，逐条审计，默认关闭 |

---

## 5. Skills

| Skill | 触发场景 | 核心内容 |
|---|---|---|
| `verdi` | 任何 Verdi 操作 | 能力发现、会话选择、安全红线、GUI vs 无头查询的选择 |
| `verdi-waveform` | 看波形 / 查值 | 时间单位、采样沿、信号命名、游标、X/Z 语义 |
| `verdi-bus-debug` | "总线访问没到" / 握手卡住 | 从系统 md 生成逐跳检查表，定位首个 `valid && !ready` |
| `verdi-design-trace` | 追 driver / fan-in / cone / 源码 | 设计库依赖、无库时降级为时间相关候选 |
| `verdi-evidence` | 收尾 / 汇报 | 证据标签、可复现命令、结论强度、禁止编造 |

每个 skill 必须包含：

1. 适用与不适用场景；
2. 依赖的工具及调用顺序；
3. 先只读、后改 GUI 的顺序；
4. 失败/缺数据时的降级路径；
5. 输出格式（含证据标签）。

---

## 6. 安全与并发

| 规则 | 实现 |
|---|---|
| 只绑 loopback | MCP 走 stdio；broker（若启用）绑 `127.0.0.1` |
| 不碰别人的会话 | 只操作 cmdline 含 `-serverPort <port>` 的进程 |
| 不自动重试写操作 | 视图/信号变更失败后先查状态 |
| 原始 Tcl 默认关闭 | `VERDI_ALLOW_RAW=1` + 审计日志 |
| 破坏性命令 denylist | `debExit`、`wvExit`、文件删除、覆盖导出 |
| 每会话串行 | `flock` 包住每次 `cmdclient` 调用 |
| 审计 | 记录 sid、命令、结果、耗时、调用者 |

---

## 7. 会话与端口管理（已实现）

- 端口段：Verdi 11000–11999；避开 ephemeral 32768–60999。
- 注册表：`~/.local/state/verdi-sessions/<sid>.json`（0600）。
- 分配：`flock` + 预留文件 + `ss` 探测。
- 发现：`list` 校验 pid 存活、端口监听、cmdline 匹配。
- 清理：`stop` 只杀匹配端口的进程；`prune` 只删 stale 条目。
- 选择器：id / label / port。

---

## 8. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | MCP 骨架 + 会话/窗口/截图 + `verdi` skill | opencode 能发现会话、开窗口、截图 |
| M2 | 波形工具（打开/加信号/游标/列表/dump）+ `verdi-waveform` | 一条命令摆好现场 |
| M3 | 值/跳变/XZ + `verdi-bus-debug` | 真实 FSDB 上跑通逐跳检查 |
| M4 | 设计追踪 + source + `verdi-design-trace` | 有库给结构，无库返回 `not_supported` |
| M5 | `verdi-evidence` + 端到端回归 | 报告可复现、标签正确 |

---

## 9. 待确认决策

1. 代码目录：`~/mydrv/aiwork/verdi-tools/` 还是 `~/work/`（不同步）？
2. M1 是否维持"直连 CLI、不写 broker"？
3. 是否增加"挂载已有 GUI"的 Tcl adapter 通道（否则必须带 `-serverPort` 重启）？
4. 是否参考/复用 `verdi_bridge`（MIT）的传输与语义设计？

---

## 10. 与现有文档的关系

- `00-recon.md`：可行性结论与 PoC 证据。
- `05-web-api-reference.md`：如果未来把后端做成 HTTP 服务，端点以此为准。
- `01-test-progress.md`：当前实测到哪一步。
- `06-vs-verdi-bridge.md`：与开源方案的对比与差异化策略。
