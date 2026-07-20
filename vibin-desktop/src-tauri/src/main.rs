use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Query, Json},
    http::StatusCode,
    response::{IntoResponse, Redirect},
    routing::{get, post},
    Router,
};
use futures::{SinkExt, StreamExt};
use serde_json::json;
use std::collections::HashMap;
use std::thread;
use std::time::Duration;
use tower_http::services::ServeDir;
use wry::{
    application::{event_loop::EventLoop, window::WindowBuilder, dpi::LogicalSize},
    webview::WebViewBuilder,
};

/// Walk up from the current executable looking for `src/index.ts`, which marks
/// the Vibin project root. Falls back to the `VIBIN_SRC` environment variable.
fn find_vibin_src() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("VIBIN_SRC") {
        if !explicit.trim().is_empty() {
            return Some(PathBuf::from(explicit));
        }
    }
    let mut dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    loop {
        let candidate = dir.join("src").join("index.ts");
        if candidate.exists() {
            return Some(candidate);
        }
        if !dir.pop() {
            return None;
        }
    }
}

#[derive(serde::Deserialize)]
struct ClientMsg {
    #[serde(rename = "type", default)]
    msg_type: String,
    #[serde(default)]
    workspace: Option<String>,
    #[serde(default)]
    vibin_src: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    decision: Option<String>,
}

type ChildRef = Arc<Mutex<Option<Child>>>;

fn write_stdin(child: ChildRef, line: String) -> Result<(), String> {
    let mut guard = child.lock().unwrap();
    match guard.as_mut() {
        Some(c) => match c.stdin.as_mut() {
            Some(stdin) => stdin
                .write_all(line.as_bytes())
                .and_then(|_| stdin.flush())
                .map_err(|e| e.to_string()),
            None => Err("session stdin unavailable".into()),
        },
        None => Err("session is not running".into()),
    }
}

async fn handle_socket(socket: WebSocket) {
    let (mut sender, mut receiver) = socket.split();
    let child: ChildRef = Arc::new(Mutex::new(None));
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let forward = tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            if sender.send(Message::Text(line)).await.is_err() {
                break;
            }
        }
        let _ = sender.send(Message::Text("{\"t\":\"ended\"}".into())).await;
        let _ = sender.close().await;
    });

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                let Ok(cmd) = serde_json::from_str::<ClientMsg>(&text) else {
                    continue;
                };
                match cmd.msg_type.as_str() {
                    "start" => {
                        if child.lock().unwrap().is_some() {
                            continue;
                        }
                        let vibin_src = match cmd.vibin_src {
                            Some(s) if !s.trim().is_empty() => PathBuf::from(s),
                            _ => match find_vibin_src() {
                                Some(p) => p,
                                None => {
                                    let _ = out_tx.send(
                                        "{\"t\":\"error\",\"m\":\"Could not locate vibin/src/index.ts. Set VIBIN_SRC.\"}"
                                            .into(),
                                    );
                                    continue;
                                }
                            },
                        };
                        let workspace = cmd
                            .workspace
                            .filter(|s| !s.trim().is_empty())
                            .map(PathBuf::from)
                            .unwrap_or_else(|| {
                                vibin_src
                                    .parent()
                                    .map(|p| p.to_path_buf())
                                    .unwrap_or_else(|| PathBuf::from("."))
                            });
                        if !workspace.is_dir() {
                            let _ = out_tx.send(format!(
                                "{{\"t\":\"error\",\"m\":\"Workspace directory does not exist: {}\"}}",
                                workspace.display()
                            ));
                            continue;
                        }
                        match Command::new("bun")
                            .arg("run")
                            .arg(&vibin_src)
                            .arg("--headless")
                            .current_dir(&workspace)
                            .stdin(Stdio::piped())
                            .stdout(Stdio::piped())
                            .stderr(Stdio::piped())
                            .spawn()
                        {
                            Ok(mut c) => {
                                let stdout = c.stdout.take().unwrap();
                                let stderr = c.stderr.take().unwrap();
                                let tx1 = out_tx.clone();
                                std::thread::spawn(move || {
                                    let reader = std::io::BufReader::new(stdout);
                                    for line in reader.lines().map_while(Result::ok) {
                                        if tx1.send(line).is_err() {
                                            break;
                                        }
                                    }
                                });
                                let tx2 = out_tx.clone();
                                std::thread::spawn(move || {
                                    let reader = std::io::BufReader::new(stderr);
                                    for line in reader.lines().map_while(Result::ok) {
                                        if !line.trim().is_empty() {
                                            let _ = tx2.send(format!(
                                                "{{\"t\":\"error\",\"m\":{}}}",
                                                serde_json::to_string(&line)
                                                    .unwrap_or_else(|_| "\"stderr\"".into())
                                            ));
                                        }
                                    }
                                });
                                *child.lock().unwrap() = Some(c);
                            }
                            Err(e) => {
                                let _ = out_tx.send(format!(
                                    "{{\"t\":\"error\",\"m\":\"Failed to spawn bun: {}\"}}",
                                    e
                                ));
                            }
                        }
                    }
                    "prompt" => {
                        if let Some(text) = cmd.text {
                            let child = child.clone();
                            let line = format!("prompt\t{text}\n");
                            let _ = tokio::task::spawn_blocking(move || write_stdin(child, line)).await;
                        }
                    }
                    "approve" => {
                        if let (Some(id), Some(decision)) = (cmd.id, cmd.decision) {
                            let child = child.clone();
                            let line = format!("approve\t{id}\t{decision}\n");
                            let _ = tokio::task::spawn_blocking(move || write_stdin(child, line)).await;
                        }
                    }
                    "stop" => {
                        if let Some(mut c) = child.lock().unwrap().take() {
                            let _ = c.kill();
                        }
                    }
                    _ => {}
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    if let Some(mut c) = child.lock().unwrap().take() {
        let _ = c.kill();
    }
    forward.abort();
}

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", ".next", ".turbo", "vendor", ".cache",
    ".idea", ".vscode", ".svelte-kit", "build",
];

