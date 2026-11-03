# Kali 验证报告

在真实 Linux 上对 GUI 版与 TUI 版的部署与验证记录。

- **目标机**：Kali GNU/Linux 2026.1，kernel 6.18.12+kali-amd64，x86_64，用户 `kali`
- **验证日期**：2026-09-14
- **源码位置**：`~/ccm`
- **驱动方式**：当时用一台 Kali 虚拟机做 SSH/SFTP 回归。驱动脚本是内部工具，不随仓库分发。

---

## 一、交付产物

| 产物 | 路径（VM 内） | 大小 |
|---|---|---|
| GUI（AppImage） | `~/ccm/dist/Claude Code Manager-1.0.0.AppImage` | 151 MB |
| TUI（单文件 ELF） | `~/ccm/cli/ccm-tui/target/release/ccm` | 987 KB |
| 无头安装驱动 | `~/ccm/dist-installer/ccm-installer.cjs` | 72.8 KB |

## 二、门禁结果

| 检查项 | 本机（Windows） | Kali（Linux） |
|---|---|---|
| TypeScript typecheck | 0 错误 | **TYPECHECK_EXIT=0** |
| JS/TS 单测 | 80 / 80 | **80 / 80** |
| Rust 单测 | —（无工具链） | **12 / 12** |
| electron-vite build | 通过 | 通过 |
| AppImage 打包 | — | **成功** |

## 三、安装管线端到端实测

`detect` 报告 Kali 环境，`plan` 给出计划，`install` 真实执行。

### 3.1 镜像测速（`dry-run`，只读）

```
✓ Official     909ms  28.5 MB
✓ Aliyun       575ms  28.5 MB
✓ Huawei       311ms  28.5 MB
  选定源: huawei
  总耗时 1544ms
```

三路并发测速在真实网络中生效，选择 Huawei（比 official 快约 3 倍）。

### 3.2 Node.js 便携版全流程（`CCM_FORCE_PORTABLE=1`）

```
[installer] Node.js source selected: huawei -> .../node-v22.14.0-linux-x64.tar.xz
[installer] 内置摘要与镜像发布值一致
  · Node.js 8.6%  3.5 MB/s (2.5 MB/28.5 MB)
  · Node.js 50.0% 10.5 MB/s (14.3 MB/28.5 MB)
  · Node.js 100.0% 11.0 MB/s (28.5 MB/28.5 MB)
  · Node.js: verifying (huawei)
[installer] Node.js archive verified: 69b09dba…37ec
  · Node.js: extracting (huawei)
[installer] Node.js 22.14.0 installed to .../runtime/node/v22.14.0/bin
```

逐项验证：

| 机制 | 证据 |
|---|---|
| 并发测速选源 | `huawei` 胜出并记录在日志与进度事件中 |
| 钉死 SHA256 校验 | `69b09dba…37ec` 与 `components.ts` 内置值一致 |
| 镜像摘要交叉核对 | 「内置摘要与镜像发布值一致」（二者独立比对通过） |
| 断点续传/进度节流 | 进度按 ~150ms 节流上报，末块放行至 100% |
| `.part` → 原子 promote | 缓存目录只有正式归档 + `.verified.json`，无残留 `.part` |
| 侧车标记缓存 | 第二次运行 `cache hit (verified-by-marker)`，跳过下载**与**哈希 |
| xz 解压 | `tar -xJf --strip-components=1`，2447 个文件 |
| 解压后可执行性校验 | 受管 `bin/node --version` → `v22.14.0`；`bin/npm --version` → `10.9.2` |

标记文件内容：

```json
{ "sha256": "69b09dba5c8dcb05c4e4273a4340db1005abeafe3927efda2bc5b249e80437ec",
  "size": 29893360, "mtimeMs": 1789383573528 }
```

### 3.3 Claude Code 托管安装（`CCM_FORCE_MANAGED_CLAUDE=1`）

系统已存在 `/usr/local/bin/claude`（Anthropic 原生安装器，2.1.168），强制走托管路径以验证 npm 分支：

```
[installer] npm registry is https://registry.npmjs.org/; using https://registry.npmmirror.com/
            for this install via npm_config_registry (global config untouched)
[installer] managed shim verified at .../runtime/npm-global/bin/claude
[installer] Claude Code 2.1.270 installed to the managed prefix
```

**关键安全属性已实测确认**：

- 用户全局 registry 仍是 `https://registry.npmjs.org/`（未被改写）
- `~/.npmrc` 内容仅 `prefix=/home/kali/.npm-global`，**没有任何本次写入**
- 托管 `claude --version` → `2.1.270 (Claude Code)`
- 新开登录 shell 中 `claude` 解析到托管版本

### 3.4 PATH 语汇

受管目录注入是「替换」而非「追加」——实测修复了早期构建留下的坏状态：

```
BEFORE: .bashrc blocks=2  .zshrc blocks=2  .profile blocks=2
[installer] PATH export written to: /home/kali/.bashrc, ...
[installer] 合并了重复的 PATH 块（早期版本重复追加所致）: ...
AFTER:  .bashrc blocks=1  .zshrc blocks=1  .profile blocks=1
```

用户自己的行（`export PATH="$HOME/.npm-global/bin:..."`、`export EDITOR=vim` 等）完好保留。

## 四、GUI 验证（Xvfb 无头）

`scripts/verify-gui.sh`：起 Xvfb → 启动 AppImage → 等窗口 → 截图。

截图确认渲染的不是空壳，而是**来自管线后端的真实数据**：

- 标题栏 `Claude Manager`，侧边栏 10 项（环境 / API 配置 / 模型管理 / Skills / Agents / Plugins / Hooks / MCP Servers / 通用设置 / 配置文件）
- 环境面板：`Kali GNU/Linux 2026.1`、内核 `6.18.12+kali-amd64`、架构 `x64`
- 工具链：Node `22.22.3`、npm `10.9.8`、Git `2.53.0`、Claude Code `2.1.168`
- 前置条件：xz 解压可用、apt 可用
- 受管 PATH 目录标注「本次新增」

进程态：3 个子进程（Electron 多进程模型已启动），常驻约 216 MB。

## 五、TUI 验证（真实 PTY）

`scripts/verify-tui.sh`：tmux 提供真 TTY → 逐个切换 8 个 tab → `capture-pane -e` 抓取。

| 检查项 | 结果 |
|---|---|
| 8 个 tab 全部渲染 | `Status Install API Models Skills Agents Config Help` |
| 状态页显示真实数据 | CLI `✓ 2.1.270`（托管版）、URL、三个模型映射 |
| **每 tick spawn CLI 已消除** | 6 秒空闲 **0 次 execve**（修复前约 24 次） |
| 两次 `q` 退出确认 | 第一次出提示且进程存活 → 第二次干净退出 |

## 六、本次在 Linux 上发现并修复的缺陷

以下几项**只有真机实跑才能发现**，静态检查与 Windows 本地测试均无法暴露。

