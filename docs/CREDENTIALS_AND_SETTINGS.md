# 系统凭据与模型设置

## 当前实现

工作台侧栏「模型设置」提供 deepseek-chat / qwen3.5-flash 两个官方模型的 API Key 保存、替换、删除和连接测试。工作台顶部仍负责选择当前模型；选择结果继续使用原有原子配置与备份机制。

- 明文仅短暂经过密码输入框、受限 IPC、Main/Host 内存和对应官方 HTTPS 请求。保存成功或关闭设置清空输入，不提供读取明文的 renderer API。
- Main 使用 Electron safeStorage；macOS 由 Keychain 保护加密材料，应用 userData/credentials/*.sealed 保存密文，不是将 API Key 直接写入 Keychain 条目。
- 密文用同目录临时文件、fsync、rename 原子写入，目录 0700、文件 0600；不生成旧密钥备份。
- 来源优先级：本机已保存凭据 > DEEPSEEK_API_KEY / QWEN_API_KEY > 未配置。删除仅删除本机密文，保留并回退到环境变量。
- 已保存但损坏或解密失败时不悄悄回退环境变量：该模型暂时按未配置处理，设置页展示错误，可重新保存或删除修复；其他模型继续可用。
- 加密服务不可用时拒绝写入；Linux basic_text 后端亦拒绝保存。当前实际验收平台是 macOS arm64，Windows/Linux 未做真实桌面验证。
- Main 在修改前要求 Host 空闲并关闭旧 runtime，更新 Host 凭据环境，下一次连接重新使用新凭据。任务执行或连接中拒绝更新，不中断在途任务。凭据 pause/apply 是内部消息，不开放给 renderer。
- 凭据不进入 settings.json、任务日志、源码交付包或测试输出；真实 API Key 不用于密文持久化测试。

## 连接测试的准确含义

用户主动点击后向固定官方 `/responses` 地址发送 `Reply OK` 最小请求，15 秒超时、拒绝 HTTP 跳转，只返回 HTTP 状态，不回显响应体或请求头。测试会产生少量 API 用量。测试使用已保存/环境凭据，忽略输入框里尚未保存的值。

HTTP 200 只证明最小请求通过，不保证工具调用、多轮、模型输出质量或完整 Agent 回归。当前设置不是任意 Base URL / 任意模型注册编辑器。

## 验收命令

```sh
cd /Users/c4n6r/cypherSec/CoAgent
npm run check
npm run desktop:build
npm run test:desktop:settings
# 需要官方环境变量；各发送一次最小请求
npm run test:desktop:settings:live
```

4 项凭据单元测试覆盖密文、0600、重载、环境优先级、状态脱敏、删除、损坏修复、加密不可用、ID/密钥格式校验。真实 Electron 设置测试覆盖保存后输入清空、系统加密密文、重启、删除回退、损坏后修复、Host 配置同步、内部 IPC 拒绝。既有审批、工作台、崩溃恢复和双模型桌面测试保留。

## 后续

自定义供应商注册、Base URL/协议校验与完整能力测试；签名/公证/安装包升级后的 Keychain 行为；配置导入导出（排除凭据）；更完整的键盘焦点管理。历史 Qwen 固定 20 例结果仍为 18/20，本阶段桌面验收不覆盖该记录。

## 后续增量更新

自定义供应商编辑器现已落地；见 [CUSTOM_PROVIDERS.md](CUSTOM_PROVIDERS.md)。本文前面的“两种固定模型 / 编辑器待进行”描述保留为该阶段记录。连接测试现按各条目选择的协议发送到已配置服务，不再仅限两个官方地址。
