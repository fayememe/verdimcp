# 协议级分析 — 设计定稿（方案 C）

> 状态：**v1 已实现**（2026-10-18）· 证据标签：VERIFIED（demo acceptance）
> 上游：`06-vs-verdi-bridge.md` §5.2（差异化策略）、`03-mcp-plan.md` §4.3–4.4（工具面）、`04-npi-research.md`（NPI 无头引擎）
> 定位：三大差异化杠杆之一，与 `10-visual-evidence.md`、`11-domain-skills.md` 共用同一骨架。

## 0. 一句话

**工具层"傻而准"，判断层装智能。** 协议语义不进 MCP server；机械凝缩在 server（协议无关原语），协议知识与设计意图理解在 skill/agent，Verdi 只做它独有的"精密传感器"。

分层：

- **Verdi = 传感器**：准确取出信号/波形/事务/源码/schematic。
- **MCP = 傻而准的原语**：把原始信号凝缩成结构化数据，**不做协议语义判断**。
- **Agent/harness = 唯一智能**：理解设计意图、判断"什么叫错"、决定查什么、查到什么程度算够。

## 1. 设计原则

1. MCP server 代码里**不出现** "AXI/APB/AHB" 等协议字符串；原语只认"信号角色"（valid/ready/data/id/last…）与"信号路径"。
2. 协议覆盖无限：agent 的训练知识 + skill 内参考规则文本 = 无界协议库。
3. 海量数据不过 LLM：原语层先聚合/分帧，绝不把百万级变化流直接喂给 agent。
4. 确定性靠"按需固化"：agent 探索时自由看，确认规则有效后 `verdi_check_define` 固化成声明式检查，之后引擎确定性重跑。
5. Verdi 原生 Protocol Analyzer 是机会主义捷径，不是依赖；不可脚本化就放弃，靠 Piece 1 + 3 兜底。

## 2. Piece 1 — MCP 原语（协议无关，我们要写代码的部分）

工具面（加粗 = 本杠杆新增；其余复用已验证能力）：

| 工具 | 输入 | 输出 | 状态 |
|---|---|---|---|
| `verdi_signal_map_put` | name, {role→abs_path} | ok | 设计（新） |
| `verdi_signal_map_get` | name | profile | 设计（新） |
| `verdi_signal_map_list` | — | profiles[] | 设计（新） |
| **`verdi_handshake_beats`** | channel{valid,ready,data?,id?,strobe?,last?}, start,end,unit,max | beats[] | 设计（新） |
| **`verdi_change_stats`** | signals[], start,end,unit | 每信号 计数/首/末 变化 | 设计（新，聚合） |
| **`verdi_window_scan`** | predicate, start,end,unit,max | hits[]（前 N 个命中） | 设计（新，通用谓词） |
| **`verdi_check_define`** | name, predicate, params | check_id | 设计（新，按需固化） |
| **`verdi_check_run`** | check_id | result | 设计（新） |
| `verdi_transitions_get` | signal,start,end,unit,max | 跳变列表 | VERIFIED |
| `verdi_value_get` | signal,time,unit | value（含 X/Z） | VERIFIED |
| `verdi_xz_scan` | scope,start,end,max | X/Z 候选 | 部分 VERIFIED |

关键语义：

- **`verdi_handshake_beats`** 是唯一"看起来像协议"的原语，但它只做语法：给定 valid/ready 信号对（来自 signal map），返回每个 `valid && ready` 同时成立的拍（cycle + 附带 data/id/strobe/last 的取值）。AXI 的 AW/W/B/AR/R、APB 的 PSEL/PENABLE、Wishbone 的 STB/ACK 都只是"一组 valid/ready 对"，原语不知道也不关心它们是 AXI 还是 APB。
- **`verdi_window_scan`** 的 predicate 是"对信号状态的谓词"，例：`awvalid && !awready` 持续 >N 拍。这是通用的"找卡死握手"，不是"AXI 卡死检查器"。
- **`verdi_check_define`** 是"agent 按需生成确定性检查器"的桥：agent 把一条规则写成声明式谓词存进项目 profile，之后 `verdi_check_run` 在引擎内确定性重跑。检查器不是我们预置的，是 debug 现场生成的。

## 3. Piece 2 — Verdi 原生通道（机会主义，待验证）

- Verdi 自带 Protocol Analyzer / nProtocol，可在 GUI 里把 AXI/AHB/APB 等解码成事务。
- 若可经 Tcl/libnclt 脚本化（W-2024.09 **未验证**），暴露 `verdi_protocol_decode(protocol, scope) → transactions`，作为"现成事务重构"的快捷路径，省掉我们自建重构。
- 标记 **NOT_TESTED**；不可脚本化则整块删除，靠 Piece 1 + 3 兜底。**不**重写 Verdi 的解码器。
- **实测（2026-10-18）**：`info commands *rotocol*` 返回 `perSyncProtocolAnalyzer`、`membNewProtocolAnalyzerWindow`、`pabProtocolTree*`；`info commands *ransaction*` 返回 `wvColorizeTransactions`、`wvSelectTransaction`、`wvFilterTransactions`、`pabDetailTransactionInfo` 等。**命令面 VERIFIED；实际解码 NOT_TESTED**（当前无协议 FSDB）。因此 Piece 2 仍为可选通道，不作为 v1 依赖。

