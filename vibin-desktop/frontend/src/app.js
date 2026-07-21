import * as session from "./session.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function apiGet(path) {
  try {
    const r = await fetch(path);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
async function apiPost(path, body) {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

let WORKSPACE = session.getWorkspace();
let VIBIN_SRC = session.getVibinSrc();

async function loadConfig() {
  const cfg = await apiGet("/api/config");
  if (!cfg) return;
  if (!localStorage.getItem("vibin.workspace")) localStorage.setItem("vibin.workspace", cfg.workspace);
  if (!localStorage.getItem("vibin.vibinSrc")) localStorage.setItem("vibin.vibinSrc", cfg.vibinSrc);
  WORKSPACE = localStorage.getItem("vibin.workspace") || cfg.workspace;
  VIBIN_SRC = localStorage.getItem("vibin.vibinSrc") || cfg.vibinSrc;
}

// ── Audio (ding) ─────────────────────────────────────────────
let audioCtx;
function ding() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1175].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = now + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
  } catch (e) {}
}

// ── Rail toggle / collapse ───────────────────────────────────
const app = document.getElementById("app");
document.querySelectorAll('.rail-btn[data-toggle="chatrail"]').forEach((b) => {
  b.addEventListener("click", () => {
    const collapsed = app.classList.toggle("rail-collapsed");
    b.setAttribute("aria-pressed", !collapsed);
  });
});
document.getElementById("collapse-rail").addEventListener("click", () => {
  const collapsed = app.classList.toggle("rail-collapsed");
  document.querySelector('.rail-btn[data-toggle="chatrail"]').setAttribute("aria-pressed", !collapsed);
  if (window.innerWidth <= 920) app.classList.toggle("rail-open", !collapsed);
});

// Disable the native (inspect / reload) context menu app-wide.
document.addEventListener("contextmenu", (e) => e.preventDefault());

const composerRefs = document.getElementById("composer-refs");

// ── Rail (tasks) ─────────────────────────────────────────────
const taskListView = document.getElementById("task-list");
const chatPanel = document.querySelector(".main");
let sessionTitle = document.getElementById("crumb-task");
const renameSessionButton = document.getElementById("rename-session");

// ── Multi-task state ─────────────────────────────────────────
let tasks = [];
let activeId = null;
const TASKS_KEY = "vibin.tasks";

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        tasks = parsed;
        return true;
      }
    }
  } catch {}
  return false;
}
function saveTasks() {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch {}
}
function getActive() {
  return tasks.find((t) => t.id === activeId) || null;
}
function persistActiveChat() {
  const t = getActive();
  if (!t) return;
  const clone = chatInner.cloneNode(true);
  const es = clone.querySelector("#empty-state");
  if (es) es.remove();
  const typing = clone.querySelector(".typing");
  if (typing) typing.remove();
  t.chatHtml = clone.innerHTML;
}

function statusClass(kind) {
  return kind === "running" ? "status-running" : kind === "done" ? "status-done" : "status-help";
}

function currentSessionName() {
  const t = getActive();
  return t ? t.name : "New task";
}

function setSessionName(name) {
  const next = name.trim() || "New task";
  const t = getActive();
  if (t) {
    t.name = next;
    if (liveTask) {
      const lt = liveTask.querySelector(".task-title");
      if (lt) lt.textContent = next;
    }
  }
  sessionTitle.textContent = next;
  saveTasks();
}

function openCurrentSession() {
  chatPanel.hidden = false;
  app.classList.remove("rail-collapsed");
  document.getElementById("composer-input").focus();
}

renameSessionButton.addEventListener("click", () => {
  if (renameSessionButton.querySelector("input")) return;
  const input = document.createElement("input");
  input.className = "session-title-input";
  input.value = currentSessionName();
  renameSessionButton.replaceChildren(input);
  input.focus();
  input.select();
  const finish = () => {
    setSessionName(input.value);
    renameSessionButton.innerHTML = `<b id="crumb-task">${escapeHtml(currentSessionName())}</b><span class="material-symbols-outlined">edit</span>`;
    sessionTitle = document.getElementById("crumb-task");
  };
  input.addEventListener("blur", finish, { once: true });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") { input.value = currentSessionName(); input.blur(); }
  });
});

// ── Live task (derived from session events) ───────────────────
let liveTask, liveTaskGit;
function bindLiveTask() {
  liveTask = taskListView.querySelector(`.task[data-id="${activeId}"]`);
  liveTaskGit = liveTask ? liveTask.querySelector(".git-badge") : null;
}

