# 更新日志

本项目的所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- MCP 测试命令安全校验（拒绝 shell 元字符与路径穿越）。
- 依赖自动更新扫描（Dependabot：npm + cargo，每周）。
- 工程文档：CONTEXT.md、架构决策记录（ADR）。
- 环境安装：Node.js 与 Git 并行安装（二者相互独立），缩短整体安装耗时。
- 环境安装：下载支持中途取消、失败自动重试（最多 3 次）、断点续传（HTTP `Range`，仅在
  服务端返回 `206` 时续传，返回 `200` 时丢弃部分文件重下以免拼接损坏）。
- 环境安装：界面显示真实下载进度（百分比、速度、已下载/总量）。
- 检测并一键导入已有 Claude Code 配置（`~/.claude/settings.json` 或环境变量）。
- 环境安装：Node.js 与 Git 安装完成后**立即弹窗提示重启应用**，重启后再安装 Claude Code。
  新装的 Node 目录只写入了注册表 PATH，当前进程继承的 PATH 无法看到它，因此重启是可靠
  分界点；重启后重试会自动跳过已装的 Node.js 与 Git，只完成 Claude Code。
- 环境安装：**Claude Code 安装完成后同样弹窗提示重启** —— `npm install -g` 把 `claude`
  命令写进了用户 PATH，而本进程使用的是启动时继承的 PATH，无法自行更新，不重启就会一直
  显示「未安装」。弹窗文案会说明原因；若检测已能识别（例如原本就在 PATH 上），则**不**
  弹出，避免无谓打扰。
  `restart-required` 事件载荷由 `true` 改为 `{ stage: "base_environment" | "claude_code" }`，
  前端据此显示对应文案。

### 变更
- 移除未使用的 `@tauri-apps/plugin-shell` 前端依赖。
- 修正发布工作流与 CI 工作流中的 Windows 打包与校验逻辑。
- **构建产物瘦身**：新增 `[profile]` 配置（dev/test 关闭调试符号、release 加 `strip`）。
  此前 `src-tauri/target/` 膨胀到 **14.3 GB**，单个 debug `app_lib.lib` 约 1 GB、
  每个 `.pdb` 100–150 MB，且 `incremental` 缓存累积到 6.1 GB。配置后同样的构建产出
  `target/` 仅 **1.9 GB**（降约 87%），`incremental` 从 6.1 GB 降到 0.17 GB。
  保留行号级 panic 回溯（只需符号名，不受影响）；放弃的是原生调试器单步能力，
  对以 Rust 单元测试为主的开发流程影响很小。
- **环境安装提速**：Git 下载改为**多源并发竞速**（原先按固定顺序依次尝试）。
  实测 GitHub 的 Git 发布地址会 TLS 握手失败，固定顺序下安装器会一直等它 ——
  一次实测等了 **101 秒**才回退到可用的镜像。现在两个源同时探测、取最快者，
  其余保留为有序兜底；实测 **283ms** 即选中可用源。
- **环境安装提速**：Node.js 与 Git 共用同一个竞速实现
  （`select_fastest_candidate`）；Node 的探测从「版本目录」改为「实际文件 URL」，
  校验的是真正要下载的那个地址。
- **安全**：Git 安装器新增 **SHA256 校验**（此前完全没有完整性验证）。
  校验值为**内嵌固定值**（取自 git-for-windows v2.45.2.windows.1 官方发布说明），
  不从网络获取 —— 否则校验值与安装包走同一通道，能替换安装包的一方也能替换校验值，
  等于没有校验。任一镜像校验失败即丢弃该文件并尝试下一个，绝不安装未验证的二进制。
  实测确认 GitHub 官方产物与 npmmirror 镜像 **逐字节一致**
  （同为 65.0 MB，SHA256 `ce022a6a…da98`）。
- **环境安装提速**：zip 解压由 PowerShell `Expand-Archive` 改为
  `tar.exe` 优先、Rust `zip` crate 兜底。实测同一份 Node.js 归档
  （33MB / 2447 个文件）：`Expand-Archive` **7.7s** → `tar.exe` **1.6s**。
  解压原本是整个 Node.js 安装中最慢的一步。
