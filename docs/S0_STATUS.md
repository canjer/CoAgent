# S0 开发进展与兼容性记录

更新：2026-09-21。**S0 已实现可运行原型，但尚未通过双真实模型验收；V1 尚未发布。**

## 1. 本轮已实现

- TypeScript 工程、精确版本依赖和锁文件。
- Codex 0.155.1 原生二进制哈希与 721 个上游生成类型文件。
- stdio 双向 RPC：初始化、请求关联、审批响应、通知、超时、异常与进程树关闭。
- 版本化会话封装：创建、列表、历史读取、恢复、启动、停止。
- 隔离 HOME、CODEX_HOME 和测试工作目录；不读取个人运行时配置。
- 本地模型网关：Responses 转发、模型别名、调用凭据、超时、取消与错误内容脱敏。
- Chat Completions 严格子集：文本流、JSON 工具、多轮工具结果、SSE 分片解析与失败事件。
- 首个目标模型配置：deepseek-flash；配置不含 API Key。
- DeepSeek 真实烟测入口；缺少环境密钥时明确返回待验证状态与退出码 2。

## 2. 证据分层

| 层次 | 实际执行 | 结论 |
| --- | --- | --- |
| 类型检查与构建 | tsc 检查与编译 | 通过 |
| 单元与 HTTP 契约 | 32 项确定性测试 | 通过 |
| Chat 多轮工具桥接 | 脚本驱动、真实读取临时文件、模拟上游模型 | 通过；不是完整 Codex + Chat 验收 |
| Codex 原生执行 | 真实二进制 + 确定性 Responses 服务 | 读取、写入、校验通过 |
| 会话持久化 | 关闭真实 Codex 后重新启动并恢复历史 | 通过 |
| 取消 | 请求到达本地模型服务后中断真实 Codex | interrupted 终态通过 |
| DeepSeek 真实调用 | 充值后真实文件任务、重启恢复及续轮完成 | 有限工具级验证通过；完整 Agent 回归尚待完成 |
| 第二个真实供应商 | 用户尚未指定 | 待验证 |
| Electron / React UI | 依计划待 S0 关口通过后实施 | 尚未开发 |

准确的测试输出、命令与退出码记录在项目根目录 VERIFICATION.txt。

## 3. 本轮发现与修正

### 3.1 本机代理影响回环访问

最初真实 Codex 请求出现 HTTP 502，而本地网关没有收到请求。为隔离测试进程显式配置 NO_PROXY / no_proxy 的回环例外后，工具执行链路正常。该配置不覆盖用户全局代理。

### 3.2 请求包含额外字段和工具类型

捕获到的请求字段：model、instructions、input、tools、tool_choice、parallel_tool_calls、reasoning、store、stream、include、prompt_cache_key、client_metadata。

默认运行时还可能包含 namespace 工具。测试配置关闭多 Agent 与目标管理后，本轮工具集为 exec_command、write_stdin、request_user_input、view_image。

这说明“Chat Completions 文本测试通过”不足以推导完整 Codex 兼容性。当前桥接将私有推理、自定义工具、命名空间等未实现行为显式拒绝；后续按模型档案适配，不静默删除。

### 3.3 网关凭据被 shell 继承

初始实现向 Codex 进程注入网关 token 环境变量，即使配置 shell_environment_policy，实际工具环境检查仍发现它存在。已改成命令式凭据读取：测试用短期 token 放入权限为 0600 的隔离文件，供应商 API Key 仍只留在网关进程。

集成测试现在断言工具环境中不存在 COAGENT_GATEWAY_TOKEN。此断言只验证环境继承，不意味着同一操作系统用户的文件隔离已达到对抗性边界。S1 的正式凭据服务仍待实现。

### 3.4 会话来源过滤

只查询 appServer 来源会漏掉本次运行时生成的会话。Adapter 查询 appServer、vscode 和 cli，并配合独立 CODEX_HOME 与工作目录筛选，重启后的列表和恢复测试通过。

### 3.5 取消测试需匹配真实端点

启动时还存在 /models 探测；原测试误把该请求当作模型推理已开始。改为只在 /responses 请求到达后发出取消，确认实际轮次进入 interrupted。

### 3.6 工具批次要整体校验

桥接先验证整个工具调用批次，再发出可执行的完成事件；任一参数 JSON 不合法时整批不完成。新增回归测试覆盖完整工具与错误工具并存的情况。

## 4. DeepSeek 接入选择

