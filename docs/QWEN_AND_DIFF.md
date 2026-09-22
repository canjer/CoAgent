# Qwen3.5 Flash 与桌面 Git diff

## 本轮配置

- 官方模型 ID：`qwen3.5-flash`（小写）。凭据环境变量：`QWEN_API_KEY`。
- 已验证北京地域官方地址：`https://dashscope.aliyuncs.com/compatible-mode/v1`。
- 最小 Chat Completions 与 Responses 请求均返回 HTTP 200，响应模型均为 `qwen3.5-flash`。
- Agent 采用官方 **OpenAI Responses 兼容入口**；没有使用第三方中转，也没有把 Chat Completions 连通测试当成完整 Chat 桥接验收。
- Chat Completions 探测显式 `enable_thinking=false`；实际 Agent Responses 使用服务默认设置，两者不混记为同一配置。
- 供应商档案集中在 `packages/model-gateway/src/profiles.ts`，示例在 `examples/qwen3.5-flash.json`。

[官方模型文档](https://help.aliyun.com/zh/model-studio/qwen3-5-flash) · [官方 Responses API 文档](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-responses)

## 桌面模型选择

右上角模型菜单提供 DeepSeek Chat / Qwen3.5 Flash。未设置对应密钥时选项禁用；运行中禁止切换。切换时关闭旧 Codex 和网关，下一次操作创建新连接。模型 ID 和工作目录保存到应用 settings.json，密钥不保存、不传给 renderer 或 Codex 子进程环境。

默认沿用已有模型配置；没有配置时仍为 DeepSeek Chat。可在 UI 选择 Qwen，或启动时指定：

```sh
cd /Users/c4n6r/cypherSec/CoAgent
COAGENT_MODEL=qwen3.5-flash npm run desktop
```

`COAGENT_MODEL` 在启动时优先于保存的选择，不修改环境变量中的密钥。切换后恢复旧会话时，会向 Codex 明确发送所选 model，不继续沿用旧会话的模型设置。

## 下一步已实现：Git diff

右侧“变更”标签展示已暂存/未暂存差异，支持刷新、增删行颜色。操作只读，不执行 git add/commit/reset。未跟踪文件不包含在 git diff 中，可在文件面板预览。

- 工作目录必须是 Git 仓库根目录；不读取父级仓库的 diff。
- 使用固定 `/usr/bin/git`、参数数组、关闭 external diff/textconv、禁用 fsmonitor/hooks。
- 不继承调用者的 Git 环境，不读取全局/系统 Git 配置；10 秒超时、1 MiB 输出上限。
- 非 Git 仓库和超限等错误在面板显示，不产生文件写入。

## 验证证据

- Qwen 真实文件任务 + 关闭进程 + 历史恢复 + 续轮：PASS。
- Qwen 真实桌面：执行文件任务、内容预览、重启历史、停止 `interrupted`：PASS。
- 本地桌面：DeepSeek → Qwen → 重启仍为 Qwen → DeepSeek，双向切换与保存：PASS。
- 本地桌面：未暂存与已暂存 diff 的实际 `+new line` / `-old line`：PASS，截图已检查。
- 单测新增模型档案/凭据变量区分、拒绝未知模型、Git diff 正常/空/非仓库/父仓库边界。
- 固定 Agent 回归结果以 `docs/AGENT_REGRESSION_qwen3.5-flash.json` 为准，每项验证文件与工具退出码，结果不只依赖模型文字回复。

可复现命令：

```sh
npm run check
npm run desktop:build
npm run test:desktop:workbench
COAGENT_MODEL=qwen3.5-flash npm run smoke:live -- --resume
COAGENT_MODEL=qwen3.5-flash npm run test:agent
COAGENT_MODEL=qwen3.5-flash npm run test:desktop
```

## 固定回归结果：首轮 18/20（90%）

首轮完整运行退出码为 1，保留所有失败项，不将整套标为全绿：

- `count`：期望 `3\n`，实际为七个前导空格后接 `3\n`。语义计数正确，精确文件格式断言失败。
- `trim`：首轮记录 Error，未完成文件结果校验；该轮仅记录错误类别，因此根因尚未确认。独立使用相同任务复测为 1/1（退出 0），结果另存 `AGENT_REGRESSION_qwen3.5-flash_trim.json`，不覆盖完整首轮报告。

本地单元/集成测试 35 + 3 全通过。Qwen 达到原计划 80% 固定任务门槛，但仍有稳定性与格式遵循问题，保留后续优化项。DeepSeek 本轮额外重跑文件烟测和恢复续轮均通过，历史 20/20 不冒充本轮完整重测。

## 后续阶段

用户本轮已明确启用第二供应商，覆盖此前“暂缓第二模型”的决策。现阶段两个供应商均走 Responses；通用 Chat Completions 工具桥接、思考模式切换及多模态尚未完成验收。

独立 Host Utility Process、系统凭据存储、安装包签名/公证仍待开发。当前 Git diff 是仓库状态视图，不是每轮任务的自动前后快照；非 Git 文件夹暂不生成差异。

```text
继续 /Users/c4n6r/cypherSec/CoAgent。读取 docs/QWEN_AND_DIFF.md，先跑 npm run check。保留 DeepSeek Chat / Qwen3.5 Flash 双模型切换、独立环境凭据、真实历史恢复、停止、审批和 Git diff。下一步抽取 Host Utility Process，并补充崩溃恢复测试。不要把原生 Responses 的验收当作通用 Chat 桥接验收。
```

### 模型切换与退出竞态修复

连续切换模型后立即退出时，旧实现可能重复关闭同一网关并使退出等待挂起。现已将资源释放统一为可重复调用的共享 Promise，提前摘除旧连接引用；退出无论清理成功与否均结束应用。模型配置写入完成后才更新对外状态。桌面工作台回归包含切换、重启和最终退出完成标记。