fn build_tree(root: &std::path::Path, depth: usize) -> serde_json::Value {
    let dirname = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".into());
    if depth == 0 {
        return json!({ "name": dirname, "type": "dir", "children": [] });
    }
    let mut children = vec![];
    if let Ok(entries) = std::fs::read_dir(root) {
        let mut ents: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        ents.sort_by_key(|e| e.file_name());
        for entry in ents {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                children.push(build_tree(&path, depth - 1));
            } else {
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                children.push(json!({ "name": name, "type": "file", "size": size }));
            }
        }
    }
    json!({ "name": dirname, "type": "dir", "children": children })
}

fn run_cmd(dir: &std::path::Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).current_dir(dir).output().ok()?;
    if out.status.success() {
        String::from_utf8(out.stdout)
            .ok()
            .map(|s| s.trim().to_string())
    } else {
        None
    }
}

fn run_capture(dir: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| e.to_string())?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() {
        Ok(s)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn git_info(root: &std::path::Path) -> serde_json::Value {
    let branch = run_cmd(root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    let porcelain = run_cmd(root, &["status", "--porcelain"]).unwrap_or_default();
    let dirty = !porcelain.is_empty();
    let mut files = vec![];
    for line in porcelain.lines() {
        if line.len() >= 3 {
            let code = &line[0..2];
            let p = line[3..].to_string();
            files.push(json!({ "status": code, "path": p }));
        }
    }
    let is_repo = run_cmd(root, &["rev-parse", "--is-inside-work-tree"]).is_some();
    json!({
        "branch": branch,
        "dirty": dirty,
        "files": files,
        "is_repo": is_repo,
    })
}

#[derive(serde::Deserialize)]
struct CommitReq {
    root: String,
    message: String,
}

async fn api_config() -> impl IntoResponse {
    let vibin_src = find_vibin_src().unwrap_or_default();
    let workspace = vibin_src
        .parent()
        .and_then(|srcdir| srcdir.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    Json(json!({
        "workspace": workspace.display().to_string(),
        "vibinSrc": vibin_src.display().to_string(),
    }))
}

async fn api_files(Query(q): Query<HashMap<String, String>>) -> impl IntoResponse {
    let root = match q.get("root") {
        Some(r) if !r.trim().is_empty() => PathBuf::from(r),
        _ => return (StatusCode::BAD_REQUEST, "missing root").into_response(),
    };
    if !root.is_dir() {
        return (StatusCode::BAD_REQUEST, "not a directory").into_response();
    }
    let tree = tokio::task::spawn_blocking(move || build_tree(&root, 4))
        .await
        .unwrap_or_else(|_| json!({}));
    Json(tree).into_response()
}

async fn api_git(Query(q): Query<HashMap<String, String>>) -> impl IntoResponse {
    let root = match q.get("root") {
        Some(r) if !r.trim().is_empty() => PathBuf::from(r),
        _ => return (StatusCode::BAD_REQUEST, "missing root").into_response(),
    };
    if !root.is_dir() {
        return (StatusCode::BAD_REQUEST, "not a directory").into_response();
    }
    let info = tokio::task::spawn_blocking(move || git_info(&root))
        .await
        .unwrap_or_else(|_| json!({}));
    Json(info).into_response()
}

async fn api_commit(Json(body): Json<CommitReq>) -> impl IntoResponse {
    let root = PathBuf::from(&body.root);
    if !root.is_dir() {
        return Json(json!({ "ok": false, "message": "invalid root" })).into_response();
    }
    if let Err(e) = run_capture(&root, &["add", "-A"]) {
        return Json(json!({ "ok": false, "message": e })).into_response();
    }
    match run_capture(&root, &["commit", "-m", &body.message]) {
        Ok(out) => Json(json!({ "ok": true, "message": out })).into_response(),
        Err(e) => Json(json!({ "ok": false, "message": e })).into_response(),
    }
}

fn app_router() -> Router {
    let dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    Router::new()
        .route("/api/config", get(api_config))
        .route("/api/files", get(api_files))
        .route("/api/git", get(api_git))
        .route("/api/commit", post(api_commit))
        .route("/ws", get(ws_handler))
        .route("/", get(|| async { Redirect::permanent("/app.html") }))
        .fallback_service(ServeDir::new(dist))
}

fn start_server() {
    thread::spawn(|| {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("failed to build tokio runtime");
        rt.block_on(async {
            let app = app_router();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:1420")
                .await
                .expect("failed to bind 127.0.0.1:1420");
            println!("Vibin desktop running at http://localhost:1420");
            axum::serve(listener, app).await.expect("server error");
        });
    });
}

fn open_window_or_fallback() {
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Vibin")
        .with_inner_size(LogicalSize::new(1100.0, 760.0))
        .build(&event_loop)
        .expect("failed to create window");
    let builder = WebViewBuilder::new(window).expect("failed to create webview builder");
    match builder
        .with_url("http://localhost:1420")
        .expect("failed to set url")
        .build()
    {
        Ok(webview) => {
            event_loop.run(move |_event, _window_target, _control_flow| {
                let _ = &webview;
            });
        }
        Err(e) => {
            eprintln!("Native window unavailable ({e}); opening in browser instead.");
            let _ = webbrowser::open("http://localhost:1420");
            loop {
                thread::sleep(Duration::from_secs(3600));
            }
        }
    }
}

fn main() {
    start_server();
    thread::sleep(Duration::from_millis(800));
    open_window_or_fallback();
}
