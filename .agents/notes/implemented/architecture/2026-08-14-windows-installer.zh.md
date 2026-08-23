# Agent Note：dsh Web 应用的 Windows 用户级安装包（windows-installer）

Status: implemented

[English](2026-08-14-windows-installer.md) | 中文

## 问题

Web GUI 此前只能从仓库检出目录运行 `dsh web`，并要求系统安装 Node。Windows 最终用户需要的是普通应用体验：运行一个安装程序，得到开始菜单/桌面快捷方式，点击后在浏览器中看到界面——机器上没有 Node、pnpm、仓库检出。

## 决策

### 打包路线：pnpm deploy 闭包 + 官方 node.exe + Inno Setup

安装包负载**不是** pkg/SEA 单文件 exe（该路线在 Python SDK 运行时中明确将 Windows 列为非目标），而是真实的磁盘包树：

- `app/` —— 由 `pnpm --filter dsh-windows-installer-pkg deploy --legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true` 部署的依赖清单 [`apps/windows-runtime/package.json`](../../../../apps/windows-runtime/package.json)（`dsh-windows-installer-pkg`）的闭包，与 `build-exe-for-python-sdk.ts` 实测的同一组标志。该清单镜像 `python/sdk-runtime` 的闭包（headless composition 已验证的依赖列表），再加上 `@deepseek-ai/dsh` 与 workspace 中声明的全部 `@deepseek-ai/*` peer：在 `--config.auto-install-peers=false` 下，peer-only 包（cosmokit、schemastery、dsh-timeout、dsh-scope……）只能作为清单直接依赖进入树，否则 deploy 会丢弃它们。因此应用入口是 `app/node_modules/@deepseek-ai/dsh/lib/bin.js`。随后的 restore 步骤把 legacy deploy 遗留在部署源旁边（`apps/windows-runtime/node_modules`）的清单依赖复制进暂存树（排除包内依赖树）；materialization 步骤把暂存树中的每一个链接（workspace 符号链接/junction）替换为真实字节。
- `node/node.exe` —— 满足仓库 engines 区间（`^22.19.0 || >=24.0.0`，从 `nodejs.org/dist/index.json` 实时解析最新版本；可用 `--node-exe`/`--node-version` 覆盖）的官方 `win-x64/node.exe`。规范名 `node.exe` 是启动器约定的名字；带版本号的下载作为缓存留在旁边。尚未固定 SHA——见“已知限制”。
- `launcher/` —— 两个 PowerShell 脚本（PowerShell 随每个 Windows 附带）。

[`scripts/build-windows-installer.ts`](../../../../scripts/build-windows-installer.ts) 拥有流水线：`pnpm run build` → 部署 + restore + materialize + 产物检查（`node_modules/@deepseek-ai/dsh/lib/bin.js`、Web 前端 `dist/index.html`）→ node.exe 暂存 → 无密钥暂存启动冒烟 → 模板填充 → ISCC 编译。pnpm 通过 `npm_execpath` 无 shell 调用（本脚本必须经 `pnpm run build:windows-installer` 运行）；ISCC.exe 直接 spawn。ISCC.exe 在标准 Inno Setup 6/7 目录（含 winget 用户级安装的 `%LOCALAPPDATA%\Programs`）中查找，或经 `--iscc` 指定。产物：`dist-windows/dsh-setup-<version>-x64.exe`（lzma2 solid 压缩后约 58 MB）。

### 启动器语义：固定端口、幂等启动、浏览器即窗口

`dsh-web.ps1` 先探测 TCP 3080（Web bundle 自身的部署回退端口）。未监听 → 隐藏窗口启动 `node.exe app\node_modules\@deepseek-ai\dsh\lib\bin.js web --port 3080`，stdout/stderr 重定向到 `%LOCALAPPDATA%\DeepSeek Harness\logs`，等待端口最长 90 秒；随后打开浏览器。已在监听 → 只打开浏览器，因此反复点击快捷方式不会叠出多个服务器。代价：端口探测无法区分 DSH 与其他监听者——在已运行源码 `dsh web` 的开发机上（相同默认端口），快捷方式会打开那个实例。`dsh-stop.ps1` 通过匹配命令行为 `@deepseek-ai\dsh\lib\bin.js" web` 的 `node.exe` 进程停止服务器——按安装形态匹配，绝不波及所有 node 进程。

