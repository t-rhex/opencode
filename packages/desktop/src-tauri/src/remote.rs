use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RemoteSession {
    pub id: String,
    pub target: String,
    pub repo: String,
    pub git_ref: String,
    pub port: u32,
    pub local_port: u32,
    pub started_at: String,
}

#[derive(Clone, Serialize)]
pub struct RemoteConnectResult {
    pub url: String,
    pub password: Option<String>,
    pub session: RemoteSession,
}

#[derive(Default)]
pub struct RemoteState {
    pub tunnel: Arc<Mutex<Option<Child>>>,
    pub session: Arc<Mutex<Option<RemoteSession>>>,
}

fn ssh_exec(target: &str, command: &str, key_path: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("ssh");
    cmd.arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=10");

    if let Some(key) = key_path {
        cmd.arg("-i").arg(key);
    }

    cmd.arg(target).arg(command);

    let output = cmd.output().map_err(|e| format!("SSH failed: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.trim().is_empty() {
            Err(format!("SSH command failed with exit code: {:?}", output.status.code()))
        } else {
            Err(stderr)
        }
    }
}

fn find_free_port() -> u32 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .expect("Failed to find free port")
        .local_addr()
        .expect("Failed to get local addr")
        .port() as u32
}

fn generate_session_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap();
    let secs = now.as_secs();
    let random: u32 = rand::random::<u32>() & 0xFFFFFF;
    format!("{}-{:06x}", secs, random)
}

#[tauri::command]
pub async fn remote_connect(
    app: AppHandle,
    target: String,
    repo: String,
    git_ref: String,
    key_path: Option<String>,
) -> Result<RemoteConnectResult, String> {
    let key = key_path.as_deref();
    let session_id = generate_session_id();
    let bin_path = "~/.opencode-remote/bin/opencode";

    let installed = ssh_exec(
        &target,
        &format!("test -f {} && echo yes || echo no", bin_path),
        key,
    )
    .map(|o| o.trim() == "yes")
    .unwrap_or(false);

    if !installed {
        ssh_exec(
            &target,
            "mkdir -p ~/.opencode-remote/bin ~/.opencode-remote/run ~/.opencode-remote/logs ~/.opencode-remote/workspaces",
            key,
        )?;
        ssh_exec(
            &target,
            "curl -fsSL https://opencode.ai/install | bash",
            key,
        )?;
        ssh_exec(
            &target,
            "cp ~/.opencode/bin/opencode ~/.opencode-remote/bin/opencode",
            key,
        )?;
    }

    let workspace = format!("~/.opencode-remote/workspaces/{}", session_id);
    let repo_path = format!("{}/repo", workspace);
    ssh_exec(&target, &format!("mkdir -p {}", workspace), key)?;
    ssh_exec(&target, &format!("git clone {} {}", repo, repo_path), key)?;
    ssh_exec(
        &target,
        &format!("cd {} && git checkout {}", repo_path, git_ref),
        key,
    )?;

    let password = uuid::Uuid::new_v4().to_string();

    let log_path = format!("~/.opencode-remote/logs/{}.log", session_id);
    let start_cmd = format!(
        "cd {} && OPENCODE_SERVER_PASSWORD={} nohup {} serve --port 0 --hostname 127.0.0.1 > {} 2>&1 & echo $!",
        repo_path, password, bin_path, log_path
    );
    let pid_str = ssh_exec(&target, &start_cmd, key)?;
    let pid: u32 = pid_str
        .trim()
        .parse()
        .map_err(|_| format!("Failed to parse PID from: {}", pid_str))?;

    let meta_path = format!("~/.opencode-remote/run/{}.json", session_id);
    let meta_json = format!(
        r#"{{"id":"{}","pid":{},"repo":"{}","ref":"{}"}}"#,
        session_id, pid, repo, git_ref
    );
    ssh_exec(
        &target,
        &format!("echo '{}' > {}", meta_json, meta_path),
        key,
    )?;

    let mut remote_port = 0u32;
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(500));
        if let Ok(log) = ssh_exec(&target, &format!("cat {} 2>/dev/null", log_path), key) {
            if let Some(idx) = log.find("listening on http://") {
                let rest = &log[idx + 20..];
                if let Some(colon_idx) = rest.find(':') {
                    let port_part = &rest[colon_idx + 1..];
                    if let Some(port_str) = port_part.split_whitespace().next() {
                        if let Ok(p) = port_str.trim().parse::<u32>() {
                            remote_port = p;
                            break;
                        }
                    }
                }
            }
        }
    }

    if remote_port == 0 {
        let _ = ssh_exec(&target, &format!("kill -9 {} 2>/dev/null || true", pid), key);
        let _ = ssh_exec(&target, &format!("rm -f {}", meta_path), key);
        return Err("Server failed to start - could not detect port".to_string());
    }

    let local_port = find_free_port();
    let mut tunnel_cmd = Command::new("ssh");
    tunnel_cmd
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-N")
        .arg("-L")
        .arg(format!("{}:127.0.0.1:{}", local_port, remote_port));

    if let Some(k) = key {
        tunnel_cmd.arg("-i").arg(k);
    }
    tunnel_cmd.arg(&target);

    let tunnel = tunnel_cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn tunnel: {}", e))?;

    std::thread::sleep(Duration::from_secs(1));

    let state = app.state::<RemoteState>();
    *state.tunnel.lock().unwrap() = Some(tunnel);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let session = RemoteSession {
        id: session_id,
        target: target.clone(),
        repo,
        git_ref,
        port: remote_port,
        local_port,
        started_at: format!("{}", now),
    };
    *state.session.lock().unwrap() = Some(session.clone());

    Ok(RemoteConnectResult {
        url: format!("http://127.0.0.1:{}", local_port),
        password: Some(password),
        session,
    })
}

#[tauri::command]
pub async fn remote_disconnect(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RemoteState>();

    if let Some(mut tunnel) = state.tunnel.lock().unwrap().take() {
        let _ = tunnel.kill();
    }

    *state.session.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn remote_list_sessions(
    target: String,
    key_path: Option<String>,
) -> Result<Vec<RemoteSession>, String> {
    let key = key_path.as_deref();
    let output = ssh_exec(
        &target,
        "ls ~/.opencode-remote/run/*.json 2>/dev/null || true",
        key,
    )?;

    let mut sessions = Vec::new();
    for line in output.lines() {
        let path = line.trim();
        if path.is_empty() || !path.ends_with(".json") {
            continue;
        }
        if let Ok(content) = ssh_exec(&target, &format!("cat {}", path), key) {
            if let Ok(session) = serde_json::from_str::<RemoteSession>(&content) {
                sessions.push(session);
            }
        }
    }
    Ok(sessions)
}

#[tauri::command]
pub async fn remote_stop_session(
    target: String,
    session_id: String,
    key_path: Option<String>,
) -> Result<(), String> {
    let key = key_path.as_deref();
    let meta_path = format!("~/.opencode-remote/run/{}.json", session_id);

    if let Ok(content) = ssh_exec(&target, &format!("cat {} 2>/dev/null", meta_path), key) {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(pid) = meta.get("pid").and_then(|p| p.as_u64()) {
                let _ = ssh_exec(
                    &target,
                    &format!("kill -9 {} 2>/dev/null || true", pid),
                    key,
                );
            }
        }
    }

    let _ = ssh_exec(&target, &format!("rm -f {}", meta_path), key);

    Ok(())
}
