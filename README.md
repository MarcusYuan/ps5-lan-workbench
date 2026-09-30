# PS5 Local Host

[简体中文](README.md) | [English](README.en.md)

PS5 Local Host 是一个用于局域网测试的桌面工具。它在电脑上运行 DNS 和网页服务，让 PS5 尝试访问由你提供的网页文件；还提供第三方组件下载与发送 ELF、通过 PKG Manager 安装本地 PKG，以及通过 FTP 发送游戏目录或镜像的操作入口。

> **技术交流与使用边界：** 本项目提供局域网服务与文件传输工具，供技术交流及获得授权的测试使用。仓库与构建包不附带 PS5 漏洞利用程序、破解脚本、第三方 ELF 或游戏资源；第三方组件仅在用户主动操作后下载。请先阅读下方[免责声明](#免责声明)；“技术交流”本身不授予访问、修改设备或运行第三方内容的权限。

> **验证状态：** 核心服务及下载流程有自动化测试；PS5 13.60 的证书提示、页面入口和后续行为仍待实机验证。看到“PS5 HTTPS 访问”只表示应用收到符合条件的请求。

## 功能概览

| 功能 | 说明 |
| --- | --- |
| 本地网页服务 | 下载并检查用户指定的 GitHub 仓库或 HTTPS ZIP；通过本地 HTTPS 和 HTTP 托管网页文件。 |
| DNS 重定向 | 将指定域名的 A 查询指向所选电脑 IPv4；不转发其他域名的查询。 |
| 组件操作 | 用户主动下载固定上游发布的 WebKit Autoloader、PKG Manager、Kstuff FPKG、Payload Manager、FTP Server（drakmor）、PS5 Web File Manager 附件，校验内置 SHA-256 后可发送 ELF。 |
| 本地 PKG 安装 | 选择电脑上的单个 `.pkg`，通过 PS5 上的 PKG Manager Direct Install 传输并安装。 |
| 游戏目录 / 镜像发送 | 通过 FTP 上传完整游戏目录或 `.exfat` / `.ffpkg` 镜像至 PS5 的 `/data/homebrew/`；传输完成不代表挂载或启动成功。 |
| 状态与日志 | 分别显示服务状态、PS5 HTTPS 请求、下载与远程任务进度。 |

组件、网页文件和 PKG 均由用户自行选择或主动获取，不随应用打包。网页归档检查只验证地址、结构和入口文件等条件，并非脚本安全审计。

## 获取与运行

正式版本可从 [Releases](https://github.com/MarcusYuan/ps5-lan-workbench/releases) 下载：Windows x64 提供安装版和便携版，macOS Intel（x64）与 Apple Silicon（arm64）各提供 DMG 和 ZIP，并附有统一的 `SHA256SUMS.txt`。推送与 `package.json` 版本一致的 `v*` 标签时，工作流会构建并发布 Release；推送到 `main` 或手动运行 [Build desktop packages](https://github.com/MarcusYuan/ps5-lan-workbench/actions/workflows/build.yml) 只生成有期限的 Actions Artifacts。构建包未签名，macOS 可能受到 Gatekeeper 拦截。

从源码运行需要 Node.js 22.12 或更新版本：

```bash
npm ci
node node_modules/electron/install.js
npm start
```

`npm ci` 通常会安装 Electron 运行时；若下载未完成，上面的 `install.js` 可补装。完整开发命令见[开发与构建](#开发与构建)。

## 使用本地网页服务

1. 将电脑和 PS5 接入同一局域网，在应用中选择面向 PS5 的电脑 IPv4 网卡。
2. 在“文件来源”输入公开 GitHub 仓库根地址（如 `https://github.com/owner/repository`）或 HTTPS ZIP 直链，并设置归档内的网页入口相对路径（默认 `index.html`）。Release 页面地址不是 ZIP 直链。
3. 点击“下载并检查”。GitHub 仓库会先确定默认分支的具体提交，再下载归档。成功后文件保存在应用用户数据目录；失败或取消不会替换上一份可用文件。
4. 点击“启动本地服务”。应用默认监听 DNS UDP/TCP 53、HTTPS 443 和 HTTP 8000。按系统提示授予必要权限；端口占用会显示错误。
5. 在 PS5 网络设置中，将主 DNS 设为应用显示的电脑 IPv4 地址，然后通过 PS5 用户指南入口尝试访问网页。HTTP 地址仅用于电脑或局域网测试。
6. 查看“PS5 HTTPS 访问”和活动日志。收到请求不代表 PS5 已信任自签证书，也不代表网页或第三方程序执行成功。

应用会自动生成包含目标域名 SAN 的自签证书，并在域名变化或证书临近过期时更新；它不会安装为系统根证书。

## 组件与本地 PKG

1. 在顶部单独填写并保存 PS5 的 IPv4 地址。保存地址不会探测主机；电脑网卡地址仍用于 DNS 和网页服务。
2. 在“安装插件”区查看上游来源，主动下载所需组件。应用会校验固定发布附件的 SHA-256；只有点击“加载到 PS5”后，才会检查默认 9021 端口并发送 ELF。WebKit Autoloader 与 Kstuff FPKG 发送后需在 PS5 上确认运行；PKG Manager 就绪情况通过默认 8844 接口检查。
3. Payload Manager v0.5.2 的“检查状态”和“打开管理页面”无需先下载 ELF；应用通过固定端口 8084 检查版本与服务响应，确认后才打开官方页面。加载时若已运行则不重复发送；发送后最多等待 30 秒确认，超时只报告“已发送，启动未确认”。Payload Manager 可能执行主机已有自动加载列表，本应用不会修改该列表。
4. 在“安装本地 PKG”区选择或拖入电脑上的单个 `.pkg`，点击“安装到 PS5”。应用通过 PKG Manager Direct Install 分段传输，无需 SMB 共享，也不依赖 9021。保持电脑和源文件可用，直到 PS5 返回安装结果。

在 7.00–13.60 固件上，WebKit Autoloader 默认 ELF Loader 可能仅接受 PS5 本机连接。若需从电脑发送 ELF，请先按[上游说明](https://github.com/itsPLK/ps5-webkit-autoloader/blob/v0.5.1/README.md)启用局域网连接。Payload Manager 与 PKG Manager 是不同程序。

固定版本：WebKit Autoloader v0.5.1、PKG Manager v1.4.1、Kstuff FPKG 1.13-fpkg-dr-test5、Payload Manager v0.5.2、FTP Server（drakmor）1.16-ng-stable、PS5 Web File Manager v1.9。缓存的旧版 Autoloader ELF 需重新下载才能通过新版校验。Autoloader v0.5.1 的 Relapse 需要有效的 Wi-Fi 或以太网连接，即使没有互联网也需要。

发送 FTP Server 后，在主机上确认启动，再用 FTP 客户端连接 PS5 地址的 2121 端口。发送 Web File Manager 后，在浏览器打开 `http://<PS5-IP>:<通知中的端口>/`；默认 8888，端口占用时尝试更高端口，以启动通知为准。这两个组件只报告发送结果，本项目尚未验证其在 13.40 上的运行。解压功能需要另行获取上游 `wfm-7zip-helper.elf`；本应用不下载或安装此 helper。

Kstuff 改为用户指定的 [GBAtemp test5 附件](https://gbatemp.net/attachments/kstuff-1-13-fpkg-dr-test5-elf-7z.593030/)，下载后自动解压。压缩包和 ELF 分别固定大小与 SHA-256；这些校验值来自本地下载核验，尚未与作者公布值核对。13.40/13.60 FPKG 兼容性未验证。旧 Lite 1.11 缓存需重新下载；组件 ID 保持兼容。GBAtemp 下载直连，不使用 GitHub 镜像。

### 游戏目录与镜像的 FTP 发送

1. 保存目标 PS5 地址，在主机上启动 FTP Server；发送 ELF 完成不代表 FTP 已运行。
2. 在“发送游戏目录 / 镜像”选择完整游戏根目录，或已有的 `.exfat` / `.ffpkg` 镜像。目录必须包含非空 `eboot.bin` 和含 `titleId` 的 `sce_sys/param.json`；不支持符号链接、目录联接和不安全文件名。镜像按扩展名和基本文件条件筛选，不验证其内部游戏内容或兼容性。`.ffpkg` 是镜像，与 FPKG 安装包不同。
3. 确认 FTP 端口（默认 2121），点击“发送到 PS5”。本功能使用匿名 FTP 登录，不保存凭据，适用于允许该登录方式的主机 FTP 服务。
4. 文件先上传到 `/data/.ps5-local-host-<任务标识>/`，逐文件核对远端大小后，再重命名至 `/data/homebrew/<所选目录或镜像名称>`。已有同名目标会拒绝传输；传输期间请勿用其他工具修改目标。大小核对不是内容哈希校验。源文件变化会中止任务。
5. 进度及取消按钮位于任务区域。取消或失败后尝试清理本任务临时文件；无法清理时，技术详情记录残留路径。连接在最终重命名时中断则报告结果未确认，需到 PS5 检查。断点续传、覆盖更新、存储位置选择和镜像制作尚未提供。
6. 完成后在 PS5 上确认兼容的加载器（例如 ShadowMountPlus）识别、挂载及启动。加载器需另行准备，本应用不自动下载、启动或验证它。PS5 13.00 及具体游戏的运行兼容性仍待实机验证。

### GitHub 镜像加速

“文件来源”中的“GitHub 镜像加速”默认关闭。开启后，新发起的公开 GitHub 仓库 API、ZIP 和组件附件下载会通过第三方 `gh-proxy.org`；切换不会中断当前任务，也不改变 DNS、HTTPS 或 PS5 连接。服务商会收到请求的公开资源地址。应用不会通过镜像转发账号凭据、带查询参数的地址或其他站点 ZIP；组件仍校验内置 SHA-256。普通网页 ZIP 没有预置可信摘要，请自行判断来源和镜像是否可信。镜像失败时可关闭开关重试。

## 网络与本地数据

| 项目 | 行为 |
| --- | --- |
| DNS | 仅将目标域名（默认 `manuals.playstation.net`）的 A 查询回答为所选电脑 IPv4；AAAA 不提供地址，其他域名返回 NXDOMAIN；不转发公网 DNS。 |
| 网页 | HTTPS 和 HTTP 托管同一份已下载文件；`/document/<语言>/ps5/` 重定向到所选入口，缺失文件返回 404。 |
| 外网请求 | 应用仅在用户主动下载资源时连接上游；用户提供的网页或脚本可能自行访问外网。 |
| PS5 连接 | 用户主动加载 ELF、安装 PKG、发送游戏目录 / 镜像或检查组件状态时，向保存的 PS5 地址发起对应连接。 |
| 本地存储 | 配置、下载文件和证书私钥保存在 Electron 用户数据目录，不进入安装包；重启后须手动启动服务。 |

若要检查网页的离线行为，可在下载并启动服务后断开电脑外网，同时保持电脑与 PS5 的局域网连接。

## 故障排查

| 现象 | 检查项 |
| --- | --- |
| 服务无法启动 | 检查电脑网卡、系统权限，以及 53、443、8000 端口是否被 DNS、代理或其他程序占用。 |
| PS5 无法打开页面 | 确认电脑和 PS5 在同一局域网、PS5 主 DNS 指向所选电脑 IPv4，并查看 HTTPS 请求日志。证书提示和页面行为仍需实机确认。 |
| 下载失败 | 检查 GitHub 仓库或 HTTPS ZIP 直链、入口相对路径；若使用镜像，关闭后重试。 |
| ELF 或 PKG 操作失败 | 确认填写的是 PS5 IPv4，检查对应的 9021 或 8844 服务是否已在 PS5 上就绪，并查看任务日志。 |

若 53 端口被占用，可用 `--diagnostic-ports` 临时测试电脑侧 DNS 5354、HTTPS 8443、HTTP 18000：

```bash
npm start -- --diagnostic-ports
```

打包应用也可在命令行追加此参数。诊断模式不能用于 PS5 实机访问，因为 PS5 DNS 设置无法指定 5354；正常重启应用即可恢复默认端口。

## 开发与构建

```bash
npm test
npm run pack:dir
npm run pack:mac
npm run pack:win
```

`pack:mac` 在 macOS 上生成 DMG 和 ZIP；`pack:win` 在 Windows 上生成 NSIS 安装版和便携版。正式分发需要发布者自行提供 macOS 签名、公证及 Windows 签名凭据。`npm test` 使用普通测试网页和本机高端口，覆盖下载、DNS、HTTPS、静态资源、证书复用和端口释放等流程；自动化测试不能代替 PS5 实机验证。

## 免责声明

本项目仅供技术交流、学习研究及合法授权环境下的局域网测试。请仅在自己拥有或获得明确授权的设备、账号和网络中使用，并遵守所在地法律法规、平台服务条款及第三方软件许可。**“技术交流”或“学习研究”是项目用途说明，不代表任何具体操作已获得授权，也不能免除使用者应承担的法律责任。**

- **项目关系与内容：** 本项目是独立的非官方工具，与 Sony Interactive Entertainment、PlayStation 及列出的第三方项目没有隶属、授权、合作或背书关系。相关名称仅用于说明兼容对象或上游来源，商标归各自权利人所有。仓库与构建包不附带漏洞利用程序、破解脚本、第三方 ELF 或游戏资源。
- **第三方资源：** 网页、脚本、ELF、PKG 及下载镜像由用户自行选择或主动使用。请自行核实来源、许可、使用条件和安全性。本工具可下载、校验或托管文件，不代表对其合法性、安全性、兼容性或运行效果作出审查、推荐或保证；哈希校验也不能替代这些判断。
- **结果与风险：** 服务启动、收到 PS5 请求、ELF 发送完成或文件传输完成，均不等于第三方内容已成功执行或安装。本项目按现状提供，不保证适配所有设备和固件，也不保证持续可用或无故障。使用本工具或第三方内容可能造成网络异常、数据丢失、设备故障或账号限制；请提前备份重要数据。
- **责任范围：** 在适用法律允许的范围内，作者及贡献者不对使用或无法使用本项目，以及用户自行选择、下载、托管或运行第三方内容造成的损失承担责任。本声明不排除依法不得排除的责任，也不替代本项目的 [MIT 许可证](LICENSE) 或第三方许可与条款。

如不能接受上述条件和风险，请勿使用。发现仓库或分发包存在侵权等问题，可提交 [Issue](https://github.com/MarcusYuan/ps5-lan-workbench/issues)；请勿附上账号密码或证书私钥。

## 联系方式与交流

| 渠道 | 联系方式 | 用途 |
| --- | --- | --- |
| QQ 群 | `672608984` | 中文技术交流与使用讨论 |
| Discord | [PS5 Technical Exchange](https://discord.gg/3UrdCB47Q8) | 技术交流与使用讨论 |
| GitHub Issues | [提交问题或建议](https://github.com/MarcusYuan/ps5-lan-workbench/issues) | Bug 反馈、功能建议及项目相关问题 |

反馈问题时，请提供应用版本、操作系统、复现步骤和已脱敏的日志；请勿公开账号密码、私钥或其他敏感信息。

## 许可证

项目代码采用 [MIT 许可证](LICENSE)；用户主动下载的第三方组件遵循各自上游许可证。
