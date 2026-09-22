# coAgent 项目设计文档

> 文档版本：0.1 · 更新日期：2026-09-21  
> 状态：设计基线；S0 运行时与网关原型已开始开发，尚未发布。  
> 定位：基于 Codex 开源执行能力的个人桌面工作 Agent。  
> 配套文档：[V1 目标与分阶段开发计划](/Users/c4n6r/cypherSec/coAgent/V1_ROADMAP.md)

## 1. 设计结论

coAgent 采用“自建桌面前端 + 轻量 Host + Codex App Server + 模型适配网关”的结构。

已确认的产品约束：

- 面向个人用户，单机使用，数据规模较小。
- 无账号注册、登录、组织、角色、租户与远程访问管理。
- 业务层不引入 SQLite、PostgreSQL、Redis 或独立数据库服务。
- 会话和执行历史由 Codex 原有持久化能力管理，不重复建立聊天数据库。
- 应用配置使用 JSON；模板使用 Markdown；工作成果保存为普通文件。
- 模型供应商可扩展，模型实际能力必须通过测试，不能只以连接成功作为兼容标准。
- 优先扩展外围模块，不从重写 Codex Agent 循环开始。

本设计采用的默认假设：首发 macOS、单主窗口、全应用同一时间只运行一个任务；Windows、Linux 和多任务并行在后续版本评估。操作系统首发选择是排期假设，不是已确认的用户要求。

## 2. 产品目标与使用闭环

### 2.1 产品目标

用户在图形界面中选择工作目录与模型，输入任务，查看 Agent 读取文件、执行命令和修改内容的过程，并检查最终成果。

核心闭环：

```text
添加模型配置 → 选择工作空间 → 创建会话 → 输入任务
    → 查看执行过程 → 处理必要确认 → 检查 Diff / 成果
    → 继续对话，或关闭应用后恢复历史
```

### 2.2 V1 的三个工作场景

| 场景 | 示例 | 成果 |
| --- | --- | --- |
| 项目理解 | 阅读目录中的代码与文档，说明结构和运行方法 | Markdown 说明 |
| 小规模代码工作 | 修改小功能、执行项目测试、解释变更 | 文件变更、Diff、测试结果 |
| 材料整理 | 汇总本地文本材料，形成方案或工作总结 | Markdown / 文本文件 |

Word、PDF、Excel 的专用处理与预览、联网调研、企业业务连接器属于后续扩展；V1 先验证本地文件任务，而不是同时实现完整办公套件。

### 2.3 V1 功能目标编号

| 编号 | 目标 |
| --- | --- |
| G1 | 桌面启动、目录选择、基础设置 |
| G2 | 会话创建、历史查看、恢复与继续 |
| G3 | 流式输出、工具过程、确认与停止 |
| G4 | 多模型配置、两类协议验证、能力分级 |
| G5 | 文件成果、文本预览、Diff 与受控恢复 |
| G6 | 配置持久化、凭据管理、崩溃后的状态核对 |
| G7 | 本地 Markdown 任务模板 |
| G8 | 固定运行时版本、测试、打包与版本回退 |

详细验收条件及任务编号见配套开发计划。本文描述系统边界，不代表功能已经实现。

## 3. Codex 的复用边界

官方列出的开源组件包含 CLI、SDK 和 App Server；IDE 扩展与 Codex 云端不属于同一开源交付范围。coAgent 自建界面，不以存在完整开源桌面产品为前提。[官方开源组件说明](https://learn.chatgpt.com/docs/open-source)

App Server 用于产品内的深度交互集成。它提供会话、事件流及审批等接口；当前文档仍对 App Server 命令与 WebSocket 传输给出实验性说明。因此，采用本地 stdio、锁定版本，并以契约测试控制升级风险。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)

| 层 | 复用或新建 |
| --- | --- |
| Agent 循环、模型与工具的执行衔接 | 优先复用 Codex |
| 会话历史与运行时持久化 | 使用 Codex 接口，不直接改内部存储格式 |
| 前端、工作空间入口、成果界面 | coAgent 新建 |
| 配置、凭据引用、进程管理 | coAgent Host 新建 |
| 异构模型协议转换 | coAgent Gateway 新建 |
| 特定工作流程 | 先用任务模板，后续接入 Skills / MCP |

