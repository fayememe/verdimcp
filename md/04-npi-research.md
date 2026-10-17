# Verdi MCP：NPI 技术调研与混合波形引擎方案

> 2026-10-17 · 研究与实施建议，尚未在 f29 验证

## 1. NPI 调研：verdi_bridge 的已实现机制

参考项目：[RuihongY/verdi_bridge](https://github.com/RuihongY/verdi_bridge)。

其 Headless NPI Engine：
1. 先通过 GUI Tcl Adapter 获取当前 nWave 所打开的 FSDB 路径与 Verdi 环境（`engine_info`）。
2. 在 Verdi 所在主机启动短生命周期 `npi_engine.py`，使用 Verdi 提供的 Python `pynpi` Reader 打开 FSDB。
3. 查询结束后进程退出；不修改 GUI，超时也不会留下未完成的 GUI 操作。
4. 提供 `auto`、`gui`、`npi` 三种模式：默认 `count_changes` 优先 NPI；其他查询先给 GUI 约 0.1 秒预算，超预算再走 NPI；NPI 不可用时回退 GUI。
5. 支持 `count_changes`、`get_value_changes`、`find_transitions`、`measure_clock`、`sample_signals`、`sample_on_clock`。
6. 对多 GB FSDB 按时间窗口读取，提供内存限制、查询预算、截断/续读信息；对 alias/sparse 信号有额外加载策略。

### 性能（对方公开测试，非 f29 实测）

测试环境：Verdi T-2022.06-SP2-1，远程 Python 3.6.8。

| 查询 | GUI | auto / NPI |
|---|---:|---:|
| 128 cold signals × 8 times | 19 s | 4.0 s |
| 128 signals 全程变化统计 | 94 s（9 次调用） | 3.8 s（1 次） |
| 2M-change bus + clock 统计 | 约 9 min（推算） | 9.5 s |
| 一次 warm sample | 0.12 s | 0.12 s（GUI） |

NPI 单次启动、初始化和打开 FSDB 约 0.6 秒，因此不适合所有小查询。不能把上述差异解读为 Socket 传输比文件传输慢；主要差异来自 **GUI API 查询路径 vs headless FSDB Reader**。

### 依赖与授权

- Verdi 主机需要能导入 `pynpi` 的 Python（对方测试使用 3.6.8）；需具备 `VERDI_HOME`、可读 FSDB 和 Verdi 相关 license 环境。
- 对方说明无可用授权时 NPI 无法打开 FSDB，`auto` 回退 GUI。**f29 P0 已验证当前 license 可打开 demo FSDB**；大 FSDB 与并发 license 占用待 P1。
- 仅对可读 FSDB 做此路径；不能假定 VCD 支持。
- 同一时间戳的多个变化 / glitch 可能被折叠；不能把返回结果当作完整 delta-cycle event stream。X/Z 必须保留，时间精度用整数 tick 或精确十进制表示。

## 2. Reader 生命周期：先短进程，后评估常驻

**第一版采用每次请求一个 NPI 子进程**：失败隔离简单、易清理资源、授权占用时间短、与对方已验证策略接近。

长期 Reader + FSDB 句柄缓存只是优化候选。需要用真实连续多轮查询测量累计延迟、峰值 RSS、license 占用、FSDB 更新/替换检测、崩溃恢复。不要在没有实测前认定它优于短进程。

## 3. 统一执行与安全约束

- 引擎路由：`auto` / `gui` / `npi` 可配置；超时、资源限制、明确 fallback 原因。
- NPI 不操作 GUI；GUI 修改必须显式调用 GUI 工具。切换 session 时重新确认 FSDB 路径，防止旧上下文误读。
- 同一 GUI session 的命令串行执行，避免 libnclt 并发返回错配；NPI 查询可独立并发，但限制 worker 数与内存。
- 所有工具参数结构化校验；不暴露任意 shell/Tcl 执行；限制 FSDB/source/log 访问范围；请求和响应关联 request ID。
- NPI 查询可能返回部分结果，必须显式标注 `truncated` 和 `resume_from`；不可静默截断。
- 若 FSDB 正在写入，需确认 Reader 的一致性语义，必要时固定文件版本或提示不保证快照一致。

## 4. f29 验证计划与验收

**P0：环境与 API smoke test**
- 在 f29 检查 Verdi 版本、`VERDI_HOME`、Python、`import pynpi`、license 环境。
- 用已知 FSDB 查询信号列表、单点值、指定时间窗变化；对比 nWave。
- 记录初始化时间、首查/热查延迟、RSS、license 状态和失败信息。

### P0 实测（2026-10-17，VERIFIED）

- **Python**：`/usr/bin/python3` **3.11.2**；`pynpi` 位于
  `$VERDI_HOME/share/NPI/python`，可直接 import（无需 pip）。
- **环境**：需要 `PYTHONPATH=$VERDI_HOME/share/NPI/python`；还需要
  `LD_LIBRARY_PATH=$VERDI_HOME/share/NPI/lib/linux64:$VERDI_HOME/platform/linux64/lib/Qt5/lib`，
  否则 `import pynpi` 会因 `libQt5Script.so.5` 缺失失败。
- **License**：`npisys.init()` + `waveform.open()` 成功，无 checkout 错误。
- **被测 FSDB**：`demo/sim/sync_fifo.fsdb`（9677 bytes）；`scale_unit=1ps`，
  `min/max=0/240000`。
- **查询结果**：
  - `tb_sync_fifo.rst_n @ 40ns` = `1`
  - `tb_sync_fifo.rd_data @ 40ns` = `XX`
  - `tb_sync_fifo.count @ 240ns` = `0`
  - `rd_data 0..50ns` = `[(0, 'XX')]`
  - `sig_find_x_backward(rd_data, 100ns)` = `(0, 'XX')`
  - `clk vc_count 0..240ns` = `49`
- **耗时 / 内存**（两次运行，短进程）：

  | 阶段 | 耗时 |
  |---|---:|
  | `import pynpi` | 0.029 s |
  | `npisys.init()` | 3.03 s |
  | `waveform.open()` | 0.005–0.008 s |
  | 100× `sig_value_at` | 0.001–0.002 s |
  | `close` + `end` | 0.03–0.04 s |
  | 总计 | **~3.1 s** |
  | 峰值 RSS | **106 MB** |

- **脚本 / 证据**：`demo/npi/npi_smoke.py`、`demo/npi/run_npi.sh`；
  输出 `demo/evidence/npi_smoke.log`、计时 `demo/evidence/npi_timing.log`。
- **语义坑**：`sig_find_x_forward(..., 0)` 找不到 time 0 的初始 X（初始值不是 value change）；
  用 `sig_value_between()` 或 `sig_find_x_backward()`。
- **尚未做（P1）**：信号/层级列表 dump、128 signals × 8 timestamps、GUI/libnclt 对比、
  大 FSDB、正在写入的 FSDB、并发 worker。

**P1：性能与语义**
- 小查询（1–4 signals × 少量 timestamps）、中等查询（128 signals × 8 timestamps）、长区间 transition count、clock sampling。
- 比较 GUI/libnclt 与 NPI 的 wall time、GUI 响应性、峰值内存、结果一致性。
- 覆盖 X/Z、时间单位、边界时间、同时间戳多次变化、无变化信号、层级 alias、超时、FSDB 不存在/损坏。

**P2：MCP 集成**
- Bun MCP 保留现有 GUI tools，新增 NPI worker adapter 和自动路由。
- 以 project → host → user → Verdi session → FSDB 的链路完成自动发现。
- 在本地 OpenCode + Zed Remote Project、远程 OpenCode 两种模式各跑一次 end-to-end。
- 先做一个真实 RTL/SoC bug 工作流：定位错误时间 → 批量读波形 → 将证据信号和时间窗口呈现在同一 Verdi GUI。

**建议验收门槛**：P0 所有基础读取成功且语义正确；P1 有可重复的对比数据；P2 不要求 GUI 为批量分析长期阻塞。是否启用常驻 Reader 由数据决定。

## 5. 待决事项

1. ~~f29 上 `pynpi` 是否可导入、能否正常 checkout 所需 license？~~ → ✅ 已实测：可导入、可打开 FSDB（见 P0 实测）。
2. 我们现有 Verdi/FSDB 版本的 API 行为是否与参考项目一致？→ demo FSDB 上单点值 / X / vc_count 正常；大 FSDB 与边界语义待 P1。
3. 当前项目上下文如何可靠解析远程 host、user 和 Verdi session？
4. 对方的 `npi_engine.py` 可参考哪些算法/接口设计？需核对版本与许可约束。
5. 是否需要支持多 Agent 同时访问同一 GUI，以及会话所有权如何管理？

## 6. 参考资料

- [verdi_bridge README](https://github.com/RuihongY/verdi_bridge)
- [Architecture / Headless engine](https://github.com/RuihongY/verdi_bridge/blob/main/docs/architecture.md)
- [Tool reference / Headless NPI / benchmarks](https://github.com/RuihongY/verdi_bridge/blob/main/docs/tools.md)

> 本文将“对方文档已经实现并测量的事实”与“我们的设计建议、待验证假设”分开表述。
> f29 的 P0 已完成（见上）；P1 性能对比与 P2 MCP 集成尚未开始。
