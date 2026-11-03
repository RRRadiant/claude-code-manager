//! Application state — reads and caches all Claude Code configuration from ~/.claude/

use anyhow::Result;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn claude_dir() -> PathBuf { dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp")).join(".claude") }
fn settings_path() -> PathBuf { claude_dir().join("settings.json") }
fn agents_dir() -> PathBuf { claude_dir().join("agents") }
fn commands_dir() -> PathBuf { claude_dir().join("commands") }

#[derive(Debug, Clone)] pub struct CliStatus { pub installed: bool, pub version: String, pub path: String }
#[derive(Debug, Clone)] pub struct ConfigEntry { pub path: String, pub name: String, pub content: String, pub exists: bool }
#[derive(Debug, Clone)] pub struct SkillEntry { pub name: String, pub path: String, pub description: String, pub argument_hint: String }
#[derive(Debug, Clone)] pub struct AgentEntry { pub name: String, pub filename: String, pub description: String, pub model: String, pub tools: Vec<String>, pub enabled: bool }

pub struct App { inner: Arc<Mutex<AppInner>> }
struct AppInner {
    cli: CliStatus, settings: Value, settings_exists: bool,
    api_key_masked: String, api_key_full: String, base_url: String, default_model: String,
    haiku_model: String, sonnet_model: String, opus_model: String,
    skills: Vec<SkillEntry>, agents: Vec<AgentEntry>, config_files: Vec<ConfigEntry>,
    has_curl: bool, has_git: bool, has_npm: bool, has_python: bool,
}

/// How much work a refresh should do.
///
/// The event loop redraws four times a second, and the two halves of a refresh
/// have wildly different costs: re-reading `~/.claude/` is a few small file
/// reads, while detecting the CLI spawns `claude --version` — a Node.js program
/// that takes hundreds of milliseconds to start. Doing the expensive half on
/// every tick spawned that process four times a second and burned CPU on an idle
/// screen. The tick now uses `Files`, and `Full` runs at startup and after an
/// action that could have changed what is installed.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Refresh { Full, Files }

impl App {
    pub fn new() -> Result<Self> {
        let inner = AppInner {
            cli: CliStatus { installed: false, version: String::new(), path: String::new() },
            settings: Value::Null, settings_exists: false,
            api_key_masked: String::new(), api_key_full: String::new(),
            base_url: String::from("https://api.anthropic.com"),
            default_model: String::from("sonnet"), haiku_model: String::new(),
            sonnet_model: String::new(), opus_model: String::new(),
            skills: Vec::new(), agents: Vec::new(), config_files: Vec::new(),
            has_curl: false, has_git: false, has_npm: false, has_python: false,
        };
        let app = Self { inner: Arc::new(Mutex::new(inner)) };
        app.refresh(Refresh::Full)?;
        Ok(app)
    }

    /// Re-read `~/.claude/` and, when asked, re-probe the toolchain.
    pub fn refresh(&self, mode: Refresh) -> Result<()> {
        let i = &mut *self.inner.lock().unwrap();
        if mode == Refresh::Full {
            i.cli = detect_cli();
            i.has_curl = which::which("curl").is_ok(); i.has_git = which::which("git").is_ok();
            i.has_npm = which::which("npm").is_ok(); i.has_python = which::which("python3").is_ok();
        }
        let sp = settings_path(); i.settings_exists = sp.exists();
        i.settings = if i.settings_exists { serde_json::from_str(&fs::read_to_string(&sp).unwrap_or_default()).unwrap_or(Value::Null) } else { Value::Null };
        i.api_key_full = i.settings.pointer("/env/ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()).unwrap_or("").to_string();
        i.api_key_masked = mask_key(&i.api_key_full);
        i.base_url = i.settings.pointer("/env/ANTHROPIC_BASE_URL").and_then(|v| v.as_str()).unwrap_or("https://api.anthropic.com").to_string();
        i.default_model = i.settings.pointer("/model").and_then(|v| v.as_str()).unwrap_or("sonnet").to_string();
        i.haiku_model = i.settings.pointer("/env/ANTHROPIC_DEFAULT_HAIKU_MODEL").and_then(|v| v.as_str()).unwrap_or("").to_string();
        i.sonnet_model = i.settings.pointer("/env/ANTHROPIC_DEFAULT_SONNET_MODEL").and_then(|v| v.as_str()).unwrap_or("").to_string();
        i.opus_model = i.settings.pointer("/env/ANTHROPIC_DEFAULT_OPUS_MODEL").and_then(|v| v.as_str()).unwrap_or("").to_string();
        i.skills = load_skills(); i.agents = load_agents(); i.config_files = list_config_files();
        Ok(())
    }

    // Accessors
    pub fn cli(&self) -> CliStatus { self.inner.lock().unwrap().cli.clone() }
    pub fn api_key_masked(&self) -> String { self.inner.lock().unwrap().api_key_masked.clone() }
    /// The real key, for pre-filling an edit field.
    ///
    /// Deliberately separate from the masked accessor. Seeding an editor with the
    /// *masked* value meant pressing Enter without typing wrote the placeholder
    /// back as the credential, silently destroying a working key.
    pub fn api_key_full(&self) -> String { self.inner.lock().unwrap().api_key_full.clone() }
    pub fn base_url(&self) -> String { self.inner.lock().unwrap().base_url.clone() }
    pub fn default_model(&self) -> String { self.inner.lock().unwrap().default_model.clone() }
    pub fn haiku_model(&self) -> String { self.inner.lock().unwrap().haiku_model.clone() }
    pub fn sonnet_model(&self) -> String { self.inner.lock().unwrap().sonnet_model.clone() }
    pub fn opus_model(&self) -> String { self.inner.lock().unwrap().opus_model.clone() }
    pub fn settings_exists(&self) -> bool { self.inner.lock().unwrap().settings_exists }
    pub fn settings_raw(&self) -> String { serde_json::to_string_pretty(&self.inner.lock().unwrap().settings).unwrap_or_default() }
    pub fn skills(&self) -> Vec<SkillEntry> { self.inner.lock().unwrap().skills.clone() }
    pub fn agents(&self) -> Vec<AgentEntry> { self.inner.lock().unwrap().agents.clone() }
    pub fn config_files(&self) -> Vec<ConfigEntry> { self.inner.lock().unwrap().config_files.clone() }
    pub fn has_curl(&self) -> bool { self.inner.lock().unwrap().has_curl }
    pub fn has_git(&self) -> bool { self.inner.lock().unwrap().has_git }
    pub fn has_npm(&self) -> bool { self.inner.lock().unwrap().has_npm }
    pub fn has_python(&self) -> bool { self.inner.lock().unwrap().has_python }
    pub fn all_deps_ok(&self) -> bool { let i = self.inner.lock().unwrap(); i.has_curl && i.has_git && i.has_npm }

    // Mutations
    pub fn write_settings(&self, json: &str) -> Result<()> {
        let sp = settings_path(); if let Some(p) = sp.parent() { fs::create_dir_all(p)?; }
        let _: Value = serde_json::from_str(json)?; fs::write(&sp, json)?;
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; let _ = fs::set_permissions(&sp, fs::Permissions::from_mode(0o600)); }
        Ok(())
    }
    pub fn create_skill(&self, name: &str, description: &str) -> Result<()> {
        let dir = commands_dir(); fs::create_dir_all(&dir)?;
        fs::write(dir.join(format!("{}.md", sanitize(name))), format!("---\ndescription: {}\nargument-hint:\n---\n", description))?;
        Ok(())
    }
    pub fn delete_skill(&self, filename: &str) -> Result<()> { let p = commands_dir().join(filename); if p.exists() { fs::remove_file(p)?; } Ok(()) }
    pub fn create_agent(&self, name: &str, description: &str, model: &str) -> Result<()> {
        let dir = agents_dir(); fs::create_dir_all(&dir)?;
        let m = if model.is_empty() || model == "default" { String::new() } else { format!("model: {}\n", model) };
        fs::write(dir.join(format!("{}.md", sanitize(name))), format!("---\nname: {}\ndescription: {}\n{}---\n\n# {}\n\n", name, description, m, name))?;
        Ok(())
    }
    pub fn delete_agent(&self, filename: &str) -> Result<()> { let p = agents_dir().join(filename); if p.exists() { fs::remove_file(p)?; } Ok(()) }
    pub fn read_config_file(&self, path: &str) -> Result<String> { Ok(fs::read_to_string(path)?) }
    pub fn write_config_file(&self, path: &str, content: &str) -> Result<()> { fs::write(path, content)?; Ok(()) }
}

/// Take at most `max` bytes from the front, never splitting a character.
///
/// Every previous truncation in this crate sliced by byte index (`&s[..800]`,
/// `&s[..12]`), which panics with "byte index N is not a char boundary" as soon
/// as the text contains anything non-ASCII — a Chinese error message from npm, a
/// CLAUDE.md written in Chinese, a key with a non-ASCII character. Panicking
/// inside a TUI is worse than a wrong length: without a panic hook the terminal
/// is left in raw mode and the alternate screen.
pub fn clip(s: &str, max: usize) -> &str {
    if s.len() <= max { return s; }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) { end -= 1; }
    &s[..end]
}