用户指定模型：**deepseek-flash**。官方文档列出 Responses 支持，因此优先走原生 Responses 路径，示例地址为 `https://api.deepseek.com`。

资料：
- [DeepSeek Responses 指南](https://api-docs.deepseek.com/guides/responses_api/)
- [DeepSeek 与 Codex 集成](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)

首次真实调用返回 HTTP 402；充值后文件任务、历史恢复及续轮通过。能力标记更新为 tool，完整 Agent 认证仍为 false。下一步需根据真实响应检查模型目录、上下文预算、工具格式和推理字段，不直接承诺所有 Codex 默认行为均兼容。

## 5. S0 清单状态

| 任务 | 状态 |
| --- | --- |
| S0-01 | npm 元数据确认仓库与 Apache-2.0 声明；正式分发许可证与 NOTICE 核查仍待完成 |
| S0-02 | 完成：固定版本、平台、来源与二进制哈希 |
| S0-03 | 完成：隔离运行时与临时工作区 |
| S0-04 | 完成：生成类型与真实运行时生命周期测试 |
| S0-05 | 完成：deepseek-flash 原生 Responses 真实文件读写与命令校验通过 |
| S0-06 | 已捕获并记录脱敏字段／工具形状；真实供应商轨迹待补 |
| S0-07 | 完成桥接原型及脚本驱动多轮测试；完整 Codex 路径及第二个真实服务待验证 |
| S0-08 | 完成：真实运行时历史读取与重启恢复 |
| S0-09 | 完成：本记录列明协议、凭据及状态处理缺口 |

## 6. 下一批开发工作

1. 基于已通过的 DeepSeek 真实文件任务与恢复续轮，扩展取消、工具失败与上下文场景。
2. 对真实 DeepSeek 请求补齐模型配置与适配，不将模拟模型测试计入真实能力等级。
3. 指定第二个供应商，或明确调整 V1 的双供应商目标；未经确认不默认替换需求。
4. 继续完善 Chat Completions 模型档案，包括推理、自定义工具与命名空间策略。
5. S0 退出条件达成后进入 S1 桌面骨架与配置存储。

## 7. 可复用续接提示词

```text
继续 coAgent S0。先阅读 PROJECT_DESIGN.md、V1_ROADMAP.md 和 docs/S0_STATUS.md。
先执行 npm run check，不重复初始化项目，不读取个人 Codex 登录文件。
首个真实模型固定为 deepseek-flash；凭据只通过本机环境或正式凭据入口获得。
区分脚本模型、真实 Codex 工具执行和真实模型能力三类证据。
不要把未完成的双供应商验收标记为通过。
```

## 8. 真实调用续测

当前进程未继承密钥，但交互式 zsh 已加载。通过交互式 Shell 启动真实测试后，DeepSeek /responses 返回 402，未产生工具调用。根据 [DeepSeek 官方错误码](https://api-docs.deepseek.com/quick_start/error_codes/)，402 表示余额不足。未读取或持久化密钥值，未重复自动重试。新增 HTTP 状态诊断、非重试错误分类与两项回归测试；smoke:live 遇到 402 的退出码为 3。第二个真实供应商及完整真实执行验收保持待验证。

## 9. 充值后真实验收

已重新执行真实测试：单轮文件任务 PASS；追加 --resume 测试后，关闭进程、重启、读取历史、恢复会话和第二轮文件任务均 PASS，持久化轮次为 2。校验包含实际文件内容、成功命令退出码及原文件未被改动。第二个真实供应商与完整 Chat 桥接关口仍保留，不将有限烟测等同 V1 验收。详情见 [真实验证记录](/Users/c4n6r/cypherSec/CoAgent/docs/DEEPSEEK_LIVE_VALIDATION.md)。

## 2026-09-21 最新执行调整（覆盖此前阶段关口）

用户已明确暂缓第二个模型服务，优先完整固定 Agent 回归与桌面前端。本轮新增 Electron/React 桌面执行、历史、审批和停止闭环；真实 DeepSeek 固定套件及桌面实测分别留证。第二供应商不再阻挡 S1/S2 开发，但不计为已验收。Host 独立进程、设置页、文件/diff 面板和发布包继续排期。当前状态以 [桌面交付记录](/Users/c4n6r/cypherSec/CoAgent/docs/DESKTOP_V1_STATUS.md) 和 [回归逐项结果](/Users/c4n6r/cypherSec/CoAgent/docs/AGENT_REGRESSION.json) 为准。
