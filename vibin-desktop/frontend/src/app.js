import * as session from "./session.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ── API helpers ──────────────────────────────────────────────
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

// ── Per-project session persistence ───────────────────────────
function sessionKey() {
  return "vibin.session." + btoa(unescape(encodeURIComponent(WORKSPACE)));
}
function saveSession() {
  try {
    const clone = chatInner.cloneNode(true);
    const es = clone.querySelector("#empty-state");
    if (es) es.remove();
    const typing = clone.querySelector(".typing");
    if (typing) typing.remove();
    if (!clone.querySelector(".msg, .agent-callout, .run")) {
      localStorage.removeItem(sessionKey());
      return;
    }
    localStorage.setItem(sessionKey(), clone.innerHTML);
  } catch {}
}
function loadSession() {
  try {
    const html = localStorage.getItem(sessionKey());
    if (html && html.trim()) {
      chatInner.innerHTML = html;
      const t = chatInner.querySelector(".typing");
      if (t) t.remove();
      return true;
    }
  } catch {}
  return false;
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

// ── Rail tabs (Tasks / Chats) ────────────────────────────────
const tabTasks = document.querySelector('.rail-tab[data-tab="tasks"]');
const tabChats = document.querySelector('.rail-tab[data-tab="chats"]');
const taskListView = document.getElementById("task-list");
const chatListView = document.getElementById("chat-list");
const chatPanel = document.querySelector(".main");
let sessionTitle = document.getElementById("crumb-task");
const renameSessionButton = document.getElementById("rename-session");

function currentSessionName() {
  return localStorage.getItem("vibin.sessionName") || "Current session";
}

function setSessionName(name) {
  const next = name.trim() || "Current session";
  localStorage.setItem("vibin.sessionName", next);
  sessionTitle.textContent = next;
  document.querySelectorAll('[data-chat="c1"] .task-title, #task-list .task-title').forEach((title) => {
    title.textContent = next;
  });
}

function openCurrentSession() {
  chatPanel.hidden = false;
  app.classList.remove("rail-collapsed");
  document.querySelectorAll(".task").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll('[data-chat="c1"], #task-list .task').forEach((item) => item.classList.add("active"));
  setSessionName(currentSessionName());
  document.getElementById("composer-input").focus();
}

function selectTab(name) {
  tabTasks.setAttribute("aria-selected", name === "tasks");
  tabChats.setAttribute("aria-selected", name === "chats");
  taskListView.hidden = name !== "tasks";
  chatListView.hidden = name !== "chats";
}
tabTasks.addEventListener("click", () => selectTab("tasks"));
tabChats.addEventListener("click", () => selectTab("chats"));
chatListView.querySelector('[data-chat="c1"]').addEventListener("click", openCurrentSession);

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
    renameSessionButton.innerHTML = `<b id="crumb-task">${escapeHtml(currentSessionName())}</b><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>`;
    sessionTitle = document.getElementById("crumb-task");
  };
  input.addEventListener("blur", finish, { once: true });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") { input.value = currentSessionName(); input.blur(); }
  });
});

// ── Live task (derived from session events) ───────────────────
let liveTask, liveTaskMsg, liveTaskGit;
function buildLiveTask() {
  const list = document.getElementById("task-list");
  list.innerHTML = "";
  liveTask = document.createElement("div");
  liveTask.className = "task active";
  liveTask.innerHTML = `
    <div class="task-top">
      <span class="status-dot status-running" title="Idle"></span>
      <span class="task-title">Current session</span>
    </div>
    <div class="task-msg">Waiting for your first message…</div>
    <div class="task-foot">
      <span class="git-badge local" id="live-git">local only</span>
    </div>`;
  list.appendChild(liveTask);
  liveTaskMsg = liveTask.querySelector(".task-msg");
  liveTaskGit = liveTask.querySelector("#live-git");
  liveTask.addEventListener("click", () => {
    openCurrentSession();
  });
  setSessionName(currentSessionName());
}
function setLiveStatus(kind, msg) {
  const dot = liveTask.querySelector(".status-dot");
  dot.className =
    "status-dot " + (kind === "running" ? "status-running" : kind === "done" ? "status-done" : "status-help");
  if (msg) liveTaskMsg.textContent = msg;
}

// ── Git badge ────────────────────────────────────────────────
function gitClass(branch) {
  const b = (branch || "").toLowerCase();
  if (b === "master" || b === "main") return "master";
  if (!b) return "local";
  return "worktree";
}
function setGitBadge(el, branch) {
  const cls = gitClass(branch);
  el.className = "git-badge " + cls;
  const icon =
    cls === "master"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4M5 4L3 6M5 4l2 2M19 3l-6 6M19 3v6"/></svg>'
      : cls === "local"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h16"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 8.4v7.2M8.4 6.6c5 0 6 1.6 6 4.4"/></svg>';
  el.innerHTML = icon + " " + (branch || "no branch");
}
async function refreshGit() {
  const g = await apiGet("/api/git?root=" + encodeURIComponent(WORKSPACE));
  if (!g) return;
  setGitBadge(document.getElementById("head-git"), g.branch);
  if (liveTaskGit) setGitBadge(liveTaskGit, g.branch);
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
  tag.innerHTML = `${escapeHtml(path)}<button title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
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
document.getElementById("head-files").addEventListener("click", openFiles);
document.getElementById("open-commit").addEventListener("click", openCommit);
document.getElementById("head-commit").addEventListener("click", openCommit);
document.getElementById("open-pr").addEventListener("click", openPr);
document.getElementById("head-pr").addEventListener("click", openPr);
document.getElementById("open-settings").addEventListener("click", () => {
  window.location.href = "settings.html";
});

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

function doSend() {
  const v = input.value.trim();
  if (!v) return;
  addUserMessage(v);
  input.value = "";
  input.style.height = "auto";
  setLiveStatus("running", "Agent is working…");
  session.sendPrompt(v).catch((e) => appendSystem(String(e), "help"));
}

async function newChat() {
  try {
    await session.stopSession();
  } catch {}
  localStorage.removeItem(sessionKey());
  chatInner.innerHTML = "";
  showEmptyState();
  assistantBody = null;
  typingEl = null;
  setLiveStatus("running", "Waiting for your first message…");
  session.ensureStarted().catch((e) => appendSystem(String(e), "help"));
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
document.getElementById("ref-file").addEventListener("click", openFiles);
document.getElementById("new-task").addEventListener("click", newChat);

// ── Boot ─────────────────────────────────────────────────────
buildLiveTask();
session.onAgentEvent(renderEvent);
const restored = loadSession();
if (!restored) showEmptyState();
loadConfig()
  .then(refreshGit)
  .then(() => session.ensureStarted().catch((e) => appendSystem(String(e), "help")));
