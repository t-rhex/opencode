use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
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
#[serde(rename_all = "snake_case")]
pub struct RemoteConnectResult {
    pub url: String,
    pub password: Option<String>,
    pub session: RemoteSession,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub is_dir: bool,
    pub path: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowseResult {
    pub entries: Vec<DirectoryEntry>,
    pub path: String,
}

#[derive(Default)]
pub struct RemoteState {
    pub tunnel: Arc<Mutex<Option<Child>>>,
    pub session: Arc<Mutex<Option<RemoteSession>>>,
}

fn parse_target(target: &str) -> (String, Option<String>) {
    if let Some(colon_idx) = target.rfind(':') {
        let potential_port = &target[colon_idx + 1..];
        if potential_port.parse::<u16>().is_ok() {
            return (target[..colon_idx].to_string(), Some(potential_port.to_string()));
        }
    }
    (target.to_string(), None)
}

#[allow(non_snake_case)]
fn ssh_exec(target: &str, command: &str, keyPath: Option<&str>) -> Result<String, String> {
    let (host, port) = parse_target(target);
    
    let mut cmd = Command::new("ssh");
    cmd.arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=10");

    if let Some(p) = &port {
        cmd.arg("-p").arg(p);
    }

    if let Some(key) = keyPath {
        cmd.arg("-i").arg(key);
    }

    cmd.arg(&host).arg(command);

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

fn emit_progress(app: &AppHandle, step: &str, detail: &str) {
    let _ = app.emit("remote-progress", serde_json::json!({
        "step": step,
        "detail": detail
    }));
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn remote_connect(
    app: AppHandle,
    target: String,
    repo: String,
    gitRef: String,
    keyPath: Option<String>,
) -> Result<RemoteConnectResult, String> {
    println!("[remote_connect] Starting with target={}, repo={}, gitRef={}, keyPath={:?}", target, repo, gitRef, keyPath);
    let key = keyPath.as_deref();
    let git_ref = gitRef;
    let session_id = generate_session_id();
    let bin_path = "~/.opencode-remote/bin/opencode";

    println!("[remote_connect] Checking if opencode is installed...");
    emit_progress(&app, "connecting", &format!("Connecting to {}", target));

    let installed = ssh_exec(
        &target,
        &format!("test -f {} && echo yes || echo no", bin_path),
        key,
    )
    .map(|o| o.trim() == "yes")
    .unwrap_or(false);

    println!("[remote_connect] Installed: {}", installed);

    if !installed {
        emit_progress(&app, "installing", "Installing opencode on remote...");
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

    println!("[remote_connect] Cloning repo...");
    emit_progress(&app, "cloning", &format!("Cloning {}...", repo));
    let workspace = format!("~/.opencode-remote/workspaces/{}", session_id);
    let repo_path = format!("{}/repo", workspace);
    ssh_exec(&target, &format!("mkdir -p {}", workspace), key)?;
    println!("[remote_connect] Created workspace dir");
    ssh_exec(&target, &format!("git clone {} {}", repo, repo_path), key)?;
    println!("[remote_connect] Cloned repo");
    ssh_exec(
        &target,
        &format!("cd {} && git checkout {}", repo_path, git_ref),
        key,
    )?;
    println!("[remote_connect] Checked out {}", git_ref);

    emit_progress(&app, "starting", "Starting remote server...");
    println!("[remote_connect] Starting server...");
    let password = uuid::Uuid::new_v4().to_string();

    let log_path = format!("~/.opencode-remote/logs/{}.log", session_id);
    let pid_file = format!("~/.opencode-remote/run/{}.pid", session_id);
    let start_cmd = format!(
        r#"cat > /tmp/start-{}.sh << 'SCRIPT'
#!/bin/bash
cd "{}" || exit 1
OPENCODE_DIRECTORY="{}" OPENCODE_SERVER_PASSWORD={} {} serve --port 0 --hostname 127.0.0.1 > {} 2>&1 &
echo $! > {}
SCRIPT
chmod +x /tmp/start-{}.sh && nohup /tmp/start-{}.sh </dev/null >/dev/null 2>&1 & sleep 1 && cat {}"#,
        session_id, repo_path, repo_path, password, bin_path, log_path, pid_file, session_id, session_id, pid_file
    );
    println!("[remote_connect] Running: {}", start_cmd);
    let pid_str = ssh_exec(&target, &start_cmd, key)?;
    println!("[remote_connect] Got PID: {}", pid_str);
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

    emit_progress(&app, "waiting", "Waiting for server to start...");
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

    emit_progress(&app, "tunneling", "Creating SSH tunnel...");
    let local_port = find_free_port();
    let (tunnel_host, tunnel_port) = parse_target(&target);
    let mut tunnel_cmd = Command::new("ssh");
    tunnel_cmd
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-N")
        .arg("-L")
        .arg(format!("{}:127.0.0.1:{}", local_port, remote_port));

    if let Some(p) = &tunnel_port {
        tunnel_cmd.arg("-p").arg(p);
    }
    if let Some(k) = key {
        tunnel_cmd.arg("-i").arg(k);
    }
    tunnel_cmd.arg(&tunnel_host);

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

    let result = RemoteConnectResult {
        url: format!("http://127.0.0.1:{}", local_port),
        password: Some(password.clone()),
        session,
    };
    println!("[remote_connect] Returning result: url={}, password={}", result.url, password);
    Ok(result)
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
#[allow(non_snake_case)]
pub async fn remote_list_sessions(
    target: String,
    keyPath: Option<String>,
) -> Result<Vec<RemoteSession>, String> {
    let key = keyPath.as_deref();
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
#[allow(non_snake_case)]
pub async fn remote_stop_session(
    target: String,
    sessionId: String,
    keyPath: Option<String>,
) -> Result<(), String> {
    let key = keyPath.as_deref();
    let session_id = sessionId;
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

#[tauri::command]
#[allow(non_snake_case)]
pub async fn remote_browse_directory(
    target: String,
    path: String,
    keyPath: Option<String>,
) -> Result<BrowseResult, String> {
    let key = keyPath.as_deref();
    let resolved_path = if path == "~" || path.is_empty() {
        "~".to_string()
    } else {
        path.clone()
    };

    let output = ssh_exec(
        &target,
        &format!("cd {} && pwd && ls -la", resolved_path),
        key,
    )?;

    let lines: Vec<&str> = output.lines().collect();
    if lines.is_empty() {
        return Err("Failed to read directory".to_string());
    }

    let actual_path = lines[0].trim().to_string();
    let mut entries = Vec::new();

    for line in lines.iter().skip(1) {
        let line = line.trim();
        if line.is_empty() || line.starts_with("total ") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }

        let name = parts[8..].join(" ");
        if name == "." || name == ".." {
            continue;
        }

        let is_dir = parts[0].starts_with('d');
        let full_path = if actual_path == "/" {
            format!("/{}", name)
        } else {
            format!("{}/{}", actual_path, name)
        };

        println!("[remote_browse] Entry: name={}, is_dir={}, perms={}", name, is_dir, parts[0]);
        entries.push(DirectoryEntry {
            name,
            is_dir,
            path: full_path,
        });
    }

    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(BrowseResult {
        entries,
        path: actual_path,
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn remote_connect_directory(
    app: AppHandle,
    target: String,
    path: String,
    keyPath: Option<String>,
) -> Result<RemoteConnectResult, String> {
    println!("[remote_connect_directory] Called with target={}, path={}, keyPath={:?}", target, path, keyPath);
    let key = keyPath.as_deref();
    let session_id = generate_session_id();
    let bin_path = "~/.opencode-remote/bin/opencode";

    emit_progress(&app, "connecting", &format!("Connecting to {}", target));

    let installed = ssh_exec(
        &target,
        &format!("test -f {} && echo yes || echo no", bin_path),
        key,
    )
    .map(|o| o.trim() == "yes")
    .unwrap_or(false);

    if !installed {
        emit_progress(&app, "installing", "Installing opencode on remote...");
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

    let resolved_path = ssh_exec(&target, &format!("cd {} && pwd", path), key)?
        .trim()
        .to_string();
    println!("[remote_connect_directory] Resolved path: {} -> {}", path, resolved_path);

    emit_progress(&app, "starting", "Starting remote server...");
    let password = uuid::Uuid::new_v4().to_string();

    let log_path = format!("~/.opencode-remote/logs/{}.log", session_id);
    let pid_file = format!("~/.opencode-remote/run/{}.pid", session_id);
    let start_cmd = format!(
        r#"cat > /tmp/start-{}.sh << 'SCRIPT'
#!/bin/bash
cd "{}" || exit 1
OPENCODE_DIRECTORY="{}" OPENCODE_SERVER_PASSWORD={} {} serve --port 0 --hostname 127.0.0.1 > {} 2>&1 &
echo $! > {}
SCRIPT
chmod +x /tmp/start-{}.sh && nohup /tmp/start-{}.sh </dev/null >/dev/null 2>&1 & sleep 1 && cat {}"#,
        session_id, resolved_path, resolved_path, password, bin_path, log_path, pid_file, session_id, session_id, pid_file
    );
    println!("[remote_connect_directory] Start command:\n{}", start_cmd);
    let pid_str = ssh_exec(&target, &start_cmd, key)?;
    println!("[remote_connect_directory] PID result: {}", pid_str);
    let pid: u32 = pid_str
        .trim()
        .parse()
        .map_err(|_| format!("Failed to parse PID from: {}", pid_str))?;

    let meta_path = format!("~/.opencode-remote/run/{}.json", session_id);
    let meta_json = format!(
        r#"{{"id":"{}","pid":{},"repo":"{}","ref":"{}"}}"#,
        session_id, pid, resolved_path, "directory"
    );
    ssh_exec(
        &target,
        &format!("echo '{}' > {}", meta_json, meta_path),
        key,
    )?;

    emit_progress(&app, "waiting", "Waiting for server to start...");
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

    emit_progress(&app, "tunneling", "Creating SSH tunnel...");
    let local_port = find_free_port();
    let (tunnel_host, tunnel_port) = parse_target(&target);
    let mut tunnel_cmd = Command::new("ssh");
    tunnel_cmd
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-N")
        .arg("-L")
        .arg(format!("{}:127.0.0.1:{}", local_port, remote_port));

    if let Some(p) = &tunnel_port {
        tunnel_cmd.arg("-p").arg(p);
    }
    if let Some(k) = key {
        tunnel_cmd.arg("-i").arg(k);
    }
    tunnel_cmd.arg(&tunnel_host);

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
        repo: resolved_path,
        git_ref: "directory".to_string(),
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
#[allow(non_snake_case)]
pub async fn remote_create_directory(
    target: String,
    path: String,
    keyPath: Option<String>,
) -> Result<String, String> {
    let key = keyPath.as_deref();
    
    // Create the directory
    ssh_exec(&target, &format!("mkdir -p \"{}\"", path), key)?;
    
    // Return the created path
    Ok(path)
}
