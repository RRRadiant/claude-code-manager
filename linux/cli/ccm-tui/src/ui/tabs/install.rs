//! Install tab — cursor-based install method selection.
use crate::app::{App, Refresh, clip}; use crate::ui::{UIState, theme};
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{Frame, layout::{Constraint, Direction, Layout, Rect}, style::{Modifier, Style}, text::{Line, Span}, widgets::{Block, Borders, Paragraph, Wrap}};

const METHODS: &[(&str, &str)] = &[
    ("npm", "npm install -g @anthropic-ai/claude-code (推荐)"),
    ("curl", "curl -fsSL https://claude.ai/install.sh | bash"),
    ("github", "下载 GitHub Release 预编译二进制到 ~/.local/bin"),
];

pub fn draw(f: &mut Frame, app: &App, ui_state: &UIState, area: Rect) -> anyhow::Result<()> {
    let sel = ui_state.scroll_offset % METHODS.len();
    let chunks = Layout::default().direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Length(9), Constraint::Min(1)]).split(area);

    let cli = app.cli();
    let st = if cli.installed { vec![Line::from(vec![
        Span::styled("✓ 已安装: ", Style::default().fg(theme::ok())), Span::raw(&cli.version),
        Span::styled(format!("  路径: {}", cli.path), theme::subtitle())])]
    } else { vec![Line::from(vec![
        Span::styled("✗ 未安装", Style::default().fg(theme::err())), Span::raw("  —  ↑↓ 选择  Enter 执行  r 检测")])] };
    f.render_widget(Paragraph::new(st).block(Block::default().title(Span::styled(" CLI ", theme::title())).borders(Borders::ALL).border_style(theme::border_default())), chunks[0]);

    let mut lines: Vec<Line> = Vec::new();
    for (i, (name, desc)) in METHODS.iter().enumerate() {
        if i == sel {
            lines.push(Line::from(vec![Span::styled(" ▸ ", Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK)),
                Span::styled(*name, theme::primary().add_modifier(Modifier::BOLD)), Span::raw(format!("  —  {}", desc))]));
        } else {
            lines.push(Line::from(vec![Span::raw("   "), Span::styled(*name, Style::default().fg(theme::accent())), Span::raw(format!("  —  {}", desc))]));
        }
    }
    lines.push(Line::from(""));
    if let Some(method) = pending(ui_state) {
        let desc = METHODS.iter().find(|(n, _)| *n == method).map(|(_, d)| *d).unwrap_or("");
        lines.push(Line::from(vec![
            Span::styled("  确认执行？ ", Style::default().fg(theme::warn()).add_modifier(Modifier::BOLD)),
            Span::styled(method, theme::primary()),
            Span::raw(format!("  —  {desc}"))]));
        lines.push(Line::from(vec![Span::styled(
            "  y / Enter 执行   其他任意键取消",
            Style::default().fg(theme::warn()))]));
    } else {
        lines.push(Line::from(vec![Span::styled("  ↑↓ 选择  Enter 确认  r 刷新  1/2/3 快捷键", theme::subtitle())]));
    }
    if let Some((ref msg, _)) = ui_state.message {
        let c = if msg.contains("成功")||msg.contains("✓"){theme::ok()}else if msg.contains("失败")||msg.contains("✗"){theme::err()}else{theme::warn()};
        lines.push(Line::from("")); lines.push(Line::from(vec![Span::styled(format!("  {}", msg), Style::default().fg(c))]));
    }
    f.render_widget(Paragraph::new(lines).block(Block::default().title(Span::styled(" 安装 ", theme::title())).borders(Borders::ALL).border_style(theme::border_default())), chunks[1]);

    let deps = vec![
        Line::from(vec![Span::styled("curl:    ",theme::subtitle()),Span::styled(icon(app.has_curl()),if app.has_curl(){Style::default().fg(theme::ok())}else{Style::default().fg(theme::err())})]),
        Line::from(vec![Span::styled("git:     ",theme::subtitle()),Span::styled(icon(app.has_git()),if app.has_git(){Style::default().fg(theme::ok())}else{Style::default().fg(theme::err())})]),
        Line::from(vec![Span::styled("npm:     ",theme::subtitle()),Span::styled(icon(app.has_npm()),if app.has_npm(){Style::default().fg(theme::ok())}else{Style::default().fg(theme::err())})]),
        Line::from(vec![Span::styled("python3: ",theme::subtitle()),Span::styled(icon(app.has_python()),if app.has_python(){Style::default().fg(theme::ok())}else{Style::default().fg(theme::err())})]),
    ];
    f.render_widget(Paragraph::new(deps).block(Block::default().title(Span::styled(" 依赖 ", theme::title())).borders(Borders::ALL).border_style(theme::border_default())), chunks[2]);
    Ok(())
}
fn icon(ok: bool) -> &'static str { if ok { "✓ 已安装" } else { "✗ 缺失" } }

/// Pending confirmation: which method the user asked for but has not confirmed.
///
/// Installing is a system-level side effect that takes minutes and downloads
/// hundreds of megabytes. The previous version ran it on a single unconfirmed
/// keystroke, so pressing `1` by accident — or trying to type a digit into an
/// input field, since this handler matched digits *before* checking input mode —
/// started a global npm install.
fn pending(ui_state: &UIState) -> Option<&'static str> {
    ui_state.confirm.as_deref().and_then(|label| {
        METHODS.iter().find(|(name, _)| label == *name).map(|(name, _)| *name)
    })
}

