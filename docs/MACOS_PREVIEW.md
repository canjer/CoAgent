# macOS 本机预览版 0.1.0-preview.1

## 构建与安装

```sh
cd /Users/c4n6r/cypherSec/CoAgent
npm run desktop:package
npm run test:desktop:package
```

输出位于 `dist/release/`：

- `coAgent-0.1.0-preview.1-arm64.dmg`：Apple Silicon macOS 安装镜像；打开后可将 coAgent.app 拖到 Applications。
- `coAgent.app`：独立应用，包含 Electron、前端、Main/Host 以及固定版本 Codex runtime 及其配套资源；启动不再依赖源码目录、系统 Node.js 或 npm。
- `APP_MANIFEST.json`：应用资源 SHA256 清单及签名状态。
- `SHA256SUMS.txt`：DMG 的 SHA256。

安装测试将镜像只读挂载，复制应用到临时 Applications 目录，卸载镜像，再验证签名、资源哈希和应用功能。它不覆盖用户的 /Applications 或实际配置。

## 当前签名状态

这是本机构建的 **ad-hoc 签名预览版**，不是 Developer ID 签名、公证的公开发行版。`codesign --verify --deep --strict` 与 `hdiutil verify` 通过，不等于 Gatekeeper 公证通过；未验证另一台 Mac 下载后的安装体验。正式分发仍需开发者签名、公证及跨设备验收。

打包采用 Electron 的手动应用布局；分发与 safeStorage 的身份要求参见 [Electron Application Distribution](https://www.electronjs.org/docs/latest/tutorial/application-distribution)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

## 数据与凭据兼容性

本轮保留开发版的数据位置 `~/Library/Application Support/Electron`，保留既有配置、服务列表、任务记录与 runtime 历史路径；测试通过 COAGENT_TEST_USER_DATA 使用独立临时目录。桌面显示名是 coAgent，内部应用名暂时保留 Electron。正式版切换独立命名空间需另行迁移，不能直接改名后宣称兼容。

**实测跨应用身份密钥需要重新录入**：开发版密文在该签名应用中解密失败。应用只显示已有的解密错误，不自动删除、不覆写原文件；用户在「模型设置」明确重新保存后，本机密文更新。测试验证原密文在重录前保持不变，并验证重录后打包版重启可正常解密。

这不是透明凭据迁移。重新保存后的密文也不承诺可被旧开发身份解密，切换回开发版可能同样需要重录。环境变量仍可使用；从 Finder 启动不应假定继承终端的 API Key，请通过设置页配置。

## 回归与截图

桌面功能回归默认不截图，避免截图超时导致文件任务、历史、取消检查尚未执行完即中止。通过 `COAGENT_CAPTURE_SCREENSHOTS=1 npm run test:desktop` 可显式执行截图，截图失败仍使该次测试失败，不吞掉错误。

本轮 DeepSeek 与 Qwen 的开发版真实桌面任务均通过：文件生成、文件预览、历史重启和取消。上轮 Qwen 503、截图超时与历史 18/20 记录仍保留，未替换为本轮结果。本轮没有重跑固定 20 例全套模型质量回归，也没有新增自动重放。

安装包专项回归覆盖只读镜像校验、安装副本资源核验、源码目录以外启动、凭据显式重录与重启，以及自定义 Responses 本地服务 + 真实 Codex 文件工具闭环。该测试使用模拟服务及测试密钥，不代表新的商用模型认证。

## 许可文件

安装包 Resources/licenses 包含 Electron、Chromium、React、React DOM 和 Codex 的许可及 Codex NOTICE；Codex 配套资源自带 notice 保留。Codex 文本取自固定版本 [LICENSE](https://github.com/openai/codex/blob/rust-v0.155.1/LICENSE) 与 [NOTICE](https://github.com/openai/codex/blob/rust-v0.155.1/NOTICE)。

## 后续

1. Developer ID 签名、公证及跨设备安装验收。
2. 独立数据/Keychain 身份迁移与版本升级回归。
3. Qwen 固定任务全集重跑、失败用例诊断。
4. 按具体模型需要，再扩展 Chat Agent 协议适配。

### 最终安装包验收补充

打包应用的 DeepSeek 与 Qwen 真实桌面流程也均通过（`packaged=true`）：文件任务、预览、重启历史、取消；均从源码目录外启动。安装测试曾出现首次启动等待 h1 超过 30 秒，原日志保留；复验通过，打包副本冷启动检查现使用明确的 60 秒上限。该调整不重放任何 Agent 任务。

## 个人使用与重复启动修复

用户已确认目前可以启动，不再推进发布签名或公证。排查时发现旧开发实例仍持有同一数据目录的单实例锁，新应用退出码为 0 但旧窗口未被唤起。新增 second-instance 和 activate 处理：恢复、显示并聚焦已有窗口；不启动第二个 Host，也不重放任务。初始化异常改为明确弹窗，而非仅写 stderr 后退出。

`npm run test:desktop:startup` 在临时数据目录隐藏首个窗口，再启动第二进程，验证窗口恢复、只有一个窗口且 Host PID 不变；安装副本也执行同一回归。旧版本仍在运行时尚未具备该处理，需正常退出旧版本后再启动新版本。本轮不终止用户当前实例，不改动实际用户数据。

本轮重新验证跨开发身份凭据时再次遇到窗口等待超时，故不宣称该迁移路径稳定。安装验收默认验证打包版自身的保存/重启/删除；跨身份专项使用 `COAGENT_TEST_MIGRATE=1 npm run test:desktop:package` 独立执行，失败记录保留。重复启动修复在开发版和安装副本均已通过，与该迁移测试分开记录。

当前完整安装套件在后续凭据 UI 点击也出现超时，未全部通过。本轮只将“重复启动恢复已有窗口”计为新增已验证能力；完整安装回归待继续稳定。DMG 已重新生成，原始失败日志及退出码 1 纳入交付记录。