## 4. Piece 3 — skill 承载协议知识 + 判断（差异化所在）

`verdi-bus-debug` skill 的决策流程：

1. **定位接口与协议**：读系统 md / 用户描述 → 确定要查的总线接口 + 协议类型。
2. **建信号映射**：`verdi_signal_map_put` 把协议角色绑到绝对信号路径（有 profile 直接 `get`）；映射不全先 `verdi_signals_list` 补齐。
3. **提取现场**：`verdi_handshake_beats` 拉握手拍（带 data/id/last），`verdi_change_stats` 看量级 → 决定 GUI 交互 vs NPI 批量。
4. **应用协议规则**（来自 skill 内参考知识文本，grounding）：逐条核对 活性/合规/配对/响应/死锁。
5. **定位首个违例**：输出"第几笔、哪个通道、哪一拍、期望 vs 实际"。
6. **确定性固化**：规则有效且需复现时 → `verdi_check_define` 固化成声明式检查，之后 `verdi_check_run` 确定性重跑。
7. **产出证据**：交给 `10-visual-evidence.md` / `verdi-evidence`。

skill 内参考知识（grounding，防幻觉）：AXI4 / AXI4-Lite / AXI4-Stream / AHB(-Lite) / APB / Wishbone 的核心规则文本，每条标注来源，可现场 fetch 权威 spec 补充。**规则是 prompt 里的知识，不是 server 里的代码。**

## 5. 数据模型

- `SignalMapProfile { name, signals: { role → abs_path }, created_by, updated_at }`
- `HandshakeChannel { name, valid_role, ready_role, data_roles[], id_role, last_role, strobe_role }`
- `HandshakeBeat { time, valid, ready, data?, id?, strobe?, last? }`
- `DeclarativeCheck { check_id, name, predicate, params, last_run, result }`

## 6. Must-Not-Have（边界红线）

- ❌ MCP server 内出现任何协议语义 / 协议字符串。
- ❌ 预置一库协议检查器（AXI/AHB/APB 都算）。
- ❌ 依赖 Verdi Protocol Analyzer 可脚本化（只做可选通道）。
- ❌ 把百万级原始变化流直接喂给 agent（一律先聚合）。
- ❌ 用 `as any` / 静默吞异常（沿用 AGENTS.md §5.1）。

## 7. 边界与分期

- **v1**：Piece 1 全部原语 + Piece 3（skill 决策流程 + grounding 规则文本 + `verdi_check_define` 桥）+ Piece 2 仅做"可脚本化验证"。
- **v2（后续，非本杠杆）**：吞吐/延迟/outstanding/bottleneck 归因（`verdi-performance` skill）、CDC、覆盖率。

## 8. 已决（默认锁定）

1. **Verdi Protocol Analyzer 可脚本化验证** → 放 v1 顺手做（一次 Tcl 探测，便宜）。
2. **`verdi_check_define` 谓词 DSL** → v1 最小集：信号布尔/关系运算 + 时间窗持续；完整语法实现时定。
3. **`verdi_handshake_beats` 时钟对齐** → 多通道各自独立求值（各自 valid/ready 独立，返回各自拍）。


## 9. 实现状态（2026-10-18）

v1 原语已实现并通过 demo 验收（`poc/evidence/m1-m5/`，76 checks）：

| 工具 | 状态 | 说明 |
|---|---|---|
| `verdi_signal_map_put/get/list` | ✅ VERIFIED | profile 存 `~/.local/state/verdi-mcp/signal-maps.json` |
| `verdi_handshake_beats` | ✅ VERIFIED | clock 上升沿采样；无 clock 时用变化点；返回 data/id/strobe/last |
| `verdi_change_stats` | ✅ VERIFIED | NPI 聚合：count + first/last value，不返回原始变化流 |
| `verdi_window_scan` | ✅ VERIFIED | 布尔谓词 `! && || ()` + `min_duration`；最多 5000 bins |
| `verdi_check_define/run` | ✅ VERIFIED | 声明式检查存 `~/.local/state/verdi-mcp/checks.json`，确定性重跑 |

- **协议语义不在 server**：server 只认自由 role 名与路径；AXI/APB/AHB 规则文本在 `skills/verdi-bus-debug/SKILL.md`。
- **证据**：`poc/evidence/m1-m5/` 的 handshake/change_stats/window_scan/check_* 检查。
- Protocol Analyzer 仍为可选；本轮只验证命令面，不依赖。
