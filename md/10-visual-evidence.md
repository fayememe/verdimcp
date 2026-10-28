# 视觉证据 — 设计定稿（证据工件 + 双渲染后端）

> 状态：**v1 已实现（按 P1 结果收窄）**（2026-10-18）· 证据标签：VERIFIED（demo acceptance）
> 上游：`06-vs-verdi-bridge.md` §5.3（视觉证据差异化）、`03-mcp-plan.md` §4.2（窗口与视觉）
> 定位：三大差异化杠杆之一，与 `09-protocol-analysis.md`、`11-domain-skills.md` 共用同一骨架。

## 0. 一句话

"截图"其实是**波形可视化**，有两个渲染后端（GUI 捕获 / headless 渲染），标注层盖在两者之上。证据 = **「像素 + 机器层 + 可复现」三者绑定**——光有图是廉价工具，做成证据工件才是护城河。

### 三种使用场景（工具不能只选一种）

| 场景 | 人在哪 | 需要什么 | 渲染后端 |
|---|---|---|---|
| 1 关键 debug | designer 开着 Verdi | agent 标注进现场 GUI，工程师立刻看到 | GUI 捕获 + 原生标记（**优先验证**） |
| 2 自动测试 | 无人在场 | 失败测例自动 开 FSDB → 定位 → 截图 → 证据 | GUI 或 headless，全自动 + 自证 |
| 3 超大 FSDB | GUI 卡/慢 | 聊天里直接看波形，不碰 GUI | headless 渲染（NPI 读值直接画） |

前提（场景 3）：headless 渲染必须**实测比手动操作 GUI 快**（正是 NPI P1：大 FSDB + 128 信号批量），不拍脑袋。

## 1. 证据工件模型

`Evidence`（顶层工件）：`{ evidence_id, session_id, created_at, conclusion, confidence, items[] }`

`EvidenceItem` 类型（一件证明）：
- `ScreenshotItem { image, roi{time_range, signals[], cursor_time}, annotations[{type, signal, time, label}], query_used }`
- `ValueItem { signal, time, value, query_used }`
- `ChangesItem { signal, time_range, transitions[], query_used }`
- `SourceItem { file, line, snippet }`
- `SchematicItem { ... }`
- `CheckItem { check_id, result }`

`EvidenceReport`（渲染后）：HTML/MD，内嵌 items + 复现命令 + 结论强度。

**可复现铁律**：每个 item 存「产生它的那条工具调用 + 参数」（`query_used`），报告里生成「复现」节 = 一串可重放的工具调用。

**结论强度**：`confirmed / likely / uncertain` + 理由。呼应 AGENTS.md「禁止编造」。

## 2. 工具面（加粗 = 新增）

| 工具 | 输入 | 输出 | 状态 |
|---|---|---|---|
| `verdi_window_screenshot` | sid,wid | PNG | VERIFIED |
| **`verdi_evidence_create`** | sid, title | evidence_id | 设计（新） |
| **`verdi_capture_annotate`** | evidence_id, roi{...}, annotations[] | ScreenshotItem（GUI 捕获） | 设计（新） |
| **`verdi_waveform_render`** | signals[], time_range, unit, radix | 波形图（headless，NPI 画） | 设计（新；v1 受 §8 限制） |
| **`verdi_evidence_add`** | evidence_id, item(Value/Changes/Source/Check) | item_id | 设计（新） |
| **`verdi_evidence_compare`** | evidence_id, roi_a, roi_b | 并排图 | 设计（新） |
| **`verdi_evidence_report`** | evidence_id, format(md/html) | 报告路径 | 设计（新） |

## 3. 七层能力 → 工具映射

1. 聚焦取景 = `capture_annotate.roi`（截图前 zoom 到出错时间窗 + 信号集）。
2. 标注层 = `annotations`（高亮信号、圈出错拍、箭头、游标标记）。
3. 值叠加 = 游标处信号值叠加，X/Z 用醒目色。
4. 前后对比 = `evidence_compare` 并排 / diff。
5. 多窗口 = 一个 evidence 挂 waveform + source + schematic 多个 item。
6. 机器层 = `ValueItem / ChangesItem / SourceItem / CheckItem` 结构化数据。
7. 报告渲染 = `evidence_report`。

## 4. 标注与渲染后端

- **标注层共享**：无论 GUI 捕获还是 headless 渲染，都盖同一套 annotation；且标注文本**从机器层数据渲染**，不手打（防幻觉：图上的 `arready=0` 标签必须从 `ValueItem{value:"0"}` 渲染出来，不是 agent 自由输入）。
- 两个后端：
  - **GUI 捕获**（`capture_annotate`）：截 Verdi 实际窗口。场景 1/2 里 GUI 可用时。
  - **headless 渲染**（`waveform_render`）：NPI 读值 → 服务端直接画波形。场景 3、以及场景 2 的自动化。
- **Verdi 原生标记（场景 1，已 VERIFIED）**：W-2024.09 可经 libnclt 脚本化加标记/注释/高亮——`wvSetMarker`、`wvSetMarkerOption`、`wvReportMarker`、`wvAddComment` + `wvAddCommentBox`、`verdiHighlightSignal` 均实测成功；截图可见 marker、comment row/box 与信号颜色。因此 `capture_annotate` **优先尝试原生标注进现场 GUI**，失败再降级到后处理像素标注。证据：`poc/evidence/diff-levers/annot/`。

