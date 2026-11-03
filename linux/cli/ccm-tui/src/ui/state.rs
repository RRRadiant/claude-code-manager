//! UI state — scroll, selected tab, input buffers, messages.
#[derive(Debug, Clone)]
pub struct UIState {
    pub selected_tab: usize, pub quit_confirmation: bool,
    pub scroll_offset: usize, pub visible_rows: usize,
    pub input_active: bool, pub input_buffer: String,
    pub input_label: String, pub input_password: bool, pub input_cursor: usize,
    pub input2_buffer: String, pub input2_active: bool,
    /// Pending destructive-action confirmation, keyed by the action's label.
    ///
    /// Set by a handler that wants a yes/no before acting; any key other than
    /// `y`/`Enter` clears it. Used by the Install tab, whose actions download
    /// hundreds of megabytes and modify the system.
    pub confirm: Option<String>,
    pub message: Option<(String, std::time::Instant)>,
}
impl Default for UIState {
    fn default() -> Self {
        Self { selected_tab: 0, quit_confirmation: false, scroll_offset: 0, visible_rows: 20,
            input_active: false, input_buffer: String::new(), input_label: String::new(),
            input_password: false, input_cursor: 0, input2_buffer: String::new(), input2_active: false,
            confirm: None, message: None }
    }
}
impl UIState {
    pub fn next_tab(&mut self) { self.selected_tab = (self.selected_tab + 1) % super::TAB_COUNT; }
    pub fn prev_tab(&mut self) { if self.selected_tab == 0 { self.selected_tab = super::TAB_COUNT - 1; } else { self.selected_tab -= 1; } }
    pub fn scroll_up(&mut self) { self.scroll_offset = self.scroll_offset.saturating_sub(1); }
    pub fn scroll_down(&mut self) { self.scroll_offset += 1; }
    pub fn set_message(&mut self, msg: impl Into<String>) { self.message = Some((msg.into(), std::time::Instant::now())); }
    pub fn clear_input(&mut self) { self.input_active = false; self.input_buffer.clear(); self.input_label.clear(); self.input_cursor = 0; }
    pub fn start_input(&mut self, label: &str, initial: &str, password: bool) {
        self.input_active = true; self.input_label = label.to_string();
        self.input_buffer = initial.to_string(); self.input_password = password;
        self.input_cursor = initial.len(); self.input2_active = false; self.input2_buffer.clear();
    }

    // -- Character-aware editing -------------------------------------------
    //
    // `input_cursor` is a *byte* offset, because that is what `String::insert`
    // and `remove` take. Every editor in this crate used to advance it by one per
    // keystroke and pass it straight to those methods, so typing a single
    // non-ASCII character (any Chinese text, which this UI is full of) and then
    // pressing Backspace panicked with "byte index N is not a char boundary".
    // These helpers keep the cursor on a boundary for every operation.

    /// Byte offset of the character boundary immediately before the cursor.
    fn prev_boundary(&self) -> usize {
        let mut i = self.input_cursor.saturating_sub(1);
        while i > 0 && !self.input_buffer.is_char_boundary(i) { i -= 1; }
        i
    }

    /// Byte offset of the character boundary immediately after the cursor.
    fn next_boundary(&self) -> usize {
        let len = self.input_buffer.len();
        let mut i = (self.input_cursor + 1).min(len);
        while i < len && !self.input_buffer.is_char_boundary(i) { i += 1; }
        i
    }

    /// Insert a character at the cursor and advance past it.
    pub fn input_push(&mut self, c: char) {
        let at = self.input_cursor.min(self.input_buffer.len());
        let at = if self.input_buffer.is_char_boundary(at) { at } else { self.prev_boundary() };
        self.input_buffer.insert(at, c);
        self.input_cursor = at + c.len_utf8();
    }

    /// Delete the character before the cursor.
    pub fn input_backspace(&mut self) {
        if self.input_cursor == 0 { return; }
        let from = self.prev_boundary();
        self.input_buffer.remove(from);
        self.input_cursor = from;
    }

