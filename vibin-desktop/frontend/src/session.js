const wsBase = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
const WS_URL = `${wsBase}/ws`;

let socket = null;
let started = false;
const handlers = [];

const DEFAULT_WORKSPACE = "C:\\Users\\spoil\\OneDrive\\Desktop\\Vibin";
const DEFAULT_VIBIN_SRC = "C:\\Users\\spoil\\OneDrive\\Desktop\\Vibin\\src\\index.ts";

export function getWorkspace() {
  return localStorage.getItem("vibin.workspace") || DEFAULT_WORKSPACE;
}
export function getVibinSrc() {
  return localStorage.getItem("vibin.vibinSrc") || DEFAULT_VIBIN_SRC;
}

function ensureConnected() {
  if (socket) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket = new WebSocket(WS_URL);
    socket.onopen = () => resolve();
    socket.onerror = (e) => reject(e);
    socket.onclose = () => {
      socket = null;
    };
    socket.onmessage = (ev) => {
      handlers.forEach((h) => h(ev.data));
    };
  });
}

export async function ensureStarted() {
  await ensureConnected();
  if (!started) {
    socket.send(
      JSON.stringify({ type: "start", workspace: getWorkspace(), vibinSrc: getVibinSrc() })
    );
    started = true;
  }
}

export async function sendPrompt(prompt) {
  await ensureStarted();
  socket.send(JSON.stringify({ type: "prompt", text: prompt }));
}

export async function sendApproval(id, decision) {
  await ensureStarted();
  socket.send(JSON.stringify({ type: "approve", id, decision }));
}

export async function stopSession() {
  if (!socket) return;
  socket.send(JSON.stringify({ type: "stop" }));
  socket.close();
  socket = null;
  started = false;
}

export async function onAgentEvent(handler) {
  handlers.push(handler);
}
