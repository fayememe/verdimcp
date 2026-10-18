# PoC archive — libnclt socket control

> 归档日期：2026-10-17。来源：`/tmp/opencode/verdi_poc/`（易失，已复制而非移动）。
> 结论与证据标签见 `../md/00-recon.md`、`../md/01-test-progress.md`。

## 内容

| 文件 | 说明 |
|---|---|
| `cmdclient.c` | 最小 libnclt 客户端：连接 `-serverPort`、同步命令、事件回调 |
| `build.sh` | 编译 `cmdclient`（依赖 `$VERDI_HOME/share/libcmd`） |
| `run_poc.sh` | 一键复现：启动自己的 Verdi、建窗/开库/加信号/游标/枚举/截图、退出时只杀自己的进程 |
| `verdi-session` | 会话/端口管理（Python 3，注册表 `~/.local/state/verdi-sessions/`） |
| `FINDINGS.md` | PoC 结论、API 用法、踩坑 |
| `scan_xz.py` | X/Z 扫描原型（GUI 逐点；prototype，非最终工具） |
| `evidence/signals.txt` | 枚举出的 40 个信号 |
| `evidence/poc_output.txt` | 单会话命令/事件输出 |
| `evidence/clientA*.out`、`clientB*.out` | 多 client 并发测试输出（结论不明确） |
| `evidence/multi.log`、`multi2.log` | 并发测试的 Verdi 启动日志 |
| `evidence/nwave.png` | GUI 截图（CYCLE / R_W / VMA，游标 100 ns） |
| `evidence/nschema_x.png` | X 追踪 schematic 截图 |
| `evidence/source_window.png` | 源码 / 层次 / 波形同屏截图 |
| `evidence/tri.vcd`、`tri.vcd.fsdb` | 自制 X/Z 测试数据（x → 0 → z → 1） |
| `evidence/leafpin.rpt` | driver/load 叶子引脚报告 |
| `evidence/scan_out.txt` | `scan_xz.py` 的一次失败输出（缺 `libnclt`，非能力结论） |

未归档：编译产物 `cmdclient`、`__pycache__`、`demo/`（Synopsys 自带 demo，`run_poc.sh` 会从 `$VERDI_HOME` 复制）、`novas.*`、`verdi.log`。

## 复现

```bash
cd poc
./build.sh
PORT=11066 DISPLAY=localhost:10.0 XAUTHORITY=$HOME/.Xauthority ./run_poc.sh
```

注意：

- 需要 `SNPSLMD_LICENSE_FILE` 与可用的 X display（见 `FINDINGS.md`）。
- `run_poc.sh` 只杀 cmdline 含 `-serverPort <PORT>` 的进程；仍应先确认端口未被他人占用。
- **只对 f29 上自己的会话操作**；不要 attach 或杀死其他用户的 Verdi。
- `verdi-session` 当前假定 `cmdclient` 安装在 `~/.local/libexec/verdi-session/cmdclient`；安装脚本尚未归档，M0 再补。
- `scan_xz.py` 需要先构建 `poc/cmdclient`，并让 `LD_LIBRARY_PATH` 包含
  `$VERDI_HOME/share/libcmd/linux64`；它按 25 ns 步长采样 `evidence/signals.txt`，未做预算/分页。
  `evidence/scan_out.txt` 是未设置库路径时的失败记录，不代表 XZ 能力结论。