## 5. Must-Not-Have

- ❌ 把 RTL/FSDB 内容原样传出（只传信号名、时间、结论、截图；源码片段按需最小化）。
- ❌ 证据里出现编造的信号值/截图（未查到的值不写）。
- ❌ 依赖 Verdi 原生标注。

## 6. 边界

- **v1**：evidence_create + capture_annotate（GUI 捕获：聚焦 + 标注 + 值叠加；优先原生标记）+ waveform_render（headless 数字波形：0/1/X/Z + 总线值 + 时间轴 + 游标线；**受 §8 限制：≤16 信号 / 小窗口，大 FSDB 改用 GUI 捕获或聚合 value table**）+ add(value/changes/source) + compare + report（md 优先，html 可选）。
- **v2**：headless 模拟波形 / 多进制、多窗口 composite 自动排版、schematic 标注、报告内嵌交互式波形。
- **前提已实测（2026-10-18）**：Verdi 原生标记可脚本化 → **VERIFIED**；headless 渲染 vs GUI 效率 → **前提被推翻**（见 §8）。

## 7. 开放点

- **证据工件落盘位置**：倾向项目内可配置目录（证据报告跟 bug 走、可提交），而非 `~/.local/state` 会话级。待定。
- `waveform_render` 本质是造一个迷你 nWave，v1 只做数字波形，不追求复刻 nWave 全部（无底洞）。

## 8. 前提验证结果（2026-10-18）

### 8.1 NPI P1 — headless 渲染效率（VERIFIED negative）

数据：`demo/bigfsdb/big.fsdb`，903 MB，128 个 32-bit 信号 + clk，5M cycles，1ps。

| 路径 | 操作 | 时间 | 峰值 RSS |
|---|---|---:|---:|
| NPI | init + open + 128×2000 采样 + SVG + `convert` PNG | **30.6 s** | **8.0 GB** |
| GUI proxy | create + open + dump + add 128 + zoom + xid + screenshot | **27.0 s** | **8.36 GB** |
| GUI same-window | add 128 + zoom + view + xid + screenshot | **9.7 s** | 同上 |

- NPI 读+渲染 ≈ 26.4 s，GUI 同窗口操作 ≈ 9.7 s；**NPI 没有更快**。
- 两者 RSS 都在 8 GB 量级，headless 不省内存。
- 结论：md/10 原前提“headless 必须比手动 GUI 快”在 128 信号 / 903 MB 场景下**不成立**。

### 8.2 对 v1 的调整（必须遵守）

- `waveform_render` 收窄为**少量信号**（建议 ≤16）和/或小时间窗、粗 bin；不承诺 128 信号全窗数字波形。
- 超大 FSDB（场景 3）优先 **GUI 捕获**（27 s 可接受）或 **聚合 value table + 定点小图**；全量 headless 波形不作为卖点。
- NPI 继续用于 `change_stats` / `window_scan` / 少量精确值查询；不用于“整窗 128 信号渲染”。

### 8.3 原生标注（VERIFIED）

- `wvSetMarker` / `wvSetMarkerOption` / `wvReportMarker` / `wvAddComment` / `wvAddCommentBox` / `verdiHighlightSignal` 均可经 libnclt 脚本化；截图 `poc/evidence/diff-levers/annot/annotated.png` 可见 marker、comment row/box 与信号颜色。
- 场景 1 的“标注进现场 GUI”通道成立；后处理像素标注作为降级。

### 8.4 Protocol Analyzer（命令面 VERIFIED，解码 NOT_TESTED）

- `info commands *rotocol*` 返回 `perSyncProtocolAnalyzer`、`membNewProtocolAnalyzerWindow`、`pabProtocolTree*`；`*ransaction*` 返回 `wvColorizeTransactions`、`wvSelectTransaction`、`pabDetailTransactionInfo` 等。
- 没有协议 FSDB，实际解码未测；md/09 Piece 2 仍只做可选通道，不依赖。


## 9. 实现状态（2026-10-18）

v1 已实现（render 按 §8 收窄）：

| 工具 | 状态 | 说明 |
|---|---|---|
| `verdi_evidence_create` | ✅ VERIFIED | evidence JSON 存 `~/.local/state/verdi-mcp/evidence/` |
| `verdi_capture_annotate` | ✅ VERIFIED | 原生 marker/comment box/highlight + 截图；失败返回 `not_supported` |
| `verdi_waveform_render` | ✅ VERIFIED（bounded） | ≤16 信号 / ≤1000 bins；NPI 采样 → SVG → PNG |
| `verdi_evidence_add` | ✅ VERIFIED | value/changes/source/check/screenshot 机器层 item |
| `verdi_evidence_compare` | ✅ VERIFIED | ROI A/B 两次捕获 + `convert +append` |
| `verdi_evidence_report` | ✅ VERIFIED | Markdown/HTML + `query_used` 复现节 |

- 原生标注已实测可用（§8.3），作为 `capture_annotate` 首选；后处理像素标注为降级。
- 大 FSDB / 128 信号：**不要**调用全窗 render；用 GUI capture 或聚合 value table（§8.1）。
- 证据：`poc/evidence/m1-m5/`（`annotated.png`、`waveform_render.png`、`evidence_report.md`、`evidence_compare.png`）。