pub fn handle_key(key: KeyEvent, ui_state: &mut UIState, app: &App) -> bool {
    // Confirmation takes precedence over everything else on this tab.
    if ui_state.confirm.is_some() {
        match key.code {
            KeyCode::Char('y') | KeyCode::Char('Y') | KeyCode::Enter => {
                let method = pending(ui_state).unwrap_or("npm");
                ui_state.confirm = None;
                do_install(ui_state, method);
            }
            _ => {
                ui_state.confirm = None;
                ui_state.set_message("已取消");
            }
        }
        return true;
    }

    match key.code {
        KeyCode::Up|KeyCode::Char('k')=>{ui_state.scroll_offset=if ui_state.scroll_offset>0{ui_state.scroll_offset-1}else{METHODS.len()-1};true}
        KeyCode::Down|KeyCode::Char('j')=>{ui_state.scroll_offset=(ui_state.scroll_offset+1)%METHODS.len();true}
        KeyCode::Enter=>{ let m = METHODS[ui_state.scroll_offset%METHODS.len()].0; ui_state.confirm = Some(m.to_string()); true }
        KeyCode::Char('1')=>{ui_state.scroll_offset=0;ui_state.confirm=Some("npm".into());true}
        KeyCode::Char('2')=>{ui_state.scroll_offset=1;ui_state.confirm=Some("curl".into());true}
        KeyCode::Char('3')=>{ui_state.scroll_offset=2;ui_state.confirm=Some("github".into());true}
        KeyCode::Char('r')=>{let _=app.refresh(Refresh::Full);ui_state.set_message("已重新检测");true}
        _=>false,
    }
}
fn do_install(ui_state: &mut UIState, method: &str) {
    let cmd = match method {
        // Install into the app-owned prefix and pass the registry as an
        // environment variable. The previous version ran
        // `npm config set prefix ~/.npm-global`, which permanently rewrote the
        // user's global npm configuration as a side effect of clicking install.
        "npm"=>"P=\"$HOME/.local/share/claude-code-manager/runtime/npm-global\"; mkdir -p \"$P\"; \
                npm_config_registry=\"${npm_config_registry:-https://registry.npmmirror.com/}\" \
                npm install -g --prefix \"$P\" @anthropic-ai/claude-code --include=optional \
                --no-audit --no-fund 2>&1",
        "curl"=>"curl -fsSL https://claude.ai/install.sh | bash 2>&1",
        _=>{ let a=if cfg!(target_arch="aarch64"){"arm64"}else{"x64"}; return do_github(ui_state,a); }
    };
    ui_state.set_message(format!("正在通过 {} 安装...", method));
    match std::process::Command::new("sh").arg("-c").arg(cmd).output() {
        Ok(o) => { if o.status.success() { ui_state.set_message(format!("✓ {} 安装成功！按 r 刷新", method)); }
        else { let e=format!("{}{}",String::from_utf8_lossy(&o.stdout),String::from_utf8_lossy(&o.stderr)); ui_state.set_message(format!("✗ 失败: {}", clip(&e, 100))); } }
        Err(e) => ui_state.set_message(format!("✗ 错误: {}", e)),
    }
}
/// Download Anthropic's prebuilt binary for THIS platform.
///
/// The previous version hard-coded `claude-code-linux-{arch}.tar.gz`, so on macOS
/// it downloaded a Linux ELF and then reported success. `cfg!(target_os)` picks
/// the asset the running binary can actually execute, and a platform with no
/// published asset says so instead of installing something broken.
fn do_github(ui_state: &mut UIState, arch: &str) {
    let os = match std::env::consts::OS {
        "linux" => "linux",
        "macos" => "darwin",
        other => {
            ui_state.set_message(format!("✗ 该方式不支持当前系统 ({other})，请用 npm 方式"));
            return;
        }
    };
    ui_state.set_message("正在下载 GitHub Release ...");
    match std::process::Command::new("sh").arg("-c").arg(format!(
        "V=$(curl -fsSL https://api.github.com/repos/anthropics/claude-code/releases/latest 2>/dev/null|grep tag_name|head -1|cut -d'\"' -f4);\
         [ -z \"$V\" ]&&{{ echo 'cannot reach GitHub API'; exit 1; }};\
         mkdir -p \"$HOME/.local/bin\";\
         curl -fsSL \"https://github.com/anthropics/claude-code/releases/download/$V/claude-code-{os}-{arch}.tar.gz\" -o /tmp/cc.tar.gz&&\
         tar -xzf /tmp/cc.tar.gz -C \"$HOME/.local/bin\"&&rm /tmp/cc.tar.gz&&chmod +x \"$HOME/.local/bin/claude\"&&\
         {{ grep -q '.local/bin' \"$HOME/.bashrc\" 2>/dev/null || echo 'export PATH=\"$HOME/.local/bin:$PATH\"'>>\"$HOME/.bashrc\"; }}"
    )).output() {
        Ok(o) => { if o.status.success() { ui_state.set_message("✓ GitHub 安装成功！按 r 刷新"); }
        else { let e=format!("{}{}",String::from_utf8_lossy(&o.stdout),String::from_utf8_lossy(&o.stderr)); ui_state.set_message(format!("✗ 失败: {}", clip(&e, 100))); } }
        Err(e) => ui_state.set_message(format!("✗ 错误: {}", e)),
    }
}
