# 协议能力诊断与 Chat Agent 文本适配

## 设置页诊断

每个已配置模型增加「诊断」按钮，与「测试」分开：测试仍仅验证最小 HTTP 请求；诊断通过实际 Gateway 路径，最多发送三条合成请求，不运行文件、命令或其他系统工具。

1. **流式文本与终止事件**：要求 SSE 文本增量及 completed，拒绝缺失终止、失败、不完整流。
2. **工具调用与完整 JSON 参数**：要求唯一 diagnostic_echo 工具和指定 JSON 值；仅检查调用，不执行真实工具。
3. **工具结果续接**：把本次随机字符串作为虚拟工具结果送回模型，要求最终文本包含它；避免固定答案导致假阳性。

工具检查失败后，续接标记“跳过”；其他失败保留为失败，不自动重试。每次请求上限 15 秒，整体最多约 45 秒，限制事件总数及累计响应体大小。界面说明少量 API 用量，结果带时间/协议/模型，不含密钥及上游原始响应。状态只保存在当前设置面板内，保存凭据或编辑配置后失效，不写“永久已认证”。

原生 Responses 与 Chat Completions 都支持上述诊断。三项通过仍不代表完整 Agent 认证，不覆盖所有工具、审批、多模态或模型质量。

## 本轮实际适配问题

真实 Codex 0.155.1 发出的文本模型请求包含 `include:["reasoning.encrypted_content"]` 和 `reasoning:{summary:"auto"}`，此前严格桥接直接报 422，导致普通聊天可用但真实 Agent 不可用。

引入显式 `codex-text` 路径：仅将上述可选的推理输出请求及 summary none/auto 规范化为不请求推理输出。通用 toChatRequest 默认仍是 strict；Gateway 的 Chat 路径明确使用 codex-text。它不伪造推理摘要，不接受 effort 等实际推理控制，也不吞掉 reasoning/refusal 内容。多模态、自定义工具、未支持字段仍明确失败。

保留已有工具历史 ID 校验、参数分片拼接、整个工具批次完成后校验再发出可执行事件、断流失败、输出大小限制与取消传递。内部 alias 与供应商实际模型 ID 继续分离。

## 自动测试

```sh
cd /Users/c4n6r/cypherSec/CoAgent
npm run check
npm run desktop:build
npm run test:desktop:diagnostics
# 需要对应环境变量；下列会发真实模型请求
npm run diagnose:chat:live
npm run smoke:chat:live
COAGENT_MODEL=qwen3.5-flash npm run diagnose:chat:live
COAGENT_MODEL=qwen3.5-flash npm run smoke:chat:live
```

- 54 个单元/协议测试，包含两协议诊断、HTTP 失败脱敏、超时以及 codex-text 字段边界。
- 5 个集成测试：新增真实 Codex + Chat 分片工具参数、读写文件、历史重启，以及 Chat 链路取消。供应商为本机确定性测试服务，不冒充真实模型。
- 桌面设置页专项：经 UI 点击诊断，三条 Chat 请求走完，显示三项通过，未执行命令。
- DeepSeek Chat 真实三项诊断与文件任务/重启续接通过；结果见 VERIFICATION.txt。

原先“Chat 只有脚本驱动工具回环”的描述已被新增真实 runtime 结果补充，完整固定任务集现已在 Chat 路径执行：DeepSeek 20/20，Qwen 16/20，见 [完整回归报告](CHAT_AGENT_REGRESSION.md)；Qwen 历史 Responses 18/20 记录不变。现有内置模型协议继续是 Responses，不自动切换用户配置。

## 尚待验证

更多真实模型、推理/多模态专用适配、Qwen 未通过任务的可靠性改进、并行工具与审批专项。个人安装版此前凭据 UI 超时仍作为独立未完成项保留，不因本轮协议测试通过而改写。

## Qwen 文本专项修复

官方 Qwen3.5 Flash 默认启用 thinking，文本桥接针对精确匹配的官方 endpoint/model 显式发送 enable_thinking=false；任意其他服务或模型不会自动注入该参数。依据：[阿里云深度思考文档](https://www.alibabacloud.com/help/zh/model-studio/deep-thinking)。设置编辑器明确说明这一文本模式。

实际工具流还会在续接分片发送空字符串 id。适配层保留首次非空 ID，忽略后续空 ID 和 null 名称/参数分片；不同的非空 ID 仍报错，最终缺失身份仍报错。新增专项测试防止错误合并工具调用。原始两次失败诊断与失败 Agent 冒烟记录保留。

官方 Qwen 强制工具选择还会在有效工具调用末尾使用 finish_reason=stop。仅精确匹配官方 Qwen 文本 profile 时接受这一结束方式；仍必须收到 [DONE]，且完整批次的工具 ID、名称、JSON 参数校验通过后才发出执行事件。通用 profile 保留严格的 tool_calls 结束要求。

修复后 Qwen Chat 三项诊断全部通过；DeepSeek 与 Qwen 均通过真实单文件任务及重启续接。早期失败保留，未将这些短测试解释成完整 20 例或全部协议特性通过。