function makeTaskCard(task) {
  const el = document.createElement("div");
  el.className = "task" + (task.id === activeId ? " active" : "");
  el.dataset.id = task.id;
  el.innerHTML = `
    <div class="task-top">
      <span class="status-dot ${statusClass(task.status || "running")}"></span>
      <span class="task-title">${escapeHtml(task.name)}</span>
    </div>
    <div class="task-msg">${escapeHtml(task.msg || "Waiting for your first message…")}</div>
    <div class="task-foot">
      <span class="git-badge ${gitClass(task.git)}">${gitBadgeInner(task.git)}</span>
    </div>`;
  el.addEventListener("click", () => activateTask(task.id));
  el.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    if (await confirmDialog(`Delete task "${task.name}"? This cannot be undone.`)) deleteTask(task.id);
  });
  return el;
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(43,33,28,.35);display:grid;place-items:center;z-index:95";
    const card = document.createElement("div");
    card.style.cssText =
      "background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px 22px;max-width:380px;box-shadow:var(--elev-raised)";
    card.innerHTML = `<div style="font-weight:600;margin-bottom:8px">Delete task</div><p style="margin:0 0 16px;color:var(--fg-2);white-space:pre-wrap">${escapeHtml(
      message
    )}</p>`;
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.cssText =
      "padding:8px 14px;border-radius:10px;font-size:13px;font-weight:500;border:1px solid var(--border);cursor:pointer;color:var(--fg-2);background:transparent";
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.style.cssText =
      "padding:8px 14px;border-radius:10px;font-size:13px;font-weight:500;border:1px solid var(--danger);cursor:pointer;color:var(--danger);background:transparent";
    cancel.addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    del.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    actions.append(cancel, del);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

function deleteTask(id) {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tasks.splice(idx, 1);
  if (activeId === id) {
    if (tasks.length === 0) {
      tasks.push({
        id: "task-initial",
        name: "New task",
        status: "running",
        git: null,
        msg: "Waiting for your first message…",
        chatHtml: "",
      });
    }
    activeId = tasks[tasks.length - 1].id;
    const t = getActive();
    chatInner.innerHTML = t.chatHtml && t.chatHtml.trim() ? t.chatHtml : "";
    assistantBody = null;
    typingEl = null;
    if (!chatInner.querySelector(".msg, .agent-callout, .run")) showEmptyState();
    sessionTitle.textContent = t.name;
  }
  renderTasks();
  bindLiveTask();
  saveTasks();
}

function renderTasks() {
  taskListView.innerHTML = "";
  tasks.forEach((t) => taskListView.appendChild(makeTaskCard(t)));
}

function setLiveStatus(kind, msg) {
  const t = getActive();
  if (t) {
    t.status = kind === "running" ? "running" : kind === "done" ? "done" : "help";
    if (msg) t.msg = msg;
  }
  if (!liveTask) return;
  const dot = liveTask.querySelector(".status-dot");
  dot.className = "status-dot " + statusClass(kind);
  if (msg) liveTask.querySelector(".task-msg").textContent = msg;
  saveTasks();
}

// ── Git badge ────────────────────────────────────────────────
function gitClass(branch) {
  const b = (branch || "").toLowerCase();
  if (b === "master" || b === "main") return "master";
  if (!b) return "local";
  return "worktree";
}
function gitIcon(cls) {
  return cls === "master" ? "commit" : cls === "local" ? "computer" : "account_tree";
}
function gitBadgeInner(branch) {
  const cls = gitClass(branch);
  return `<span class="material-symbols-outlined">${gitIcon(cls)}</span> ` + escapeHtml(branch || "no branch");
}
function setGitBadge(el, branch) {
  el.className = "git-badge " + gitClass(branch);
  el.innerHTML = gitBadgeInner(branch);
}
async function refreshGit() {
  const g = await apiGet("/api/git?root=" + encodeURIComponent(WORKSPACE));
  if (!g) return;
  setGitBadge(document.getElementById("head-git"), g.branch);
  if (liveTaskGit) {
    setGitBadge(liveTaskGit, g.branch);
    const t = getActive();
    if (t) {
      t.git = g.branch;
      saveTasks();
    }
  }
  return g;
}

