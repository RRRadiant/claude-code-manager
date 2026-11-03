//! Claude Code Manager TUI — ratatui-based terminal interface
//! Architecture mirrors rustnet: tab bar, content area, status bar.

mod app;
mod ui;

use anyhow::Result;
use crossterm::event::{Event, KeyCode, KeyModifiers};
use ratatui::prelude::CrosstermBackend;
use std::io;
use std::time::Duration;

fn main() -> Result<()> {
    let backend = CrosstermBackend::new(io::stdout());
    let mut terminal = ui::setup_terminal(backend)?;
    let app = app::App::new()?;
    let mut ui_state = ui::UIState::default();
    let res = run_loop(&mut terminal, &app, &mut ui_state);
    ui::restore_terminal(&mut terminal)?;
    if let Err(err) = res { eprintln!("Error: {}", err); }
    Ok(())
}

fn run_loop<B: ratatui::prelude::Backend>(
    terminal: &mut ui::Terminal<B>,
    app: &app::App,
    ui_state: &mut ui::UIState,
) -> Result<()>
where <B as ratatui::prelude::Backend>::Error: Send + Sync + 'static,
{
    let tick_rate = Duration::from_millis(250);
    loop {
        // Cheap refresh only: re-read ~/.claude/ so external edits show up, but do
        // not re-probe the toolchain. Detection spawns `claude --version` — a
        // Node.js program taking hundreds of milliseconds — and running it on
        // every tick meant four process spawns per second on an idle screen.
        // `Refresh::Full` runs at startup and after any action that could have
        // changed what is installed.
        let _ = app.refresh(app::Refresh::Files);
        terminal.draw(|f| { let _ = ui::draw(f, app, ui_state); })?;
        if crossterm::event::poll(tick_rate)? {
            let event = crossterm::event::read()?;
            match event {
                Event::Key(key) => {
                    let claimed = ui::dispatch_key(ui_state.selected_tab, key, ui_state, app);
                    // Clear a pending quit on ANY other key, including one a tab
                    // claimed. Guarding this on `!claimed` left the flag set
                    // forever once a tab consumed a key, so pressing `q` twice
                    // never exited — and `q` is claimed on the tabs whose input
                    // mode swallows every character.
                    if key.code != KeyCode::Char('q') {
                        ui_state.quit_confirmation = false;
                    }
                    if !claimed {
                        match (key.code, key.modifiers) {
                            // Two-step quit. The previous version set the flag and
                            // then tested it in the same iteration, so this branch
                            // was unreachable and a single `q` exited — while the
                            // status bar still said "press q again".
                            (KeyCode::Char('q'), _) => {
                                if ui_state.quit_confirmation { break; }
                                ui_state.quit_confirmation = true;
                                ui_state.set_message("再按一次 q 退出");
                            }
                            (KeyCode::Char('c'), KeyModifiers::CONTROL) => break,
                            (KeyCode::Tab, KeyModifiers::NONE) | (KeyCode::Char(']'), KeyModifiers::NONE) => ui_state.next_tab(),
                            (KeyCode::BackTab, _) | (KeyCode::Tab, KeyModifiers::SHIFT) | (KeyCode::Char('['), KeyModifiers::NONE) => ui_state.prev_tab(),
                            (KeyCode::Char(c @ '1'..='8'), _) => ui_state.selected_tab = (c as usize) - ('1' as usize),
                            (KeyCode::Char('h'), _) => ui_state.selected_tab = ui::TAB_COUNT - 1,
                            (KeyCode::Up, _) | (KeyCode::Char('k'), _) => ui_state.scroll_up(),
                            (KeyCode::Down, _) | (KeyCode::Char('j'), _) => ui_state.scroll_down(),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}
