# 分发说明

这个目录里有几种东西，按对方的情况选一种发出去。

> **先读这一条**：如果对方是 Debian/Ubuntu，**优先发 `.deb`**，别发 AppImage。
> AppImage 需要 `libfuse2`，而 Ubuntu 24.04 起该包改名为 `libfuse2t64` 且默认不装，
> 最小安装的用户会直接打不开。详见下面「AppImage 打不开怎么办」。

---

## 情况 A：对方只想**用**

按对方系统选一个：

| 对方系统 | 发什么 | 大小 | 是否需要 FUSE |
|---|---|---|---|
| Debian / Ubuntu / Kali | `claude-code-manager_1.3.7_amd64.deb` | 122 MB | **不需要** |
| 其他 Linux | `ClaudeCodeManager-1.3.7-x86_64.AppImage` **+** `ClaudeCodeManager.sh` | 157 MB | 需要（或用脚本回退） |

### 为什么 Debian 系优先发 .deb

依赖由 APT 负责：包内已声明 `Depends: libsecret-1-0, gnome-keyring`，装的时候自动带上，
不需要用户理解 FUSE、AppImage 这些概念。

```bash
sudo apt install ./claude-code-manager_1.3.7_amd64.deb
# 之后在应用菜单里找 "Claude Code Manager"，或直接运行 claude-code-manager
```

卸载：`sudo apt remove claude-code-manager`

### AppImage 用法

**两个文件必须放在同一目录**，然后运行脚本而不是 AppImage：

```bash
chmod +x ClaudeCodeManager.sh
./ClaudeCodeManager.sh
```

脚本会自动判断：有 FUSE 就直接挂载运行；没有就解包一次到
`~/.cache/claude-code-manager/appimage/` 再运行（后续复用缓存，不重复解包）。

直接双击 AppImage 也能用，但只在装了 FUSE 的机器上可行。

---

## ⚠️ 双击打不开、也没报错

### 症状

双击 AppImage 或桌面图标，**什么都不发生，也没有任何错误提示**。从终端里运行才看得到原因。

### 原因：Chromium 沙箱无法初始化

这**不是** FUSE 问题（缺 FUSE 会明确报 `dlopen` 错误）。真正的原因是：

AppImage 里的 `chrome-sandbox` **不可能带 setuid 位** —— AppImage 内嵌的是只读 squashfs 镜像，
运行时才挂载，setuid 在镜像里无法保留。于是 Electron 只能退而依赖**未特权用户命名空间**。

而 Ubuntu 24.04 及部分新内核默认限制了它：

```bash
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns
# 1 = 受限（默认）
```

受限时 Electron 无法建立沙箱，进程启动即退出。**从 `.desktop` 启动没有终端，stderr 直接被丢弃**
—— 所以用户看到的就是「双击毫无反应」。

### 先确认

```bash
bash scripts/diagnose-launch.sh
```

脚本会打印会话环境、FUSE 状态、沙箱前提条件，并**分别用默认参数和 `--no-sandbox` 各跑一次**
把 stderr 抓出来（双击时这些信息会丢失）。

### 解决办法（按推荐程度）

**方法 1：放开未特权用户命名空间（推荐，保留沙箱安全性）**

```bash
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-ccm-userns.conf
sudo sysctl --system
```

永久生效。代价是放宽了这条 AppArmor 限制 —— 对桌面用户通常可接受，服务器上请自行权衡。

**方法 2：装 .deb 并给沙箱设 setuid（推荐给 Debian/Ubuntu）**

`.deb` 安装到 `/opt`，文件系统支持 setuid：

```bash
sudo apt install ./claude-code-manager_1.3.7_amd64.deb
sudo chown root:root /opt/*/chrome-sandbox
sudo chmod 4755 /opt/*/chrome-sandbox
```

这样沙箱走 setuid 路径，不需要用户命名空间，安全性最好。

**方法 3：用启动脚本（自动兜底）**

```bash
./ClaudeCodeManager.sh
```

脚本检测到沙箱失败时会说明原因，然后自动加 `--no-sandbox` 重试。想强制不回退：`--sandbox`。

**方法 4：手动加参数（最后手段）**

```bash
./ClaudeCodeManager-1.3.7-x86_64.AppImage --no-sandbox
```

编辑桌面快捷方式，把 `Exec=` 那行末尾加上 `--no-sandbox`。

> ⚠️ `--no-sandbox` 会关闭 Chromium 的进程隔离。本应用是本地工具、不加载远程内容
> （CSP 限定 `default-src 'self'`，且外链一律交给系统浏览器），风险可控；
> 但能用方法 1 或 2 就不要用它。

### 为什么 AppImage 在有些机器上一切正常

装了 FUSE 2 且内核未限制用户命名空间时沙箱可以工作 —— 所以同一个 AppImage 在不同机器上
行为不同。这也是为什么我们推荐 Debian 系直接用 `.deb`。

---

## ⚠️ AppImage 报 libfuse.so.2 打不开

### 症状

```
dlopen(): error loading libfuse.so.2
```

或者双击没反应，终端里跑才看到上面这行。

### 原因

AppImage type 2 通过 `libfuse.so.2` 把自身挂载成一个只读文件系统。它**只能**用 FUSE 2，
不兼容 FUSE 3。而这个库：

- Ubuntu 24.04 之前叫 `libfuse2`
- Ubuntu 24.04 起改名为 `libfuse2t64`（时间戳过渡包）
- 两者**都不是默认安装的**
- 容器、WSL、最小化安装的系统通常都没有

所以「AppImage 打不开」几乎总是这个原因，而不是程序本身有问题。

### 三种解决办法

**方法 1：装 FUSE 2（最省事，一次到位）**

