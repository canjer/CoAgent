# 命令同类审批

命令审批卡增加「本次任务允许同类命令」。本轮按完整命令内容、工作目录、任务标识和完整权限上下文精确匹配，仅忽略 itemId、approvalId、startedAtMs 等回调元数据。

- 不按可执行文件名或宽泛 shell 前缀匹配；参数、工作目录、权限上下文变化需重新审批。
- 命令原文不作 shell 重写或空白归一化；不把 `npm test` 授权扩展为其他 npm 命令。
- 上下文中将来的未知字段也进入比较，避免新权限被忽略。
- 仅支持 commandExecution 中的 command 审批；文件修改、writeStdin、网络专用/缺失命令审批、MCP 均不取得命令授权。
- Host 内存保存，最多 100 类；每个自动接受动作产生 command/auto-approved 事件。
- 新任务、任务完成、停止、runtime 断连、Host 重启/退出清除。不会修改 Codex 持久 execpolicy，不使用 acceptForSession。
- 用户仍可选「允许此次操作」或「拒绝」。命令内容相同不意味着其读取的脚本或输入文件永远不变，用户授权的是本次任务内重复执行该命令。

验证：`npm run test:desktop:command-scopes` 使用真实 Codex 和本地合成 provider，两次相同追加命令只审批一次；变化命令重新审批；新任务同命令重新审批；拒绝不产生额外写入。原命令允许/拒绝、浏览器任务完全授权和 Host 崩溃恢复继续回归。

本轮只构建开发版，不生成安装包。
