//! Top tab bar — active tab highlighted with reverse-video pill.
use ratatui::{Frame, layout::Rect, style::{Modifier, Style}, text::Line, widgets::Tabs};
use crate::ui::{TAB_TITLES, UIState, theme};
pub fn draw_tabs(f: &mut Frame, ui_state: &UIState, area: Rect) {
    let titles: Vec<Line> = TAB_TITLES.iter().map(|t| Line::from(format!(" {} ", t))).collect();
    let tabs = Tabs::new(titles).select(ui_state.selected_tab)
        .padding_left("").padding_right("").divider(" ▏ ")
        .style(Style::default().fg(theme::muted()))
        .highlight_style(theme::primary().add_modifier(Modifier::REVERSED));
    f.render_widget(tabs, area);
}
