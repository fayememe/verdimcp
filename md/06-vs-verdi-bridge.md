# 我们的 Verdi MCP 方案 vs. verdi_bridge

> 对比对象：[RuihongY/verdi_bridge](https://github.com/RuihongY/verdi_bridge)（MIT，v0.3.3，20 stars）
> 我方状态：传输 PoC 已验证；MCP 与 Skills 仅有方案
> 结论先行：**对方目前更成熟；我们要赢，不能靠工具数量，要靠领域工作流与证据链。**

---

## 1. 对方是什么

一句话：把 AI agent 接到**正在运行的 Verdi**，通过 MCP 提供 18 个强类型工具，覆盖波形查询、时钟采样、driver 追踪和源码阅读。

关键事实：

| 项 | 内容 |
|---|---|
| License | MIT |
| 版本 | v0.3.3（Experimental） |
| 客户端 | Python 3.11+，MCP SDK，stdio |
| 远端 | Python 3.6+ helper，SSH |
| 传输 | **Tcl adapter + 私有请求目录**（不是网络端口） |
| 挂载方式 | `uvx verdi-bridge tcl-path` 后，在 Verdi 里 source adapter |
| 工具数 | 18 |
| 无头查询 | Python NPI FSDB reader（独立进程，查完即退） |
| 实测环境 | Verdi T-2022.06-SP2-1；UART/AXI-Lite/FIFO/arbiter；最大 2.7 GB FSDB |
| 文档 | README、guide、tools、architecture、validation、盲测记录、录屏 |
| 安全 | 无 raw Tcl、无 shell；source/log 根目录 allowlist；同用户信任边界 |

18 个工具：

```
session_status, browse_scope, find_signals, add_signals,
set_cursor, set_time_window, jump_before_error,
sample_signals, count_changes, sample_on_clock,
find_transitions, get_value_changes, measure_clock,
read_log, trace_driver, read_source, read_source_file, goto_source
```

他们的强项不只是"工具多"，而是**每个工具的语义边界写得很清楚**：

- 时间单位显式，换算用有理数，拒绝 off-grid；
- X/Z 保留为字符串，不转 0；
- 区间语义 `(start, end]`，支持 `resume_from` 续查；
- glitch 跳过显式声明，delta-cycle 完整性不承诺；
- `budget_ms` 协作预算，超时返回部分结果；
- `sample_on_clock` / `measure_clock` / `jump_before_error` 是"调试动作"级工具；
- 大 FSDB 走 NPI，且有实测耗时/内存数据。

---

## 2. 我方现状

| 项 | 内容 |
|---|---|
| 传输 | `verdi -serverPort` + `libnclt`（C 客户端） |
| 已验证 | 连接、同步命令、错误返回、事件回调 |
| 已验证 GUI | 建 nWave、开 FSDB、加信号、移游标、枚举信号、截图 |
| 会话管理 | 自动端口 + 注册表 + 启停 + stale 检测（已实测） |
| Web API | 已写参考设计（590 行），未实现 |
| MCP | 仅方案（22 个工具） |
| Skills | 仅方案（5 个） |
| 值/跳变/XZ | VERIFIED（GUI + 自制 VCD 验 Z） |
| 设计追踪/source | VERIFIED（需 `-f` 设计库） |
| 无头查询 | NPI VERIFIED（Python 3.8/3.11 + pynpi） |
| 远程 | 未开始 |

---

## 3. 对比表

| 维度 | verdi_bridge | 我们 | 谁占优 |
|---|---|---|---|
| 挂已有 GUI | Tcl adapter（官方称"任意已开 GUI"未单独验证） | 必须 `-serverPort` 重启 | **对方** |
| 传输 | 私有目录 + 原子请求/响应 | socket（loopback） | 平手（各有取舍） |
| 远程 | ✅ SSH | ❌ | **对方** |
| 工具语义 | 18 个，单位/区间/预算/X-Z 完整 | 0 个（方案 22 个） | **对方** |
| 值/跳变查询 | ✅ 实测 | ✅ 实测（语义/预算不如对方） | 对方略优 |
| 时钟采样 | ✅ `sample_on_clock` / `measure_clock` | ❌ | **对方** |
| 大 FSDB | ✅ NPI，有性能数据 | ⚠️ NPI 可用，未压测 | **对方** |
| 源码/驱动 | ✅ `trace_driver` / `read_source` / `goto_source` | ✅ driver/load/source 已验证 | 对方略优 |
| 截图/视觉证据 | ❌ | ✅ 已验证 | **我们** |
| 会话/端口管理 | 按 GUI 目录，选择当前会话 | ✅ 自动分配 + 注册表 + 多会话 | **我们** |
| 多 agent | 请求 ID 串行；多 Client 可并发提交 | ⚠️ 未证实，计划 broker | 对方略优 |
| 安全 | 无 raw Tcl、路径 allowlist | 计划 raw Tcl 默认关 | **对方** |
| 工程化 | PyPI/uvx、CI、测试、文档、盲测 | 仅 PoC + 文档 | **对方** |
| 安装便利（本机） | 需要 pip/uv，本机都没有 | Bun 已就绪 | **我们** |
| Skills/工作流 | 1 个通用 `debug_failure` prompt | 5 个领域 skill（方案） | **我们（若做成）** |
| 协议级分析 | 无（只给原始信号） | 可做 AXI/AHB/APB 状态机检查（方案） | **我们（若做成）** |
| Web API | 无（MCP + CLI + Python client） | 有参考设计 | **我们（若做成）** |
| 证据报告 | 有 validation 文档，但非每次调试产物 | 计划 `verdi-evidence` skill | **我们（若做成）** |

**注意**：我们的"优势"大多还是方案，不是已交付能力。当前实际对比是 **对方 > 我们**。

---

## 4. 对方值得直接学的地方

1. **挂载方式**：Tcl adapter 解决了"不想重启 Verdi"的痛点，也让 SSH 变成文件共享问题。
2. **语义严谨**：单位、区间、glitch、预算、续查——这些是踩过坑才写得出来的。
3. **无头引擎**：大 FSDB 必须绕开 GUI，否则 agent 一查就卡住工程师。
4. **安全边界**：不做 raw Tcl、不做 shell、路径 allowlist。
5. **证据文化**：性能数据、盲测、验证文档、录屏。

---

## 5. 我们可以赢的地方

### 5.1 Skills（最大差异）

对方只有 1 个通用 prompt；我们可以把**领域流程**固化：

- `verdi-bus-debug`：系统 md → 逐跳握手检查表 → 首个 `valid && !ready` → 证据表。
- `verdi-xz-debug`：X/Z 分类（未驱动 / 未初始化 / 三态 / 传播），明确不确定性。
- `verdi-design-trace`：有库给结构，无库降级为时间相关候选。
- `verdi-evidence`：证据标签、可复现命令、结论强度。
- `verdi`：能力发现、会话选择、安全红线。

这不是"多几个工具"，而是让 agent **知道什么时候该查什么、查到什么程度算够**。

### 5.2 协议级分析

对方给原始信号；我们可以在其上做：

- AXI：AW/W/B 通道配对、outstanding、ID 错配；
- AHB：HREADY/HRESP 卡死点；
- APB：PENABLE/PREADY 时序；
- 输出"第几跳、哪个握手、什么条件没满足"，而不是一堆波形。

### 5.3 视觉证据

截图 + 关键区域标注 + 前后对比。人机接力时，"你看到的"就是"它看到的"。对方没有截图工具。

### 5.4 会话与多 agent

自动端口、注册表、租约、只杀自己的进程；多个人/多个 agent 各用各的会话。对方按 GUI 目录选择，缺少显式的多会话管理。

### 5.5 Web API

不只 MCP：IDE、脚本、CI 都能接。对方只有 MCP + CLI + Python client。

### 5.6 安装便利（本机）

本机没有 node/pip/uv，但有 bun。Bun 单文件 MCP 在这台机器上更容易落地。

---

## 6. 必须补齐的 table-stakes

不补这些，差异化没有意义：

1. **挂已有 GUI**：增加 Tcl adapter 或"一次性 source"通道。
2. **值/跳变/X-Z 语义**：按对方的最佳实践实现，别重新踩坑。
3. **预算与分页**：`budget_ms`、`resume_from`、`max`、truncated。
4. **无头查询**：NPI 优先，FSDB Reader 备选。
5. **远程**：至少 SSH 隧道。
6. **安全**：raw Tcl 默认关闭、路径 allowlist、审计。
7. **测试与证据**：真实 FSDB 的回归、性能数据、失败案例。

---

## 7. 建议策略

| 层 | 做法 |
|---|---|
| 传输 | 保留 socket（自己启动）+ 增加 Tcl adapter（挂已有 GUI），统一内部接口 |
| 语义 | 参考对方的单位/区间/预算/X-Z 设计；必要时复用 MIT 代码并保留 NOTICE |
| 无头 | NPI 优先（pynpi 是 Python，绕不开） |
| 差异化 | 全部押在 skills、协议分析、截图/证据、会话管理、Web API |
| 打包 | Bun MCP + Python NPI helper；文档与测试对齐对方的工程化水平 |

**不建议**：为了"工具更多"而堆接口。对方 18 个工具的价值在语义，不在数量。我们的 22 个方案里，真正要抢先做的是：

1. `verdi_bus_check`（协议级）
2. `verdi_xz_classify`（X/Z 分类）
3. `verdi_evidence_report`（证据报告）
4. `verdi_screenshot`（视觉证据）

其余工具按 M1–M4 逐步补齐。

---

## 8. 风险与注意事项

1. **版本差异**：对方在 T-2022.06-SP2-1 实测；我们是 W-2024.09-SP1，命令行为可能不同，必须重测。
2. **"挂任意已有 GUI"**：对方文档也承认未单独验证；我们不能假设它一定可行。
3. **MIT 复用**：可以学设计、可以复用代码，但必须保留版权与 NOTICE，不能假装原创。
4. **多 client 并发**：我方实测出现结果错配，未定论；在确认前坚持单 broker/flock。
5. **数据边界**：RTL/FSDB 是公司资产；若模型在云端，只传信号名与结论，不传源码和波形数据。
6. **维护成本**：传输双通道 + NPI + 语义层 + skills，工作量不小；应按里程碑交付，避免一次铺开。

---

## 9. 结论

- **现状**：对方领先，且领先在"能查、查得准、装得上"。
- **我们的机会**：不是再造一个 verdi_bridge，而是做"**Verdi 调试工作流层**"——协议级检查、X/Z 分类、证据报告、视觉证据、多会话管理。
- **判断标准**：如果一个功能对方已经做得很好，直接参考；只有当它能被 skills/协议分析/证据链显著增强时，才值得自己重写。

一句话：**他们给 agent 眼睛；我们要给 agent 判断力和工作流。**
