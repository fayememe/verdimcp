# demo — sync_fifo

用于测试 Verdi MCP 的最小 DUT：同步 FIFO + valid/ready 握手，带一个明确的 X 场景。
目标是给“开会话 → 开 FSDB → 摆信号 → 移游标 → 查值/跳变/XZ → 截图”提供稳定输入。

## 布局

```
demo/
├── rtl/sync_fifo.v          # DUT：参数化同步 FIFO（DATA_WIDTH=8, DEPTH=4）
├── tb/tb_sync_fifo.v        # 自检 testbench + FSDB dump
└── sim/
    ├── filelist.f
    └── Makefile             # sim / verdi / verdi-server / clean
```

## 测试场景

1. 复位；
2. 空 FIFO 时 `rd_data` 来自未初始化 memory → **X**（给 X/Z 查询用）；
3. 写 2 项，检查 `count`；
4. 写满，检查 `full`、`wr_ready=0`；
5. 满时写请求被拒绝，`count` 不变；
6. 读 2 项，检查数据与 `count`；
7. 同时读 + 写，`count` 不变；
8. 排空，检查 `empty`、`rd_valid=0`。

## 建议观察的信号

| 信号 | 用途 |
|---|---|
| `clk` / `rst_n` | 时间基准 |
| `wr_valid` / `wr_ready` / `wr_data` | 写握手 |
| `rd_valid` / `rd_ready` / `rd_data` | 读握手 / X 场景 |
| `full` / `empty` / `count` | 状态与边界 |
| `dut.mem` | memory 数组，确认未初始化项为 X |

## 运行

`sim/synenv.sh` 会 source `/opt/synopsys/env.synopsys.rc`，因此 VCS/Verdi 的 PATH、
`VCS_HOME`、`VERDI_HOME` 与 license 环境都按站点配置来。Makefile 的 flags 对应
`.rc` 里的 `vcscmd` / `verdicmd` alias。

### 编译 + 仿真（VERIFIED 2026-10-17）

```bash
cd demo/sim
make clean
make sim
```

实际结果：

```
[40.0 ns] OK: rd_data is X while empty (xx)
TEST PASSED
$finish at simulation time 240.0 ns
```

并生成 `sync_fifo.fsdb`（约 9.7 KB）。

### Verdi

```bash
cd demo/sim
make verdi                      # 打开 design + FSDB
# 或暴露命令服务给 libnclt / Verdi MCP：
make verdi-server PORT=11066    # verdi ... -ssf sync_fifo.fsdb -serverPort 11066
```

GUI 需要可用的 X display；Makefile 默认 `DISPLAY=localhost:10.0`、
`XAUTHORITY=$HOME/.Xauthority`，可在环境里覆盖。

### 用 libnclt 操作这个 demo（VERIFIED）

```bash
cd poc
../demo/sim/synenv.sh ./build.sh             # 构建 cmdclient

# 注意：-ssf 打开的窗口不一定是你要操作的新 nWave 窗口；
# 先 wvCreateWindow，再对新窗口 wvOpenFile，之后才能 wvAddSignal。
../demo/sim/synenv.sh bash -c '
  export LD_LIBRARY_PATH="$VERDI_HOME/share/libcmd/linux64:${LD_LIBRARY_PATH:-}"
  ./poc/cmdclient 11066 \
    "wvGetAllWindows" \
    "wvCreateWindow" \
    "wvOpenFile -win <WIN> /home/faye/mydrv/aiwork/verdimcp/demo/sim/sync_fifo.fsdb" \
    "wvAddSignal -win <WIN> /tb_sync_fifo/clk /tb_sync_fifo/rst_n /tb_sync_fifo/wr_valid /tb_sync_fifo/wr_ready /tb_sync_fifo/wr_data /tb_sync_fifo/rd_valid /tb_sync_fifo/rd_ready /tb_sync_fifo/rd_data /tb_sync_fifo/full /tb_sync_fifo/empty /tb_sync_fifo/count" \
    "wvSetCursor -win <WIN> 40000" \
    "wvGetFileTimeUnit -win <WIN>"
'
```

实测：11 个信号全部加入成功；`wvGetFileTimeUnit` 返回 **1ps**，所以 40 ns 的游标值是
`40000`，不是 `40`。`rd_data` 在空 FIFO 阶段显示为 X。截图：`evidence/nwave.png`。

## 预期波形 landmark

- `~0 ns`：`rd_data` 为 X（空 FIFO + 未初始化 memory）；
- 第一次写满后：`full=1`、`wr_ready=0`；
- 满时写请求：`wr_valid=1` 但 `wr_ready=0`，`count` 保持 4；
- 同时读写：`rd_data=0xA3`，`count` 保持 2；
- 结束：`TEST PASSED`，`empty=1`。
