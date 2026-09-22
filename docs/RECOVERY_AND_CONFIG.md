# 崩溃恢复与配置可靠性

## 本轮实现

### 配置存储

`apps/desktop/storage.mjs` 提供串行写入、Schema 校验和 version=1 格式。旧版无 version 的目录/模型配置读取时规范化，下一次写入迁移；未知版本不自动降级。

写入流程：校验 → 将上一份有效配置保存到 `.bak` → 同目录 0600 临时文件 → fsync → rename → 目录 fsync。相同内容不重复保存，避免重复 UI 事件挤掉有效历史备份。失败时不提前改变 Host 内存中的模型/目录选择。

主文件 JSON 或字段损坏时尝试有效备份，原文件复制为 `.corrupt-随机ID`，恢复后 UI 提示。主文件与备份均不可用时停止加载并报告错误，保留原件供人工修复；不是静默恢复默认值。新安装不存在配置时使用默认值。

### 任务持久化

`apps/desktop/recovery.mjs` 在 userData/task-state.json 保存最小任务记录：版本、任务 ID、工作目录、模型、threadId、turnId、状态和更新时间。无提示词、密钥、完整事件流。

- turn/start 之前先保存 running，写入失败不提交执行。
- turn/start 返回后绑定 turnId；快速完成不会被迟到的绑定覆盖。
- completed/failed/interrupted 通知持久化后再向 UI 报告终态。
- 未知退出或启动失败留下 needs-review；应用重启发现 running 也转为 needs-review。
- 存在未核对记录时拒绝 run。UI 展示原工作目录和模型，可读取对应历史；“已核对，解除阻塞”记录 reviewed 后才允许新任务。
- 用户确认表示已核对，不表示任务成功，不自动执行或回滚文件。
- 任务记录写入失败使当前 Host 阻止后续执行；原运行记录保留供下次启动核对。
- 备份恢复后的任务记录保守地进入待核对；若备份没有任务身份，则要求人工处理，不据此认定没有未完成任务。

### 进程保护

增加 Electron 单实例锁，降低多个应用实例同时写同一配置的风险。沿用原 userData 路径，不迁移既有会话。独立 Host、Codex 进程隔离与清理逻辑保持。

## 实际测试

- 配置旧格式、串行写入、相同内容写入、损坏主文件备份恢复、原始坏文件保留。
- 写入 rename 前故障注入：目标旧内容不变、临时文件清理。
- 非法路径、未来版本、无有效备份时拒绝覆盖。
- Journal 崩溃后阻止执行，错误确认 ID 拒绝，明确确认后解除，快速完成状态保持。
- Electron 工作台损坏 settings.json 后重启：从备份恢复并显示提示。
- 真实 Host 强制退出后再重启整个 Electron：待核对 ID 仍相同；run 被拒绝；查看历史、点击确认后解除；上游请求计数仍为 1，没有重放。
- DeepSeek/Qwen 桌面真实执行、重启历史、停止，以及审批/diff 回归。

```sh
cd /Users/c4n6r/cypherSec/CoAgent
npm run check
npm run desktop:build
npm run test:desktop:workbench
npm run test:desktop:host
```

## 尚未覆盖

写入故障为确定性故障注入，不宣称已通过物理断电测试。目录 fsync 失败可能发生在 rename 已提交后，按错误报告并要求核对，不承诺完全回退。备份仅保留上一份有效内容，不是多版本历史。

当前恢复是“持久化待核对 + 手动确认”，没有自动根据运行时推断未知任务最终结果；文件快照、撤销与冲突恢复尚未实施。配置与任务两者均损坏时仍需人工恢复，没有修复向导。单实例锁已接入，跨操作系统和多用户场景仍待验证。

下一步：系统凭据存储、完整模型设置页；随后实现任务文件快照与可逆恢复。

```text
继续 coAgent V1。读取 docs/RECOVERY_AND_CONFIG.md，先跑 npm run check、test:desktop:host 和 test:desktop:workbench。保留任务提交前落盘、崩溃后阻塞、不自动重放、显式确认和原子配置备份。下一步完善系统凭据存储与模型设置页，不将未知任务结果自动标为成功。
```
