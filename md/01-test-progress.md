# Verdi 接入测试进展与结果

> 日期：2026-10-17
> 宿主：f29（10.3.9.99），用户 faye
> Verdi：W-2024.09-SP1
> 结论：**传输、GUI 控制、demo 全链路与 NPI P0 已实测通过；GUI 值查询与设计追踪尚未验证。**

证据标签：VERIFIED（本机实测）/ DOCUMENTED_ONLY（仅文档）/ NOT_TESTED / INFERRED。

---

## 1. 环境

| 项 | 值 | 状态 |
|---|---|---|
| Verdi | `/opt/synopsys/verdi/W-2024.09-SP1/bin/verdi` | VERIFIED |
| 版本 | `W-2024.09-SP1 for linux64 - Nov 30, 2024` | VERIFIED |
| 其他版本 | `T-2022.06-SP1`、`Verdi_O-2018.09-SP1` | VERIFIED |
| License | `SNPSLMD_LICENSE_FILE=27010@127.0.0.1`，`snpslmd` 监听 | VERIFIED |
| 显示 | SSH X 转发：`DISPLAY=localhost:10.0`，`XAUTHORITY=~/.Xauthority` | VERIFIED |
| Tcl 文档 | `$VERDI_HOME/doc/verdi_tcl.pdf` + `.verdi_tcl.txt.gz` | VERIFIED |
| 命令文档 | `$VERDI_HOME/doc/verdi_command_ref.pdf` | VERIFIED |
| FSDB 文档 | `$VERDI_HOME/doc/verdi_fsdb_reader.pdf` | VERIFIED |
| 客户端库 | `share/libcmd/linux64/libnclt.{a,so}`、`libnsys.{a,so}` | VERIFIED |
| FSDB Reader | `share/FsdbReader/`（`ffrAPI.h`、`libnffr.so`、examples） | VERIFIED（文件存在） |
| NPI | `share/NPI/inc/npi_fsdb.h` 等 | VERIFIED（文件存在） |
| Demo | `demo/verilog/behav/`（`behav.fsdb`、`cpu.v`、`system.v`） | VERIFIED |
| 工具 | gcc 12；无 tclsh/wish/python-tkinter；无 node/npm/pip；有 bun 1.3.14 | VERIFIED |

---

## 2. 完成的测试

| # | 测试 | 结果 |
|---|---|---|
| 1 | 文档与环境盘点（P0） | 完成 |
| 2 | `-serverPort` socket 连接 | 通过 |
| 3 | 同步命令与错误返回 | 通过 |
| 4 | nWave 建窗 / 开 FSDB / 加信号 / 移游标 | 通过 |
| 5 | 事件回调（add signal / cursor change） | 通过 |
| 6 | FSDB 信号枚举（dump） | 通过 |
| 7 | 窗口截图（独立 GUI 证据） | 通过 |
| 8 | 会话注册表 / 端口自动分配 | 通过 |
| 9 | 多会话并发启动 | 通过 |
| 10 | 多 client 并发连接同一会话 | **结论不明确** |
| 11 | 波形值 / 跳变 / X-Z 查询 | NPI 单点值 / X 通过；GUI 工具未做 |
| 12 | 设计追踪 / schematic / source | 未做 |
| 13 | NPI 无头查询（P0） | 通过（demo FSDB，见 §12） |
| 14 | SSH 远程 | 未做 |

---

## 3. 传输层（VERIFIED）

启动：

```bash
verdi -serverPort 11065 -ssf behav.fsdb
# 监听：127.0.1.1:11065
```

客户端：`/tmp/opencode/verdi_poc/cmdclient.c`

```c
CMDCLT c = CmdCltCreate(1);
CmdCltConnect(c, port, NULL, 20);
CmdCltAddEventCallback(c, "AllEvents", EventCB, NULL);
char* rv = NULL;
char ok = CmdCltCallCommand(c, cmd, 0, &rv);
CmdCltCheckForEvents(c);
```

