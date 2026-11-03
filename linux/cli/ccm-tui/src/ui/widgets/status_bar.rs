//! Bottom status bar — contextual keybinding hints per tab.
use ratatui::{Frame, layout::{Alignment, Rect}, widgets::Paragraph};
use crate::app::App; use crate::ui::{UIState, theme};
fn default_status(tab: usize) -> &'static str {
    match tab {
        0 => " 1-8 跳标签 | Tab 切换 | ↑↓/j k 滚动 | q 退出",
        1 => " ↑↓ 选择方式 | Enter 安装 | r 刷新 | 1/2/3 快捷 | q 退出",
        2 => " 1 编辑Key | 2 编辑URL | 3 切换模型 | q 退出",
        3 => " ↑↓ 选择模型 | Enter 编辑 | 1/2/3 快捷 | q 退出",
        4 => " ↑↓/j k 移动 | n 新建 | d 删除 | Enter 查看 | q 退出",
        5 => " ↑↓/j k 移动 | n 新建 | d 删除 | Enter 查看 | q 退出",
        6 => " ↑↓/j k 选择文件 | Enter 编辑 | s 保存 | Esc 取消 | q 退出",
        _ => " 1-8 跳标签 | h 帮助 | q 退出",
    }
}
pub fn draw_status_bar(f: &mut Frame, ui_state: &UIState, _app: &App, area: Rect) {
    let status = if ui_state.quit_confirmation { " 再按一次 q 退出 ".into() }
    else if let Some((ref msg, ref time)) = ui_state.message { if time.elapsed().as_secs() < 3 { format!(" {} ", msg) } else { default_status(ui_state.selected_tab).into() } }
    else if ui_state.input_active { format!(" {} (Enter=确认 Esc=取消) ", ui_state.input_label) }
    else { default_status(ui_state.selected_tab).to_string() };
    let style = if ui_state.quit_confirmation { theme::status_bar_confirm() } else { theme::status_bar_default() };
    f.render_widget(Paragraph::new(status).style(style).alignment(Alignment::Left), area);
}
