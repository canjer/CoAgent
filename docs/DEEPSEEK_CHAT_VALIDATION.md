# deepseek-chat 切换与文件面板（2026-09-21）

## 模型设置

桌面创建会话、恢复会话和 Gateway 上游请求均设置为 `deepseek-chat`；界面标识为 DeepSeek Chat。真实烟测和固定套件使用相同模型名。旧 `deepseek-flash` 示例和历史报告保留，不作为本轮模型证据。

实测最小请求：

- POST https://api.deepseek.com/responses，model=deepseek-chat，HTTP 200，响应 model=deepseek-flash。
- POST https://api.deepseek.com/chat/completions，model=deepseek-chat，HTTP 200，响应 model=deepseek-flash。

因此当前供应商将 deepseek-chat 解析为 Flash 别名，客户端没有悄悄替换请求模型。此结果不代表独立旧模型版本。生产路径继续采用已实测 Responses，不引入未经验证的通用 Chat 桥接。

官方协议参考：https://api-docs.deepseek.com/api/create-response/

## 本轮结果

- deepseek-chat 真实文件任务、重启历史、续轮：PASS。
- deepseek-chat 固定 Agent 回归：20/20；具体输入输出记录于 AGENT_REGRESSION.json。
- Flash 历史回归另存 AGENT_REGRESSION_FLASH.json。
- 文件模块单测：目录列表、UTF-8、中文路径、越界路径、外部软链接、二进制、大小上限及非法编码。
- 桌面 E2E：默认模型断言、真实文件任务、文件预览内容、重启历史、停止 interrupted 终态。
- 审批脚本提供者检查收到的请求 model 确为 deepseek-chat。

## 下一步已落地：只读工作文件面板

右侧“工作文件”标签支持目录浏览、上一级、刷新和 UTF-8 文本预览。忽略 .git/node_modules 和软链接列表；每目录显示上限 300 项，预览上限 256 KiB；IPC 用 realpath 检查工作目录边界。预览不写文件、不向模型自动发送文件内容。文件在外部变化后点击刷新。

新增 apps/desktop/files.mjs、tests/files.test.mjs；渲染器仅经有限 IPC 读取，继续关闭 Node 和渲染器网络访问。

## 后续阶段

变更 diff 面板、独立 Host Utility Process、模型设置页、系统凭据存储与独立应用打包仍待完成。当前为 macOS arm64 开发版，第二模型服务继续暂缓。

```sh
cd /Users/c4n6r/cypherSec/CoAgent
npm run desktop
```

可复用续接提示词：

```text
继续 coAgent V1，默认请求模型保持 deepseek-chat；注意供应商当前响应 model 为 deepseek-flash。先运行 npm run check 与桌面构建，保留只读文件面板、真实历史恢复和停止链路。下一步优先实现变更 diff 面板和 Host Utility Process。第二模型服务继续暂缓。历史 Flash 结果和 Chat 新回归分开记录。
```

停止处理补充：按 turnId 去重中断请求；针对 app-server 启动确认与 active turn 注册之间的短暂窗口，仅对 `no active turn to interrupt` 做有界重试（100 ms 间隔，最多 10 次），其他错误原样反馈，不伪造停止终态。