编译（不需要 Motif/X11）：

```bash
gcc -I$VERDI_HOME/share/libcmd cmdclient.c \
    -L$VERDI_HOME/share/libcmd/linux64 -lnclt -lnsys -o cmdclient
```

实测输出：

```
OK      wvCreateWindow                         372eb2e0
EVENT   wvCreateWindow                         35857850
OK      wvGetAllWindows                        35857850 372eb2e0
OK      wvGetXWindowId -id 372eb2e0            20002e7
OK      wvOpenFile -win 372eb2e0 .../behav.fsdb  .../behav.fsdb
EVENT   wvOpenFSDBFile                         .../behav.fsdb
EVENT   wvViewRangeChanged                     0.000000 1227.150000
OK      wvAddSignal -win 372eb2e0 /system/CYCLE /system/R_W /system/VMA   1
EVENT   wvAddSignal                            / 3 {/system/CYCLE} {/system/R_W} {/system/VMA}
EVENT   wvAddSignalByIdCode                    -idcode 3 {1 21 20}
OK      wvSetCursor -win 372eb2e0 100          1
EVENT   wvCursorTimeChange                     100 {NULL} .../behav.fsdb
EVENT   debCursorTimeChange                    100
OK      wvIsFileOpen ...                       1
OK      wvGetFileTimeUnit ...                  1ns
OK      wvDumpSignalListToFile ...             1
ERR     debGetEnv                           invalid command name "debGetEnv"
```

说明：

- `OK/ERR` 是客户端对 `CmdCltCallCommand` 返回值的判定；`ERR` 行证明 Tcl 错误会回传，不会被吞掉。
- `debGetEnv` 是故意用错命令名，用来验证错误通道。
- 返回值 `>0` 只表示"命令存在并执行"，Tcl 层错误也会返回 0。

---

## 4. GUI 证据（VERIFIED）

- 窗口：`xwininfo -id 0x20002e7` → `"MainWindow"`，`2560x615`，`Map State: IsViewable`。
- 截图：`import -window 0x20002e7 nwave.png` 成功，PNG `2560x615`。
- 截图中可见：`CYCLE`、`R_W`、`VMA` 三条波形，游标位于 `100 ns`。
- FSDB 信号枚举：`signals.txt` 共 **40** 行（`/system/CYCLE`、`/system/R_W`、`/system/VMA`、`/system/addr[7:0]` 等）。

注意：Verdi 返回的 window id（如 `372eb2e0`）不是 X id；必须 `wvGetXWindowId -id <id>` 获取，并在传给 X 工具时加 `0x` 前缀。

---

## 5. 会话与端口管理（VERIFIED）

实现：`/tmp/opencode/verdi_poc/verdi-session`（Python 3，无第三方依赖）

- 端口段：11000–11999。
- 注册表：`~/.local/state/verdi-sessions/<sid>.json`（0600）。
- 分配：`flock` + 预留文件 + `ss` 探测。
- 状态：`up` / `starting` / `down` / `stale`。
- 选择器：`--id` / `--label` / `--port`。

实测：

```
start detach label=poc  → sid 0352f7d7, port 11101, pid 2993308
exec --id 0352f7d7      → OK
exec --label poc        → OK
exec --port 11101       → OK
exec --hold 3           → 收到 wvCursorTimeChange + HOLD_END
stop --id 0352f7d7      → 端口释放、注册表条目删除
```

并发启动：

```
start label=concA → sid 13166389, port 11286
start label=concB → sid f41f9e43, port 11066
```

两个会话端口不同，注册表同时可见，`stop` 后各自清理。伪造 dead PID 条目后：`list` 默认隐藏、`list --all` 显示 `stale`、`prune` 删除。

清理结果：PoC 会话全部停止；用户原有会话 PID `1192542` / `2938719` 未受影响。

---

## 6. 并发连接（结论不明确）

