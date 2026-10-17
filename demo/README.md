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

### Verdi（项目内已验证的启动方式）

```bash
export VERDI_HOME=/opt/synopsys/verdi/W-2024.09-SP1
export SNPSLMD_LICENSE_FILE=27010@127.0.0.1
export DISPLAY=localhost:10.0
export XAUTHORITY=$HOME/.Xauthority

cd demo/sim
make verdi                      # verdi -ssf sync_fifo.fsdb
# 或暴露命令服务给 libnclt：
make verdi-server PORT=11066    # verdi -serverPort 11066 -ssf sync_fifo.fsdb
```

### VCS

**本项目目前没有记录 VCS 的编译/运行命令**（`md/`、`poc/` 内都没有）。`sim/Makefile`
里的 VCS 目标是占位，参数未经本机验证：

```bash
cd demo/sim
make sim
```

如果 VCS 报 `$fsdbDumpfile` 未定义，需要补 Verdi 的 PLI 选项；具体路径与参数以 faye 提供的
f29 实际流程为准。

## 预期波形 landmark

- `~0 ns`：`rd_data` 为 X（空 FIFO + 未初始化 memory）；
- 第一次写满后：`full=1`、`wr_ready=0`；
- 满时写请求：`wr_valid=1` 但 `wr_ready=0`，`count` 保持 4；
- 同时读写：`rd_data=0xA3`，`count` 保持 2；
- 结束：`TEST PASSED`，`empty=1`。