- 环境安装：新增分步耗时日志（解压、解压后验证、下载源、各探测），便于定位慢在哪一步。
- 环境安装：node/npm 探测改为**并行**执行（实测顺序 295ms → 并行 243ms，省约 52ms）；
  并优先探测 Windows 实际存在的 `npm.cmd`，省掉一次注定失败的 `npm` 探测。
- 环境安装：移除解压后对 `node.exe` 的**重复探测** —— `install_node_portable` 已用宽预算
  跑过一次并拿到版本号，`install_node` 原先又完整重探一遍（约 300ms，冷缓存下更久）。
- 环境安装：解压后首次运行 `node.exe` 的探测预算放宽到 120s（其余探测仍为 30s）——
  该次运行可能正被实时防护扫描新写入的 16MB 二进制，属于「慢但正常」，
  过紧的上限会把可用的安装误判为失败。该步若超过 5s 会记 WARN，明确指向杀软扫描。
- 环境安装：镜像源测速并发执行，单源超时由 5s 降至 2.5s。
- 环境安装：已校验的 Node.js 缓存归档通过 sidecar 标记复用，跳过重复 SHA256 计算。
- 环境安装：Git 改用刷新后的 PATH 检测，避免已安装却重复下载约 60MB 安装器。
- 环境安装：装/卸 Claude Code 统一走同一 npm 镜像切换与还原逻辑。
- 环境安装：WebView2 引导安装流程（缺失时同目录静默安装 → 确认后自动下载安装）。
- 环境安装：npm 全局安装附加 `--no-audit --no-fund --prefer-offline`。
- 环境安装：移除失效的腾讯 Node 镜像源（`mirrors.cloud.tencent.com/nodejs/` 返回 404）。
- 环境安装：下载进度事件按 150ms 节流，并标注 `component` / `primary` 归属。
- **安全语义变更**：API Key 现在会以明文写入 `~/.claude/settings.json`（写入前自动备份）。
  详见 `docs/security.md` 第 2 节。

### 修复
- `.gitignore` 补充忽略 `.zcode/` 与 WebView2 引导安装程序。
- **严重**：修复「界面显示安装成功，但终端里 `claude` 仍不是内部或外部命令」。
  根因是**检测把 fallback 启动器当成了安装证据**。`@anthropic-ai/claude-code` 是一个
  包装包，其原生程序（约 220MB）通过 `optionalDependencies` 分发，postinstall 再复制到
  `bin/claude.exe`。当 postinstall 未生效时，包里只剩 `cli-wrapper.cjs` —— 它自己的注释
  写明是「postinstall 未运行时的降级启动器」，**不是可执行程序**。检测却把它当作入口并
  报告「已安装」，于是界面成功、终端找不到命令。
  现要求解析结果必须是**真实且非空**的程序：`package.json` 的 `bin` 目标必须存在且大小
  大于 0；`cli-wrapper.cjs` / `install.cjs` 一律不作为安装依据。
- **严重**：新增「包装包已下载、但原生程序没装上」的专门错误提示。此前这种情况显示为
  「安装成功」，现在会明确报出原因与修复方式（检查 `npm config get omit` 是否含
  `optional`，或改用 `--include=optional` 重装）。
- **严重**：检测改为**以「能否运行」为判据**，不再以「文件是否存在」为判据。
  这修掉了同一类误报的第二个变体：npm 在 postinstall **之前**就写好了 `claude.cmd`
  shim，而该 shim 指向的 `bin\claude.exe` 正是 postinstall 失败时缺失的文件 ——
  旧逻辑看到 shim 存在就报「已安装」。现在解析出候选入口后会**实际运行一次**
  `--version`，跑不起来就报 `installed: false` + `health: "broken"`，
  让状态栏如实显示，并触发自动补救。