| # | 缺陷 | 后果 | 修复 |
|---|---|---|---|
| 1 | `nodeBinDir()` 重复拼接 `NODE_TARBALL_ROOT` | 解压成功后找不到 `node`，安装报「解压后未找到 node」而失败 | 路径改为 `<runtimeRoot>/bin`，并加回归测试锁住不变量 |
| 2 | rc 文件块「存在即跳过」 | 早期构建写入的错误路径永不被纠正，且重复追加 | 改为识别受管块并整段替换；重复块折叠为一个并单独上报 |
| 3 | `String.replace` 只替换首个匹配 | 3 个重复块只清掉 1 个 | 改为整段 span 替换 |
| 4 | `verifyManagedInstall` 用 `which claude` | 系统已装 claude 时无法证明托管安装成功 | 改为直接验证托管 shim 并运行探针 |
| 5 | GNU tar 为剥空名的顶层条目留空目录 | 运行时目录多一个空壳 | 解压后清理空目录 |
| 6 | `mask_key` / 预览 / 错误回显按字节切片 | 中文内容触发 `byte index N is not a char boundary` panic | 新增 `clip()` 字符安全截断，全量替换 |
| 7 | 输入光标混用字节索引与字符操作 | 输入任何中文后再按退格即 panic | `UIState` 新增字符感知的 push/backspace/left/right |
| 8 | `update_key` 整块替换 `env` | 保存 Key 会清掉模型映射等全部自定义变量 | 改为按键合并，保留其余字段 |
| 9 | API 页用掩码值预填输入框 | 直接回车就把掩码写回，真 Key 被毁 | 改用真实值预填 |
| 10 | 每 250ms 重新探测 CLI | 每秒 4 次 spawn `claude --version` | 引入 `Refresh::{Full,Files}`，tick 只重读文件 |
| 11 | 单击 `q` 退出、确认提示不可达 | 误触即退出；提示语与行为矛盾 | 实现真正的两步退出；任何其他键清除待确认状态 |
| 12 | Install 页数字键先于输入态匹配且无确认 | 输入框里打数字被吞并立即触发安装 | 确认流程优先，`1/2/3` 只进入确认态 |
| 13 | `npm config set prefix` 改写全局配置 | 点一下安装就永久改动用户 npm 配置 | 改用 `--prefix` + `npm_config_registry` 环境变量 |
| 14 | GitHub 方式硬编码 Linux 包名 | macOS 上下载 Linux ELF 后报成功 | 按 `std::env::consts::OS` 选择资产，无资产则明确报错 |
| 15 | `install.sh` 指向不存在的仓库 | 源码 checkout 无法自安装，远程路径必然 404 | 优先用 `target/release/ccm`，仓库名可用 `CCM_REPO` 覆盖 |

## 七、环境相关备注

- **Electron 下载被限速**：从 Kali 直连 GitHub 下载 124 MB 的 Electron 从 368 KB/s 掉到 22 KB/s 并最终超时。改用 `ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/` 后实测 **7.4 MB/s**，构建在秒级完成。这是构建期配置，不影响应用本身。
- **apt 的 Kali 镜像元数据过期**：`cargo 1.94.1` 在阿里云镜像上 404，改用 rustup 安装 **Rust 1.98.1**。
- **无头 GUI 限制**：VM 无 X 会话，Electron 无法按常规方式启动。验证通过 Xvfb 完成；用户若要在 VM 里真正交互使用，需启用 XFCE 会话（lightdm + xfce 已安装）或经 `x11vnc` 接入。

## 八、1.2.0：首次向导的样式表缺陷

### 现象

测试用户装完 **1.0.0** 后启动，看到的是这样一屏：窗口背景是深色的
（`#0B0C10`，即 `--color-bg`），文字是浅色的（`#E9ECF3`），但**六个步骤名竖着排成
一列、标题和正文一个字号、按钮退化成普通文本** —— 也就是说 `body` 上的样式生效
了，而按类名挂的样式全都没生效。

（判断依据是截图取色，不是肉眼：窗口内容区 `#0B0C10`，正文 `#E9ECF3`。所以
"CSS 完全没加载" 这个直觉是错的。）

### 定位

把两个安装包里的 `app.asar` 解开对比（`/out/renderer/assets/index-*.css`）：

| 层 | 1.0.0 / 1.1.0 里的内容 |
|---|---|
| Monaco | 有 |
| `@layer theme`（设计 token） | 有，且已被 tree-shake 到只剩用到的变量 |
| `@layer base`（preflight） | 有 |
| `@layer components, utilities;` | **只有这行声明，一层空的** |

手写的设计系统（`.page` / `.card` / `.btn-*` …）都在，所以 16 个已改造的面板显示
正常；而当时的 `setup-wizard/` 是**唯一**一个完全用 Tailwind 工具类写的界面，于是
只有它塌了。`@theme` 被 tree-shake 说明 Tailwind 插件确实跑了，只是**内容扫描
一个候选都没扫到**。

排除过的环境因素（在本机 Linux 上逐一复现，全部正常出工具类）：

- 源码树没有 `.git`（扫描根回退）
- 缺 `@tailwindcss/oxide` 原生绑定、走 WASI 回退
- 源码路径含空格 / 中文
- 没有 `@source` 显式声明

原始构建机（VM）已不可用，无法复现触发条件，因此**不再猜**，改成让这个失败模式
无法再产生后果。

### 修复

1. **向导不再依赖工具类**：七个 `setup-wizard/` 组件全部改用设计系统，新增
   `.wizard-*`（步骤条、卡片、选项卡、依赖行、hero）。现在渲染层引用的类名里
   一个 Tailwind 工具类都没有。
2. **`global.css` 显式声明扫描根**（`@source "../"`），不再依赖构建机上是否存在
   git 根。
3. **新增构建门禁 `scripts/check-css.mjs`**，挂在每个 `package:*` 脚本上：收集渲染
   层代码里出现的类名，逐一确认打包进 `out/renderer/assets/index-*.css` 的样式表里
   真的定义了它，缺一个就**构建失败**。这正是当初能拦住那个安装包的检查。
4. 版本号升到 **1.2.0**，与坏包区分开。

### 验证（WSL kali-linux 发行版，非 VM）

```
npm run package:deb      # electron-vite build → check:css → electron-builder
  check-css: index-BTCvsQU0.css (233 kB) defines all 12 required selectors
             and 122/122 class tokens used by the renderer
```

Windows 与 Linux 两次构建产出**同一个 CSS 文件名（同内容）**：`index-BTCvsQU0.css`。

安装包内实测（`dpkg-deb -x` + 解 asar）：

```
css = /out/renderer/assets/index-BTCvsQU0.css   238686 bytes
  ok  wizard shell / stepper / option card / hero / footer
  ok  utility layer present
  ok  design tokens / panel shell / body background rule
  ok  index.html links a stylesheet that exists
```

`apt install ./claude-code-manager_1.2.0_amd64.deb` → Xvfb 下逐个点击走完六步，
每步截图（`screenshots/1-欢迎.png` … `7-主界面.png`）。六步全部按设计渲染：步骤条
（已完成打勾、当前高亮）、依赖徽章、选项卡选中态、输入框 + 显示按钮、模型分层色点、
配置摘要，最后进入主面板。全程 stderr 无输出，进程常驻。

### 备注

- **WSL 更适合当构建机**：`wsl -d kali-linux -u kali` 里装 node/npm/fakeroot/dpkg/
  xvfb/xdotool 即可跑完整打包与截图流程，比 VM 稳定（VM 会掉线）。`ELECTRON_MIRROR`
  与 `ELECTRON_BUILDER_BINARIES_MIRROR` 指向 npmmirror 后下载是分钟级。
