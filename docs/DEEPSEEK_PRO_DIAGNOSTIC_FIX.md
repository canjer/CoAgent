# DeepSeek V4 Pro 诊断适配

2026-09-24

上一轮只匹配 deepseek-flash，漏掉 deepseek-v4-pro。本轮实测旧版 Pro Responses 文本通过、工具 HTTP 400、续接跳过；Chat 同样工具 HTTP 400。

将匹配器改为 isOfficialDeepSeekTextModel，精确支持官方域名根路径及 /v1 的 deepseek-flash、deepseek-v4-pro。Responses 仅合成诊断设置 reasoning.effort=none，正常任务不变；Chat 文本适配使用 thinking.type=disabled。其他模型和第三方端点保持原样。

使用 DEEPSEEK_API_KEY 环境变量运行 `node --import tsx scripts/pro-diagnostics-live.ts`，Pro/Flash × Responses/Chat 四组、共十二项合成诊断通过；不执行系统工具、不保存密钥。该结果不等同于思考模式或完整 Agent 测试。

参考：https://api-docs.deepseek.com/api/create-chat-completion/
仅更新源码与开发构建，未打包或替换安装目录。
