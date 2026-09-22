# V1 桌面与 Agent 回归交付（2026-09-21）

## 本轮决策

按用户最新调整，第二个模型供应商暂缓，不再阻挡桌面开发。当前唯一真实模型为 DeepSeek Flash，走原生 Responses。通用 Chat 桥接和多供应商验收继续单列，不标记完成。

## 已实现

- Electron + React + Vite 三栏桌面工作台：目录选择、最近会话、提示卡、输入与流式回答、命令输出、执行动态。
- 真实 Codex app-server 会话创建、继续会话、停止任务；运行中禁止切换目录和会话。
- 原生命令/文件审批卡，只允许一次响应，任务结束清理待审批项。
- 应用专属 userData/runtime 保存 Codex 历史；settings.json 保存工作目录。不新增业务 SQLite、不引入登录。
- 渲染器关闭 Node，开启 contextIsolation 和 sandbox；固定 preload IPC，主框架发送方检查，禁止外部导航、新窗口、权限申请；CSP 禁止渲染器网络访问。
- DeepSeek 凭据仅从启动环境取得，由网关使用，不传入渲染器或 Codex 子进程环境。
- 网关本地随机令牌写入应用运行目录，以 auth helper 读取；退出清理临时运行目录与子进程。

## 启动（macOS Apple Silicon）

```sh
cd /Users/c4n6r/cypherSec/CoAgent
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run desktop
```

在已经加载 DEEPSEEK_API_KEY 的终端执行。已有依赖时直接 npm run desktop。
先选择一个工作文件夹，再输入任务。Cmd+Enter 发送；运行中可点停止。审批卡明确允许或拒绝。
当前原生 Codex 二进制选择锁定 macOS arm64；尚未打包签名为独立安装包。

## 回归方法与结果

1. `npm run check`：32 个单元/协议测试、3 个真实运行时/桥接集成测试。
2. `npm run test:agent`：20 个独立临时工作目录中的真实 DeepSeek 任务；断言 completed、结果精确字节、原文件不变以及成功工具退出码。中文/嵌套/多文件另查产物，失败恢复另查非零退出码。
3. `npm run smoke:live -- --resume`：真实进程重启、历史持久化与续轮任务。
4. `npm run test:desktop`：真实 Electron 窗口 + DeepSeek，输入任务、文件落盘、重启历史、停止。校验 renderer 无 require。
5. `npm run test:desktop:approval`：脚本 Responses 服务 + 真实 Codex + 真实 Electron；分别拒绝/允许升级命令，检查文件不存在/内容正确。此项不是 DeepSeek 自主请求审批能力认证。

最终完整固定套件 **20/20 通过**，逐项结果见 AGENT_REGRESSION.json。首次加强退出码断言后为 19/20：恢复任务把 false 和后续命令合并执行，未出现独立的非零退出码。随后明确要求 false 独立工具调用再恢复，重跑完整套件；保留首轮文件 `.verification/agent-regression-strict-first.json`。不隐藏此前失败，也不将输出文件正确等同所有子步骤正确。

截图见 `.verification/desktop-welcome.png`、`desktop-task.png`、`desktop-approval.png`，已视觉检查。

## 当前阶段边界与下一批

这是可运行的开发版桌面闭环，不是全部 V1 发布验收。

- 为尽早验证前端，Host 编排和网关暂在 Electron 主进程；Codex 在独立子进程。下一步抽取 Utility Process，提高主进程故障隔离。
- 当前桌面固定 DeepSeek；模型设置页、系统凭据存储、第二供应商后续加入。
- 文件树/文件预览、变更 diff、Markdown 富文本、模板编辑器、历史分页尚未完成；本轮前端显示会话/命令与运行时事件。
- 当前停止测试覆盖终态，不覆盖所有长命令后代进程组合；大上下文、长时任务、崩溃恢复、升级迁移继续做耐久测试。
- 打包、签名、公证、自动更新、跨平台适配后续完成。

## 可复用续接提示词

```text
继续 /Users/c4n6r/cypherSec/CoAgent 的 V1。先阅读 docs/DESKTOP_V1_STATUS.md 和 V1_ROADMAP.md，执行 npm run check 与 npm run desktop:build。保持第二模型服务暂缓；优先抽取 Host Utility Process、补充文件/diff 面板和桌面错误恢复。保留已验证 DeepSeek Responses、会话历史、审批和停止链路。不要读取个人 Codex 认证文件，不重复初始化项目。真实调用测试与本地脚本提供者测试分别记录。
```

### 桌面回归修复记录

重复实测暴露启动阶段 list/run 并发初始化和快速停止的竞态。连接初始化改为共享 Promise，停止请求在 turn/start 返回前缓存，结合完成轮次集合避免完成后恢复 busy。桌面测试对停止追加 `interrupted` 终态断言，而非仅检查按钮恢复；审批测试追加 5 次并发 list 调用。

## 最新更新：deepseek-chat 与工作文件面板

默认请求模型现为 `deepseek-chat`（供应商实测返回 `deepseek-flash` 别名解析结果）。本轮重新完成 20/20 固定 Agent 回归，并新增目录浏览/只读 UTF-8 预览、边界检查与桌面验收。此前 Flash 记录保留为历史。具体以 [本轮验证](/Users/c4n6r/cypherSec/CoAgent/docs/DEEPSEEK_CHAT_VALIDATION.md) 为准；diff 面板与独立 Host 仍待开发。

## 最新更新：启用 Qwen 官方模型与 Git diff

用户已启用第二供应商 Qwen3.5 Flash，覆盖此前暂缓决策。桌面新增 DeepSeek / Qwen 模型选择与配置保存；两者使用官方 OpenAI Responses 兼容入口。新增只读 Git 已暂存/未暂存 diff 面板。实际回归和启动方法见 [Qwen 与 diff 交付记录](/Users/c4n6r/cypherSec/CoAgent/docs/QWEN_AND_DIFF.md)。独立 Host Utility Process 和签名发布仍待开发。
