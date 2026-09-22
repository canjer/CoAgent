# 浏览器兼容性诊断增量

## 已实现

侧边栏新增「站点诊断」，区分未加载、加载中、主文档已加载与加载失败，并展示网络策略拦截记录：资源 origin、类型、原因、次数。

- 仅保存 origin，不保存完整 URL、查询参数、请求头或请求体；错误只返回固定错误码。
- 最多保留 40 类记录，继续累计总数；返回值复制，100ms 合并通知，避免页面资源洪泛拖慢 UI。
- 每次显式加载/刷新重新统计，关闭清空；旧 session 的延迟请求直接取消，不污染新页面记录。
- popup 和跨站导航也记录原因。
- 诊断不改变访问权限，不会自动授权资源域，不增加新的 Agent 工具。
- 当前列表是应用网络策略拦截记录，不是完整 DevTools：站点 CSP、JavaScript 错误、字体解码错误等不保证进入列表。「主文档已加载」也不代表所有功能通过。

## 真实站点只读验证

2026-09-22，在临时 Electron session 中读取三个固定公开页面，无模型调用、无点击、无登录或表单提交；保持现有网络策略。

| 页面 | 加载 / 快照 | 文本字符 | 元素 | 应用策略阻止次数 |
|---|---|---:|---:|---:|
| https://example.com/ | 通过 | 129 | 1 | 0 |
| https://www.electronjs.org/docs/latest/api/web-contents-view | 通过 | 3496 | 110 | 1 |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript | 通过 | 6376 | 124 | 0 |

Electron 页阻止的资源是 `https://www.googletagmanager.com` 的 script，原因 `cross-origin`，正文快照仍成功。这是本次环境下的观测，不表示这些网站的登录、搜索、下载或所有交互已认证。

可重跑：`npm run test:browser:compatibility`。退出 0 表示报告生成成功；应检查 JSON 每个站点的 snapshot/status，不把报告生成成功误解为全部站点通过。输出 `.verification/browser-compatibility.json`。固定站点列表避免批量访问用户未指定的站点。

本地确定性回归覆盖 URL 脱敏、重复聚合、40 类上限、数据复制、重置，以及桌面面板显示；现有共享浏览器完整任务链继续验证。真实网页受网络及站点变化影响，因此不加入默认离线 `npm run check`。

## 下一步

基于诊断增加逐 origin 资源审批；先确定资源类型和有效期，再放行，而不是关闭 webSecurity 或全局允许跨域。连接 IP 固定、持久 profile、多标签和 iframe/shadow DOM 定位仍独立推进。Qwen 专项继续暂缓。