    /// Move the cursor one character left.
    pub fn input_left(&mut self) {
        if self.input_cursor > 0 { self.input_cursor = self.prev_boundary(); }
    }

    /// Move the cursor one character right.
    pub fn input_right(&mut self) {
        if self.input_cursor < self.input_buffer.len() { self.input_cursor = self.next_boundary(); }
    }

    /// Pop the last character of the secondary buffer (the description field).
    pub fn input2_backspace(&mut self) { self.input2_buffer.pop(); }

    /// The buffer as shown in a masked field: one `*` per *character*.
    pub fn display_buffer(&self) -> String {
        if self.input_password { "*".repeat(self.input_buffer.chars().count()) } else { self.input_buffer.clone() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn editing(initial: &str) -> UIState {
        let mut s = UIState::default();
        s.start_input("test", initial, false);
        s
    }

    #[test]
    fn typing_and_deleting_ascii_round_trips() {
        let mut s = editing("");
        for c in "sk-ant-1234".chars() { s.input_push(c); }
        assert_eq!(s.input_buffer, "sk-ant-1234");
        assert_eq!(s.input_cursor, 11);

        for _ in 0..4 { s.input_backspace(); }
        assert_eq!(s.input_buffer, "sk-ant-");
        assert_eq!(s.input_cursor, 7);
    }

    #[test]
    fn multibyte_input_does_not_panic() {
        // The regression. Every editor advanced `input_cursor` by one per
        // keystroke and handed it to `String::insert`/`remove`, which take byte
        // offsets — so entering any non-ASCII character and then editing panicked
        // with "byte index N is not a char boundary". Without a panic hook that
        // also left the terminal in raw mode on the alternate screen.
        let mut s = editing("");
        for c in "中文密钥".chars() { s.input_push(c); }
        assert_eq!(s.input_buffer, "中文密钥");
        assert_eq!(s.input_cursor, s.input_buffer.len(), "cursor must sit on a boundary");

        s.input_backspace();
        assert_eq!(s.input_buffer, "中文密");
        s.input_backspace();
        assert_eq!(s.input_buffer, "中文");

        // Mixed content, edited in the middle.
        s.input_left();
        s.input_push('X');
        assert_eq!(s.input_buffer, "中X文");
        s.input_backspace();
        assert_eq!(s.input_buffer, "中文");
    }

    #[test]
    fn cursor_movement_never_lands_mid_character() {
        let mut s = editing("a中b");
        // Walk left across the whole string and back, checking the invariant at
        // every stop.
        for _ in 0..10 {
            s.input_left();
            assert!(s.input_buffer.is_char_boundary(s.input_cursor));
        }
        assert_eq!(s.input_cursor, 0);
        for _ in 0..10 {
            s.input_right();
            assert!(s.input_buffer.is_char_boundary(s.input_cursor));
        }
        assert_eq!(s.input_cursor, s.input_buffer.len());
    }

    #[test]
    fn backspace_at_the_start_is_a_no_op() {
        let mut s = editing("abc");
        s.input_cursor = 0;
        s.input_backspace();
        assert_eq!(s.input_buffer, "abc");
        assert_eq!(s.input_cursor, 0);
    }

    #[test]
    fn pushing_past_the_end_appends() {
        let mut s = editing("ab");
        s.input_cursor = s.input_buffer.len();
        s.input_push('中');
        s.input_push('c');
        assert_eq!(s.input_buffer, "ab中c");
    }

    #[test]
    fn masked_display_counts_characters_not_bytes() {
        // `"*".repeat(buf.len())` printed six stars for two Chinese characters.
        let mut s = UIState::default();
        s.start_input("key", "中文", true);
        assert_eq!(s.display_buffer(), "**");
    }

    #[test]
    fn secondary_buffer_backspace_is_character_aware() {
        let mut s = editing("");
        s.input2_buffer.push_str("描述");
        s.input2_backspace();
        assert_eq!(s.input2_buffer, "描");
    }
}