- **新增**：安装后若发现「包装包在、程序缺失」，**自动执行补救安装**
  （`npm install -g @anthropic-ai/claude-code --include=optional`）。
  不能只重跑包的 `install.cjs`：postinstall 是从 optional 依赖里复制二进制，
  若该依赖根本没下载，重跑也无从复制。`--include=optional` 会覆盖
  `omit=optional` 配置并把平台包装上，同时顺带重新触发 postinstall。
  补救后会**再次实际运行**验证，只有真能跑才报成功。
- **严重**：修复「重启后仍检测不到刚装好的 Claude Code」。
  两个原因叠加：
  1. **`detect_npm_claude` 依赖 npm 在进程 PATH 上** —— 它先跑 `npm root -g`，失败即
     返回 `None` 并**短路了整条 npm 检测路径**（连后面直接检查
     `%APPDATA%\npm\claude.cmd` 的兜底都到不了）。而便携版 Node 的 npm 只在注册表
     PATH 里，重启后的进程依然看不到它。现改为**文件系统优先**：直接按
     `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code` 解析，完全不依赖 PATH。
  2. **应用内「重启」是假重启** —— `AppHandle::restart()` 用**当前进程的环境块**
     重新拉起自己，启动时继承的旧 PATH 原封不动传给了新进程。现改为自行启动后继进程并
     显式注入从注册表读取的合并 PATH，等价于一次全新登录；启动成功后才退出当前进程，
     失败则回退到 Tauri 自带重启。
- UI：底部状态栏在 Claude Code 版本号较长时会把系统版本挤到第二行造成重叠。
  状态栏加了 `overflow: hidden`，Claude Code 状态与「系统版本 · 架构」合并为各一个
  可截断的标签并加 `title` 悬浮提示，不再换行互挤。
- UI：按钮文字未居中。`.btn` 是 `inline-flex`，配合 `minWidth` 时内容默认左对齐
  （引导向导的「下一步」最明显）。已为 `.btn` 增加 `justify-content: center`。
- **严重**：修复安装卡在「验证安装」阶段（永久无响应）的问题。
  `verify_node_at_path` 等**全部 8 处**同步探测都使用 `Command::output()`，它会一直阻塞到
  子进程退出且 stdout 管道关闭 —— 刚解压出的 `node.exe` 若因杀毒软件首次扫描而停顿，
  整个安装就会永久卡死，既无进度也无报错。现统一改用带硬超时的探测封装（30s），
  超时即杀掉子进程并按「不可用」处理，回退到其他检测策略而不是挂起。
  同样的超时保护也加到了 `environment.rs` 的所有探测点（含 `node --version`、
  `npm root -g`、`git --version`、`where`、PowerShell 版本查询等），
  避免环境检测冻结整个页面。
- 环境安装：`detect_npm_claude` / `get_claude_code_version` 的超时由 8s 放宽到 30s ——
  安装后首次运行 npm 与 Claude CLI 可能较慢，8s 会把已安装误判为未安装。
- 安全：`get_dll_version` 不再把路径拼接进 PowerShell `-Command` 字符串，改以
  `-EncodedCommand` 传输，并移除继承的 `PSModulePath`（与 `extract_zip` 同款处理）。
- **严重**：修复便携版 Node.js 装好后 **Claude Code 仍无法安装**的问题。
  npm 的**检测**使用刷新后的注册表 PATH，而 npm 的**执行**（`cmd /c npm install -g`）
  却继承了应用进程的旧 PATH —— 便携版 Node 的 bin 目录只写进注册表，进程看不到，
  于是同一次运行里既「检测到 npm 可用」又「'npm' 不是内部或外部命令」。
  现所有 npm 调用统一携带刷新后的 PATH，并新增 npm 可达性预检，PATH 问题会以明确
  文案报出，而非变成费解的报错。
- **严重**：修复中文/非英文 Windows 上 Node.js **必然安装失败**的问题。
  `sha256_file` 用 `String::from_utf8` 严格解码 `certutil` 输出，而 certutil 的表头
  使用 OEM 代码页（简中为 GBK），不是合法 UTF-8 —— 解码在第 1 行就失败，摘要行
  根本没被读到，于是「无法计算 SHA256」→ 便携版安装失败 → 回退 winget 也失败。
  现改为宽松解码并按「64 位十六进制」特征定位摘要，不再依赖行号与编码。
