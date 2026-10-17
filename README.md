# verdimcp

Verdi MCP：让 AI agent 通过 MCP 观察并操作正在运行的 Verdi/nWave 会话。

- **宿主**：f29（10.3.9.99），Verdi W-2024.09-SP1
- **传输**：`verdi -serverPort` + `libnclt`（已实测）
- **运行时（计划）**：Bun + TypeScript + `@modelcontextprotocol/sdk`
- **不做**：替换 Verdi GUI、编辑 RTL、绕过 license、把 RTL/FSDB 传到外部服务

## 入口

- 协作规范 / 项目宪法：[AGENTS.md](AGENTS.md)
- 文档索引与交接：[md/README.md](md/README.md)
- 当前进度与下一步：[progress.md](progress.md)

## 状态

PoC 已验证 socket 控制、nWave 基本操作、事件、截图与会话注册表；MCP server 与 skills **尚未实现**。详见 [md/README.md](md/README.md) 的状态表。
