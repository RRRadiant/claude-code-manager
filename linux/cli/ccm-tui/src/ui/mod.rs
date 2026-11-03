//! TUI dispatch: tab bar, content, status bar. Architecture mirrors rustnet.

use anyhow::Result;
use crossterm::event::KeyEvent;
use ratatui::{Frame, layout::{Constraint, Direction, Layout}};
use crate::app::App;

mod terminal; mod theme; mod state; mod widgets; mod tabs;
pub use terminal::{restore_terminal, setup_terminal, Terminal};
pub use state::UIState;
use widgets::{status_bar::draw_status_bar, tabs_bar::draw_tabs};

pub const TAB_TITLES: [&str; 8] = ["Status", "Install", "API", "Models", "Skills", "Agents", "Config", "Help"];
pub const TAB_COUNT: usize = TAB_TITLES.len();

pub fn draw(f: &mut Frame, app: &App, ui_state: &UIState) -> Result<()> {
    let chunks = Layout::default().direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(1), Constraint::Length(1)]).split(f.area());
    draw_tabs(f, ui_state, chunks[0]);
    draw_content(f, app, ui_state, chunks[1])?;
    draw_status_bar(f, ui_state, app, chunks[2]);
    Ok(())
}
fn draw_content(f: &mut Frame, app: &App, ui_state: &UIState, area: ratatui::layout::Rect) -> Result<()> {
    match ui_state.selected_tab {
        0 => tabs::status::draw(f, app, ui_state, area),
        1 => tabs::install::draw(f, app, ui_state, area),
        2 => tabs::api::draw(f, app, ui_state, area),
        3 => tabs::models::draw(f, app, ui_state, area),
        4 => tabs::skills::draw(f, app, ui_state, area),
        5 => tabs::agents::draw(f, app, ui_state, area),
        6 => tabs::config::draw(f, app, ui_state, area),
        7 => tabs::help::draw(f, area),
        _ => Ok(()),
    }
}
pub fn dispatch_key(tab: usize, key: KeyEvent, ui_state: &mut UIState, app: &App) -> bool {
    match tab {
        0 => tabs::status::handle_key(key, ui_state, app),
        1 => tabs::install::handle_key(key, ui_state, app),
        2 => tabs::api::handle_key(key, ui_state, app),
        3 => tabs::models::handle_key(key, ui_state, app),
        4 => tabs::skills::handle_key(key, ui_state, app),
        5 => tabs::agents::handle_key(key, ui_state, app),
        6 => tabs::config::handle_key(key, ui_state, app),
        7 => tabs::help::handle_key(key, ui_state, app),
        _ => false,
    }
}
