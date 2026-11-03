//! API Config tab — edit API key, base URL, default model.
use crate::app::{App, Refresh}; use crate::ui::{UIState, theme};
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{Frame, layout::{Constraint, Direction, Layout, Rect}, style::{Modifier, Style}, text::{Line, Span}, widgets::{Block, Borders, Paragraph, Wrap}};

pub fn draw(f: &mut Frame, app: &App, ui_state: &UIState, area: Rect) -> anyhow::Result<()> {
    let chunks = Layout::default().direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Length(10), Constraint::Min(0)]).split(area);
    let cur = vec![Line::from(vec![Span::styled("Key: ",theme::subtitle()),Span::raw(app.api_key_masked())]),
        Line::from(vec![Span::styled("URL: ",theme::subtitle()),Span::raw(app.base_url())])];
    f.render_widget(Paragraph::new(cur).block(Block::default().title(Span::styled(" 当前 ",theme::title())).borders(Borders::ALL).border_style(theme::border_default())),chunks[0]);
    let mut fl: Vec<Line> = vec![
        Line::from(vec![Span::styled("1 编辑 API Key",Style::default().fg(theme::accent()))]),
        Line::from(vec![Span::styled("2 编辑 Base URL",Style::default().fg(theme::accent()))]),
        Line::from(vec![Span::styled("3 切换默认模型 (sonnet→haiku→opus)",Style::default().fg(theme::accent()))]),
        Line::from(""),
    ];
    if ui_state.input_active {
        let d = if ui_state.input_password { "*".repeat(ui_state.input_buffer.len()) } else { ui_state.input_buffer.clone() };
        fl.push(Line::from(vec![Span::styled(format!("{}: ",ui_state.input_label),theme::primary()),Span::raw(d),
            Span::styled(" ▊",Style::default().fg(theme::accent()).add_modifier(Modifier::SLOW_BLINK))]));
    }
    if let Some((ref msg,_)) = ui_state.message {
        let c = if msg.contains("✓")||msg.contains("成功"){theme::ok()}else{theme::err()};
        fl.push(Line::from("")); fl.push(Line::from(vec![Span::styled(msg.as_str(),Style::default().fg(c))]));
    }
    f.render_widget(Paragraph::new(fl).block(Block::default().title(Span::styled(" 编辑 ",theme::title())).borders(Borders::ALL)
        .border_style(if ui_state.input_active{theme::border_active()}else{theme::border_default()})),chunks[1]);
    Ok(())
}
pub fn handle_key(key: KeyEvent, ui_state: &mut UIState, app: &App) -> bool {
    if ui_state.input_active {
        match key.code {
            KeyCode::Esc=>{ui_state.clear_input();return true;}
            KeyCode::Enter=>{
                let l=ui_state.input_label.clone(); let v=ui_state.input_buffer.clone(); ui_state.clear_input();
                let r = if l.contains("Key"){update_key(app,&v)}else if l.contains("URL"){update_url(app,&v)}else{Ok(())};
                match r { Ok(())=>{let _=app.refresh(Refresh::Full);ui_state.set_message("✓ 已保存");} Err(e)=>ui_state.set_message(format!("✗ {}",e)), }
                return true;
            }
            // All buffer edits go through the character-aware helpers in
            // UIState; byte-indexed editing panics on any non-ASCII input.
            KeyCode::Backspace=>{ui_state.input_backspace();return true;}
            KeyCode::Left=>{ui_state.input_left();return true;}
            KeyCode::Right=>{ui_state.input_right();return true;}
            KeyCode::Char(c)=>{ui_state.input_push(c);return true;}
            _=>return true,
        }
    }
    match key.code {
        KeyCode::Char('1')=>{
            // Seed with the REAL key, never the masked one. Pre-filling the mask
            // meant pressing Enter without typing wrote "sk-1234...wxyz" back as
            // the credential and destroyed a working key.
            let real = app.api_key_full();
            ui_state.start_input("API Key",&real,false);true
        }
        KeyCode::Char('2')=>{ui_state.start_input("Base URL",&app.base_url(),false);true}
        KeyCode::Char('3')=>{
            let nxt=match app.default_model().as_str(){"sonnet"=>"haiku","haiku"=>"opus",_=>"sonnet"};
            match update_model(app,nxt){ Ok(())=>{let _=app.refresh(Refresh::Full);ui_state.set_message(format!("✓ 模型→{}",nxt));} Err(e)=>ui_state.set_message(format!("✗ {}",e)), } true
        }
        _=>false,
    }
}