// ── Drawer ────────────────────────────────────────────────────
const scrim = document.getElementById("scrim");
const drawer = document.getElementById("drawer");
const drawerTitle = document.getElementById("drawer-title");
const drawerBody = document.getElementById("drawer-body");
function openDrawer(title, html) {
  drawerTitle.textContent = title;
  drawerBody.innerHTML = html;
  scrim.classList.add("open");
  drawer.classList.add("open");
}
function closeDrawer() {
  scrim.classList.remove("open");
  drawer.classList.remove("open");
}
scrim.addEventListener("click", closeDrawer);
document.getElementById("drawer-close").addEventListener("click", closeDrawer);

// ── Image / file upload ─────────────────────────────────────
const photoInput = document.getElementById("photo-input");

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function openUpload() {
  photoInput.click();
}

async function handleUpload(files) {
  for (const file of files) {
    let path = "uploads/" + file.name;
    try {
      const dataUrl = await readAsDataURL(file);
      const base64 = String(dataUrl).split(",")[1] || "";
      const r = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, data: base64 }),
      });
      const j = await r.json();
      if (j.ok && j.path) path = j.path;
    } catch (e) {}
    addComposerRef(path);
  }
  openCurrentSession();
}

photoInput.addEventListener("change", () => {
  if (photoInput.files && photoInput.files.length) handleUpload(photoInput.files);
  photoInput.value = "";
});

// ── Settings (in-app overlay, no separate instance) ─────────
function openSettings() {
  const overlay = document.getElementById("settings-overlay");
  const panel = document.getElementById("settings-panel");
  panel.innerHTML =
    '<div class="drawer-head"><h3>Settings</h3><button class="drawer-close" id="settings-close"><span class="material-symbols-outlined">close</span></button></div><div class="settings-body" id="settings-body">Loading…</div>';
  document.getElementById("settings-close").addEventListener("click", closeSettings);
  overlay.classList.add("open");
  fetch("settings.html")
    .then((r) => r.text())
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const style = doc.querySelector("style");
      if (style) {
        const s = document.createElement("style");
        s.textContent = style.textContent;
        panel.appendChild(s);
      }
      const content = doc.querySelector(".content") || doc.body;
      const body = document.getElementById("settings-body");
      body.innerHTML = "";
      body.appendChild(document.importNode(content, true));
      import("./settings.js")
        .then((m) => m.initSettings(body))
        .catch((e) => {
          body.innerHTML = "Failed to load settings: " + e;
        });
    })
    .catch(() => {
      document.getElementById("settings-body").textContent = "Failed to load settings.";
    });
}

function closeSettings() {
  document.getElementById("settings-overlay").classList.remove("open");
}

document.getElementById("settings-overlay").addEventListener("click", (e) => {
  if (e.target.id === "settings-overlay") closeSettings();
});

function langSvg(cls, label) {
  return `<svg class="ficon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><text x="12" y="16" font-size="9" font-family="monospace" text-anchor="middle" fill="currentColor" stroke="none">${label}</text></svg>`;
}
function extClass(name) {
  const e = name.split(".").pop().toLowerCase();
  const m = {
    ts: "lc-ts", tsx: "lc-tsx", js: "lc-js", mjs: "lc-js", cjs: "lc-js", jsx: "lc-tsx",
    rs: "lc-rs", rust: "lc-rs", py: "lc-py", go: "lc-go", css: "lc-css", scss: "lc-css",
    json: "lc-json", md: "lc-md",
  };
  return m[e] || "lc-default";
}
function renderTree(node, prefix = "") {
  if (node.type === "file") {
    const path = prefix + node.name;
    const size = node.size != null ? `<span class="fsize">${(node.size / 1024).toFixed(1)}k</span>` : "";
    const cls = extClass(node.name);
    return `<div class="fnode indent file" data-path="${escapeHtml(path)}" style="cursor:pointer">${langSvg(
      cls,
      cls.split("-")[1]?.toUpperCase() || "?"
    )}<span class="fname">${escapeHtml(node.name)}</span>${size}</div>`;
  }
  const kids = (node.children || []).map((c) => renderTree(c, prefix + node.name + "/")).join("");
  return `<div class="fnode"><span class="ficon">📁</span><span class="fname">${escapeHtml(node.name)}/</span></div>${kids}`;
}

function addComposerRef(path) {
  const refs = document.getElementById("composer-refs");
  const tag = document.createElement("span");
  tag.className = "composer-ref";
  tag.dataset.path = path;
  tag.innerHTML = `${escapeHtml(path)}<button title="Remove"><span class="material-symbols-outlined">close</span></button>`;
  tag.querySelector("button").addEventListener("click", () => tag.remove());
  refs.appendChild(tag);
}