- **WSL 会把 Windows 的 PATH 带进发行版**，于是 `claude` 会被识别成"已安装"
  （`/mnt/c/Users/.../npm/claude`），首启向导因此不出现。截图验证时要用
  `env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` 起应用，
  才是真实 Linux 的初始状态。
- **一次 `wsl.exe` 调用结束时，它启动的进程会被回收**：`nohup ... &` 起的应用在下一次
  调用里已经不存在了。所以"启动 → 点击 → 截图"必须写在同一个脚本里，否则会误判成
  应用崩溃。

## 九、1.2.1：「一键安装缺失依赖」永远不会弹密码框

### 现象

用户装完 1.2.0，在向导第二步看到 npm 缺失，点「一键安装缺失依赖（1 项）」，
界面上出现的是这段红字，没有任何密码框：

```
sudo: 读取密码需要一终端；请使用 -S 选项以从标准输入进行读取，
      或者配置一个 askpass 助手程序
sudo: 需要密码
curl: Failed writing body
```

而按钮下面写的正是「安装过程会弹出密码框，请输入系统密码授权安装」。

### 原因

`deps:install-missing` 用 `spawn(cmd, { shell: true, stdio: ['ignore','pipe','pipe'] })`
在主进程里跑 `sudo apt …`。**sudo 只从终端读密码**，而这条链路里根本没有终端：
stdout/stderr 是管道，stdin 是 `ignore`。所以密码框不可能出现——UI 承诺了一件
架构上做不到的事。

同一段代码还有第二个问题：npm 缺失时它先跑
`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -`，
往用户的 apt 源里塞一个第三方仓库；这个 setup 脚本同样需要终端，于是第一条
`curl` 就因为拿不到 TTY 而中断（截图里的 `curl: Failed writing body`）。

### 修复

1. **把活交给终端窗口**。新增 `src/main/utils/terminal.ts`：按优先级找
   `x-terminal-emulator / xfce4-terminal / qterminal / konsole / alacritty /
   mate-terminal / gnome-terminal / xterm`，detached 启动，把脚本路径作为**唯一
   一个参数**传进去。
   只传一个 token 是刻意的：这些模拟器对 `-e` 的解析方式分成三派（有的 shell 拆分
   单字符串、有的收 argv、gnome-terminal 要 `--`），一个不带参数的路径三派都能跑，
   也就不存在引号被吃掉的问题。
2. **脚本落盘再执行**。`writeTempScript()` 写到 `~/.local/share/claude-code-manager/scripts/`
   而不是 `/tmp`：脚本是被 exec 的（本身就是可执行文件），`/tmp` 挂 `noexec` 的机器
   会直接 "Permission denied"；而这个目录本来就在跑解压出来的二进制，一定是 exec 的。
   权限 0700/0755，因为它可能以 root 身份跑 apt。
3. **脚本自己决定窗口什么时候关**。模拟器没有共同的 hold 参数，所以脚本结尾
   `read -n 1` 等一次按键，apt 的输出能留在屏幕上。
4. **语义改成"我不知道装没装完"**。IPC 从 `{success}` 改成
   `{success, mode: 'terminal'|'nothing-to-do'|'manual', command, terminal}`：
   终端一打开就返回，安装过程和这个调用没有关系，所以不能再报「安装完成！」。
   界面改成蓝色提示条「已打开终端（x-terminal-emulator）→ 去那里输入密码 → 回来点
   『重新检测』」，并把完整命令用 `.code-block` 显示出来，终端没弹出时可以自己粘贴。
5. **npm 改用发行版自带的**（`sudo apt-get update && sudo apt-get install -y npm`）。
   Kali 自带 npm 11（node 24），不需要第三方源；命令短到用户能看懂、能自己重跑。
6. `installer:open-terminal`（打开 Claude Code）也改用同一个终端助手，去掉了一份
   重复的模拟器表。

### 验证

`tests/dependency-install.test.mjs`（新增 14 项，Linux 上 96/96 全过、无 skip）：

- 命令只装缺的包、去重、排序；**断言命令里既没有 `nodesource` 也没有 `|`**
- 生成的脚本能过 `bash -n`
- 脚本必须以 `read -n 1 … 按任意键关闭此窗口` 结尾
- 每个模拟器拿到的 argv 恰好是 `[开关, 脚本路径]` 两项，且不含 `bash`/`-lc`
- `writeTempScript` 产出的文件是 0755 且内容一致
- 在 PATH 前面放一个假的 `x-terminal-emulator` 记录自己的 argv，断言真实启动路径
  传进去的就是 `-e <脚本路径>`

端到端（WSL，把 `/usr/bin/npm` 临时挪走制造缺失）：

```
--- what got written ---
-rwxr-xr-x  install-deps-11438.sh
=== 内容 ===
if sudo apt-get update && sudo apt-get install -y npm; then
  echo "安装完成。请回到 Claude Code Manager 窗口，点「重新检测」。"
...
read -n 1 -s -r -p "按任意键关闭此窗口..."
```

截图确认：**终端窗口真的弹出来了**，里面跑完 apt 并停在提示语上；应用侧同时出现
蓝色提示条「已打开终端（x-terminal-emulator）」。

> 注：WSL 的 kali 用户是 NOPASSWD sudo，所以截图里没出现密码提示；在真实 Kali 上
> 这一步就是 sudo 的 `[sudo] password for kali:` —— 它出现在终端里，这正是修复点。

## 十、1.2.2：桌面图标时有时无

### 现象

升级到 1.2.1 之后桌面上没有图标了（1.1.0 时是有的）。

### 原因

`postinst` 判断"该给谁建图标"只看两个变量：

```bash
[ -n "${DEBUSER:-}${SUDO_USER:-}" ] || exit 0
```

- `SUDO_USER` 是 sudo 设的，`sudo apt install ./x.deb`（说明书推荐的方式）会有；
- **`DEBUSER` 根本不是 apt 的标准变量** —— 注释里写的"apt/dpkg 会设置"是错的。

于是只要 apt 不是在 sudo 之下启动的，脚本就**静默退出**：图形前端双击安装、
root shell 里 `apt install`、`su -` 之后安装、脚本化部署、`dpkg -i` —— 全都没有
图标，而且没有任何提示，看起来就像包坏了。

另外还有一头：应用里的「添加到桌面」按钮被放在了 `claudeReady && !running`
区块里面，也就是**必须先装好 Claude Code 才看得到这个按钮**。用户在向导第二步
卡着的时候，桌面图标既没自动建、也没法手动加。

### 修复

1. **postinst 不再依赖 SUDO_USER**（`resources/linux/postinst`）：
   优先用 `DEBUSER`/`SUDO_USER`；没有就退到"当前登录的用户"（`loginctl list-users`）；
   再没有就退到 `/etc/passwd` 里所有 UID ≥ 1000 的人类账号。共享机器上不会因此
   到处撒图标 —— 只有前面都没命中才会走到最后一档。
2. **桌面目录直接读用户的 `~/.config/user-dirs.dirs`**，不再 `su - user -c xdg-user-dir`：
   后者需要可用的 `su`/PAM 会话和已安装的 xdg-user-dirs，而配置文件里就写着答案。
   仍然保留 `~/Desktop` 与 `~/桌面` 两个兜底。
3. **写日志** `/var/log/claude-code-manager-postinst.log`，并在 `apt install` 的输出里
   回显一行 `桌面图标已创建：<路径>` —— 下次再出问题不用猜。
