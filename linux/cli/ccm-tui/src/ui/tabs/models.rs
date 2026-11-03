//! Models tab — cursor-based model mapping editor.
use crate::app::{App, Refresh}; use crate::ui::{UIState, theme};
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{Frame, layout::{Constraint, Direction, Layout, Rect}, style::{Modifier, Style}, text::{Line, Span}, widgets::{Block, Borders, Paragraph, Wrap}};

const SLOTS: &[(&str, fn(&App)->String)] = &[
    ("Haiku", |a|if a.haiku_model().is_empty(){"(官方默认)".into()}else{a.haiku_model()}),
    ("Sonnet", |a|if a.sonnet_model().is_empty(){"(官方默认)".into()}else{a.sonnet_model()}),
    ("Opus", |a|if a.opus_model().is_empty(){"(官方默认)".into()}else{a.opus_model()}),
];

pub fn draw(f: &mut Frame, app: &App, ui_state: &UIState, area: Rect) -> anyhow::Result<()> {
    let sel = ui_state.scroll_offset % SLOTS.len();
    let chunks = Layout::default().direction(Direction::Vertical)
        .constraints([Constraint::Length(8), Constraint::Min(1)]).split(area);

    let mut cur: Vec<Line> = vec![Line::from(vec![Span::styled(" 自定义模型 ID — DeepSeek/OpenAI 兼容",theme::subtitle())]),Line::from("")];
    for (i,(l,g)) in SLOTS.iter().enumerate() {
        let v=g(app);
        if i==sel { cur.push(Line::from(vec![Span::styled(" ▸ ",Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK)),
            Span::styled(format!("{}:  ",l),theme::primary().add_modifier(Modifier::BOLD)),Span::raw(v)])); }
        else { cur.push(Line::from(vec![Span::raw("   "),Span::styled(format!("{}:  ",l),theme::subtitle()),Span::raw(v)])); }
    }
    f.render_widget(Paragraph::new(cur).block(Block::default().title(Span::styled(" 映射 ",theme::title())).borders(Borders::ALL).border_style(theme::border_default())),chunks[0]);

    let mut fl = vec![Line::from(""),Line::from(vec![Span::styled("  ↑↓ 选择  Enter 编辑  Esc 取消  1/2/3 快捷键",theme::subtitle())])];
    if ui_state.input_active {
        fl.push(Line::from(""));
        fl.push(Line::from(vec![Span::styled(format!("{}: ",ui_state.input_label),theme::primary()),Span::raw(&ui_state.input_buffer),
            Span::styled(" ▊",Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK))]));
    }
    if let Some((ref msg,_))=ui_state.message { fl.push(Line::from("")); fl.push(Line::from(vec![Span::styled(format!("  {}",msg),Style::default().fg(if msg.contains("✓"){theme::ok()}else{theme::err()}))])); }
    f.render_widget(Paragraph::new(fl).block(Block::default().title(Span::styled(" 编辑 ",theme::title())).borders(Borders::ALL)
        .border_style(if ui_state.input_active{theme::border_active()}else{theme::border_default()})),chunks[1]);
    Ok(())
}
pub fn handle_key(key: KeyEvent, ui_state: &mut UIState, app: &App) -> bool {
    if ui_state.input_active {
        match key.code {
            KeyCode::Esc=>{ui_state.clear_input();return true;}
            KeyCode::Enter=>{
                let l=ui_state.input_label.clone();let v=ui_state.input_buffer.clone();
                let mk=if l.contains("Haiku"){"ANTHROPIC_DEFAULT_HAIKU_MODEL"}else if l.contains("Sonnet"){"ANTHROPIC_DEFAULT_SONNET_MODEL"}else{"ANTHROPIC_DEFAULT_OPUS_MODEL"};
                ui_state.clear_input(); match update(app,mk,&v){ Ok(())=>{let _=app.refresh(Refresh::Full);ui_state.set_message("✓ 已保存");} Err(e)=>ui_state.set_message(format!("✗ {}",e)), } return true;
            }
            KeyCode::Backspace=>{ui_state.input_backspace();return true;}
            KeyCode::Left=>{if ui_state.input_cursor>0{ui_state.input_cursor-=1;}return true;}
            KeyCode::Right=>{if ui_state.input_cursor<ui_state.input_buffer.len(){ui_state.input_cursor+=1;}return true;}
            KeyCode::Char(c)=>{ui_state.input_push(c);return true;}
            _=>return true,
        }
    }
    match key.code {
        KeyCode::Up|KeyCode::Char('k')=>{ui_state.scroll_offset=if ui_state.scroll_offset>0{ui_state.scroll_offset-1}else{SLOTS.len()-1};true}
        KeyCode::Down|KeyCode::Char('j')=>{ui_state.scroll_offset=(ui_state.scroll_offset+1)%SLOTS.len();true}
        KeyCode::Enter=>{let(l,g)=SLOTS[ui_state.scroll_offset%SLOTS.len()];ui_state.start_input(&format!("{} 模型 ID",l),&g(app),false);true}
        KeyCode::Char('1')=>{ui_state.scroll_offset=0;ui_state.start_input("Haiku 模型 ID",&SLOTS[0].1(app),false);true}
        KeyCode::Char('2')=>{ui_state.scroll_offset=1;ui_state.start_input("Sonnet 模型 ID",&SLOTS[1].1(app),false);true}
        KeyCode::Char('3')=>{ui_state.scroll_offset=2;ui_state.start_input("Opus 模型 ID",&SLOTS[2].1(app),false);true}
        _=>false,
    }
}
fn update(app:&App,key:&str,value:&str)->anyhow::Result<()>{
    let mut s:serde_json::Value=if app.settings_exists(){serde_json::from_str(&app.settings_raw())?}else{serde_json::json!({})};
    if value.is_empty() { if let Some(e)=s.get_mut("env") { if let Some(o)=e.as_object_mut(){o.remove(key);} } }
    else { if let Some(e)=s.get_mut("env"){e[key]=serde_json::json!(value);}else{s["env"]=serde_json::json!({key:value});} }
    app.write_settings(&serde_json::to_string_pretty(&s)?)
}
