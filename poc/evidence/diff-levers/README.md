# 差异化杠杆 — 前提验证证据（2026-10-18）

本目录对应 `md/09/10/11` 的三个前提验证。所有会话均为自己启动、用完即停；没有操作其他人的 Verdi。

## 1. `-kdb` + `-dbdir` design-trace — **VERIFIED**

- VCS 编译 flags 已加 `-debug_access+all -debug_region+cell+encrypt -kdb`。
- `make clean && make sim` 成功；`simv.daidir/simv.kdb` 与 `kdb.elab++/` 存在。
- 启动：`VCS_HOME=/opt/synopsys/vcs/W-2024.09-SP1 verdi -dbdir simv.daidir -ssf sync_fifo.fsdb -serverPort <port>`。
- `schCreateWindow -delim . -scope {tb_sync_fifo}` → `4d2544a0`
- `schTraceDriver -win 4d2544a0 -delim . -signal {tb_sync_fifo.clk}` → `{tb_sync_fifo} {tb_sync_fifo(@1):Always0:45:45:Combo}`
- `schDumpTracedLeafPin -delim .` → `1`；`driver_leafpin.rpt` 两行。
- `schTraceLoad` + dump → `fanout_leafpin.rpt` 三行。
- `schTraceFanIn` 本身返回 trace 结果，但随后 `schDumpTracedLeafPin` 返回 `0 The previous action was not tracing driver, load or connectivity`；**fan-in 不能走 leafpin dump**。
- `srcCreateWindow -scope {tb_sync_fifo}` → `4921c7a0`；`srcGetCaretFile` → `demo/tb/tb_sync_fifo.v`；`srcGetCaretLine` → `6`。
- 截图：`schematic.png`（1711×618）。
- 关键前提：`-dbdir` 模式需要 `VCS_HOME` 环境变量；否则 Verdi 退出并提示 `The VCS_HOME environment variable is not set`。

证据文件：`start2.log`、`sessions.json`、`sch_create2.json`、`driver2.json`、`driver_leafpin.rpt`、`fanin_trace.json`、`fanout2.json`、`fanout_leafpin.rpt`、`src_create.json`、`src_get.json`、`schematic.png`。

## 2. Verdi 原生 waveform 标记 — **VERIFIED（可脚本化）**

在 nWave 窗口上通过 libnclt 执行：

```tcl
wvSetMarker -win W -name agent_m1 40000 ID_YELLOW8 solid
wvSetMarker -win W -name agent_m2 80000 ID_RED3 dashed
wvSetMarkerOption -win W -absolute on -relative on
wvGetMarker -win W
wvReportMarker -win W -toFile markers.rpt
wvAddComment "agent_note"                       # → row id
wvAddCommentBox -win W -rowid <row> -style square -left 0 -right 80000 "agent: valid && !ready"
verdiHighlightSignal -sigColor {"/tb_sync_fifo/clk" ID_BLUE3} -apply
```

结果：

- `wvSetMarker` / `wvSetMarkerOption` / `wvReportMarker` 全部返回 1；`markers.rpt` 列出 `agent_m1` / `agent_m2`、时间、颜色。
- `wvAddComment` 返回 row id，`wvAddCommentBox` 返回 box id。
- `verdiHighlightSignal` 返回 1。
- 截图 `annotated.png`（2560×615）可见 `agent_m2` 标记、`agent_note` comment row 与红色 comment box、信号颜色。

结论：**md/10 场景 1 的“原生标注进现场 GUI”通道可用**；`capture_annotate` 可以优先尝试原生标记，失败再降级到后处理像素标注。

### Protocol Analyzer 探测（可选通道）

`info commands *rotocol*` 返回：

```
perSyncProtocolAnalyzer membNewProtocolAnalyzerWindow pabProtocolTree
pabProtocolTreeExpandAll pabProtocolTreeExtBrowser pabProtocolTreeCollapseAll
```

`info commands *ransaction*` 返回大量 `pab*` / `wv*Transaction*` 命令（`wvColorizeTransactions`、`wvSelectTransaction`、`pabDetailTransactionInfo` 等）。`*AXI*` / `*APB*` 没有直接命令名。

结论：**命令面存在（VERIFIED）**，但没有协议 FSDB，**解码行为 NOT_TESTED**；md/09 Piece 2 仍只做可选通道，不依赖。

证据：`protocol_probe.json`、`markers.json`、`markers.rpt`、`comment_*.json`、`highlight.json`、`annotated.png`。

## 3. NPI P1 — headless 渲染效率 — **前提被推翻（VERIFIED negative）**

数据：`demo/bigfsdb/big.fsdb`，903 MB，128 个 32-bit 信号 + clk，5M cycles，1ps，0..4,999,999,500 ps。

| 路径 | 操作 | 时间 | 峰值 RSS |
|---|---|---:|---:|
| NPI | init + open + 128×2000 采样 + SVG + `convert` PNG | **30.6 s**（init 3.0 / open 0.01 / read 18.1 / SVG 0.1 / PNG 8.3） | **8.0 GB** |
| GUI proxy | create + open + dump + add 128 + zoom + xid + screenshot | **27.0 s** | **8.36 GB** |
| GUI same-window | add 128 + zoom + view + xid + screenshot | **9.7 s** | 同上 |

- NPI 读+渲染 ≈ 26.4 s，GUI 同窗口操作 ≈ 9.7 s；**NPI 没有更快**。
- 两者内存都在 8 GB 量级（FSDB 索引/缓存主导），不存在“headless 更省内存”的优势。
- NPI 冷启动第一次 25.6k 查询耗时 17.7 s；预热后 256k 查询 18.1 s，说明首次测量受缓存影响；上表用预热后的较优值。
- NPI 输出 PNG 559 KB，GUI 截图 73 KB；GUI 还自带 nWave 的完整视图与交互。

**结论**：md/10 中“headless 渲染必须比手动 GUI 快”的前提在 128 信号 / 903 MB / 2000 bin 这个场景下**不成立**。按用户指令，Phase 2 暂停，先报告并调整 spec：

- `waveform_render` v1 必须**收窄**：只用于少量信号（建议 ≤16）和/或小时间窗、粗 bin；不能承诺 128 信号全窗数字波形。
- 超大 FSDB 场景（场景 3）改用 **GUI 捕获**（27 s 可接受）或 **聚合 value table + 定点小图**，而不是全量 headless 波形。
- NPI 继续用于 `change_stats` / `window_scan` / 少量精确值查询，不用于“整窗 128 信号渲染”。

证据：`build_5m.log`、`gui_proxy.json`、`big_gui.png`、`npi_render.json`、`big_npi.png`、`big_npi.svg`、`big_signals.txt`、`start_gui.log`。

## 复现

```bash
# KDB
cd demo/sim && make clean && make sim
VCS_HOME=/opt/synopsys/vcs/W-2024.09-SP1 \
  DISPLAY=localhost:10.0 XAUTHORITY=$HOME/.Xauthority \
  verdi -dbdir simv.daidir -ssf sync_fifo.fsdb -serverPort 11066

# big FSDB
cd demo/bigfsdb && make CYCLES=5000000

# measurements
python3 poc/evidence/diff-levers/npi-p1/gui_proxy.py
python3 poc/evidence/diff-levers/npi-p1/npi_render.py
```

> `demo/bigfsdb/big.fsdb`、`simv*`、`tb_big.v` 为生成物，已加入 `.gitignore`；生成器与 Makefile 入库。