4. **应用侧兜底**（`src/main/services/desktop-shortcut.ts`）：首次启动时，如果图标不存在
   就自己建一个，然后在应用状态里记 `desktopShortcutEnsured`。这条路径跟包怎么装进去的
   完全无关，所以是这件事真正的兜底。记标志位是为了尊重"我就是不想要图标"的人 ——
   手动删掉之后不会再被重建；「添加到桌面」按钮仍然可以随时加回来。
   顺带把 `desktopDir()`/创建逻辑从 IPC 层抽成服务，`installer:create-desktop-shortcut`
   与启动兜底共用一份。
5. **按钮挪到页面右上角**，不再藏在「Claude Code 已就绪」里面。

### 验证（WSL，三条安装路径）

| 场景 | 结果 |
|---|---|
| A `sudo apt install ./x.deb`（普通用户升级） | ✅ 图标创建，postinst 回显路径 |
| B root shell 安装（`SUDO_USER`/`DEBUSER` **都没有**） | ✅ 退到人类账号，图标归 `kali:kali` |
| C 删掉图标 + 清掉标志位后启动应用 | ✅ 应用重建图标，日志 `[desktop] created the desktop shortcut on first run`，标志位写回 `true` |

```
=== B. root shell install ===
SUDO_USER=unset DEBUSER=unset (this is the point)
claude-code-manager: 桌面图标已创建：/home/kali/桌面/claude-code-manager.desktop
  after: -rwxr-xr-x kali kali /home/kali/桌面/claude-code-manager.desktop

=== C. the app creates a missing icon on first run ===
  before launch:  icon: (missing)
  after launch:   icon: -rwxr-xr-x kali kali /home/kali/桌面/claude-code-manager.desktop
  app logged:     [desktop] created the desktop shortcut on first run
```

B 就是原来坏掉的那条路径。

## 十一、1.3.0：交互重做（向导 / 层级映射 / 配置检测 / 重启）

### 需求先验证，结论如下

| 需求 | 验证结果 |
|---|---|
| 去掉开头引导，直接进主界面 + 站内引导 | 现状确实是**阻塞式向导**：`MainLayout` 在 `!wizardCompleted && !claude.installed` 时整个窗口交给 `SetupWizard`，六步走完才能看到界面。Windows 版是 `Onboarding.tsx`：**浮层**盖在主界面上、可跳过、每步要么做一件事要么跳到对应页面。照后者重做。 |
| Haiku/Sonnet/Opus 三档各自选模型 | **目前只能看不能改**：`ModelManager` 把 `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` 显示出来，但界面上写着"在「API 配置」中可修改"——API 面板里根本没有这个控件（它只写 `ANTHROPIC_PROVIDER/AUTH_TOKEN/BASE_URL/SELECTED_MODELS`）。向导里那个 `modelMappings` 字段更是死代码，从未落盘。三个变量确实存在：在 Claude Code 2.1.268 的二进制里 `findstr` 到 `ANTHROPIC_DEFAULT_HAIKU_MODEL`、`_SONNET_MODEL`、`_OPUS_MODEL` 全部命中。 |
| 检测已有配置 | 面板本来就直读 `~/.claude/settings.json`，所以**那个文件里的内容不用"导入"**。真正的缺口是文件之外的东西：写在 `~/.bashrc` 里的 `ANTHROPIC_AUTH_TOKEN` 会盖掉 settings.json，而 UI 里完全看不到 —— 用户会觉得"我明明配了 Key 怎么不生效"。 |
| 装完自动重启 | **技术上不是必需**：`refreshProcessPath()` 在装 node/claude 之后就地把新 PATH 合进 `process.env`（`installer/installers/node.ts:303`、`claude.ts:95,118`），所以面板立刻就能发现新版本。真正需要新进程的是"已经打开的终端"。所以做成**倒计时自动重启 + 可取消**，而不是立刻把窗口抽走。 |

### 落实

1. **引导改成浮层**（`components/onboarding/Onboarding.tsx`）：六步、圆点进度、可 Esc / 跳过；两步做实事（检测环境、跳到对应面板），其余只解释。`MainLayout` 不再有 `showWizard` 分支，界面永远是界面。
   旧状态兼容：老用户文件里是 `wizardCompleted: true`，视为"已引导"，升级后不会再被弹一次；同时写入新的 `onboardingCompleted`。
   随时重看：「通用设置」→「重新打开向导」。
2. **向导里唯一不可替代的东西搬走了**：系统依赖检查从向导第二步移到「环境」面板的「系统依赖」卡片（`DependenciesCard.tsx`）。其余（装 CLI、API、模型）本来就在面板里做得更好。
   `components/setup-wizard/` 七个文件删除；`.wizard-*` 样式一并清掉，换成 `.guide-*` / `.dep-*` / `.btn-block` / `.btn-lg` / `.form-note`。
3. **层级映射可编辑**（`ModelManager.tsx` 重写）：每档一个输入框 + `datalist`（可直接选检测到的模型，也可手填 ID），可设默认层级，可「按名字自动匹配」（只在名字明确时填，含糊的留给用户），三个按钮：保存 / 自动匹配 / 全部清空。
   写入走新的 `config:write-tier-models`，与通用写入分开是**因为清空一档必须删键**：通用的 `config:write` 是深合并，留下 `ANTHROPIC_DEFAULT_OPUS_MODEL: ""` 会让 Claude Code 拿空模型名而不是回退到默认值。
4. **已有配置扫描**（`main/services/config-scan.ts` + `ExistingConfigCard.tsx`）：报告五个已知文件的存在/可解析/摘要、CLI 安装情况（复用 installer 的 detectSystem）、skills/agents/plugins 数量、settings.json 里配了什么（Key 打码，只显示 `sk-…9f2c`），以及 **shell 启动文件里的 `ANTHROPIC_*` 导出**，后者可以一键「复制到 settings.json」——只写 settings.json，不动 rc 文件，值在写入时重新从文件读（不经过渲染层）。
5. **装完重启**（`RestartPrompt.tsx` + `app:relaunch`）：安装成功且 PATH 变化后，出现 12 秒倒计时提示条，可「立即重启」或「稍后自己重启」；同时保留"已经打开的终端不会自动更新"的说明与本次改写的 rc 文件名。
6. 首次启动时若桌面图标缺失，现在由应用自己补（见第十节），与环境面板右上角的「添加到桌面」并用。

### 验证

- 门禁：`tsc` 0 错误、`npm test` 96 项全过、`check:css` 12/12 必需选择器 + 96/96 类名。
  **这次 `check:css` 真的拦下了一个错误**：同步到 WSL 的 `tar` 只覆盖不删除，源码树里还留着已删掉的 `setup-wizard/`，于是 Linux 构建报「96/136 类名缺失」。同步脚本改成先删目录再解包，重建即通过。
- Linux 实机（WSL + 装好的 1.3.0 deb，`scripts/capture-guide.sh`）：主界面先出来、引导浮层压在上面（`1-向导-欢迎`）；点「开始」→ 检测执行并前进（`2-向导-环境检测`）；点「前往安装」→ 引导关闭、落到「环境」面板（`4-环境面板`），面板上是 安装计划 + **系统依赖**（全部已安装）；`6-模型管理` 显示三档可编辑输入框、默认层级标记、「0 / 3 个层级已映射」。
- 采集脚本本身也修了一个坑：鼠标划过按钮会改变 hover 样式，两张同一屏的截图 hash 不同 → 误判为"已前进"。现在每次截图前把指针挪到角落。