文档（`cmdclt.h`）：

> "Any number of clients can connect to a server at one time."

但并发语义未说明。实测：

- 两个 client 同时连同一端口：
  - A 只收到事件，没有命令返回；
  - B 返回 `OK wvCreateWindow (null)`；
  - 结果出现错配/不完整。
- 第二次带 `--hold` 的测试超时，未取得干净结论。

结论：**"能连多个" ≠ "并发安全"**。在语义确认前，采用"每会话一个 broker / `flock` 串行化"的设计，避免多 client 直连。

---

## 7. 踩过的坑

| 坑 | 现象 | 解决 |
|---|---|---|
| license 环境变量 | `[SCL] Checkout denied Verdi 2024.09`，回落到 `/usr/local/flexlm/...` | 显式 `SNPSLMD_LICENSE_FILE=27010@127.0.0.1` |
| `-serverPort` 不在 help | `verdi -help` 里没有 | 文档在 Tcl Reference p.98；仍可用 |
| window id ≠ X id | `xwininfo` Bad Drawable | `wvGetXWindowId` + `0x` 前缀 |
| `-ssf` 的窗口已持有 FSDB | 新建窗口 dump 失败、返回 0 | 对目标窗口先 `wvOpenFile` |
| 事件需要 pump | 收不到 `wvCursorTimeChange` | 每次命令后 `CmdCltCheckForEvents` |
| 窗口 off-screen | `xwd`/`import` 失败 | 换可视图窗口，或移动/置顶窗口 |

---

## 8. 未验证 / 未开始

- `wvGetSigValueByTime` / `wvGetCurValueString`（值查询）
- 跳变列表、X/Z 扫描
- `schTraceDriver` / `schTraceFanIn` / `schTraceX`（设计库依赖未知）
- `srcGetCaretFile` / source 窗口
- NPI / FSDB Reader 无头查询
- SSH 远程
- 多用户、跨机
- 大 FSDB 性能与内存
- 多 agent 并发语义

---

## 9. 产物与复现

**已归档（2026-10-17）**：源码、脚本与证据已从 `/tmp/opencode/verdi_poc/` 复制到仓库 `poc/`（见 `poc/README.md`）。

```
poc/
├── cmdclient.c                    # 客户端
├── build.sh                       # 编译（产物 cmdclient 不入库）
├── run_poc.sh                     # 一键复现（自动起停、只杀自己的端口）
├── verdi-session                  # 会话/端口管理
├── FINDINGS.md                    # PoC 记录
└── evidence/
    ├── poc_output.txt             # 命令/事件输出
    ├── signals.txt                # 40 个信号
    ├── nwave.png                  # GUI 截图
    ├── clientA*.out / clientB*.out# 多 client 并发测试输出
    └── multi*.log                 # 并发测试的 Verdi 日志
```

复现：

```bash
cd poc
./build.sh
PORT=11066 DISPLAY=localhost:10.0 XAUTHORITY=$HOME/.Xauthority ./run_poc.sh
```

注意：`run_poc.sh` 会从 `$VERDI_HOME/demo` 复制测试数据；不归档 Synopsys demo 与编译产物。原始 `/tmp` 副本仍可丢弃。

---

## 10. 当前状态

| 层 | 状态 |
|---|---|
| 传输（socket） | ✅ 可用 |
| nWave 操作 | ✅ 可用（建窗/开库/加信号/游标/枚举） |
| 事件回调 | ✅ 可用 |
| 截图 | ✅ 可用 |
| 会话/端口管理 | ✅ 可用 |
| demo 全链路（VCS→FSDB→Verdi） | ✅ 可用（`demo/sync_fifo`） |
| 值/跳变/X-Z | ⚠️ NPI 单点值 / X 已验证；GUI 工具未验证 |
| 设计追踪/schematic/source | ❌ 未验证 |
| 无头查询（NPI/FSDB Reader） | ✅ P0 可用（demo FSDB） |
| MCP 层 | ❌ 仅方案 |
| Skills | ❌ 仅方案 |

