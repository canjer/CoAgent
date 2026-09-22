# 完整 Chat Agent 任务集回归

日期：2026-09-21；实际模型调用，经 Chat Completions → Gateway → Codex 0.155.1 app-server 执行。

## 结果

| 模型 | 完整任务集 | 退出码 |
|---|---:|---:|
| DeepSeek deepseek-chat | 20/20 | 0 |
| Qwen qwen3.5-flash | 16/20 | 1 |

每个案例创建独立临时工作区并清理；未修改用户模型配置、凭据或正在运行的安装版。Qwen 使用现有官方文本模式 enable_thinking=false。

## 固定判定标准

沿用 Responses 任务集的原始 20 条提示、输入与精确输出；不放宽空格、逗号、换行。校验回合 completed、结果逐字节一致、输入未变、至少一条成功命令，以及中文路径/嵌套/多文件等附加产物。恢复案例同时要求出现非零退出码；本次两模型命令证据均包含独立 false（1）及随后成功 cp（0）。

任务：copy、uppercase、sort、deduplicate、sum、filter、replace、reverse、unicode、json、csv、count、trim、join、markdown、patch、nested、empty、recovery、multifile。

## Qwen 失败与独立复测

| 案例 | 首次完整回归 | 单项复测（各一次） |
|---|---|---|
| replace | 回合 completed，但 result.txt 缺失（ENOENT） | 通过 |
| join | 输出 `a,b,c,\n`，多出尾逗号 | 仍失败，result.txt 缺失；仅观察到 ls/cat 读取命令 |
| markdown | 标题前残留空格 | 仍失败，同样残留空格 |
| patch | 回合 completed，但 result.txt 缺失（ENOENT） | 通过 |

复测独立计分，不合并成完整任务集通过率。缺失文件的首次运行在读取文件时抛错，未保留命令轨迹；随后改进采集顺序，复测即使文件缺失也记录命令与退出码。该调整不改变任何提示或评分。

当前证据表明存在输出准确性与产物完成性问题；不能仅凭这些案例排除所有协议问题或断言全部由模型导致。固定提示中部分任务省略 input.txt、Markdown 空白规则等信息，后续如做提示消歧应建立独立 v2 任务集，保留 v1 历史结果。

## 报告与复现

- [deepseek-chat 20/20 / 2026-09-21T13-14-26-156Z-87f80572](regression-runs/2026-09-21T13-14-26-156Z-87f80572/AGENT_REGRESSION_CHAT_deepseek-chat.json)

- [qwen3.5-flash 16/20 / 2026-09-21T13-14-27-190Z-c6cb494b](regression-runs/2026-09-21T13-14-27-190Z-c6cb494b/AGENT_REGRESSION_CHAT_qwen3.5-flash.json)

- [qwen3.5-flash 1/1 / 2026-09-21T13-18-07-440Z-57da3b62](regression-runs/2026-09-21T13-18-07-440Z-57da3b62/AGENT_REGRESSION_CHAT_qwen3.5-flash_replace.json)

- [qwen3.5-flash 0/1 / 2026-09-21T13-18-15-472Z-a9bdfbff](regression-runs/2026-09-21T13-18-15-472Z-a9bdfbff/AGENT_REGRESSION_CHAT_qwen3.5-flash_join.json)

- [qwen3.5-flash 0/1 / 2026-09-21T13-18-20-290Z-84d7a9b7](regression-runs/2026-09-21T13-18-20-290Z-84d7a9b7/AGENT_REGRESSION_CHAT_qwen3.5-flash_markdown.json)

- [qwen3.5-flash 1/1 / 2026-09-21T13-18-26-970Z-6d2ec595](regression-runs/2026-09-21T13-18-26-970Z-6d2ec595/AGENT_REGRESSION_CHAT_qwen3.5-flash_patch.json)


```sh
cd /Users/c4n6r/cypherSec/CoAgent
npm run check
COAGENT_MODEL=deepseek-chat npm run test:agent:chat
COAGENT_MODEL=qwen3.5-flash npm run test:agent:chat
# 单项诊断，不替代完整回归
COAGENT_MODEL=qwen3.5-flash npm run test:agent:chat -- --case=join
```

真实请求使用本地环境变量 DEEPSEEK_API_KEY / QWEN_API_KEY，报告不含密钥。报告目录带时间与随机 runId，每次运行独立存档；不覆盖旧 Responses 结果。报告逐案写入 completed，异常中断的部分报告不代表完成。

## 工程回归与后续

本轮修改前后 npm run check 均为 54 单元/协议 + 5 集成通过。没有修改适配器或应用运行行为，本轮不重新打包安装程序。

下一步：对 Qwen 的缺失产物与输出校验做专项改进，使用独立版本的明确任务契约验证；保持 v1 对照。并行工具、审批专项、推理/多模态及安装版凭据 UI 稳定性仍未由这 20 个文件任务覆盖。