## 十二、1.3.1：对 1.3.0 的复查

### 机械检查（先跑，省得靠眼睛）

| 检查 | 结果 |
|---|---|
| preload 暴露的 channel ↔ 主进程 `ipcMain.handle` | **59 / 59 完全对齐**，没有"点了没反应"的通道 |
| 渲染层调用的 `electronAPI.*` ↔ preload 实际暴露 | 52 个调用全部存在，无 `TypeError` 风险 |
| 引用已删除的东西（`SetupWizard` / `.wizard-*` / `capture-wizard` / `modelMappings`） | 源码 0 处；只剩历史文档里的叙述 |
| 渲染层组件是否有人 import | 0 个孤儿文件 |

暴露但已无人调用（历史遗留 IPC 面，未删）：`cliInstall`、`safeStorage*`、`installerApplyShellPath`、`installerCacheInfo`、`installerPathStatus`、`installerRemoveShellPath`、`installerTasks`、`ping`。

### 复查发现并修掉的缺陷

**1. 「自动重启」其实会把程序杀掉（最严重）**

`app.relaunch()` 之后调用的是 `app.exit(0)`。Electron 42 上这条路径触发：

```
FATAL:electron/shell/browser/electron_browser_main_parts.cc:535] Failed to shutdown.
Trace/breakpoint trap
```

进程以 SIGTRAP 死掉、**没有重启**——用户看到的就是"装完程序自己崩了"。

发现方式：真装一次 Claude Code（`一键安装`），观察 PID。第一次 `pid_before=1120` → 12 秒后进程消失且没有新进程；日志最后一行正是那句 FATAL。

修复：改成 `app.quit()`（走正常关闭流程），并留一个 4 秒后的 `app.exit(0)` 兜底，防止某个东西不肯放手。复测：`pid_before=3759 → pid_after=4302`，日志无 FATAL。

**2. `~/.claude` 不存在时所有写盘都失败**

Claude Code 首次运行才创建 `~/.claude`。新机器上没有这个目录，于是 `config:write`、`config:write-tier-models`、`config:write-local` 全部 ENOENT —— 而这两个面板（API 配置、模型管理）恰好是新用户最先打开的。

修复：写入前 `mkdirSync(CLAUDE_DIR, { recursive: true })`。顺带把写盘逻辑从 IPC 层抽到 `services/settings-write.ts`，因为这类问题用 UI 点击很难稳定复现（我试了三轮，坐标和输入焦点都在捣乱），抽出来之后可以直接写单元测试。

**3. 引导的检测步骤看不到结果**

点「开始检测」后 `await detect()` 紧接着就 `next()` 跳到下一步，而结果那行字渲染在检测步骤上 —— 也就是**永远不会被看到**。现在检测完停在原地显示「系统依赖齐全 / 检测到 N 项缺失」，按钮变成「下一步」。

**4. 「按名字自动匹配」会把未保存的修改标记清掉**

`setDirty(filled > 0)`：先手动改了一档（dirty=true），再点自动匹配而一个都没匹配上（filled=0）→ dirty 被重置为 false，**保存按钮变灰，刚才的修改存不下去了**。改成只在有填写时置位、绝不清除。

**5. 插件数量统计的是目录项，不是插件**

`config-scan` 用 `readdirSync(~/.claude/plugins)` 计数，而那个目录里还放着登记表、marketplace 缓存、克隆下来的仓库 —— 一个插件都没有也会显示"3 plugins"。改成读 `installed_plugins.json` 里真正登记的条目数。

**6. shell rc 里的「命令生成」变量会被当成密钥写进去**

`export ANTHROPIC_AUTH_TOKEN=$(pass show anthropic)` 这种行的字面值是命令，不是密钥。原来的实现会把 `$(pass show anthropic)` 原样写进 settings.json 当作 API Key。现在这类行仍然被**报告**（标为「命令生成，未读取」），但**不再被采纳**，按钮也只提交静态值。

**7. 其余加固**

- `app.relaunch()` 在 AppImage 下需要指向 `$APPIMAGE`，否则新进程会去 exec 已经卸载的 squashfs 里的路径。
- 依赖安装按钮加了 in-flight 守卫，连点不会开出两个终端。
- `writeTempScript` 权限从 0755 收到 **0700**（可能以 root 跑 apt，别人不需要读），并且当 `$HOME` 含空格时改写到 `$XDG_RUNTIME_DIR` —— 有些终端模拟器会 shell 拆分 `-e` 参数，带空格的路径会被切成两半。
- 删掉 `appStore` 里已经没人用的 `activePanel`。

### 发现但**没有**改的（记录在案）

- **API 面板清空 Key 后会写入空字符串**：`config:write` 是深合并，`ANTHROPIC_AUTH_TOKEN: ""` 会留在文件里。Claude Code 拿到空 token 的行为没有实测过，改成"清空即删键"是行为变更，需要单独确认，这轮没动。
- **`settings.json` 损坏时**保存会直接报 JSON 解析错误（扫描卡片会提示"解析失败"，但没有"备份并重建"的入口）。
- **引导浮层没有焦点陷阱**：Tab 能跑到后面的界面上。有 `role="dialog" aria-modal` 和 Esc 关闭，但严格来说不完整。
- **历史遗留 IPC 面**（上表那 8 个）没删，删它们属于接口收缩，等确认没有外部调用再说。

### 验证

- Linux：**111 / 111 测试通过、0 skip**（新增 `settings-write` 9 项，覆盖"没有 ~/.claude 也能写""清空一级必须删键""不写不属于自己的变量"）。
- Windows：96 项（HOME 重定向类测试在 Windows 上跳过——`os.homedir()` 读的是 `USERPROFILE`）。
- 真机重跑：装一次 Claude Code → 倒计时提示出现（截图里是「安装完成，2 秒后自动重启」）→ 自动重启后 PID 变化且无 FATAL；画面同时证实了自动打开的终端里 Claude Code 已经跑起来，以及桌面图标"需要手动授权"的提示按预期出现。

## 十三、1.3.2：桌面图标又没了

### 复现不了，但找到了一个自己埋的坑

用户反馈 1.3.1 装完桌面没有图标。三条安装路径在本机 WSL 上重跑**全部正常**（`sudo apt install` / root shell / 应用首次启动补建），包括带 `user-dirs.dirs` 的真实桌面配置——原来只测过没有该文件的兜底路径。

于是回头审"桌面目录是怎么选出来的"，发现了这个：

```ts
// 旧代码
for (const name of ['Desktop', '桌面']) {
  if (existsSync(join(homedir(), name))) return join(homedir(), name)
}
return join(homedir(), 'Desktop')   // ← 凭空造一个
```

两个问题叠在一起：

1. **顺序**：`Desktop` 排在 `桌面` 前面。中文 Kali 的桌面是 `~/桌面`；只要 `~/Desktop` 也存在（哪怕是空的），图标就写进那个人根本看不到的目录。
2. **凭空兜底**：两个都不存在时返回 `~/Desktop`，而 `createShortcut()` 会 `mkdirSync` 把它建出来。**于是"写到了一个会话不显示的目录"和"写入成功"在程序里长得一模一样** —— 面板显示「桌面图标已就绪」，用户看着空桌面。更糟的是从此 `~/Desktop` 存在了，以后每次都优先选它。

