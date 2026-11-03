//! Skills tab — list with blinking cursor, n=new, d=delete.
use crate::app::{App, Refresh}; use crate::ui::{UIState, theme};
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{Frame, layout::Rect, style::{Modifier, Style}, text::{Line, Span}, widgets::{Block, Borders, Paragraph, Wrap}};

pub fn draw(f: &mut Frame, app: &App, ui_state: &UIState, area: Rect) -> anyhow::Result<()> {
    let skills = app.skills(); let mut lines: Vec<Line> = Vec::new();
    if skills.is_empty() {
        lines.push(Line::from(vec![Span::styled("  暂无 Skills — 按 n 创建", theme::subtitle())]));
    } else {
        lines.push(Line::from(vec![Span::styled(format!("  Skills: {} 个  (↑↓/j k 移动  n 新建  d 删除)", skills.len()), theme::subtitle())]));
        lines.push(Line::from(""));
        for (i, s) in skills.iter().enumerate() {
            if i < ui_state.scroll_offset { continue; }
            let desc = if s.description.is_empty() { String::new() } else { format!("  —  {}", s.description) };
            if i == ui_state.scroll_offset {
                lines.push(Line::from(vec![
                    Span::styled(" ▸ ", Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK)),
                    Span::styled("⚡", Style::default().fg(theme::warn())),
                    Span::styled(format!(" {}", s.name), theme::primary().add_modifier(Modifier::BOLD)),
                    Span::raw(desc)]));
            } else {
                lines.push(Line::from(vec![
                    Span::raw("   "), Span::styled("⚡", Style::default().fg(theme::warn())),
                    Span::styled(format!(" {}", s.name), theme::primary()), Span::raw(desc)]));
            }
        }
    }
    if ui_state.input_active {
        lines.push(Line::from("")); lines.push(Line::from("── 新建 ──".to_string()));
        lines.push(Line::from(vec![Span::styled(format!("  名称: {}", ui_state.input_buffer), Style::default().fg(theme::accent())),
            Span::styled(if ui_state.input2_active { "" } else { " ▊" }, Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK))]));
        if !ui_state.input2_buffer.is_empty() || ui_state.input2_active {
            lines.push(Line::from(vec![Span::styled(format!("  描述: {}", ui_state.input2_buffer), Style::default().fg(theme::accent())),
                Span::styled(if ui_state.input2_active { " ▊" } else { "" }, Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK))]));
        }
    }
    if let Some((ref msg, _)) = ui_state.message { lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled(format!("  {}", msg), Style::default().fg(if msg.contains("✓") { theme::ok() } else { theme::err() }))])); }
    f.render_widget(Paragraph::new(lines).block(Block::default().title(Span::styled(" Skills ", theme::title())).borders(Borders::ALL)
        .border_style(if ui_state.input_active { theme::border_active() } else { theme::border_default() })), area);
    Ok(())
}
pub fn handle_key(key: KeyEvent, ui_state: &mut UIState, app: &App) -> bool {
    if ui_state.input_active {
        match key.code {
            KeyCode::Esc => { ui_state.clear_input(); return true; }
            KeyCode::Enter => {
                if ui_state.input2_active {
                    let n = ui_state.input_buffer.clone(); let d = ui_state.input2_buffer.clone(); ui_state.clear_input();
                    match app.create_skill(&n, &d) { Ok(()) => { let _ = app.refresh(Refresh::Full); ui_state.set_message(format!("✓ '{}' 已创建", n)); }
                        Err(e) => ui_state.set_message(format!("✗ {}", e)), }
                } else { ui_state.input2_active = true; } return true;
            }
            KeyCode::Tab => { ui_state.input2_active = !ui_state.input2_active; return true; }
            KeyCode::Backspace => {
                if ui_state.input2_active { ui_state.input2_backspace(); } else { ui_state.input_backspace(); }
                return true;
            }
            KeyCode::Left | KeyCode::Right => return true,
            KeyCode::Char(c) => {
                if ui_state.input2_active { ui_state.input2_buffer.push(c); } else { ui_state.input_push(c); }
                return true;
            }
            _ => return true,
        }
    }
    let skills = app.skills();
    match key.code {
        KeyCode::Up | KeyCode::Char('k') => { if ui_state.scroll_offset > 0 { ui_state.scroll_offset -= 1; } true }
        KeyCode::Down | KeyCode::Char('j') => { if ui_state.scroll_offset + 1 < skills.len() { ui_state.scroll_offset += 1; } true }
        KeyCode::Char('n') => { ui_state.start_input("Skill 名称", "", false); ui_state.input2_active = false; ui_state.input2_buffer.clear(); true }
        KeyCode::Char('d') => {
            if let Some(s) = skills.get(ui_state.scroll_offset) {
                let name = s.name.clone(); let f = s.path.rsplit('/').next().unwrap_or("").to_string();
                match app.delete_skill(&f) { Ok(()) => { let _ = app.refresh(Refresh::Full); ui_state.set_message(format!("✓ '{}' 已删除", name)); } Err(e) => ui_state.set_message(format!("✗ {}", e)), }
            } true
        }
        KeyCode::Enter => { if let Some(s) = skills.get(ui_state.scroll_offset) { let c = std::fs::read_to_string(&s.path).unwrap_or_default(); ui_state.set_message(format!("{}: {} 字符", s.name, c.chars().count())); } true }
        _ => false,
    }
}
