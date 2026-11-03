//! Terminal setup/teardown for crossterm raw mode.
use anyhow::Result;
use crossterm::{cursor, execute, terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode}};
use ratatui::prelude::CrosstermBackend;
use std::io::{self, Stdout};
pub type Terminal<B> = ratatui::Terminal<B>;
pub fn setup_terminal(b: CrosstermBackend<Stdout>) -> Result<Terminal<CrosstermBackend<Stdout>>> {
    enable_raw_mode()?; let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, cursor::Hide)?;
    Ok(Terminal::new(b)?)
}
pub fn restore_terminal(t: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    disable_raw_mode()?; execute!(io::stdout(), LeaveAlternateScreen, cursor::Show)?;
    t.show_cursor()?; Ok(())
}