`ensureShortcutOnce` 还有第二层放大：创建失败时**照样**写 `desktopShortcutEnsured` 标志位（当时的理由是"不要在每次启动重试失败路径"）。于是失败一次就永远不再尝试。

### 修复

- **不再凭空造目录**。规则写成一个纯函数 `chooseDesktopDir()` 并加了测试：优先 `xdg-user-dir` → 解析 `user-dirs.dirs` → `$XDG_DESKTOP_DIR`；都不给答案时，只有一个标准目录就用它，两个都在就**按 locale 决定**（`zh*` → `桌面`，否则 `Desktop`），一个都没有就返回 null。
- **没答案就说不出来**：应用侧面板显示「没找到桌面目录」，postinst 写日志说明它找过哪些位置；不再有"看起来成功"的假象。
- **只有成功才写标志位**：失败下次启动还会再试（面板按钮本来也一直在）。
- **`已有配置` 卡片新增一行「桌面图标」**，直接显示图标的完整路径 —— 下次再出这种问题，用户自己就能看出"写到哪去了"。
- postinst 用同一套规则（locale 决胜负、不猜、失败写日志）。

### 顺带炸出来的打包坑

改完 postinst 后 `electron-builder` 直接构建失败：

```
Error: Macro HOME is not defined
    at FpmTarget.writeConfigFile
```

electron-builder 会把维护者脚本**过一遍 `${宏}` 模板替换**，遇到 `${HOME}` 这种它不认识的宏就抛错。所以 postinst/postrm 里**不能出现任何 `${名字}` 形式**（`${1:-configure}`、`${DEBUSER:-}`、`${#existing[@]}` 这类带 `:-`/`#`/`[` 的没事，构建一直能过就是证明）。

修法：用字符类匹配 `$[{]HOME[}]`，字面量里不再出现 `${HOME}`，注释里也不写。这条现在有机械检查兜着：

```
Select-String -Path resources\linux\postinst -Pattern '\$\{[A-Za-z_][A-Za-z0-9_]*\}'
```

### 验证

postinst 五个场景（真装真跑，逐个 `apt install --reinstall`）：

| 场景 | 期望 | 结果 |
|---|---|---|
| `user-dirs.dirs` 指向 `桌面`，且两个目录都在 | `桌面` | ✅ 只在 `桌面` |
| 无配置、两个目录都在、`LANG=zh_CN.UTF-8` | `桌面` | ✅ 只在 `桌面` |
| 无配置、两个目录都在、`LANG=C` | `Desktop` | ✅ 只在 `Desktop` |
| 无配置、只有 `桌面` | `桌面` | ✅ |
| 两个目录都没有 | 不建、不猜、写日志 | ✅ `~/Desktop` 没有被创建，日志有 2 行说明 |

应用侧规则由新增的 `tests/desktop-shortcut.test.mjs`（14 项）覆盖，含"两个都在时按 locale 决胜负""什么都不给时返回 null 而不是 `~/Desktop`"。Linux 全套 **121 / 121 通过**。

## 十四、1.3.3：图标建出来了，桌面就是不显示

### 用户给的数据（决定性）

```
$ cat /var/log/claude-code-manager-postinst.log
2026-09-15 00:56:49 created /home/kali/桌面/claude-code-manager.desktop for kali

$ ls -la ~/Desktop ~/桌面
/home/kali/桌面:
-rwxr-xr-x  1 kali kali 289  9月15日 00:56 claude-code-manager.desktop
/home/kali/Desktop:
（空，目录本身的 mtime 是 9月14日 13:08）

$ cat ~/.config/user-dirs.dirs
XDG_DESKTOP_DIR="$HOME/桌面"
```

三条信息拼起来就清楚了：

1. **图标建好了，位置也对**（配置说 `桌面`，文件就在 `桌面`）；
2. `~/Desktop` 也存在但是空的，而且**是 9月14日 13:08 被造出来的** —— 那正是 1.2.x「凭空兜底」的产物；
3. 用户桌面上只有 主文件夹 / 文件系统 / 回收站 三个特殊图标 —— **说明 xfdesktop 正在显示的是一个空目录**，只可能是 `~/Desktop`。

即：**会话显示 `~/Desktop`，而配置和安装脚本写的是 `~/桌面`**。桌面环境只在**登录时**读一次 `user-dirs.dirs`；之后配置被改过（换语言、xdg-user-dirs-update 重新生成等），运行中的会话不会跟着变。9月14 12:47 那张截图里能看到图标，是因为当时两边还是同一个目录。

### 修复：不再猜"会话显示哪个"

既然从应用里无法判断会话正在显示哪个目录，那就**给每个存在的桌面目录都放一份**（`desktopDirs()`）：配置指向的那个排在最前，其余存在的标准目录依次跟上；一个都没有就仍然什么都不做（不发明目录）。

代价是可能多一个用户看不到的小文件；收益是**无论桌面显示哪个，图标都在里面**。`postrm` 本来就遍历所有桌面目录删除，两边对称。

- `shortcutStatus()` 现在返回 `locations[]`：每个目录 + 是否已有图标。
- `createShortcut()` 写入全部候选，逐条 `gio set metadata::trusted`。
- postinst 同样改成 `desktop_dirs_for()` 输出多行、循环写入。
- 「已有配置」卡片把那几行路径直接列出来，两个目录时会额外提示"注销重登即可"。
- 安装说明新增「桌面图标没出现怎么办」：先 `ls` 两个路径确认文件在不在、用 `touch` 判断会话显示哪个、以及注销重登/两边都放的两个办法。

### 验证

postinst 五场景（真装真跑）：

| 场景 | 结果 |
|---|---|
| 配置指向 `桌面`，两个目录都在 | ✅ 两个都写入 |
| 无配置、两个都在、`LANG=zh_CN.UTF-8` | ✅ 两个都写入 |
| 无配置、两个都在、`LANG=C` | ✅ 两个都写入 |
| 只有 `桌面` | ✅ 只写 `桌面` |
| 两个都没有 | ✅ 不建、不猜，日志 4 行说明 |

应用侧新增 4 项测试（"列出两个目录且配置排前""跳过不存在的配置目录""一个都没有时返回空""createShortcut 两个都写"），Linux 全套 **125 / 125 通过**。

## 十五、1.3.3 的包在用户机器上解压失败（坏的是拷贝件，不是构建件）

### 现象

用户在自己的 Kali 上解压 `~/Downloads/CCM-Kali-1.3.3.zip`，7-Zip 拒绝：

```
ERRORS:   Headers Error / Unconfirmed start of archive
WARNINGS: There are data after the end of archive
          Physical Size = 122362760    Tail Size = 972
```

### 排查：先证明母版是好的

不能一看到"包坏了"就去重打包 —— 先确定坏在哪一环。三条独立证据都指向**母版完好**：

| 检查 | 结果 |
|---|---|
| 工作区母版 zip 尾部字节 | `trailing = 0`（用户那份多出 972 字节） |
| Windows 自带 `Expand-Archive` 解压母版 | ✅ 成功（独立于我们的代码） |
| 12 个条目的 CRC32 vs 用户 7-Zip 打印的 CRC | **12/12 完全一致** → 两边内部是同一份字节 |
| 工作区 `CCM-Kali-1.3.3/` 里的 deb vs zip 内的 deb | SHA256 相同（`f22e3ea0…`）→ 分发包与构建产物同源 |

