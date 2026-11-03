//! Status tab — dashboard with scrollable skills list and blinking cursor.
use crate::app::App; use crate::ui::{UIState, theme};
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{Frame, layout::{Constraint, Direction, Layout, Rect}, style::{Modifier, Style}, text::{Line, Span}, widgets::{Block, Borders, Paragraph, Wrap}};

pub fn draw(f: &mut Frame, app: &App, ui_state: &UIState, area: Rect) -> anyhow::Result<()> {
    let chunks = Layout::default().direction(Direction::Vertical)
        .constraints([Constraint::Length(7), Constraint::Length(7), Constraint::Length(7), Constraint::Min(1)]).split(area);
    draw_cli(f, app, chunks[0]);
    draw_api(f, app, chunks[1]);
    draw_models(f, app, chunks[2]);
    draw_skills(f, app, ui_state, chunks[3]);
    Ok(())
}
fn draw_cli(f: &mut Frame, app: &App, area: Rect) {
    let cli = app.cli();
    let s = if cli.installed { Span::styled(format!("✓ {}", cli.version), Style::default().fg(theme::ok())) }
    else { Span::styled("✗ 未安装 — 按 2 切换到 Install", Style::default().fg(theme::err())) };
    let deps = format!("curl: {}  git: {}  npm: {}", icon(app.has_curl()), icon(app.has_git()), icon(app.has_npm()));
    let text = vec![Line::from(vec![Span::styled("CLI: ", theme::subtitle()), s]),
        Line::from(""), Line::from(vec![Span::styled("依赖: ", theme::subtitle()), Span::raw(deps)])];
    f.render_widget(Paragraph::new(text).block(Block::default().title(Span::styled(" CLI ", theme::title())).borders(Borders::ALL).border_style(theme::border_default())), area);
}
fn draw_api(f: &mut Frame, app: &App, area: Rect) {
    let ks = if app.api_key_masked() != "未配置" { Span::styled(format!("✓ {}", app.api_key_masked()), Style::default().fg(theme::ok())) }
    else { Span::styled("✗ 未配置 — 按 3 切换", Style::default().fg(theme::err())) };
    let text = vec![Line::from(vec![Span::styled("Key:  ", theme::subtitle()), ks]),
        Line::from(vec![Span::styled("URL:  ", theme::subtitle()), Span::raw(app.base_url())]),
        Line::from(vec![Span::styled("模型: ", theme::subtitle()), Span::raw(app.default_model())])];
    f.render_widget(Paragraph::new(text).block(Block::default().title(Span::styled(" API ", theme::title())).borders(Borders::ALL).border_style(theme::border_default())), area);
}
fn draw_models(f: &mut Frame, app: &App, area: Rect) {
    let hm=app.haiku_model(); let sm=app.sonnet_model(); let om=app.opus_model();
    let h=if hm.is_empty(){"(默认)"}else{hm.as_str()}; let s=if sm.is_empty(){"(默认)"}else{sm.as_str()}; let o=if om.is_empty(){"(默认)"}else{om.as_str()};
    let text=vec![Line::from(vec![Span::styled("Haiku:  ",theme::subtitle()),Span::raw(h)]),Line::from(""),
        Line::from(vec![Span::styled("Sonnet: ",theme::subtitle()),Span::raw(s)]),Line::from(""),
        Line::from(vec![Span::styled("Opus:   ",theme::subtitle()),Span::raw(o)])];
    f.render_widget(Paragraph::new(text).block(Block::default().title(Span::styled(" 模型 ",theme::title())).borders(Borders::ALL).border_style(theme::border_default())),area);
}
fn draw_skills(f: &mut Frame, app: &App, ui_state: &UIState, area: Rect) {
    let skills=app.skills(); let mut text=vec![
        Line::from(vec![Span::styled("Skills: ",theme::subtitle()),Span::raw(format!("{} 个",skills.len())),
            Span::styled("    Agents: ",theme::subtitle()),Span::raw(format!("{} 个",app.agents().len())),
            Span::styled("  (↑↓ 滚动)",theme::subtitle())]),
        Line::from(""),
    ];
    if skills.is_empty() { text.push(Line::from(vec![Span::raw("  (无Skills — 按 5 跳转)")])); }
    else { for (i,s) in skills.iter().enumerate() { if i<ui_state.scroll_offset{continue;}
        let d=if s.description.is_empty(){String::new()}else{format!(" — {}",s.description)};
        if i==ui_state.scroll_offset {
            text.push(Line::from(vec![Span::styled(" ▸ ⚡ ",Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK)),
                Span::styled(&s.name,theme::primary().add_modifier(Modifier::BOLD)),Span::raw(d)]));
        } else { text.push(Line::from(vec![Span::raw("   ⚡ "),Span::styled(&s.name,theme::primary()),Span::raw(d)])); }
    }}
    f.render_widget(Paragraph::new(text).block(Block::default().title(Span::styled(" Skills ",theme::title())).borders(Borders::ALL).border_style(theme::border_default())),area);
}
fn icon(ok:bool)->&'static str { if ok{"✓"}else{"✗"} }
pub fn handle_key(key:KeyEvent,ui_state:&mut UIState,_app:&App)->bool {
    let skills=_app.skills();
    match key.code {
        KeyCode::Up|KeyCode::Char('k')=>{ if ui_state.scroll_offset>0{ui_state.scroll_offset-=1;} true }
        KeyCode::Down|KeyCode::Char('j')=>{ if ui_state.scroll_offset+1<skills.len(){ui_state.scroll_offset+=1;} true }
        _=>false,
    }
}
