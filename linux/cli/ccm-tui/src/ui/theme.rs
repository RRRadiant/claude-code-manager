//! Color palette — 7-slot base, mirors rustnet's theme approach.
use ratatui::style::{Color, Modifier, Style};
const C: Color = Color::Cyan; const G: Color = Color::Green; const Y: Color = Color::Yellow;
const R: Color = Color::Red; const B: Color = Color::Blue; const M: Color = Color::Magenta; const GR: Color = Color::Gray;
pub fn accent() -> Color { C } pub fn ok() -> Color { G } pub fn warn() -> Color { Y }
pub fn err() -> Color { R } pub fn info() -> Color { B } pub fn special() -> Color { M } pub fn muted() -> Color { GR }
pub fn primary() -> Style { Style::default().fg(accent()).add_modifier(Modifier::BOLD) }
pub fn heading() -> Color { warn() }
pub fn title() -> Style { Style::default().fg(accent()).add_modifier(Modifier::BOLD) }
pub fn subtitle() -> Style { Style::default().fg(muted()) }
pub fn border_default() -> Style { Style::default().fg(muted()) }
pub fn border_active() -> Style { Style::default().fg(accent()) }
pub fn status_bar_default() -> Style { Style::default().fg(info()).add_modifier(Modifier::REVERSED) }
pub fn status_bar_confirm() -> Style { Style::default().fg(warn()).add_modifier(Modifier::BOLD | Modifier::REVERSED) }