- **严重**：修复 PowerShell 模块 cmdlet 无法解析的问题。CCM 若从 PowerShell 7 环境
  启动，会继承 PS7 的 `PSModulePath`；而 `extract_zip` 调用的是 Windows PowerShell
  5.1，它因此无法自动加载自带模块，`Expand-Archive`（解压）与 `Get-FileHash`
  全部报「无法识别」。现于子进程移除继承的 `PSModulePath`，恢复 5.1 默认模块发现。
  这同时解释了「解压失败」与「校验失败」两类症状。
- 环境安装：Node.js 安装失败时不再丢弃原因。此前 `if let Ok(r) = pr` 直接忽略
  `Err`，用户只能看到「便携版未成功，winget 不可用或失败」这种无信息量的提示；
  现在便携版与 winget 的失败原因都会写入日志、进度行与最终错误信息。
- 环境安装：Node 的 winget 分支不再用 `let _ =` 吞掉退出码，并按
  「未安装 winget / winget 无法运行 / winget 执行后仍检测不到」区分失败原因。
- 环境安装：`SHASUMS256.txt` 改为在全部镜像间回退获取（此前硬编码 nodejs.org，
  在 nodejs.org 不可达但镜像可达的网络下会导致校验必失败）。
- 环境安装：SHA256 计算增加 `Get-FileHash` 回退路径（`certutil` 缺失或被策略禁用时）。
- 环境安装：解压后找不到 `node.exe` 时，错误信息会带上运行时目录的实际内容，
  便于区分「解压为空」与「解压到了别处」。
- 环境安装：读取 npm registry 改用宽松解码（此前严格 UTF-8，与 certutil 同类问题）。
- 安全：`extract_zip` 不再拼接 PowerShell 命令字符串，改以 `-EncodedCommand` 传输，
  消除命令注入面（此前是项目内唯一违反「参数数组、禁止拼接」原则的位置）。
- **严重**：`apply_config` 不再把 `$CREDENTIALS:...` 占位符当作 token 写进
  `settings.json`。Claude Code 会把该占位符按字面值当作 Bearer token 发出，导致
  **所有请求 401**，而保存操作却显示成功——这是「配置好 API 后 Claude Code 仍不可用」
  的直接原因。现在写入真实 Key，并在无法解析 Key 时保留原有值而非覆盖。
- **严重**：Claude Code 检测不再依赖 `cli.js`。上游新版本已改为发布
  `bin/claude.exe`（实测 2.1.266 的包内不存在 `cli.js`），旧检测逻辑因此把**已安装**的
  Claude Code 判为未安装，进而导致安装后「验证失败」、卸载静默变成空操作。
  现改为读取 `package.json` 的 `bin` 字段并多路兜底，同时兼容旧的 `cli.js` 布局。
- 环境安装：`save_provider_config` 不再吞掉 `apply_config` 的错误（此前凭据已存、
  配置未写入，UI 仍报成功）。
- 环境安装：写入 `HKCU\Environment\PATH` 后广播 `WM_SETTINGCHANGE`，新开终端可立即识别；
  写回时保留原有注册表值类型（`REG_EXPAND_SZ`），不再破坏 `%VAR%` 引用。
- 环境安装：Node.js 归档改为**校验通过后**才移入缓存，损坏文件不再污染缓存路径。
- 环境安装：winget 的退出码与输出不再被静默丢弃，失败原因可诊断。
- 环境安装：修正进度回退（60% → 50%）并补齐解压/校验阶段进度。

## [0.1.0] - 2026-07-20

### 新增
- 首个版本：Claude Code Manager Windows 图形化管理工具。
- Claude Code 环境检测、安装与卸载。
- API 服务商配置（Anthropic、DeepSeek、自定义兼容接口）。
- 模型检测与选择。
- 配置文件可视化编辑（settings.json、CLAUDE.md、.mcp.json）。
- MCP Server 管理与测试。
- 故障诊断。
- 凭据经 Windows Credential Manager 安全存储。
- 日志脱敏（API Key / Token / 密码 / 邮箱）。