关键推理：用户 7-Zip 报的 `Physical Size = 122362760` 是 `cdOffset`（中央目录起点），
说明它**完整读完了归档**，只是归档后面还跟着 972 字节不属于它的数据。
母版大小 122363732 = 122362760 + 972，`declaredEnd == size`。

**结论：损坏发生在"从工作区搬到 Kali"这一段**，构建和打包都没问题。
另外 7 个 zip 复验全部 `trailing = 0` 且条目全 PASS，排除流水线通病。

### 真正的缺口：交付件从来没有完整性门禁

损坏本身是传输问题，但**我们能做的两件事一件都没做**：

1. 打完包不校验就发出去 —— 一个被截断或被追加数据的 zip，我们这边毫无感知；
2. 交付时不给校验值 —— 用户拿到坏文件只能靠"解压失败"发现，而**有些解压器对
   尾部垃圾是静默容忍的**，那就会装出一个半截的 deb，最后表现成"你们软件是坏的"。

顺带发现：组包流程是手工的（WSL 里构建 → 拷出来 → 拖进文件夹 → 右键压缩），
这几步里每一步都能悄悄丢字节或追加字节。

### 修复

**1. `scripts/check-package.mjs` —— 交付包校验门禁**（新增）

逐项检查并 exit 非 0：局部文件头可定位、中央目录与 EOCD 对得上、**EOCD 之后没有
多余字节**（正是本次故障）、每个条目 CRC32 与解压长度都对得上、`.deb` 条目的 `ar`
容器成员可解。

CRC 实现自带已知向量自检（`123456789` → `cbf43926`）—— 这个自检不是装饰：
第一版脚本补码顺序写错，12 个条目**全部**报 CRC 不匹配，差点把好包判成坏包。

**2. `scripts/make-delivery.mjs` —— 一步组包并校验**（新增）

组包不再是手工步骤：检查内容目录齐全（含"1.3.4 的目录里还放着 1.3.3 的 deb"
这种版本错配）→ `zip -r -X` → 校验 → **校验不过就删掉 zip**（让它不可能被误发）
→ 写 `CCM-Kali-<版本>.SHA256SUMS.txt`。已存在同名 zip 时拒绝覆盖。

**3. 交付时随包给校验值**

`node scripts/check-package.mjs --write-sums <zip>...` 为每个包写一份
`<包名>.SHA256SUMS.txt`。之前试过所有包共用一个 `SHA256SUMS.txt`，
结果一次校验 7 个包时**互相覆盖，只剩最后一个条目** —— 那种"校验文件本身是错的"
比没有更坏，已改成每包一份。

**4. 安装说明新增「解压时报错 / 压缩包打不开」**

教用户用 `sha256sum -c` 和文件大小区分"包坏了"与"没传完"，并明确：
坏的是拷贝件，源文件没受影响，**不要用断点续传接着传坏文件**（那会把损坏固化）。

### 验证

校验门禁对三种损坏模式都能拦下（用母版现场合成的样本，测完即删）：

| 样本 | 结果 |
|---|---|
| 尾部追加 972 字节（复现用户症状） | ✅ FAIL：`972 bytes of data after the end of the archive` |
| 截断到 97%（传输中断） | ✅ FAIL：`no end-of-central-directory record found` |
| 中间翻转 1 字节（静默位损坏） | ✅ FAIL：`screenshots/5-环境面板.png: CRC mismatch` |

七个现存交付包全部 PASS 并各自生成校验文件；Windows 门禁 `tsc --noEmit` 0 错误、
106 项测试 103 过 3 跳过。

### 还没定论的

- **这 972 字节到底是什么**，需要用户在 Kali 上跑
  `tail -c 972 <zip> | od -A d -t x1z` 看内容才知道；也还没确认他用什么方式
  把包搬到 Kali 的（`~/Downloads` 说明经过浏览器或文件管理器）。
  这一条不影响结论（母版已证明完好），但能解释传输为什么会坏。

### 顺带修掉的一个「测试自己坏掉」

为 1.3.4 出包时，Linux 全套从 125 项涨到 130 项，其中 **1 项失败**：

```
✖ falls through a configured answer that does not exist
  + actual   '/home/kali/Desktop'
  - expected '/home/kali/桌面'
```

这个用例长这样：

```js
configured: [`${HOME}/Desktop`, `${HOME}/桌面`, null],
existingStandard: [`${HOME}/桌面`],
```

它的意图是"配置来源给出了一个**不存在**的目录时不该采纳"。但
`chooseDesktopDir()` 会通过 `looksUsable()` 去 `statSync` **真实磁盘**，
而打包机上 `/home/kali/Desktop` **真的存在** —— 那正是第五节 postinst
五场景测试造出来的（`drwxr-xr-x ... Sep 15 13:03`）。于是这个字面量变成了
"存在的目录"，configured 分支胜出，断言反过来。

两个平台的差别只是**磁盘状态**，不是平台行为：Windows 上没有
`/home/kali/Desktop`，所以这个用例一直是绿的，直到有人在一台真有该目录的
机器上跑。**一个结果取决于机器上恰好有哪些目录的用例，不算测试。**

修法：改用任何机器上都不可能存在的路径 `/ccm-no-such-user/Desktop`，
并在注释里写明原因 —— 否则下一个人会"顺手改回 `${HOME}/Desktop`"。

修完两个平台都干净：Linux **130 / 130 通过、0 skip**，Windows 111 项 108 过 3 跳过。

### 1.3.5：按用户要求重写「第一步」，过程中又炸出两个体验缺陷

用户的反馈是：不要让他在终端里手输 `cd 路径`（中文路径容易打错），
应该让他**进到安装包所在文件夹、在那儿开终端、直接敲安装命令**。

重写这一步时发现两个真实问题：

**1. 压缩包没有顶层文件夹 —— 说明里让他「双击进到 CCM-Kali-… 文件夹」根本无从谈起**

原来的组包是 `zip -r . `，内容全在归档根部。用户右键「解压到此处」之后，
deb 和说明文件**直接散在当场**，不会生成任何文件夹；如果那个目录里正好有
一份同名 deb，还会被静默覆盖。这是模拟用户流程时才暴露的 —— 文档写着
「进入 CCM-Kali-1.3.5 文件夹」，而那个文件夹不存在。

改成 `zip -r CCM-Kali-<版本>`（归档名为参数、cwd 用内容目录的父目录），
解压必定产出一个干净的顶层文件夹。Windows 自带解压器和 `unzip` 都确认过。

**2. 校验文件的说明文字让 `sha256sum` 报警告**

`校验值.txt` 里写的中文用法说明没有注释前缀，`sha256sum -c` 把每一行都当成
待解析的校验行，于是打印：

```
sha256sum: WARNING: 5 lines are improperly formatted
```

用户看到 WARNING 会以为出了事。改成 `#` 注释行后静默跳过，现在输出只有
干净的一行 `claude-code-manager_1.3.5_amd64.deb: OK`。

**另外补了一个语义漏洞**：原来发给用户的只有 `CCM-Kali-<版本>.SHA256SUMS.txt`，
它**只覆盖 zip**。但对已经解压完的用户来说，zip 校验值帮不上忙 —— 而说明里
却让他「验一下 deb 的指纹」，那句话是错的（拿 zip 的校验值验 deb 必然不匹配）。
现在组包时会把 `校验值.txt`（deb 的 sha256）**写进文件夹再打包**，解压后
直接可用：