/// Write the API key, preserving every other variable in `env`.
///
/// The previous version replaced the whole `env` object with a two-key JSON
/// literal, so saving a key silently deleted `ANTHROPIC_DEFAULT_*_MODEL`,
/// `API_TIMEOUT_MS`, and anything else the user had configured — and the Models
/// tab wrote into those same keys, so the two tabs destroyed each other's work.
fn update_key(app:&App,key:&str)->anyhow::Result<()>{
    if key.is_empty(){return Ok(());}
    let mut s:serde_json::Value=if app.settings_exists(){serde_json::from_str(&app.settings_raw())?}else{serde_json::json!({})};
    if !s.get("env").map(|e| e.is_object()).unwrap_or(false) { s["env"]=serde_json::json!({}); }
    s["env"]["ANTHROPIC_AUTH_TOKEN"]=serde_json::json!(key);
    if s["env"].get("ANTHROPIC_BASE_URL").is_none() {
        s["env"]["ANTHROPIC_BASE_URL"]=serde_json::json!(app.base_url());
    }
    app.write_settings(&serde_json::to_string_pretty(&s)?)
}
fn update_url(app:&App,url:&str)->anyhow::Result<()>{ if url.is_empty(){return Ok(());} let mut s:serde_json::Value=if app.settings_exists(){serde_json::from_str(&app.settings_raw())?}else{serde_json::json!({})}; if let Some(e)=s.get_mut("env"){e["ANTHROPIC_BASE_URL"]=serde_json::json!(url);}else{s["env"]=serde_json::json!({"ANTHROPIC_BASE_URL":url});} app.write_settings(&serde_json::to_string_pretty(&s)?) }
fn update_model(app:&App,model:&str)->anyhow::Result<()>{ let mut s:serde_json::Value=if app.settings_exists(){serde_json::from_str(&app.settings_raw())?}else{serde_json::json!({})}; s["model"]=serde_json::json!(model); app.write_settings(&serde_json::to_string_pretty(&s)?) }

#[cfg(test)]
mod tests {
    use super::*;

    /// Apply the merge the production code performs, without touching `$HOME`.
    ///
    /// Mirrors `update_key`'s object handling exactly; the file IO around it is
    /// exercised by `App::write_settings`, which the integration run covers.
    fn merge_key(settings: &mut serde_json::Value, key: &str, base_url: &str) {
        if !settings.get("env").map(|e| e.is_object()).unwrap_or(false) {
            settings["env"] = serde_json::json!({});
        }
        settings["env"]["ANTHROPIC_AUTH_TOKEN"] = serde_json::json!(key);
        if settings["env"].get("ANTHROPIC_BASE_URL").is_none() {
            settings["env"]["ANTHROPIC_BASE_URL"] = serde_json::json!(base_url);
        }
    }

    #[test]
    fn saving_a_key_preserves_every_other_env_variable() {
        // The regression: `s["env"] = json!({...two keys...})` replaced the whole
        // object, so saving a key wiped the model mappings the Models tab owns —
        // and the two tabs then destroyed each other's work on every save.
        let mut s = serde_json::json!({
            "env": {
                "ANTHROPIC_AUTH_TOKEN": "old-key",
                "ANTHROPIC_BASE_URL": "https://example.invalid",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": "haiku-x",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "sonnet-x",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "opus-x",
                "API_TIMEOUT_MS": "300000"
            },
            "model": "sonnet"
        });

        merge_key(&mut s, "new-key", "https://api.anthropic.com");

        assert_eq!(s["env"]["ANTHROPIC_AUTH_TOKEN"], "new-key");
        assert_eq!(s["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"], "haiku-x");
        assert_eq!(s["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"], "sonnet-x");
        assert_eq!(s["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"], "opus-x");
        assert_eq!(s["env"]["API_TIMEOUT_MS"], "300000");
        assert_eq!(s["env"]["ANTHROPIC_BASE_URL"], "https://example.invalid");
        assert_eq!(s["model"], "sonnet");
    }

    #[test]
    fn saving_a_key_adds_a_missing_base_url() {
        let mut s = serde_json::json!({ "env": {} });
        merge_key(&mut s, "k", "https://api.deepseek.com");
        assert_eq!(s["env"]["ANTHROPIC_BASE_URL"], "https://api.deepseek.com");
    }

    #[test]
    fn saving_a_key_into_an_empty_document_creates_env() {
        let mut s = serde_json::json!({});
        merge_key(&mut s, "k", "https://api.anthropic.com");
        assert_eq!(s.pointer("/env/ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()), Some("k"));
    }

    #[test]
    fn a_non_object_env_is_replaced_rather_than_panicking() {
        // A hand-edited settings.json could hold `"env": "oops"`. Indexing into a
        // string with a key would panic; the guard has to replace it first.
        let mut s = serde_json::json!({ "env": "oops" });
        merge_key(&mut s, "k", "https://api.anthropic.com");
        assert_eq!(s.pointer("/env/ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()), Some("k"));
    }

    #[test]
    fn the_stored_value_is_the_literal_token() {
        // Contract with Claude Code: it reads this field as a literal token and
        // cannot resolve a credential reference. A placeholder here means 401s.
        let mut s = serde_json::json!({});
        merge_key(&mut s, "sk-ant-api03-literal", "https://api.anthropic.com");
        assert_eq!(
            s.pointer("/env/ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()),
            Some("sk-ant-api03-literal")
        );
    }
}