出现配置与协议封装确实解决不了的缺口时，才提出最小内核补丁。每个补丁应记录复现、测试、目标版本和上游升级后的退出条件。

## 4. 系统架构与进程模型

```text
React Renderer
    │ 有限、带类型校验的 Electron IPC
    ▼
Electron Main + Preload
    │ 启动、关闭、转发业务请求
    ▼
Host 子进程 / Utility Process
    ├── 配置读写、凭据访问代理、任务状态、成果索引
    ├── Runtime Adapter ── stdio ── Codex App Server 子进程
    └── Model Gateway：只监听本机回环地址
                                      ▲
                                      │ 推理请求
                           Codex App Server
                                      │
                                      ▼
                    Provider Adapter → 目标模型服务

Codex 工具执行 → 选定工作目录、受控子进程和后续工具连接器
```

### 4.1 为什么设置 Host

Host 是产品控制层，不是第二个 Agent 引擎。它负责进程生命周期、请求映射、事件规范化、配置、成果引用和错误处理。模型的规划与工具循环仍由 Codex 负责。

### 4.2 V1 的简化边界

- 一个应用实例、一个活动执行任务；提交第二个任务时提示先结束当前任务，不建立后台队列。
- 允许登记多个工作空间和保留多个会话，但不同时执行。
- 模型网关作为 Host 内部模块运行，保留未来独立部署的接口，不先拆微服务。
- Renderer 不直连模型，也不直接持有终端执行能力。
- Host、Gateway、Codex 的关闭顺序和超时处理有明确测试。
- 不暴露远程管理 API；无账号登录不等于任意网页都可以调用本地执行入口。

### 4.3 技术选择

| 模块 | V1 建议 |
| --- | --- |
| 桌面壳 | Electron |
| UI | React + TypeScript + Vite |
| Host / Gateway | TypeScript，运行于 Node 环境 |
| 状态展示 | 前端轻量状态管理；运行中状态由 Host 提供 |
| 配置 | JSON + Schema 校验 + 原子替换 |
| 模型凭据 | macOS Keychain 等系统凭据设施；仅持久化引用 |
| 会话存储 | Codex 原生持久化 |
| 自动化测试 | 单元测试、协议契约测试、桌面端端到端测试 |

以上为工程选型，不指定尚未验证的依赖版本。阶段 S0 冻结实际版本与构建基线。

## 5. 前端与交互

### 5.1 布局

```text
┌─────────────┬──────────────────────┬──────────────────┐
│ 工作空间    │ 会话与执行时间线     │ 文件与成果       │
│ 会话列表    │ 用户输入 / Agent 输出│ 文本预览         │
│ 任务模板    │ 工具调用与完成状态   │ Diff             │
│ 模型设置    │ 待确认动作           │ 打开 / 导出      │
├─────────────┴──────────────────────┴──────────────────┤
│ 模型选择 / 输入框 / 提交 / 停止 / 当前执行状态       │
└─────────────────────────────────────────────────────┘
```

### 5.2 必备页面

1. **首次启动页**：配置模型，运行能力检测，选择目录；不出现登录页。
2. **工作台**：输入任务、显示模型及目录、流式文本和工具时间线。
3. **会话列表**：读取运行时历史，按目录筛选、查看、恢复。
4. **模型设置**：地址、协议、模型 ID、凭据引用、检测结果。
5. **成果面板**：显示真实存在的产物、文本预览、Diff、在系统中打开。
6. **应用设置**：主题、默认模型、数据位置、诊断与版本信息。

### 5.3 执行状态

```text
idle → running ⇄ waiting_approval
          ├── succeeded
          ├── failed
          ├── cancelling → cancelled
          └── recovery_required
```

“停止请求已发送”和“任务已停止”是不同状态。结果以运行时最终事件及必要的进程核对为准。停止任务不撤销此前已经产生的文件或外部变更。

工具日志与聊天正文分开显示；超长输出截断展示并提供完整日志入口。Markdown 和终端输出按不可信内容渲染，不执行其中的脚本或任意本地链接动作。

## 6. 运行时接口与事件

### 6.1 Adapter 接口

下列代码是 coAgent 的拟议抽象，不是上游 SDK 类型。所有 Input、Session 与 Event 类型在实现阶段定义并校验。