async function openFiles() {
  const data = await apiGet("/api/files?root=" + encodeURIComponent(WORKSPACE));
  if (!data) {
    openDrawer("Files", '<p style="color:var(--muted)">Could not read workspace files.</p>');
    return;
  }
  openDrawer("Files", `<div class="ftree">${renderTree(data)}</div>`);
  drawerBody.querySelectorAll(".fnode.file").forEach((f) => {
    f.addEventListener("click", () => {
      addComposerRef(f.dataset.path);
      closeDrawer();
    });
  });
}

async function openCommit() {
  const g = await apiGet("/api/git?root=" + encodeURIComponent(WORKSPACE));
  const branch = g?.branch || "(unknown)";
  let rows = "";
  if (g && g.files && g.files.length) {
    rows = g.files
      .slice(0, 40)
      .map((f) => {
        const del = f.status.includes("D");
        const untracked = f.status.trim().startsWith("??");
        const cls = del ? "del" : "add";
        return `<div class="diff-row ${cls}"><span class="dl">${del ? "-" : untracked ? "?" : "+"}</span><span>${escapeHtml(f.path)}</span></div>`;
      })
      .join("");
  } else if (g && g.is_repo) {
    rows = '<p style="color:var(--muted)">No changes.</p>';
  } else {
    rows = '<p style="color:var(--muted)">Not a git repository.</p>';
  }
  const html = `
    <div class="field"><label>Branch</label><div class="branch-row"><span class="bname">${escapeHtml(branch)}</span><span class="bmeta">${g?.dirty ? "uncommitted changes" : "clean"}</span></div></div>
    <div class="field"><label>Commit message</label><input class="input" id="commit-msg" value="chore: update via Vibin desktop" /></div>
    <div class="field"><label>Changes</label>${rows}</div>
    <button class="head-btn primary" id="commit-btn" style="width:100%;justify-content:center;">Commit to branch</button>`;
  openDrawer("Commit changes", html);
  document.getElementById("commit-btn").addEventListener("click", async (e) => {
    e.target.textContent = "Committing…";
    const res = await apiPost("/api/commit", {
      root: WORKSPACE,
      message: document.getElementById("commit-msg").value,
    });
    e.target.textContent = res.ok ? "Committed ✓" : "Failed: " + (res.message || "");
    if (res.ok) setTimeout(refreshGit, 600);
  });
}

async function openPr() {
  const g = await apiGet("/api/git?root=" + encodeURIComponent(WORKSPACE));
  const branch = g?.branch || "(unknown)";
  const html = `
    <div class="field"><label>From → Into</label><div class="branch-row"><span class="bname">${escapeHtml(branch)}</span><span class="bmeta">→ master</span></div></div>
    <div class="field"><label>Title</label><input class="input" value="Changes from ${escapeHtml(branch)}" /></div>
    <div class="field"><label>Description</label><textarea class="textarea">Opened from Vibin desktop.</textarea></div>
    <div class="field"><label>Commits</label><div class="diff-row add"><span class="dl">+</span><span>working tree changes</span></div></div>
    <button class="head-btn primary" style="width:100%;justify-content:center;" onclick="this.textContent='Connect a git remote / gh to open PRs'">Open pull request</button>`;
  openDrawer("Open pull request", html);
}

document.getElementById("open-files").addEventListener("click", openFiles);
document.getElementById("open-commit").addEventListener("click", openCommit);
document.getElementById("head-commit").addEventListener("click", openCommit);
document.getElementById("open-pr").addEventListener("click", openPr);
document.getElementById("head-pr").addEventListener("click", openPr);
document.getElementById("open-settings").addEventListener("click", openSettings);
document.getElementById("attach-file").addEventListener("click", openUpload);

// ── Live chat ────────────────────────────────────────────────
const chatScroll = document.getElementById("chat-scroll");
const chatInner = document.getElementById("chat-inner");
const input = document.getElementById("composer-input");
let assistantBody = null;
let typingEl = null;

const scrollBottom = () => chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: "smooth" });

function clearEmpty() {
  const es = chatInner.querySelector("#empty-state");
  if (es) es.remove();
}
function showEmptyState() {
  const es = document.createElement("div");
  es.className = "empty";
  es.id = "empty-state";
  es.innerHTML = `<div class="empty-mark">V</div><h3>What should we build?</h3><p>Message the agent below. It works inside your repo and can edit files, run commands, and open pull requests.</p>`;
  chatInner.appendChild(es);
}

