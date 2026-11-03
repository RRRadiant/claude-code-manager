//! Config tab — file list with blinking cursor, edit & save.
use crate::app::{App, Refresh, clip}; use crate::ui::{UIState, theme};
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{Frame, layout::{Constraint, Direction, Layout, Rect}, style::{Modifier, Style}, text::{Line, Span}, widgets::{Block, Borders, Paragraph, Wrap}};

pub fn draw(f: &mut Frame, app: &App, ui_state: &UIState, area: Rect) -> anyhow::Result<()> {
    let files = app.config_files(); let sel = ui_state.scroll_offset % files.len().max(1);
    let chunks = Layout::default().direction(Direction::Vertical)
        .constraints([Constraint::Length((files.len()+3) as u16), Constraint::Min(1)]).split(area);

    let mut ll: Vec<Line> = Vec::new();
    for (i, f) in files.iter().enumerate() {
        let ic = if f.exists { "✓" } else { "✗" };
        let co = if f.exists { theme::ok() } else { theme::err() };
        if i == sel {
            ll.push(Line::from(vec![
                Span::styled(" ▸ ", Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK)),
                Span::styled(format!("{} {}", ic, f.name), Style::default().fg(co).add_modifier(Modifier::BOLD))]));
        } else {
            ll.push(Line::from(vec![Span::raw("   "), Span::styled(format!("{} {}", ic, f.name), Style::default().fg(co))]));
        }
    }
    ll.push(Line::from(""));
    ll.push(Line::from(vec![Span::styled("  ↑↓/j k 选择  Enter 编辑  s 保存  Esc 取消", theme::subtitle())]));
    f.render_widget(Paragraph::new(ll).block(Block::default().title(Span::styled(" 文件 ", theme::title())).borders(Borders::ALL).border_style(theme::border_default())), chunks[0]);

    let content = if let Some(f) = files.get(sel) {
        if ui_state.input_active { format!("  编辑: {}\n\n{}", f.name, ui_state.input_buffer) }
        else if f.exists { let c=&f.content; let pv=if c.len()>800{format!("{}\n\n  ... (Enter 编辑)", clip(&c, 800))}else{c.clone()}; format!("  {}\n\n  ... (Enter 编辑)", f.path)+&pv.lines().map(|l|format!("  {}",l)).collect::<Vec<_>>().join("\n") }
        else { "  (不存在 — Enter 创建)".to_string() }
    } else { String::new() };
    let mut display = content;
    if let Some((ref msg,_)) = ui_state.message {
        let color = if msg.contains("✓") { theme::ok() } else { theme::err() };
        display = format!("{}\n\n  {}", display, msg);
    }
    f.render_widget(Paragraph::new(display).block(Block::default().title(Span::styled(" 预览 ", theme::title())).borders(Borders::ALL)
        .border_style(if ui_state.input_active{theme::border_active()}else{theme::border_default()})), chunks[1]);
    Ok(())
}
pub fn handle_key(key: KeyEvent, ui_state: &mut UIState, app: &App) -> bool {
    let files = app.config_files();
    if ui_state.input_active {
        match key.code {
            KeyCode::Esc => { ui_state.clear_input(); return true; }
            KeyCode::Backspace => { ui_state.input_backspace(); return true; }
            KeyCode::Left => { if ui_state.input_cursor > 0 { ui_state.input_cursor-=1; } return true; }
            KeyCode::Right => { if ui_state.input_cursor < ui_state.input_buffer.len() { ui_state.input_cursor+=1; } return true; }
            KeyCode::Char(c) => { ui_state.input_push(c); return true; }
            KeyCode::Enter => { ui_state.input_push('\n'); return true; }
            _ => return true,
        }
    }
    match key.code {
        KeyCode::Up|KeyCode::Char('k')=>{if !files.is_empty()&&ui_state.scroll_offset>0{ui_state.scroll_offset-=1;}true}
        KeyCode::Down|KeyCode::Char('j')=>{if !files.is_empty(){ui_state.scroll_offset+=1;}true}
        KeyCode::Enter=>{let s=ui_state.scroll_offset%files.len().max(1);if let Some(f)=files.get(s){let c=if f.exists{app.read_config_file(&f.path).unwrap_or_default()}else{String::from("{}")};ui_state.start_input(&format!("编辑 {}",f.name),&c,false);}true}
        KeyCode::Char('s')=>{let s=ui_state.scroll_offset%files.len().max(1);if let Some(f)=files.get(s){let c=ui_state.input_buffer.clone();match app.write_config_file(&f.path,&c){Ok(())=>{let _=app.refresh(Refresh::Full);ui_state.set_message(format!("✓ {} 已保存",f.name));ui_state.clear_input();}Err(e)=>ui_state.set_message(format!("✗ {}",e)),}}true}
        _=>false,
    }
}
