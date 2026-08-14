// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Check if WebView2 runtime is installed (multi-method)
fn is_webview2_installed() -> bool {
    // Delegate to the same comprehensive detection used by the app
    let info = app_lib::environment::detect_webview2();
    info.installed
}

fn main() {
    if !is_webview2_installed() {
        // Try to run the Evergreen bootstrapper next to this exe
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()));

        let bootstrapper = exe_dir
            .as_ref()
            .map(|d| d.join("MicrosoftEdgeWebview2Setup.exe"));

        let installed = if let Some(ref path) = bootstrapper {
            if path.exists() {
                std::process::Command::new(path)
                    .args(["/silent", "/install"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
            } else {
                false
            }
        } else {
            false
        };

        if !installed {
            let title: Vec<u16> = OsStr::new("WebView2 未安装")
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let msg: Vec<u16> = OsStr::new(
                "本应用需要 Microsoft Edge WebView2 运行时。\n\n\
                 请从此处下载并安装：\n\
                 https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\n\
                 或者将下载的 MicrosoftEdgeWebview2Setup.exe\n\
                 放在本程序同一目录下后重新运行。",
            )
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                    std::ptr::null_mut(),
                    msg.as_ptr(),
                    title.as_ptr(),
                    0x0000_0010_u32, // MB_ICONERROR
                );
            }
            return;
        }
    }

    app_lib::run();
}
