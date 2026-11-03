//! Help tab — keybindings reference.
use crate::ui::{UIState, theme};
use crossterm::event::KeyEvent;
use ratatui::{Frame, layout::Rect, text::{Line, Span}, widgets::{Block, Borders, Paragraph, Wrap}};

pub fn draw(f: &mut Frame, area: Rect) -> anyhow::Result<()> {
    let lines = vec![
        Line::from(vec![Span::styled(" Claude Code Manager TUI", theme::title())]),
        Line::from(vec![Span::styled(" v1.0.0 — ratatui + crossterm, 灵感来自 rustnet", theme::subtitle())]),
        Line::from(""),
        Line::from(vec![Span::styled(" 全局", theme::heading())]),
        Line::from("  1-8 / Tab / [ ]    切换标签页"),
        Line::from("  ↑↓ / j k            移动光标/滚动"),
        Line::from("  Enter               确认 / 编辑"),
        Line::from("  Esc                 取消 / 退出编辑"),
        Line::from("  q / Ctrl+C          退出"),
        Line::from(""),
        Line::from(vec![Span::styled(" 各标签页", theme::heading())]),
        Line::from("  Status  (1) 仪表盘 — ↑↓ 滚动 Skills"),
        Line::from("  Install (2) 安装器 — ↑↓ 选方式 Enter 执行"),
        Line::from("  API     (3) 配置   — 1 Key 2 URL 3 模型"),
        Line::from("  Models  (4) 映射   — ↑↓ 选 Enter 编辑"),
        Line::from("  Skills  (5) 命令   — n 新建 d 删除 Enter 查看"),
        Line::from("  Agents  (6) 代理   — n 新建 d 删除 Enter 查看"),
        Line::from("  Config  (7) 文件   — ↑↓ 选 Enter 编辑 s 保存"),
        Line::from(""),
        Line::from(vec![Span::styled(" ~/.claude/", theme::heading())]),
        Line::from("  settings.json / settings.local.json / CLAUDE.md"),
        Line::from("  commands/  (Skills)    agents/  (Agents)"),
    ];
    f.render_widget(Paragraph::new(lines).block(Block::default().title(Span::styled(" 帮助 ", theme::title())).borders(Borders::ALL).border_style(theme::border_default())), area);
    Ok(())
}
pub fn handle_key(_key: KeyEvent, _ui_state: &mut UIState, _app: &crate::app::App) -> bool { false }
