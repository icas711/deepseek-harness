# Cookbook：构建 Windows 安装包

[English](building-the-windows-installer.md) | 中文

构建 dsh Web 应用的用户级 Windows 安装包：一个 `dsh-setup-<version>-x64.exe`，把部署的应用闭包、捆绑的 `node.exe` 和启动器快捷方式装进 `%LOCALAPPDATA%\Programs`——目标机器无需管理员权限、无需系统 Node、无需仓库检出。设计决策（闭包清单、启动器端口语义、卸载保留 `~/.dsh`）见 [windows-installer Agent Note](../../.agents/notes/implemented/architecture/2026-08-14-windows-installer.md)。

## 1. 检查前置条件

- 一台 Windows x64 机器，仓库已检出且已运行 `pnpm install`。
- 已安装 [Inno Setup 6](https://jrsoftware.org/isinfo.php)（winget 用户级安装位于 `%LOCALAPPDATA%\Programs\Inno Setup 6`，构建脚本会自动发现），或传入 `--iscc <ISCC.exe 路径>`。
- 首次构建需要联网下载官方 `node.exe`（之后的构建复用缓存副本）；或传入 `--node-exe <路径>` 捆绑本地文件。

## 2. 运行构建

```powershell
pnpm run build:windows-installer
```

脚本运行完整流水线：`pnpm run build` → 把 [`apps/windows-runtime/package.json`](../../apps/windows-runtime/package.json) 的闭包部署到 `dist-windows/staging/app`（恢复 peer-only 包并把链接替换为真实字节）→ 暂存 `node.exe` → 启动暂存应用并要求 HTTP 响应（冒烟）→ 从模板填充 `dist-windows/setup.iss` → 用 ISCC 编译。

标志：

| 标志 | 作用 |
|---|---|
| `--skip-build` | 复用现有 `lib/` 产物（跳过 `pnpm run build`） |
| `--skip-smoke` | 跳过暂存启动冒烟测试 |
| `--node-exe <path>` | 捆绑此本地 node.exe 而不是下载 |
| `--node-version <ver>` | 下载此 Node 版本（默认：满足仓库 engines 区间的最新版） |
| `iscc <path>` / `--iscc <path>` | 使用此 ISCC.exe |
| `--dry-run` | 只打印每个命令，不执行 |

**验证：**运行以 `build-windows-installer: product: dist-windows\dsh-setup-<version>-x64.exe (… MB)` 和冒烟行 `smoke passed: http://127.0.0.1:<port>/ → HTTP 200` 结束。失败时错误会指明失败的步骤；`dist-windows/` 下的暂存树与 `%LOCALAPPDATA%\DeepSeek Harness\logs` 下的日志持有细节。

## 3. 安装并检查

```powershell
dist-windows\dsh-setup-<version>-x64.exe            # 交互式向导（EN/RU）
dist-windows\dsh-setup-<version>-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART   # 静默
```

**验证：**`%LOCALAPPDATA%\Programs\DeepSeek Harness` 包含 `app\node_modules\@deepseek-ai\dsh\lib\bin.js`、`node\node.exe`、`launcher\dsh-web.ps1`。开始菜单快捷方式 "DeepSeek Harness" 在 3080 端口隐藏启动服务器并在浏览器打开界面；再次点击只开新标签。"Stop DeepSeek Harness" 停止服务器。API 密钥在首次运行时于 GUI 设置中输入。卸载只移除安装目录——`~/.dsh`（会话、设置、凭据）保留。

## 4. 更改交付内容

交付的插件集合是 [`apps/windows-runtime/package.json`](../../apps/windows-runtime/package.json) 的依赖列表——`dsh` CLI 加上镜像自 `python/sdk-runtime` 的闭包与 workspace 中声明的全部 `@deepseek-ai/*` peer。在那里增删依赖，重跑 `pnpm install --no-frozen-lockfile --filter dsh-windows-installer-pkg`，再重新构建。缺失的包会在发货前被冒烟发现。

## 故障排查

- **3080 端口已被监听**（例如源码树的 `dsh web` 使用默认端口）：启动器会打开浏览器到占用该端口的进程，而不是启动自己的服务器。停掉另一个监听者，或让它在别的端口运行。
- **`ISCC.exe not found`**：安装 Inno Setup 6 或传入 `--iscc`。
- **tsx 下 `spawn EPERM`**：受限沙箱阻止了 esbuild 子进程；在不受限的 shell 中运行构建。
- 生成的 `dist-windows/setup.iss` 是构建产物——编辑模板 `scripts/windows-installer/setup.iss.txt`，绝不要改生成副本。
