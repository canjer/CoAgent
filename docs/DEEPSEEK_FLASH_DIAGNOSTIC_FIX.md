# DeepSeek Flash 诊断 HTTP 400 修复

## 实测原因
旧诊断第二步发送具名 tool_choice，DeepSeek Flash 默认思考模式拒绝它。使用 DEEPSEEK_API_KEY 实测 Responses：文本通过、工具 HTTP 400、续接跳过。单独合成请求返回 `Thinking mode does not support this tool_choice`。Chat 同样拒绝该工具请求，其思考输出也不属于当前文本桥接支持范围。

## 修改
- 官方 https://api.deepseek.com（根路径或 /v1）的 deepseek-flash：Responses 合成诊断加 reasoning.effort=none；界面诊断结果明确标记非思考模式。
- Chat 文本桥接对上述精确服务/模型增加 thinking.type=disabled，保持现有不支持思考内容的边界。此设置也适用于正常 Chat 请求。
- 普通 Responses 请求保持原始 reasoning 配置不变。其他模型和第三方同名服务不套用该选项。
- 不把工具选择改成 auto 来假装强制调用通过；仍要求唯一 diagnostic_echo、完整 JSON、随机工具结果回传。

## 验证
运行 `node --import tsx scripts/flash-diagnostics-live.ts`，从进程环境 DEEPSEEK_API_KEY 读取密钥，不在日志或源码保存密钥。两种协议各三项诊断通过，没有执行任何系统工具。诊断不是完整 Agent 任务或思考模式工具链认证。

参考：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/ 和 https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/
本轮构建开发版本，不打包或替换 /Applications/coAgent.app。
