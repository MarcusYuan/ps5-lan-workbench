# PS5 LAN Workbench — 仓库协作入口

## 定位与事实来源

本文件定义仓库级协作原则和阅读入口。版本、打包与发布流程统一维护在 [GitHub 发布规则](rules/github-release.md)，此处不复制流程正文。

- 明确的用户指令优先；已经给出的任务授权持续有效，不重复索要确认。
- 产品能力、使用方法和限制见 [中文 README](README.md) 与 [English README](README.en.md)，两者必须同步。
- README 面向首次使用者，优先说明下载、准备和按目标操作；组件版本、协议、诊断和开发细节统一放在 [中文详细指南](guides/usage.zh-CN.md) 与 [English guide](guides/usage.en.md)，两者同步维护。
- `package.json`、锁文件、工作流和代码提供当前实现证据。规则与实现冲突时，明确判断需要修复实现还是更新规则，不能把计划中的能力描述成已完成。
- 新增长期规则前，先检查现有主题；同一主题只维护一份规则。临时调研、构建日志和任务计划不属于仓库规范。

## 项目边界

- 本项目是基于 Electron 的局域网桌面工具，使用 JavaScript；应用产品名为 `PS5 Local Host`。
- 面向技术研究和交流，处理用户自行提供或有权使用的文件。不得把第三方游戏、密钥、证书、ELF 或 PKG 随应用发布。
- 下载第三方组件必须由用户主动触发，并保留来源及兼容性信息；不得把第三方组件的能力描述成本项目已验证的能力。
- 服务启动、收到请求、文件传输完成、远端接受和 PS5 实际执行成功是不同状态。日志、UI、README 和 Release 必须如实区分。
- 固件兼容性必须由实际硬件验证支持；未经验证的版本明确标注待验证。构建和单元测试成功不能代替实机验证。
- README 和发布说明保留技术交流用途、使用者责任、无效果保证与第三方权利说明；免责声明不能用于扩大项目范围或承诺免责效果。

## 阅读分流

| 任务 | 入口 |
|---|---|
| 使用方法、功能范围、免责声明 | [README.md](README.md)、[README.en.md](README.en.md) |
| 组件版本、网络参数、传输限制、诊断及源码运行 | [guides/usage.zh-CN.md](guides/usage.zh-CN.md)、[guides/usage.en.md](guides/usage.en.md) |
| 版本、标签、打包、GitHub Releases、失败恢复 | [rules/github-release.md](rules/github-release.md) |
| 依赖、开发命令、打包包含范围 | [package.json](package.json)、[package-lock.json](package-lock.json) |
| GitHub 自动构建和发布的实际行为 | [.github/workflows/build.yml](.github/workflows/build.yml) |
| Electron 生命周期和 IPC 边界 | [src/main.js](src/main.js)、[src/preload.js](src/preload.js) |
| DNS、Web、证书和下载服务 | `src/core/`、`src/service/` |
| PS5 通信、组件管理、PKG 会话 | `src/ps5/`、`src/components/`、`src/pkg/` |
| 已交付界面与中英文文案 | `ui-prototype/`、[src/i18n/index.js](src/i18n/index.js) |
| 行为验证 | `test/` |

`ui-prototype/` 中的界面是当前打包入口；不能因为目录名包含 prototype 就按废弃演示代码处理。

## 实现与协作

- 开始编辑前检查 Git 状态和相关实现。只修改当前任务需要的文件，不覆盖其他任务的未提交工作。
- 提交时逐项选择文件并审查暂存差异；工作区存在其他改动时禁止直接 `git add .`。
- 保持现有 JavaScript 模块和目录职责；没有具体需求不引入框架、依赖或跨模块抽象。
- 渲染层通过受限 preload API 调用主进程；新增 IPC 必须验证输入、路径和操作范围，不直接向页面暴露任意文件或命令执行能力。
- 网络监听、提权、远端通信、文件读写和下载解压都是输入边界；保留超时、错误处理、路径校验和清理机制。
- UI 新增或修改用户可见文案时，同步维护中英文。操作反馈必须反映真实状态。
- 不把凭证、用户配置、个人路径、证书、构建输出或第三方二进制提交到仓库。调整打包文件范围时检查是否包含敏感文件。

## 验证与交付

- 依赖安装使用锁文件：`npm ci`。开发启动：`npm start`。
- 行为变化先运行相关测试，交付前运行 `npm test`；该命令使用 Node 内置测试器并串行执行测试文件，避免网络端口测试相互干扰。
- Windows 打包使用 `npm run pack:win`；macOS 在相应平台使用 `npm run pack:mac -- --x64` 或 `npm run pack:mac -- --arm64`。跨平台交付以对应 GitHub runner 的结果为准。
- 文档改动检查事实、链接与 `git diff --check`，无需为纯文档修改重复运行应用构建。
- 当前没有统一 lint、formatter 或 typecheck 脚本；不得声称运行过不存在的检查。
- 完成说明写清修改、验证结果和未验证事项。推送成功、构建成功、Release 发布成功必须分别报告，并提供对应证据。

## 私有仓库配置

- 私有 Nexus 配置位于 `C:\Users\008by\.codex\secrets\nexus.json`；仅当任务需要包、容器或 raw 仓库访问时读取。
- 该文件属于秘密：不得引用、输出、概述、提交或把其中凭证复制到源码、日志、聊天及命令输出。
- 使用 Nexus 下载依赖时使用 group 端点；向 hosted 仓库发布必须有用户明确请求。
- 当前本地配置中的 Nexus HTTP 主机属于可信环境；Hugging Face 不可用。
- Gradle Plugin Portal 代理和 Docker OCI attestation 缓存未经验证，不得假定可用。
- GitHub 公共构建当前使用 npm 官方 registry；不得为了本地镜像访问把私人配置写入公共工作流或锁文件。
