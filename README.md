# CoAgent

## 启动方式

环境要求：Node.js >= 22.18.0（当前验证平台为 macOS Apple Silicon）。

```sh
# 1. 安装依赖
npm ci --ignore-scripts

# 2. 首次运行需下载 Electron 二进制
node node_modules/electron/install.js

# 3. 启动桌面应用
npm run desktop
```

说明：需要在终端环境变量中设置 `DEEPSEEK_API_KEY`，或启动后在应用「模型设置」中配置模型 API Key。
