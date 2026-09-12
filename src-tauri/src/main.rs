// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Microsoft Edge WebView2 Evergreen 引导安装器（在线下载完整运行时）
const WEBVIEW2_BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/// 引导安装器最小有效字节数，用于排除误下载到 HTML 重定向页
const BOOTSTRAPPER_MIN_BYTES: usize = 500_000;

// MessageBox 常量（沿用现有代码的字面量风格）
const MB_OKCANCEL: u32 = 0x0000_0001;
const MB_ICONERROR: u32 = 0x0000_0010;
const MB_ICONINFORMATION: u32 = 0x0000_0040;
const IDOK: i32 = 1;

/// 把 &str 转为带 null 结尾的 UTF-16 宽字符串
fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// 弹出 MessageBox，返回用户点击的按钮 ID
fn message_box(msg: &str, title: &str, flags: u32) -> i32 {
    let msg = wide(msg);
    let title = wide(title);
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
            std::ptr::null_mut(),
            msg.as_ptr(),
            title.as_ptr(),
            flags,
        )
    }
}

/// Check if WebView2 runtime is installed (multi-method)
fn is_webview2_installed() -> bool {
    let info = app_lib::environment::detect_webview2();
    info.installed
}

/// 当前可执行文件所在目录
fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

/// 下载 WebView2 引导安装器到临时目录，成功返回文件路径
fn download_bootstrapper() -> Option<PathBuf> {
    let dest = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
    let rt = tokio::runtime::Runtime::new().ok()?;
    let downloaded = rt.block_on(async {
        let resp = reqwest::get(WEBVIEW2_BOOTSTRAPPER_URL).await.ok()?;
        let bytes = resp.bytes().await.ok()?;
        if bytes.len() < BOOTSTRAPPER_MIN_BYTES {
            return None;
        }
        let data: &[u8] = bytes.as_ref();
        std::fs::write(&dest, data).ok()?;
        Some(true)
    });
    downloaded.map(|_| dest)
}

/// 运行 WebView2 引导安装器；返回码不可靠（静默安装、用户取消等），
/// 因此安装完成后以真实检测结果为准
fn install_webview2(path: &Path, silent: bool) -> bool {
    let mut cmd = std::process::Command::new(path);
    if silent {
        cmd.args(["/silent", "/install"]);
    } else {
        cmd.arg("/install");
    }
    let _ = cmd.creation_flags(CREATE_NO_WINDOW).status();
    app_lib::environment::detect_webview2().installed
}

fn main() {
    // 已安装：直接启动
    if is_webview2_installed() {
        app_lib::run();
        return;
    }

    // 缺失：先尝试 exe 同目录的引导安装器（静默）
    if let Some(path) = exe_dir().map(|d| d.join("MicrosoftEdgeWebview2Setup.exe")) {
        if path.exists() && install_webview2(&path, true) {
            app_lib::run();
            return;
        }
    }

    // 同目录没有或安装失败：弹确认框，询问是否自动下载并安装
    let confirmed = message_box(
        "本应用需要 Microsoft Edge WebView2 运行时才能显示界面。\n\n\
         Windows 10 默认未安装。是否现在自动下载并安装？\n\
         （需要联网，约 1~3 分钟）",
        "安装 WebView2 运行时",
        MB_OKCANCEL | MB_ICONINFORMATION,
    );
    if confirmed != IDOK {
        return; // 用户取消，退出
    }

    // 自动下载引导安装器并安装（非静默，显示微软官方进度窗口）
    match download_bootstrapper() {
        Some(path) if install_webview2(&path, false) => {
            app_lib::run();
        }
        _ => {
            message_box(
                "自动安装 Microsoft Edge WebView2 运行时失败。\n\n\
                 请手动从此处下载并安装：\n\
                 https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                "WebView2 安装失败",
                MB_ICONERROR,
            );
        }
    }
}
