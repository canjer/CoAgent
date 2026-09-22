# Security S1：受控测试执行基础

状态：首版实现。入口为桌面右侧栏「＋ → 安全测试」。本轮仅构建、测试，不生成安装包。

## 已实现

- 项目路径绑定测试配置；默认关闭。字段：目标/排除规则、启用工具、请求预算、速率、超时与时间窗口。
- Host 内 Tool Registry → Scope Gate → Executor 路径；首个工具为 `http-head` v1。
- 域名精确/子域通配、IPv4/IPv6/CIDR、协议、端口、路径前缀；排除优先。
- DNS 所有返回地址均校验；私网/特殊地址需要额外明确 IP/CIDR 规则；实际连接固定在校验后的地址，保持原 Host/TLS 主机名。
- 串行执行，跳转重新校验并计数，最多 5 次跳转；循环跳转、出范围、预算耗尽终止。
- 每次开始需确认具体目标及配置预算，活动测试期间禁止修改配置或切换项目；普通 Agent 任务与测试互斥。
- 停止撤销请求、DNS 等待和速率等待，不继续启动后续目标；Host 异常退出后保留证据，旧运行标记 interrupted，不自动重放。
- JSON 原子落盘、备份、校验；配置从备份恢复时持久化禁用，重新核对、启用并保存后才能执行。
- 桌面查看运行状态、请求数、证据数、错误和证据路径。无模型密钥也能执行这个确定性工具。

## 当前边界

这是受控执行入口，不是对全部进程的网络隔离层。普通对话的 Shell/MCP/浏览器仍遵循原有策略，尚未接入 S1 Scope Gate。S1 不自动运行扫描器，不识别/确认漏洞，不生成漏洞报告。HEAD 仅降低影响，并不能保证目标应用没有业务副作用。

仅支持不带查询参数、片段或 URL 凭据的 HTTP(S) URL；不发送 Cookie/Authorization、不读取响应正文、不读取浏览器登录状态。使用直接网络连接，不继承系统 HTTP 代理；VPN 的系统路由仍由操作系统决定。收到浏览器挑战或其他 HTTP 状态时记录该状态，不自动解挑战。

并发固定为 1；HTTP 工具、事件及证据均在 Host 进程中。停止 DNS 等待不代表底层系统解析立即终止，但解析完成后不会继续发起请求。证据写入失败结束任务。崩溃时已记账请求可能尚未真正发出，因此计数是保守上界而非精确网络包数量。

## 使用步骤

1. 新建任务/选择项目文件夹，右侧栏「＋ → 安全测试」。
2. 展开「项目测试配置」，修改下面的 JSON，保存。
3. 填写每行一个目标 URL；核对范围和预算，勾选确认，再开始。
4. 使用「停止安全测试」停止；关闭标签只是隐藏界面，不取消任务。
5. 运行卡片中查看本地证据目录；重启不会重放测试。

示例（把 example.com 改为实际项目目标；不在 URL 中填写密钥）：

```json
{
  "version": 1,
  "enabled": true,
  "targets": [{"host":"example.com","protocols":["https"],"ports":[443],"path":"/"}],
  "exclude": [{"host":"example.com","protocols":["https"],"ports":[443],"path":"/admin"}],
  "tools": ["http-head"],
  "budget": {"maxRequests":30,"requestsPerSecond":1,"concurrency":1,"timeoutMs":10000,"maxDurationMs":60000},
  "startsAt": null,
  "expiresAt": null
}
```

`*.example.com` 只匹配子域，不匹配根域。路径 `/api` 匹配 `/api` 和 `/api/...`，不匹配 `/api2`。时间窗口填写含时区的 ISO 日期字符串。maxRequests 1–1000，requestsPerSecond 0.1–10，timeoutMs 100–60000，maxDurationMs 100–3600000。内网域名需同时配置域名规则与对应 IP/CIDR 的协议、端口、路径规则。

## 存储和证据

使用 Electron userData 下 `security/<规范化项目绝对路径 SHA-256>/`，而非可被项目代码直接覆盖的配置文件；目录不属于防恶意本地进程的沙箱。沿用本地 JSON，无 SQLite、无账号登录。

```text
engagement.json                 当前配置
engagement.json.bak             上一有效配置
runs/<时间戳-UUID>/plan.json      已确认目标、工具版本、配置快照及哈希
runs/<时间戳-UUID>/run.json       请求数、状态、证据数、错误
runs/<时间戳-UUID>/events.jsonl   请求记账和证据 SHA-256
runs/<时间戳-UUID>/evidence/*.json
```

响应证据只存时间、工具、URL、校验地址、状态和选定响应头。不存正文、Set-Cookie、Authorization 或 Location；目标域名、路径及选定响应头仍可能包含内部信息，应按项目数据管理。SHA-256 用于完整性核对，不等同于签名或防篡改审计。

## 代码与测试

- `apps/desktop/security/scope.mjs`：配置校验与目标范围。
- `apps/desktop/security/executor.mjs`：工具注册、DNS 固定与 HEAD 适配器。
- `apps/desktop/security/service.mjs`：执行生命周期、预算、停止、配置和证据。
- `apps/desktop/renderer/security-panel.jsx`：桌面操作入口。
- `tests/security-s1.test.mjs`：边界、预算、证据、停止、恢复、DNS 等测试。
- `scripts/desktop-security.mjs`：本地 HTTP fixture 的配置→确认→执行→证据→重启回归，不访问真实业务目标。

```sh
npm run check
npm run desktop:build
npm run test:desktop:security
```

## 后续 S2

1. 通过统一注册工具桥将模型产生的计划交给 Host 校验，模型不直接修改项目范围。
2. 将预算、确认和结果反馈接入任务时间线；提供表单化范围编辑器与证据导出。
3. 逐个引入有结构化输入输出的检查工具，明确实际出网、重定向、取消与日志语义。
4. 在声明统一控制 Shell/MCP 前补进程隔离与网络出口策略；不能仅靠提示词或命令名白名单。

复用开发任务提示词：

```text
基于 Security S1 接入一个确定性工具。先声明输入 schema、网络行为和证据字段；
所有执行必须经过 Tool Registry、Scope Gate 和 Executor。目标变化、跳转及重试
都重新检查范围并计入预算。补充越界零请求、取消后无后续请求和证据脱敏测试，
明确该工具已覆盖与尚未覆盖的控制边界，不自动扩展用户的项目范围。
```
