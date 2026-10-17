# Verdi MCP — 文档索引与交接

> 本目录是项目的**权威文档**（见根目录 `AGENTS.md` §0.4）。代码是实现，不是来源。
> 最后更新：2026-10-17（项目初始化 session）

## 一句话

让 OpenCode 等 AI agent 通过 MCP 安全地观察并操作 f29 上正在运行的 Verdi/nWave 会话：发现/选择会话、打开 FSDB、摆放信号、移动游标、查询值/跳变/X-Z、追踪设计结构、截图取证。**不替换 Verdi GUI，不把 RTL/FSDB 传到外部服务。**

## 当前状态（2026-10-17）

| 层 | 状态 | 依据 |
|---|---|---|
| 传输：`-serverPort` + `libnclt` | ✅ VERIFIED | `01-test-progress.md` §3 |
| nWave：建窗 / 开库 / 加信号 / 游标 / 信号枚举 | ✅ VERIFIED | `01-test-progress.md` §3–4 |
| 事件回调 / 截图 / 会话注册表 / 多会话启动 | ✅ VERIFIED | `01-test-progress.md` §4–5 |
| 多 client 并发连接同一会话 | ⚠️ 结论不明确（出现返回错配） | `01-test-progress.md` §6 |
| 波形值 / 跳变 / X-Z 查询 | ❌ NOT_TESTED | — |
| 设计追踪 / schematic / source | ❌ NOT_TESTED（依赖 design DB，未知） | `00-recon.md` §1 |
| NPI / FSDB Reader 无头查询 | ❌ 未开始 | `04-npi-research.md` |
| MCP server | ❌ 仅设计 | `02-architecture.md` / `03-mcp-plan.md` |
| Skills | ❌ 仅设计 | `03-mcp-plan.md` §5 |
| 仓库 / 文档初始化 | ✅ 完成（已 commit 并 push 到 Forgejo `faye/verdimcp`，private） | `progress.md` |
| demo（`sync_fifo`） | ✅ 骨架建立；❌ 未跑仿真（VCS 调用命令未知） | `demo/README.md` |

## 文档索引

| 文件 | 内容 | 性质 |
|---|---|---|
| `00-recon.md` | 可行性报告、环境盘点、能力矩阵、PoC 证据 | 已验证事实 + 未验证项 |
| `01-test-progress.md` | 实测进展、传输/GUI/会话细节、踩坑、未验证清单 | 活文档（随测试更新） |
| `02-architecture.md` | 整体架构 v0.1、部署模式、会话发现、并发与安全 | 草案 |
| `03-mcp-plan.md` | 三层架构、MCP 工具面、Skills、里程碑 M1–M5 | 方案 |
| `04-npi-research.md` | NPI / verdi_bridge 调研、性能、验证计划 P0–P2 | 调研 + 待验证 |
| `05-web-api-reference.md` | 本地 HTTP/JSON API 参考设计（若后端做成服务） | 参考设计 |
| `06-vs-verdi-bridge.md` | 与 RuihongY/verdi_bridge 的对比、差异化策略 | 分析 |

## 接手顺序

1. 根目录 `AGENTS.md`（宪法、安全红线、文档纪律）
2. 本文件（状态 + 索引）
3. 根目录 `progress.md`（checklist / pending / NEXT / 交接）
4. 需要细节时再读 `01-test-progress.md`、`03-mcp-plan.md`

## 代码布局（现状与待定）

- 当前仓库有文档、配置、`poc/` 与 `demo/`；`mcp/`、`skills/`、`bin/` **尚未创建**。
- `03-mcp-plan.md` §3 建议的 `~/mydrv/aiwork/verdi-tools/` 已被本仓库 `~/mydrv/aiwork/verdimcp/` 取代；目录细分仍待确认（见 `progress.md` pending #3）。
- PoC 源码、脚本与证据已归档到 `poc/`（2026-10-17）。
- 测试用 demo 在 `demo/`：`rtl/sync_fifo.v` + `tb/tb_sync_fifo.v` + `sim/`（见 `demo/README.md`）。

## 运行 Verdi / VCS（项目内已知）

- **Verdi：有记录（VERIFIED）**：`verdi -serverPort <port> -ssf <fsdb>`；需要 `VERDI_HOME`、`SNPSLMD_LICENSE_FILE=27010@127.0.0.1`、可用的 `DISPLAY`/`XAUTHORITY`。详见 `00-recon.md` §2、`01-test-progress.md` §3。
- **VCS：无记录**：项目内没有 VCS 编译/运行命令；`demo/sim/Makefile` 的 VCS 目标是占位，待 faye 提供实际命令。

## 证据标签

- **VERIFIED**：在本机（f29）实际执行并观察到结果。
- **DOCUMENTED_ONLY**：仅见本地文档，未执行。
- **NOT_TESTED**：既未执行、也无可信文档结论。
- **INFERRED / PROPOSED**：推理或设计提案。

## 交接（2026-10-17）

- **完成**：`git init`（`main`，origin 指向 Forgejo）、`opencode.json`、`.gitignore`、7 份 inbox 文档归档进 `md/`、`progress.md`、`AGENTS.md` 改为 verdimcp / f29 口径、PoC 归档到 `poc/`、demo 骨架 `demo/{rtl,tb,sim}`、首次 commit、创建 private 仓库并 push。
- **未做**：任何 MCP/skills 代码；demo 的 VCS/仿真（不知道 VCS 调用命令）；值/跳变/XZ 与 NPI 验证。
- **下一步**：见 `progress.md` §4 NEXT。