### 安装器：用户级、卸载保留数据

`scripts/windows-installer/setup.iss.txt`（模板；生成副本填充后写入 `dist-windows/setup.iss`）：`PrivilegesRequired=lowest`、`DefaultDirName={localappdata}\Programs\DeepSeek Harness`、仅 x64、英文 + 俄文向导语言（均随 Inno Setup 附带）。卸载只移除安装目录；`~/.dsh`（会话、设置、凭据）刻意保留——没有 `[UninstallDelete]` 段，且未经本 note 反转不得添加。无自启动任务。API 密钥在首次运行的 GUI 设置中输入，而不是安装期间。

### 冒烟：打包流程不得交付无法启动的树

ISCC 之前，脚本用捆绑的 node.exe 启动暂存树（`web --port 0`，OS 分配端口），从 stdout 读取打印的 `dsh web: http://127.0.0.1:<port>` 行（无结尾斜杠），要求前端给出 HTTP 响应，然后经 `Get-NetTCPConnection` 按端口终止监听。冒烟使用捆绑运行时，因此同时证明了 node.exe 配对。`--skip-smoke` 可跳过；`--dry-run` 中冒烟被跳过。

## 已知限制与 deferred work

- exe 未签名：Windows SmartScreen 首次运行会告警。代码签名需要证书，暂缓。
- node.exe 下载未固定摘要（仅有大小下限）。可复现构建应从 `SHASUMS256.txt` 固定版本与 SHA256。
- 固定端口 3080 无回落到 `--port 0` 的冲突处理（那会破坏“第二次点击只开新标签”的幂等性，因为每次浏览器 URL 会不同），也无监听者身份校验（3080 上的非 DSH 监听者会让快捷方式只开浏览器而永远不启动应用）。
- 闭包清单携带 Web composition 不会挂载的包（dsh-e2b、dsh-lsp、SDK/hooks 系列）；它们增加安装体积，可对照 web profile 的行差异裁剪。
- 冒烟使用真实 `~/.dsh` home（profile 自动初始化），因此会在构建机上创建 `web` profile（若不存在）。

## 考虑过的替代方案

**pkg `--sea` 单文件 exe。** 此表面拒绝：Python SDK note 已将 Windows 列为该路线的非目标，且安装包不需要 VFS 语义——磁盘上的真实树更简单，并保留正常模块解析。

**Electron/Tauri 壳。** v1 拒绝：浏览器已是合格的窗口，壳会引入巨大依赖与自身发布流程，却无功能收益。

**MSI/WiX。** 拒绝：不需要每机器语义；Inno Setup 免费、可脚本、开箱双语。

**要求系统 Node。** 产品决策拒绝：目标受众是最终用户；捆绑 node.exe（约 80 MB）换取完全自治。

**直接部署 apps/cli（`--filter @deepseek-ai/dsh`）。** 实测拒绝：关闭 auto-install-peers 的 legacy deploy 会丢弃所有 peer-only workspace 包，而 CLI 清单不（也不应）携带它们；专用依赖清单镜像了已验证的 python/sdk-runtime 模式。

## 后果

收益：单文件安装程序，无需管理员权限、Node 或仓库知识；幂等启动；重装/卸载后用户数据保留；闭包清单同时明确了 Windows 应用交付什么。代价：安装后约 450 MB 占用（闭包 + node.exe）；lzma2 solid 压缩使 ISCC 步骤较慢；负载是明文源码（无混淆——与 single-exe note 立场一致）；在 python/sdk-runtime 之外多了一份手工维护的闭包清单。