fn mask_key(key: &str) -> String {
    if key.is_empty() { return "未配置".into(); }
    if key.chars().count() <= 20 { return format!("{}...", clip(key, 15)); }
    // Keep the last four *characters*, not the last four bytes.
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{}...{}", clip(key, 12), tail)
}
fn sanitize(name: &str) -> String {
    name.to_lowercase().chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>().split('-').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-")
}
fn detect_cli() -> CliStatus {
    match which::which("claude") {
        Ok(path) => {
            let v = std::process::Command::new(&path).arg("--version").output().ok()
                .and_then(|o| String::from_utf8(o.stdout).ok()).unwrap_or_default().trim().to_string();
            CliStatus { installed: true, version: v, path: path.to_string_lossy().to_string() }
        }
        Err(_) => CliStatus { installed: false, version: String::new(), path: String::new() },
    }
}
fn load_skills() -> Vec<SkillEntry> {
    let dir = commands_dir(); if !dir.exists() { return vec![]; }
    let mut s = vec![];
    if let Ok(e) = fs::read_dir(&dir) { for en in e.flatten() {
        let p = en.path(); let n = p.file_stem().unwrap_or_default().to_string_lossy();
        if n.starts_with('_') { continue; }
        let c = fs::read_to_string(&p).unwrap_or_default();
        let (d, h) = parse_fm(&c, "description", "argument-hint");
        s.push(SkillEntry { name: n.to_string(), path: p.to_string_lossy().to_string(), description: d, argument_hint: h });
    }}
    s.sort_by(|a,b| a.name.cmp(&b.name)); s
}
fn load_agents() -> Vec<AgentEntry> {
    let dir = agents_dir(); if !dir.exists() { return vec![]; }
    let mut a = vec![];
    if let Ok(e) = fs::read_dir(&dir) { for en in e.flatten() {
        let p = en.path(); let fn_ = p.file_name().unwrap_or_default().to_string_lossy();
        let n = p.file_stem().unwrap_or_default().to_string_lossy();
        if n.starts_with('_') { continue; }
        let c = fs::read_to_string(&p).unwrap_or_default();
        let (d, m) = parse_fm(&c, "description", "model");
        a.push(AgentEntry { name: n.to_string(), filename: fn_.to_string(), description: d, model: m, tools: vec![], enabled: true });
    }}
    a.sort_by(|a,b| a.name.cmp(&b.name)); a
}
fn parse_fm(content: &str, k1: &str, k2: &str) -> (String, String) {
    let (mut v1, mut v2) = (String::new(), String::new());
    if content.starts_with("---") { if let Some(end) = content[3..].find("---") {
        for line in content[3..3+end].lines() { if let Some((k, v)) = line.split_once(':') {
            match k.trim() { k if k == k1 => v1 = v.trim().to_string(), k if k == k2 => v2 = v.trim().to_string(), _ => {} }
        }}
    }}
    (v1, v2)
}
fn list_config_files() -> Vec<ConfigEntry> {
    let cd = claude_dir(); if !cd.exists() {
        return vec![
            ConfigEntry { path: cd.join("settings.json").to_string_lossy().to_string(), name: "settings.json".into(), content: String::new(), exists: false },
            ConfigEntry { path: cd.join("settings.local.json").to_string_lossy().to_string(), name: "settings.local.json".into(), content: String::new(), exists: false },
        ];
    }
    ["settings.json", "settings.local.json", "CLAUDE.md"].iter().map(|t| {
        let p = cd.join(t); ConfigEntry { name: t.to_string(), path: p.to_string_lossy().to_string(),
            content: if p.exists() { fs::read_to_string(&p).unwrap_or_default() } else { String::new() },
            exists: p.exists() }
    }).collect()
}