```
sha256sum -c 校验值.txt
```

### 验证：完整模拟用户流程

在 WSL 里按说明书写的一步步走一遍（拷两个文件 → 验 zip → 解压 → 进文件夹
→ `ls` 检查 → 验 deb → 装），并额外确认校验**真的有效**：

| 步骤 | 结果 |
|---|---|
| ① `sha256sum -c CCM-Kali-*.SHA256SUMS.txt` | ✅ `OK` / exit 0 |
| 解压后产生顶层文件夹 | ✅ `CCM-Kali-1.3.5/`，deb + 说明 + 校验值 + 截图 |
| ③ `ls claude-code-manager_1.3.5_amd64.deb` | ✅ 列出来了 |
| `sha256sum -c 校验值.txt` | ✅ `OK`，无 WARNING |
| 篡改 deb 一个字节后重验 | ✅ `FAILED` / exit 1 |
| 恢复后重验 | ✅ `OK` / exit 0 |

顺带一个教训：清理掉 1.3.3 交付目录之后，出 1.3.5 时**截图源路径失效**，
`make-delivery.mjs` 的内容检查直接拦下来了（"screenshots/ is empty"）——
它没让一个缺截图的包被发出去。这就是脚本化组包相比手工拖文件的价值。

## 十六、1.3.6：重启后「系统依赖」里的 npm 变成缺失

### 用户报的现象

安装完环境当次能检测到 node，重启应用也还行；**重启 Kali 之后再打开应用，
「系统依赖」卡片里的 npm 就显示缺失。**

### 根因：同一个应用里有四条检测链路，只有一条走托管 PATH

应用自己装的工具链在 `~/.local/share/claude-code-manager/runtime/…`，而这个目录
**只在这几种情况下才在 PATH 上**：

1. 安装当次 —— `installNode()` 末尾调 `refreshProcessPath()`，改的是**进程内存**里的 PATH；
2. 从终端启动 —— shell 读过 rc 文件，那里面有应用写的 export；
3. 从桌面菜单启动 —— **都没有**。桌面会话不读 `.bashrc`，应用的进程 PATH 就是会话 PATH。

而检测有四个入口，只有一个把托管目录并进 PATH 再查：

| 入口 | 用托管 PATH？ | 后果 |
|---|---|---|
| `installer/env.ts` `which`/`detectTool`（安装计划、系统信息） | ✅ `mergedEnv()` | 正确 |
| `services/dependency-checker.ts`（**系统依赖卡片**） | ❌ `execSync('which npm')` | **本 bug** |
| `services/cli-detector.ts`（`cli:status`） | ❌ `execSync('which claude')` | 同样会误报 |
| `ipc/config.ts` `config:cli-path` | ❌ | 同样会误报 |

于是同一块屏幕上，走托管 PATH 的那栏说「Node.js 已就绪」，走裸 PATH 的那栏说
「npm 缺失」—— 同一台机器、同一批文件，**只差应用是怎么被启动的**。

时间线也由此对上：安装当次进程 PATH 已被刷新（能检测到）；退出后从命令行启动
（rc 里有 export，也能检测到）；**重启 Kali 后从桌面菜单启动，就只剩裸 PATH 了**。

另外查清一件事：用户的 `~/.local/share/claude-code-manager/runtime/node/`
**根本不存在** —— 安装时 `planNode()` 检测到系统已有 node 就直接跳过下载，
托管目录里只有 Claude Code（`npm-global/bin/claude`）。所以「托管 node」本来
就不该作为判定依据，判定必须能落到系统工具链和托管目录两者上。

### 修复

1. **`dependency-checker` 改用托管 PATH**，并把 PATH 作为参数暴露出来：

   ```ts
   export function checkDependencies(opts: { path?: string } = {}): DepCheckResult
   ```

   默认值是 `mergedEnv().PATH`；返回值新增 `pathValue`，因为「用的是哪条 PATH」
   正是这件事的分水岭，藏起来只会让下一个查这个 bug 的人重新推一遍。

2. **不再依赖 `which` 命令**。第一版修复把 PATH 塞进 `execSync('which …')` 的
   env 里，结果**把 `which` 自己也从 PATH 里去掉了**，什么都找不到 —— 这个失败
   恰好说明依赖 `which` 本身就脆：它在有些精简 Debian 上是个独立包。改成直接遍历
   PATH 判断可执行位（`resolveOnPath()`，放在 `installer/env.ts` 作为唯一的实现）。

3. **`cli-detector` 增加一条不依赖 PATH 的查找路径**：应用自己的 npm 目录
   （`npmBinDir()`）排在候选列表最前，`cli:status` 不再受启动环境影响。

4. **`config:cli-path`** 换成同一套解析，并在候选里加上应用自有的 npm 目录。

5. **不再往用户的 shell 配置里写死目录**。`installNode()` 走「系统已有 node，
   无需安装」这条提前返回路径时**也会**调用 `ensureOnPath()`，于是把一个
   **永远不会存在**的 `runtime/node/v22.14.0/bin` 写进 `.bashrc` 并前置到 PATH。
   新增 `shellPathDirs()` 过滤出真实存在的目录；一个都没有时**根本不碰用户
   的 shell 配置**（没装任何自有的东西，就没有什么需要导出）。

### 验证

**回归测试**（都先确认红、再转绿）：

| 测试文件 | 覆盖 |
|---|---|
| `tests/dependency-check.test.mjs`（5 项） | 给定 PATH 能找到/找不到 npm；**默认 PATH 必须是托管 PATH**；apt 包判定不受 PATH 影响；返回结构不变 |
| `tests/cli-detector.test.mjs`（5 项） | 应用自有目录无需 PATH 即可命中；优先于系统安装；方法标注正确 |
| `tests/shell-path-dirs.test.mjs`（5 项） | 只保留真实存在的目录；全不存在时返回空而不是猜一个；文件不算目录 |

**真机验证**（WSL，把进程 PATH 剥成桌面会话的样子）：
`detectClaudeCode()` 在最小 PATH 下仍找到托管 claude
（`…/runtime/npm-global/bin/claude`，`installMethod: npm`），
`checkDependencies()` 的受检 PATH 里包含托管目录。

门禁：Linux **145 / 145 通过、0 skip**，Windows 126 项 123 过 3 跳过，`tsc` 0 错误。

### 顺带修正的一个认知错误

`computeRefreshedPath()` 把托管目录**追加**在 PATH 末尾（冲突时覆盖，不抢占位置），
我最初的断言写成了「托管目录必须排最前」。这是刻意的：不重排未被触碰的会话 PATH，
而重复项由托管目录覆盖系统项。真正有用的性质是「托管目录确实被查询到」，与位置无关。

### 仍然悬着的一个问题

用户机器上「系统依赖」显示 npm 缺失，而 Kali 的 `nodejs` 包自带 npm —— 上面这套
修复让四条链路一致了，但**是否就是他这次看到的那一例，还需要他用诊断脚本确认**：
如果他的桌面对话话 PATH 里连 `/usr/bin` 都没有，那是另一个（更严重的）问题。
诊断脚本：`D:\temp\kali-node-diagnose.sh`（只读）。