```bash
# Debian / Ubuntu 24.04 之前
sudo apt install libfuse2

# Ubuntu 24.04 及之后
sudo apt install libfuse2t64

# Fedora / RHEL
sudo dnf install fuse-libs

# Arch
sudo pacman -S fuse2
```

**方法 2：用附带的启动脚本（不需要 root，不需要装任何东西）**

```bash
./ClaudeCodeManager.sh
```

脚本检测到没有 `libfuse.so.2` 时会自动改用解包模式。首次运行解包约需几秒，
之后走缓存。加 `--reinstall` 可强制重新解包。

**方法 3：手动解包（脚本不适用时）**

```bash
./ClaudeCodeManager-1.3.7-x86_64.AppImage --appimage-extract
./squashfs-root/AppRun
```

`--appimage-extract` 本身**不需要** FUSE（只是读取内嵌的镜像），所以这条在任何机器上都能用。

**方法 4：改用 .deb**

见上面的「情况 A」。这也是我们推荐 Debian 系用户首选 .deb 的原因。

---

## 情况 B：对方要**看代码 / 自己构建**

打开后进入「环境」面板，点「一键安装」即可。它会：

1. 三路镜像并发测速，选最快的下载 Node.js 22.14.0（约 28.5 MB）
2. 校验内置的 SHA256（不匹配就丢弃重下）
3. 解压到 `~/.local/share/claude-code-manager/`
4. 用 npm 把 Claude Code 装进同一个应用自有目录（**不改动对方全局的 npm 配置**）
5. 把两个目录写进 `~/.bashrc` / `~/.zshrc` / `.profile`

**安装完需要新开一个终端**才能在终端里直接用 `claude` —— 已经打开的终端不会自动更新
PATH。应用内部不受影响。

> 卸载：删掉 `~/.local/share/claude-code-manager/`，再删掉三个 rc 文件里
> `# >>> claude-code-manager >>>` 和 `# <<< claude-code-manager <<<` 之间的那几行。

---

## 情况 B：对方要**看代码 / 自己构建**

发源码包，约 **280 KB**（不含 `node_modules`、构建产物和 AppImage）。

### 包内必须有

```
src/                      Electron 三进程源码（主进程 / preload / React 渲染层）
cli/ccm-tui/              Rust TUI 源码
  └── dist/               三个预编译二进制（Linux x64/arm64、macOS arm64）
resources/                图标与桌面入口
docs/                     架构与设计文档
scripts/                  构建与验证脚本
tests/                    单元测试
tools/                    辅助脚本
package.json
package-lock.json         ← 必须带上，否则依赖版本会漂移
electron.vite.config.ts
tsconfig.json
README.md  LICENSE  .gitignore
```

### 不要发这些

| 排除项 | 原因 |
|---|---|
| `node_modules/` | 约 380 个包，跨平台二进制不通用，对方 `npm install` 就行 |
| `out/` | 构建产物，25 MB，可由源码重建 |
| `dist/`、`dist-installer/` | 打包产物与临时 bundle |
| `cli/ccm-tui/target/` | Rust 构建目录，可达数 GB |
| `.git/` | 除非你想连历史一起给 |

### 打成一个包

```bash
tar -czf ccm-source.tar.gz \
  --exclude=node_modules --exclude=.git --exclude=out \
  --exclude=dist --exclude=dist-installer \
  --exclude=cli/ccm-tui/target --exclude='*.AppImage' \
  .
```

### 对方需要什么

| 用途 | 需要 |
|---|---|
| 只跑前端/主进程 | Node.js 20+ |
| 构建 Linux 安装包 | Node.js 20+ |
| 构建/修改 TUI | Rust 1.77+（Kali 实测 1.98.1 可用） |

### 对方的构建步骤

```bash
npm install --legacy-peer-deps      # 必须加这个标志，peer 依赖有冲突
npm run typecheck                   # 类型检查
npm test                            # 单元测试
npm run build                       # 只构建，不打包

# 打 AppImage
npm run package:appimage
```

**国内网络注意**：electron-builder 会从 GitHub 下载 124 MB 的 Electron，实测会被限速
（368 KB/s 掉到 22 KB/s 并最终超时）。用镜像：

```bash
ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://cdn.npmmirror.com/binaries/electron-builder-binaries/" \
npm run package:appimage
```

实测该镜像 **7.4 MB/s**，数秒完成。

---

## 情况 C：对方只想在**终端**里用

`cli/ccm-tui/dist/` 里已经有预编译的 TUI 单文件二进制：

```
ccm-linux-x64       983 KB     ELF x86-64
ccm-linux-arm64     880 KB     ELF aarch64
ccm-macos-arm64     896 KB     Mach-O arm64
```

发对应的那个即可，**不需要 Node.js**（只有一个要求：glibc，非静态链接）。

```bash
chmod +x ccm-linux-x64
./ccm-linux-x64
```

按键：`1`–`8` 跳标签页，`Tab` 切换，`↑↓`/`j k` 移动，`n` 新建，`d` 删除，`q` 按两次退出。

> 注意：这是仓库里原有的二进制，构建于修复之前，已知存在若干问题（详见
> `docs/kali-verification.md`）。要发布建议先从 `cli/ccm-tui` 重新构建。

---

## 一句话总结

| 对方是 | 发什么 | 大小 |
|---|---|---|
| 普通用户 | 只发 `.AppImage` | 157 MB |
| 开发者 | 只发源码包 | 280 KB |
| 终端用户 | 只发 `ccm-linux-x64` | 983 KB |

**不要把整个项目目录直接打包发出去** —— 里面有 `node_modules`（体积大且平台相关）
和已经过期的 `out/`，对方拿到反而困惑。
