# 独立 Host Utility Process（2026-09-21）

## 已实施的结构

```text
React Renderer → 有限 Preload IPC → Electron Main
                                     ↓ 请求 ID / 响应 / 事件
                              Host Utility Process
                              ├─ Codex 编排、会话与审批
                              ├─ 本地模型网关及模型切换
                              ├─ 配置读取保存
                              ├─ 文件预览 / Git diff
                              └─ Codex app-server 子进程
```

保留 Codex 编排，不替换 Agent 引擎。Electron Main 仅保留窗口、原生目录选择、IPC 发送方校验和 Host 生命周期。业务代码移到 `apps/desktop/host.mjs`，连接管理位于 `apps/desktop/host-client.mjs`。构建独立产出 `dist/desktop/host.mjs`。

## 生命周期

- Host 由 Electron utilityProcess.fork 创建，使用独立 PID；只传入明确列出的环境变量。
- 主进程与 Host 通过消息端口通信，请求 ID 匹配响应；启动超时 15 秒、业务请求超时 30 秒。
- Host 退出时拒绝未完成请求、清空连接引用并通知 UI；不重试 run、不自动重放工具。
- 主进程登记 Host 报告的 Codex PID，Host 意外退出后清理该进程组；正常退出走原有 Codex → 网关 → 临时目录清理。
- 下一次用户操作可拉起新 Host，从 settings.json 与 Codex 历史重新读取数据。旧审批不复用。
- UI 在 Host 崩溃后明确提示核对文件与历史，不把未知任务结果显示为成功。
- shutdown 仅供 Main 使用，不加入 Renderer 可调用方法白名单；Renderer 也没有进程终止入口。

## 验证

1. `npm run check`：原单元/协议/集成回归。
2. `npm run test:desktop:workbench`：双模型选择保存、重启、已暂存/未暂存 diff、正常退出。
3. `npm run test:desktop:approval`：真实运行时审批允许/拒绝。
4. `npm run test:desktop:host`：确定性本地服务保持推理请求未完成；检查 Host 与 Electron PID 不同，Codex 的父进程为 Host；SIGKILL Host，验证窗口存活、Codex 清理、新 Host PID、历史可查询、旧审批拒绝、上游请求仍只有一次。
5. DeepSeek 和 Qwen 的真实桌面任务：文件写入与预览、重启历史、停止 interrupted。

本轮不重复完整 20 项模型质量回归。此前 DeepSeek 20/20、Qwen 18/20 保留为历史记录；Host 架构回归不改变 Qwen 两项问题的状态。

## 边界与下一步

- 独立进程用于职责与故障隔离，不是操作系统安全沙箱；供应商密钥存在于 Host 内存及其启动环境。
- 主进程能清理已登记的 Codex 进程组；极端的启动登记窗口、整机断电、Main 自身 SIGKILL、逃离进程组的后代需要继续验证。
- 尚无持久化的活动任务恢复记录。当前只在本次桌面存活期间显示“需核对”，不是完整的跨应用崩溃恢复。
- 配置仍采用原 JSON 保存逻辑；Schema、原子写入、备份与迁移是下一步。
- 单应用实例锁、系统凭据存储、独立安装包仍待实现。

参考：[Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)。

```text
继续 coAgent V1：先阅读 docs/HOST_PROCESS.md，执行 npm run check 和 npm run test:desktop:host。保持 Main / Host / Codex 三层隔离，不自动重放未知结果的任务。下一步实现 JSON 配置原子写入、Schema 和备份恢复，再补活动任务持久化与崩溃核对流程。保留双模型、审批、停止、文件预览和 Git diff 回归。
```