function addUserMessage(text) {
  setSessionName(text.trim().replace(/\s+/g, " ").slice(0, 42) || "New task");
  clearEmpty();
  const m = document.createElement("div");
  m.className = "msg";
  m.innerHTML = `<div class="ava user">YO</div><div class="msg-body"><div class="msg-name">You <span>just now</span></div><div class="msg-text">${escapeHtml(text)}</div></div>`;
  chatInner.appendChild(m);
  scrollBottom();
  saveSession();
}

function showTyping() {
  clearEmpty();
  if (typingEl) return;
  typingEl = document.createElement("div");
  typingEl.className = "typing";
  typingEl.innerHTML = `<div class="ava agent">AI</div><div class="bubble"><span></span><span></span><span></span></div>`;
  chatInner.appendChild(typingEl);
  scrollBottom();
}

function ensureAssistant() {
  if (typingEl && typingEl.parentNode) {
    typingEl.remove();
    typingEl = null;
  }
  if (assistantBody) return;
  clearEmpty();
  const m = document.createElement("div");
  m.className = "msg";
  m.innerHTML = `<div class="ava agent">AI</div><div class="msg-body"></div>`;
  chatInner.appendChild(m);
  assistantBody = m.querySelector(".msg-body");
  scrollBottom();
}

function appendSystem(text, kind = "") {
  clearEmpty();
  const c = document.createElement("div");
  c.className = `agent-callout ${kind}`.trim();
  c.innerHTML = `<div class="ac-title">Vibe agent</div><p>${escapeHtml(text)}</p>`;
  chatInner.appendChild(c);
  scrollBottom();
  saveSession();
}

function showApproval(ev) {
  ding();
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(43,33,28,.35);display:grid;place-items:center;z-index:80";
  const card = document.createElement("div");
  card.style.cssText =
    "background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px 22px;max-width:420px;box-shadow:var(--elev-raised)";
  card.innerHTML = `<div class="ct" style="font-weight:600;margin-bottom:8px">Agent wants to ${escapeHtml(
    ev.kind
  )}</div><p style="margin:0 0 16px;color:var(--fg-2);white-space:pre-wrap">${escapeHtml(
    ev.summary + (ev.command ? `\n${ev.command}` : "")
  )}</p>`;
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
  const mk = (label, decision, primary) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `padding:8px 14px;border-radius:10px;font-size:13px;font-weight:500;border:1px solid var(--border);cursor:pointer;${
      primary ? "background:var(--accent);color:var(--accent-on);border-color:var(--accent)" : "color:var(--fg-2)"
    }`;
    b.addEventListener("click", () => {
      session.sendApproval(ev.id, decision);
      overlay.remove();
    });
    return b;
  };
  actions.append(mk("Reject", "reject", false), mk("Always", "always", false), mk("Allow", "allow", true));
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function renderEvent(line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  switch (ev.t) {
    case "text":
      ensureAssistant();
      assistantBody.appendChild(document.createTextNode(ev.d));
      scrollBottom();
      break;
    case "tool":
      ensureAssistant();
      {
        const run = document.createElement("div");
        run.className = "run";
        run.innerHTML = `<span class="dot"></span><span class="txt">Using <b>${escapeHtml(
          ev.name
        )}</b>${ev.summary ? ` — ${escapeHtml(ev.summary)}` : ""}</span>`;
        assistantBody.appendChild(run);
        scrollBottom();
      }
      break;
    case "assistant_start":
      showTyping();
      setLiveStatus("running", "Agent is working…");
      break;
    case "assistant_end":
      assistantBody = null;
      setLiveStatus("done", "Agent finished");
      break;
    case "info":
      appendSystem(ev.m);
      break;
    case "error":
      appendSystem(ev.m + (ev.h ? `\n${ev.h}` : ""), "help");
      setLiveStatus("help", "Agent hit an error");
      break;
    case "need_approval":
      showApproval(ev);
      setLiveStatus("help", "Agent needs your review");
      break;
    case "setup_required":
      appendSystem(
        "Vibin needs a provider. Run `vibin` in a terminal once to set up a provider and model, then restart this app.",
        "help"
      );
      break;
    case "ready":
    case "done":
    case "ended":
      appendSystem("Session ended.", "");
      setLiveStatus("done", "Session ended");
      break;
  }
  saveSession();
}

