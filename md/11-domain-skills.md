# 领域 skills — 设计定稿（决策流程）

> 状态：**已实现**（2026-10-18；6 个 active + performance v2 stub）· 证据标签：VERIFIED（demo acceptance）
> 上游：`06-vs-verdi-bridge.md` §5.1（Skills 差异化）、`03-mcp-plan.md` §5（Skills）
> 定位：三大差异化杠杆之一，与 `09-protocol-analysis.md`、`10-visual-evidence.md` 共用同一骨架。

## 0. 一句话

Skill 不是 prompt，是**决策流程**：何时用 → 先查什么 → 查到什么程度算够 → 降级 → 输出 + 证据标签。所有 skill 共享同一套证据 schema（产出喂给 `10-visual-evidence.md`）。

## 1. 共享约定（每个 skill 都必须包含）

1. 适用 / 不适用场景；
2. 依赖工具及调用顺序；
3. 先只读、后改 GUI 的顺序；
4. 失败 / 缺数据的降级路径；
5. 输出格式（含证据标签）。

## 2. 技能库（7 个）

| Skill | 触发场景 | 决策流程要点 |
|---|---|---|
| `verdi` | 任何 Verdi 操作 | 能力发现 → 会话选择 → 安全红线（只操作自己会话、只读优先、raw 默认关）→ GUI vs NPI 路由 |
| `verdi-waveform` | 看波形 / 查值 | 时间单位(1ps) → 采样沿 → 信号命名(GUI `/` vs NPI `.`) → 游标 → X/Z 语义 |
| `verdi-bus-debug` | 总线访问没到 / 握手卡住 | 见 `09-protocol-analysis.md` §4 决策流程 |
| `verdi-xz-debug` | 信号是 X/Z | X/Z 分类：未驱动 / 未初始化 / 三态 / 传播 → `xz_scan` 找候选 → NPI `sig_find_x_*` 追源 → 标不确定性 |
| `verdi-design-trace` | 追 driver / cone / source | 三条路径：① `-dbdir simv.daidir`（VCS `-kdb` 编译出的设计库，精确对齐仿真，**待验证**）；② `-f filelist.f`（源码再 elaborate，VERIFIED）；③ 两者都无 → `not_supported` + 时间相关候选 |
| `verdi-performance` | 吞吐 / 延迟 / bottleneck | **v2，不在本轮** |
| `verdi-evidence` | 收尾 / 汇报 | 证据标签 → 可复现命令 → 结论强度 → 禁止编造 → 产 EvidenceReport |

## 3. 证据标签（沿用 md/README 口径）

- `VERIFIED`：本机实测。
- `DOCUMENTED_ONLY`：仅文档。
- `NOT_TESTED`：未验证。
- `INFERRED / PROPOSED`：推理 / 提案。

## 4. Must-Not-Have

- ❌ skill 编造查询结果（未查到的值不写）。
- ❌ 无库时假装有结构（必须 `not_supported`）。
- ❌ 破坏性动作（默认只读，改 GUI 前确认目标会话）。

## 5. design-trace 的三条路径（补充）

`verdi-design-trace` 要拿设计结构，有三条路，按"精确度"排序：

1. **`-dbdir simv.daidir`（最优，已 VERIFIED）**：VCS 编译时加 `-kdb`（本仓库同时加 `-debug_access+all`），在 `simv.daidir` 里生成 KDB（`simv.kdb` + `kdb.elab++/`）；Verdi 用 `-dbdir simv.daidir -ssf <fsdb>` 读取。优点：直接对上产生 FSDB 的那次 elaborate，不依赖源码、不会源码/波形漂移。
   - **实测（2026-10-18）**：`schCreateWindow` / `schTraceDriver` / `schTraceLoad` / `schDumpTracedLeafPin` / `srcCreateWindow` / `srcGetCaretFile` / `srcGetCaretLine` 全部成功；`schTraceFanIn` 能返回 trace 结果，但随后 `schDumpTracedLeafPin` 报 "previous action was not tracing driver, load or connectivity"（fan-in 不能走 leafpin dump）。
   - **关键环境要求**：`-dbdir` 模式必须设置 `VCS_HOME=/opt/synopsys/vcs/W-2024.09-SP1`；否则 Verdi 直接退出。
   - 证据：`poc/evidence/diff-levers/kdb/`。
   - `-f filelist.f` 路径保持不变，仍为 VERIFIED；新增 `make verdi-dbdir` / `verdi-dbdir-server` 目标，不破坏原 `verdi` target。
2. **`-f filelist.f`（可用，VERIFIED）**：Verdi 重新 elaborate 源码。能用，但源码改动后可能与波形不一致。
3. **两者都无（降级）**：返回 `not_supported`，只给「时间相关候选」（相近时间跳变的信号，明确标注为弱启发式、非结构结论）。

> `verdi -help` 已确认：`-dbdir` = "Specify the daidir directory to load / path of Verdi elaborated KDB"；`-simflow` = 加载 VCS 生成的 KDB；`-kdb <file>` = 加载 kdb 库。
>
> **待验证降级**：无 `-dbdir` 且无 `-f` 时仍返回 `not_supported` + 时间相关候选；本轮未改变该行为。

## 6. 与现有实现的衔接

现有 `skills/` 已有 5 个 skill（verdi / waveform / bus-debug / design-trace / evidence，见 `md/README.md`）。本稿在它们之上：

- 新增 `verdi-xz-debug`（X/Z 分类，从 `verdi-bus-debug` 拆出独立）。
- `verdi-bus-debug` 升级为"参数化协议 + 决策流程 + 协议规则 grounding 文本"。
- `verdi-evidence` 升级为"调用 `10-visual-evidence.md` 的工具产 EvidenceReport"。
- `verdi-performance` 留 v2。


## 7. 实现状态（2026-10-18）

`skills/` 现有 **7 个** skill：

| Skill | 状态 |
|---|---|
| `verdi` | ✅ 更新：session/窗口/新原语/evidence 路由 |
| `verdi-waveform` | ✅ 更新：bounded render + 大 FSDB 限制 |
| `verdi-bus-debug` | ✅ 升级：signal map / handshake beats / change stats / window scan / check define+run + 协议 grounding 文本 |
| `verdi-xz-debug` | ✅ 新增：X/Z 分类与降级 |
| `verdi-design-trace` | ✅ 更新：`-dbdir` VERIFIED + `-f` + `not_supported` |
| `verdi-evidence` | ✅ 升级：evidence 工具链 |
| `verdi-performance` | ⏸ v2 stub（未实现，禁止编造性能结论） |

- 协议规则只在 skill 文本；MCP server 无协议字符串。
- 验收：`poc/evidence/m1-m5/`（76 checks）。
