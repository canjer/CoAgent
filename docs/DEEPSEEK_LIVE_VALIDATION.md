# DeepSeek 真实调用验证

## 当前结论

用户充值后，`deepseek-flash` 原生 Responses 路径通过真实文件任务，以及进程重启后的历史恢复和继续执行。调用使用环境变量中的密钥；未把密钥写入源码、日志或模型上下文。

本记录只证明列出的任务通过；不代表完整 Agent 能力认证、全部工具格式兼容或 V1 发布验收通过。

## 执行环境与输入

- Codex：锁定 0.155.1，macOS arm64。
- 服务：DeepSeek 官方 Responses 接口，模型 deepseek-flash。
- 启动：交互式 zsh 加载用户配置的环境变量。
- 工作目录：每次新建的临时测试目录；测试结束清理。
- 运行时：独立 HOME、CODEX_HOME，工具使用 workspace-write 边界。
- 初始文件：input.txt，内容为 `coAgent smoke input` 加换行。
- 第一轮：读取输入，创建 output.txt，内容为 `coAgent smoke passed` 加换行，运行命令校验。
- 扩展测试：结束 Codex 进程，重新启动，列出并恢复原会话，验证轮次历史，然后创建 resumed.txt，内容为 `coAgent resume passed` 加换行。
- 最后确认 input.txt、output.txt 内容未被续轮改动，持久化历史新增一轮。

## 原始结果

充值后的基线命令：

```sh
/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && npm run smoke:live'
```

退出码：0。

```json
{"status":"PASS","model":"deepseek-flash","protocol":"responses","check":"single-live-file-task","deniedRequests":0,"fullAgentCertification":false}
```

增强脚本命令：

```sh
/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && npm run smoke:live -- --resume'
```

退出码：0。

```json
{"status":"PASS","model":"deepseek-flash","protocol":"responses","check":"single-live-file-task","deniedRequests":0,"fullAgentCertification":false}
{"status":"PASS","model":"deepseek-flash","protocol":"responses","check":"live-restart-resume-followup","persistedTurns":2,"deniedRequests":0,"fullAgentCertification":false}
```

新增断言：历史中至少有一个 commandExecution 状态为 completed 且 exitCode 为 0。模型文字声称成功不会单独构成通过依据。

## 状态更新

- 之前的 HTTP 402 已在本次请求中解除；历史错误记录保留。
- S0-05 更新为完成。
- 模型能力从 untested 更新为有限的 tool 级，fullAgentCertification 仍为 false。
- 第二个真实供应商、完整 Chat Completions + Codex 循环、20 例任务回归仍待完成。
- 当前变更不包含桌面 UI，不将此次测试计入 S1 前端交付。

## 复用

```text
继续 coAgent 开发。先读取本文件、S0_STATUS.md 和 V1_ROADMAP.md。
DeepSeek 原生 Responses 文件任务及重启续轮已实测通过，保留这项结果。
下一批扩展工具失败、取消和长上下文测试，或根据用户选定的第二供应商补齐双模型关口。
不在日志或配置样例中写入 API Key，不将有限烟测标记为完整 Agent 认证。
```