---

## 11. demo 实测（2026-10-17）

DUT / TB：`demo/rtl/sync_fifo.v` / `demo/tb/tb_sync_fifo.v`；场景见 `demo/README.md`。

### 编译 + 仿真（VERIFIED）

```bash
cd demo/sim
make clean
make sim
```

结果：

```
[40.0 ns] OK: rd_data is X while empty (xx)
TEST PASSED
$finish at simulation time 240.0 ns
```

产物 `sync_fifo.fsdb` 9677 bytes。`synenv.sh` 会 source `/opt/synopsys/env.synopsys.rc`；
VCS flags 对应 `.rc` 的 `vcscmd` alias。

### Verdi + libnclt（VERIFIED）

```bash
make verdi-server PORT=11066
# 另一 shell，经 libnclt：
wvCreateWindow                                  -> 348634d0
wvOpenFile -win 348634d0 .../sync_fifo.fsdb     -> path
wvAddSignal -win 348634d0 <11 signals>          -> 1
wvSetCursor -win 348634d0 40000                 -> 1
wvGetFileTimeUnit -win 348634d0                 -> 1ps
```

截图：`demo/evidence/nwave.png`。

### 注意

- `-ssf` 不保证把 FSDB 绑到**新建**的 nWave 窗口；必须先对该窗口 `wvOpenFile`，否则
  `wvAddSignal` 返回 0。
- 文件时间单位是 **1ps**，40 ns 的游标值是 `40000`，不是 `40`。
- demo 的空读 X 场景可直接作为 M3 值 / 跳变 / XZ 的回归输入。

---

## 12. NPI 实测（2026-10-17，P0）

脚本：`demo/npi/npi_smoke.py`；入口：`demo/npi/run_npi.sh`。

```bash
cd demo/npi
./run_npi.sh                  # 默认读 ../sim/sync_fifo.fsdb
```

结果：

```
NPI SMOKE PASSED
```

### 环境

- `/usr/bin/python3` **3.11.2**；`pynpi` 在 `$VERDI_HOME/share/NPI/python`，无需 pip。
- `PYTHONPATH=$VERDI_HOME/share/NPI/python`
- `LD_LIBRARY_PATH=$VERDI_HOME/share/NPI/lib/linux64:$VERDI_HOME/platform/linux64/lib/Qt5/lib`
  （否则 `libQt5Script.so.5` 缺失）
- `npisys.init()` + `waveform.open()` 成功，license 无 checkout 错误。

### 结果（demo FSDB）

- `scale_unit=1ps`，`min/max=0/240000`
- `tb_sync_fifo.rst_n @ 40ns` = `1`
- `tb_sync_fifo.rd_data @ 40ns` = `XX`
- `tb_sync_fifo.count @ 240ns` = `0`
- `rd_data 0..50ns` = `[(0, 'XX')]`
- `sig_find_x_backward(rd_data, 100ns)` = `(0, 'XX')`
- `clk vc_count 0..240ns` = `49`

### 耗时 / 内存

短进程两次运行：

| 阶段 | 耗时 |
|---|---:|
| `import pynpi` | 0.029 s |
| `npisys.init()` | 3.03 s |
| `waveform.open()` | 0.005–0.008 s |
| 100× `sig_value_at` | 0.001–0.002 s |
| `close` + `end` | 0.03–0.04 s |
| **总计** | **~3.1 s** |
| 峰值 RSS | **106 MB** |

### 语义坑

- `sig_find_x_forward(..., 0)` 找不到 time 0 的初始 X（初始值不是 value change）；
  用 `sig_value_between()` 或 `sig_find_x_backward()`。
- 3.1 s 主要花在 `npisys.init()`；如果 MCP 每次查询都起短进程，小查询会明显变慢。
  常驻 Reader 是否值得，需要 P1 的批量查询数据。