```ts
interface AgentRuntime {
  createSession(input: CreateSessionInput): Promise<Session>;
  listSessions(input: ListSessionsInput): Promise<SessionPage>;
  readSession(sessionId: string): Promise<SessionSnapshot>;
  resumeSession(sessionId: string): Promise<Session>;
  startTurn(input: StartTurnInput): Promise<{ turnId: string }>;
  interruptTurn(sessionId: string, turnId: string): Promise<void>;
  respondToApproval(input: ApprovalDecision): Promise<void>;
  subscribe(sessionId: string): AsyncIterable<AgentEvent>;
}
```

上游提供按所用版本生成协议类型的能力。实现阶段应使用对应版本产物，不手写一份假设永久稳定的上游类型。[类型生成与消息格式](https://learn.chatgpt.com/docs/app-server#message-schema)

### 6.2 生命周期要求

- 一次连接完成一次初始化握手，握手成功后再发业务请求。
- 同时识别普通响应、通知，以及服务器发起的审批请求。
- 请求有超时和待响应映射，子进程退出时释放所有等待者。
- stdout 作为协议通道，诊断输出独立处理。
- Host 分配自己的事件序号，前端据此去重；序号不冒充运行时的原生恢复能力。
- UI 重连先获取快照，再接收后续事件；Host 重启后通过运行时记录核对状态。
- 查询会话时显式验证 sourceKinds 等过滤条件，避免新建会话因默认过滤被隐藏。

### 6.3 审批要求

审批记录绑定运行时进程实例、会话、轮次、请求 ID 和动作参数摘要。重复点击只处理一次。进程重启后旧审批失效；需要时重新获取当前动作，而不是沿用旧确认。

不自行把所有工具调用都包装成重复审批，也不在 UI 中无条件自动同意运行时请求。实际允许的决策值以锁定版本的协议为准。

## 7. 多模型设计

### 7.1 产品承诺

“模型可扩展”指能够添加协议 Adapter 和供应商配置，不表示每个模型拥有同等 Agent 能力。

V1 优先实现两条路径：

1. Responses 兼容服务。
2. Chat Completions 服务，经网关转换后接入。

Anthropic Messages、Gemini 原生协议等保留扩展接口，进入后续迭代。本地服务若兼容上述已实现协议，可按同一测试流程接入，但不预先承诺某个模型一定通过。

当前官方配置参考中，自定义 Provider 的 wire_api 仅列出 responses；仅修改 base_url 并不能自动解决异构协议问题。[Provider 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)

### 7.2 网关分层

```text
Codex 请求
  → 固定版本所需的 Responses 兼容入口
  → CanonicalRequest / CanonicalEvent
  → Provider Adapter
  → 目标服务
```

网关不执行工具、不批准动作、不运行第二套 Agent 循环。它负责协议转换、能力检查、错误映射和可获得的用量信息。

### 7.3 模型档案

```ts
type Compatibility = "untested" | "chat" | "tool" | "agent";

interface ModelProfile {
  id: string;
  providerId: string;
  upstreamModel: string;
  protocol: "responses" | "chat-completions" | "custom";
  compatibility: Compatibility;
  contextTokens?: number;
  maxOutputTokens?: number;
  capabilities: {
    streaming: boolean;
    toolCalling: boolean;
    parallelToolCalls: boolean;
    vision: boolean;
    structuredOutput: boolean;
  };
  toolProfile: string;
  promptProfile: string;
}
```

能力档案区分供应商声明、人工配置和实测结果，并记录测试日期、模型 ID、网关版本和 Codex 版本。未知的上下文上限保持未知，不能显示成已验证能力。

### 7.4 必须验证的转换

| 项目 | 处理要求 |
| --- | --- |
| 消息角色 | 显式转换，不丢弃系统约束 |
| 流式事件 | 保持顺序、结束状态及调用归属 |
| 工具参数分片 | 完整拼接与结构校验后再形成调用 |
| 工具调用和结果 | 保留稳定关联标识，覆盖多轮和多调用 |
| 自由文本 / 自定义工具 | 单独设计适配并测试；不能等同普通 JSON 工具 |
| 私有推理状态 | 不跨供应商直接复用 |
| 上下文与输出预算 | 按目标模型处理，给工具结果预留空间 |
| 未支持字段 | 显式报错或按已声明能力降级，不静默丢失关键语义 |
| 错误与用量 | 保留可诊断类别；缺失用量不伪造为精确账单 |

阶段 S0 必须用真实执行轨迹确认锁定版本实际发出的请求、工具定义及所需端点。若出现自由文本工具、特殊上下文压缩或其他超出适配集合的行为，应形成兼容性问题单；不能仅凭聊天成功继续宣称支持完整 Agent。

### 7.5 配置示意

下例写入 coAgent 独立运行时配置；地址、端口及模型别名由 Host 实际生成。

```toml
model = "work-default"
model_provider = "coagent_gateway"

[model_providers.coagent_gateway]
name = "coAgent Gateway"
base_url = "http://127.0.0.1:8787/v1"
env_key = "COAGENT_GATEWAY_TOKEN"
wire_api = "responses"
```

Provider 配置放在 Host 管理的运行时配置层，不放进普通工作项目的配置。官方文档将这类配置与项目局部配置区分。[高级配置](https://learn.chatgpt.com/docs/config-file/config-advanced)

### 7.6 切换、重试与取消

- 每个执行轮次固定模型，不在中途自动换供应商。
- 跨供应商切换在 V1 中创建新会话；由用户选择是否带入摘要及成果引用，不自动复制私有状态。
- 请求取消沿 UI、Host、运行时、网关向下传播，并核对最后状态。
- 网关只进行有界、符合请求语义的重试；与运行时重试次数合并预算。
- 已经发生文件或外部写入后，不自动重放整个任务。
- 同时记录请求错误和可能已经完成的动作，避免误判为“什么都没发生”。

## 8. 数据存储：不另建业务数据库

### 8.1 数据所有权

| 数据 | 唯一主存储 | coAgent 如何使用 |
| --- | --- | --- |
| 会话与执行历史 | Codex 运行时 | 通过接口查询与恢复 |
| 模型、供应商及界面偏好 | 应用 JSON 配置 | Host 单写入者 |
| API Key | 系统凭据存储 | 配置仅保存 secretRef |
| 最近目录、界面选择 | 应用 JSON 配置 | 小型列表 |
| 模板 | Markdown | 加载、展示、展开后提交 |
| 成果内容 | 工作目录中的普通文件 | 索引引用，不默认复制一份 |
| 成果元信息 | 按任务保存的小型 JSON | 路径、哈希、会话关联 |
| 运行中显示状态 | Host 内存 | 重连读取快照 |
| 最小恢复记录 | 单个活动任务的 JSON | 记录运行标识及待核对动作，不复制 token 流 |

Codex 自身包含 SQLite 支持的运行时状态存储。这里的“不用 SQLite”是指 coAgent 不再自建一套业务数据库，而非删除上游内部依赖。[sqlite_home 配置](https://learn.chatgpt.com/docs/config-file/config-reference)

### 8.2 数据目录

开发项目根目录为 `/Users/c4n6r/cypherSec/coAgent`。用户运行数据不写入源码仓库。

应用启动时通过平台 API 获取用户数据目录。当前 macOS 用户的示例根目录为 `/Users/c4n6r/Library/Application Support/coAgent`，不在代码里硬编码用户名。

该目录下逻辑划分为：配置、模板、成果元信息、恢复记录、诊断日志，以及独立的 codex-home。CODEX_HOME 由 Host 指向独立位置，避免与用户已有 Codex 配置相互覆盖。CODEX_HOME 的用途来自官方状态目录说明。[配置与状态位置](https://learn.chatgpt.com/docs/config-file/config-advanced#config-and-state-locations)

### 8.3 配置格式示意

```json
{
  "schemaVersion": 1,
  "theme": "system",
  "defaultModelId": null,
  "recentWorkspaces": [],
  "providers": [],
  "models": []
}
```

### 8.4 可靠性规则

1. Host 统一串行写入，应用使用单实例约束。
2. 小配置采用同目录临时文件、必要的刷盘、原子替换及上一版备份；在目标文件系统测试崩溃行为。
3. 读取时做 Schema 校验；损坏时保留原文件并提供备份恢复，不静默清空配置。
4. schemaVersion 驱动配置迁移；新版本配置被旧版本遇到时不强行覆盖。
5. 不每输出一个 token 就写配置，不重复建立完整事件库。
6. 日志有大小上限、轮转与脱敏；导出诊断包前展示内容范围。
7. 备份运行时数据时，停止运行时后整体复制，或使用其支持的一致性备份方式；不只复制一个正在写入的数据库文件。

只有在复杂查询、可靠队列、多个并发写入者或跨记录事务成为真实需求后，才评估业务层 SQLite。数据量不是唯一决策指标。

## 9. 本地执行与凭据边界

- 没有账号系统，但保留进程间调用边界和模型密钥保护。
- Renderer 关闭直接 Node 访问，通过受限 Preload 暴露具体业务动作；所有 IPC 输入在 Host 再校验。
- 本机模型网关仅监听回环地址，并校验每次启动生成的调用凭据；它不是用户登录机制。
- API Key 留在凭据服务与网关，不进入前端持久状态、URL、普通日志或模型上下文。
- 工具子进程的环境变量使用允许列表；验证模型和网关凭据不会被默认继承。
- 目录路径规范化，处理符号链接和越界访问；作用目录与可写边界交给运行时策略执行。
- 文件和网页中的内容是任务数据，不获得修改工具权限或读取凭据的能力。
- V1 的工具主要为本地文件和命令；外部业务写操作在增加对应连接器时另定义幂等与补偿规则。

## 10. 成果、文件修改与恢复

成果必须指向实际存在的文件。索引至少保存会话 ID、轮次 ID、路径、类型、创建时间与可取得的内容哈希；“模型说已生成”不等于成果验证完成。

V1 提供文本预览、Diff、系统打开与导出。二进制内容只显示基本信息并交给系统打开，不实现通用 Office 预览。

受控恢复的设计：

1. 执行前记录用户已有未提交修改，不能把工作区默认视为干净。
2. 对纳入任务范围的小型文本文件保留基线或可逆补丁，并设大小限制。
3. 恢复前比较当前内容与任务完成时哈希；用户随后改过的文件必须提示冲突。
4. 新文件、删除文件、二进制文件分别处理；没有快照的内容不能标为可一键恢复。
5. 不使用覆盖整个目录或强制重置整个仓库的方式恢复单个任务。

三种恢复相互独立：停止任务、恢复文件、回退应用版本。UI 不将它们合并成一个含义模糊的“撤销”。

## 11. 代码模块规划

以下是拟建目录，不代表本次已创建应用代码。

| 拟建绝对路径 | 职责 |
| --- | --- |
| `/Users/c4n6r/cypherSec/coAgent/apps/desktop` | Electron 主进程、Preload、React UI |
| `/Users/c4n6r/cypherSec/coAgent/packages/contracts` | 业务协议、Schema、事件 |
| `/Users/c4n6r/cypherSec/coAgent/packages/host` | 生命周期、任务状态、工作空间 |
| `/Users/c4n6r/cypherSec/coAgent/packages/runtime-codex` | 上游连接与版本化协议 Adapter |
| `/Users/c4n6r/cypherSec/coAgent/packages/model-gateway` | 推理入口、规范化消息、供应商 Adapter |
| `/Users/c4n6r/cypherSec/coAgent/packages/storage` | 配置、备份、迁移与凭据引用 |
| `/Users/c4n6r/cypherSec/coAgent/packages/artifacts` | 文件引用、Diff 与快照 |
| `/Users/c4n6r/cypherSec/coAgent/tests` | 契约、故障注入与桌面端测试 |

包结构用于边界清晰，不要求独立发布。初期可在同一仓库、同一发布流水线中实现。

## 12. 测试、版本与后续演进

### 12.1 测试层次

- 单元测试：配置、状态机、参数校验、事件去重。
- 协议测试：上游请求 / 响应、工具调用完整性、错误及流中断。
- 文件测试：原子替换、损坏恢复、迁移与冲突恢复。
- 集成测试：启动、关闭、凭据注入、子进程退出和环境继承。
- 场景测试：真实代码任务、资料整理、重启恢复。
- 桌面测试：首次使用、模型配置、提交、审批、停止与成果打开。

使用模拟模型响应做确定性测试；真实模型测试另记录供应商、模型、日期、成本及结果。两者不能相互冒充。

### 12.2 版本管理与分发

固定 Codex 二进制版本、来源、哈希、协议 Schema 和适配器版本。复用组件的许可证与分发要求在 S0 核查，打包时保留相应声明。

升级流程：获取候选版本 → 生成协议类型 → 对比变化 → 跑兼容与场景测试 → 内部试用 → 发布。V1 采用手动升级安装包，不先实现自动更新服务。

回退应用前先备份配置和运行时数据；旧运行时是否能读取新状态必须经过测试，不能仅替换二进制就承诺可回退。优先以并行版本目录和对应数据备份保留可恢复基线。

### 12.3 后续演进顺序

1. 新增供应商原生协议与更多模型验证。
2. MCP / Skills 管理、文档与表格工具。
3. Windows / Linux 和更完整的安装体验。
4. 真实需求驱动的多任务、定时任务或远程执行。

如以后转向团队产品，再重新设计身份、租户和远程执行边界；不将这些功能提前加入个人 V1。

## 13. 尚待开发阶段确认的决策

| 决策 | 当前状态 | 解决阶段 |
| --- | --- | --- |
| 首发系统与 CPU 架构 | 默认 macOS；具体架构待冻结 | S0 |
| Codex tag / commit 与获取方式 | 尚未选定，禁止使用浮动 latest 作为发布基线 | S0 |
| 两个实测供应商及模型 ID | 待根据可用服务登记 | S0 |
| 目标模型工具格式和上下文行为 | 待真实轨迹验证 | S0 / S3 |
| Electron 与其他依赖版本 | 待构建验证后锁定 | S0 / S1 |
| 分发签名、安装形式 | 根据首发系统确定 | S6 |

以上未决项不改变已确认的个人单机、无登录、不另建业务数据库的原则。

## 2026-09-21 最新执行调整（覆盖此前阶段关口）

用户已明确暂缓第二个模型服务，优先完整固定 Agent 回归与桌面前端。本轮新增 Electron/React 桌面执行、历史、审批和停止闭环；真实 DeepSeek 固定套件及桌面实测分别留证。第二供应商不再阻挡 S1/S2 开发，但不计为已验收。Host 独立进程、设置页、文件/diff 面板和发布包继续排期。当前状态以 [桌面交付记录](/Users/c4n6r/cypherSec/CoAgent/docs/DESKTOP_V1_STATUS.md) 和 [回归逐项结果](/Users/c4n6r/cypherSec/CoAgent/docs/AGENT_REGRESSION.json) 为准。

## 最新更新：deepseek-chat 与工作文件面板

默认请求模型现为 `deepseek-chat`（供应商实测返回 `deepseek-flash` 别名解析结果）。本轮重新完成 20/20 固定 Agent 回归，并新增目录浏览/只读 UTF-8 预览、边界检查与桌面验收。此前 Flash 记录保留为历史。具体以 [本轮验证](/Users/c4n6r/cypherSec/CoAgent/docs/DEEPSEEK_CHAT_VALIDATION.md) 为准；diff 面板与独立 Host 仍待开发。

## 最新更新：启用 Qwen 官方模型与 Git diff

用户已启用第二供应商 Qwen3.5 Flash，覆盖此前暂缓决策。桌面新增 DeepSeek / Qwen 模型选择与配置保存；两者使用官方 OpenAI Responses 兼容入口。新增只读 Git 已暂存/未暂存 diff 面板。实际回归和启动方法见 [Qwen 与 diff 交付记录](/Users/c4n6r/cypherSec/CoAgent/docs/QWEN_AND_DIFF.md)。独立 Host Utility Process 和签名发布仍待开发。

## 最新更新：独立 Host 已落地

Codex 编排、模型网关、配置和文件操作已迁至 Electron Utility Process；Main 保留窗口、原生对话框与受限转发。已新增 Host 强制退出、子进程清理、重新连接和不重放验证。详见 [Host 交付记录](/Users/c4n6r/cypherSec/CoAgent/docs/HOST_PROCESS.md)。活动任务持久化恢复与配置原子写入尚待开发。

## 最新更新：配置可靠性与持久化恢复

已加入配置 Schema、串行原子写入、有效备份及损坏提示；任务执行前持久化最小记录，应用重启后保留待核对状态，显式确认前阻止新任务且不自动重放。详见 [恢复与配置记录](/Users/c4n6r/cypherSec/CoAgent/docs/RECOVERY_AND_CONFIG.md)。文件撤销恢复与系统凭据存储仍待开发。
