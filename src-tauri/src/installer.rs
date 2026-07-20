use tauri::{AppHandle, Manager};
use crate::error::{AppError, codes, AppResult};
use crate::process::{CommandSpec, execute_command};
use crate::environment;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

pub async fn install_claude_code(task_id: &str, app: &AppHandle) -> AppResult<()> {
    let state = app.state::<crate::AppState>();
    let tm = &state.task_manager;
    tm.update_progress(task_id, 5.0, Some("检查系统环境...".to_string()), app);
    let ps = environment::detect_powershell();
    if !ps.available {
        return Err(AppError::new(codes::INSTALL_NETWORK_ERROR,
            "PowerShell 不可用", "Claude Code 安装需要 PowerShell。").retryable());
    }
    tm.update_progress(task_id, 10.0, Some("正在下载安装程序...".to_string()), app);
    let script = r#"$p=$env:TEMP; $f="$p\cc.ps1"; iwr -Uri https://claude.ai/install.ps1 -OutFile $f; & $f; if(Test-Path (Join-Path $env:USERPROFILE ".local\bin\claude.exe")){echo CLAUDE_INSTALL_OK}else{echo CLAUDE_INSTALL_FAILED}"#;
    tm.update_progress(task_id, 20.0, Some("正在安装 Claude Code...".to_string()), app);
    let cancel_mutex = tm.get_cancel_flag(task_id);
    let cancel_flag: Option<Arc<AtomicBool>> = cancel_mutex.map(|m| {
        let flag = Arc::new(AtomicBool::new(false));
        let f = flag.clone();
        std::thread::spawn(move || loop {
            if *m.lock().unwrap() { f.store(true, Ordering::SeqCst); break; }
            std::thread::sleep(std::time::Duration::from_millis(200));
        });
        flag
    });
    let spec = CommandSpec::new("powershell.exe".to_string())
        .args(vec!["-NoProfile".to_string(),"-NonInteractive".to_string(),"-ExecutionPolicy".to_string(),"Bypass".to_string(),"-Command".to_string(),script.to_string()])
        .timeout(std::time::Duration::from_secs(300));
    let output = execute_command(&spec, cancel_flag).await?;
    tm.update_progress(task_id, 80.0, Some("验证安装结果...".to_string()), app);
    if output.stdout.contains("CLAUDE_INSTALL_OK") {
        tm.succeed_task(task_id, app); Ok(())
    } else {
        Err(AppError::new(codes::INSTALL_DOWNLOAD_FAILED,"安装失败","安装程序未返回预期结果。").retryable())
    }
}

pub async fn uninstall_claude_code(task_id: &str, app: &AppHandle) -> AppResult<()> {
    let state = app.state::<crate::AppState>();
    let tm = &state.task_manager;
    tm.update_progress(task_id, 10.0, Some("查找安装位置...".to_string()), app);
    let cc_info = environment::detect_claude_code();
    if !cc_info.installed {
        return Err(AppError::new("INSTALL_NOT_FOUND","Claude Code 未安装","未检测到 Claude Code。"));
    }
    tm.update_progress(task_id, 30.0, Some("正在卸载...".to_string()), app);
    if let Some(ref path) = cc_info.path { if path.exists() {
        std::fs::remove_file(path).map_err(|e| AppError::new(
            codes::INSTALL_DOWNLOAD_FAILED,"卸载失败","无法删除文件。").with_details(e.to_string()))?;
    }}
    tm.update_progress(task_id, 100.0, Some("卸载完成".to_string()), app);
    tm.succeed_task(task_id, app); Ok(())
}
