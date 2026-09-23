# DeepSeek Flash 新增与编辑器状态修复

2026-09-24

## 已验证
- 最新源码新增 DeepSeek Flash + 同时填写测试 Key（Chat）保存成功，未向供应商发送请求；用户报告的“未知模型”未在该路径复现。
- 原界面 DeepSeek 协议选择被禁用，后端也拒绝 Responses；本轮放开两种协议。
- 原 ProviderEditor 在编辑对象变化时不重新初始化 useState，可能携带上一个对象的 ID；删除服务后编辑器仍保留旧 ID。增加组件 key、删除成功关闭编辑器，后端对失效编辑 ID 提供明确提示。
- 不把 `deepseek-flash` 当内部服务 ID；新增使用 custom UUID，模型名称仍存 upstreamModel。
- 系统凭据保护保持原样，未修改地址/协议/模型时已有凭据可保留；更换目标仍需先删除旧凭据。

## 使用
服务名称 DeepSeek Flash；API 类型 DeepSeek；接口 Responses；Base URL https://api.deepseek.com；模型 ID deepseek-flash。Key 在设置页输入。

## 验证范围
使用临时 userData、测试密钥和本地 HTTP 夹具；未调用真实 DeepSeek，不代表真实模型完整 Agent 能力验证。安装目录 coAgent.app 比本轮源码旧，本轮仅构建开发版本，未替换安装程序。
官方参考：https://api-docs.deepseek.com/api/create-response/