function saveSession() {
  persistActiveChat();
  saveTasks();
}

function doSend() {
  const v = input.value.trim();
  const refs = [...composerRefs.querySelectorAll(".composer-ref")].map(
    (r) => r.dataset.path || r.textContent.trim()
  );
  if (!v && refs.length === 0) return;
  let full = v;
  if (refs.length) {
    full += "\n\nReferenced files:\n" + refs.map((p) => "- " + p).join("\n");
  }
  addUserMessage(v || "(attached files)");
  input.value = "";
  input.style.height = "auto";
  composerRefs.innerHTML = "";
  setLiveStatus("running", "Agent is working…");
  session.sendPrompt(full).catch((e) => appendSystem(String(e), "help"));
}

async function newChat() {
  persistActiveChat();
  try {
    await session.stopSession();
  } catch {}
  const id = "task-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const task = {
    id,
    name: "New task",
    status: "running",
    git: getActive() ? getActive().git : null,
    msg: "Waiting for your first message…",
    chatHtml: "",
  };
  tasks.push(task);
  activeId = id;
  chatInner.innerHTML = "";
  showEmptyState();
  assistantBody = null;
  typingEl = null;
  renderTasks();
  bindLiveTask();
  sessionTitle.textContent = "New task";
  setLiveStatus("running", "Waiting for your first message…");
  saveTasks();
  openCurrentSession();
  session.ensureStarted().catch((e) => appendSystem(String(e), "help"));
}

async function activateTask(id) {
  if (id === activeId) {
    openCurrentSession();
    return;
  }
  persistActiveChat();
  saveTasks();
  activeId = id;
  const t = getActive();
  chatInner.innerHTML = t.chatHtml && t.chatHtml.trim() ? t.chatHtml : "";
  assistantBody = null;
  typingEl = null;
  if (!chatInner.querySelector(".msg, .agent-callout, .run")) showEmptyState();
  renderTasks();
  bindLiveTask();
  sessionTitle.textContent = t.name;
  openCurrentSession();
}

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
});
document.getElementById("send-btn").addEventListener("click", doSend);
document.getElementById("new-task").addEventListener("click", newChat);

const modelSelect = document.getElementById("model-select");
const FALLBACK_MODELS = [
  { provider: "openai", model: "gpt-4o" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "anthropic", model: "claude-3-5-sonnet" },
  { provider: "anthropic", model: "claude-3-5-haiku" },
  { provider: "openrouter", model: "openai/gpt-4o" },
  { provider: "openrouter", model: "anthropic/claude-3.5-sonnet" },
  { provider: "codex", model: "gpt-5.3-codex" },
];
async function loadModels() {
  let list = FALLBACK_MODELS;
  try {
    const r = await fetch("/api/models");
    if (r.ok) {
      const data = await r.json();
      const models = Array.isArray(data.models) ? data.models : [];
      if (models.length) list = models.map((m) => ({ model: String(m) }));
    }
  } catch (e) {}
  modelSelect.innerHTML = list
    .map((m) => `<option value="${escapeHtml(m.model)}">${escapeHtml(m.model)}</option>`)
    .join("");
  const saved = localStorage.getItem("vibin.model");
  if (saved) modelSelect.value = saved;
}
modelSelect.addEventListener("change", () => {
  const model = modelSelect.value;
  localStorage.setItem("vibin.model", model);
  session.sendPrompt(`/model ${model}`).catch((e) => appendSystem(String(e), "help"));
});
loadModels();

// ── Boot ─────────────────────────────────────────────────────
loadTasks();
if (!tasks.length) {
  tasks.push({
    id: "task-initial",
    name: "New task",
    status: "running",
    git: null,
    msg: "Waiting for your first message…",
    chatHtml: "",
  });
}
activeId = tasks[tasks.length - 1].id;
renderTasks();
bindLiveTask();
session.onAgentEvent(renderEvent);
const bootTask = getActive();
sessionTitle.textContent = bootTask.name;
chatInner.innerHTML = bootTask.chatHtml && bootTask.chatHtml.trim() ? bootTask.chatHtml : "";
if (!chatInner.querySelector(".msg, .agent-callout, .run")) showEmptyState();
loadConfig()
  .then(refreshGit)
  .then(() => session.ensureStarted().catch((e) => appendSystem(String(e), "help")));
