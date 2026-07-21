const wsBase = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
const WS_URL = `${wsBase}/ws`;

let socket = null;
let started = false;
let connecting = null;
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
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    const next = new WebSocket(WS_URL);
    socket = next;
    next.onopen = () => {
      connecting = null;
      resolve();
    };
    next.onerror = (e) => {
      connecting = null;
      if (socket === next) socket = null;
      reject(e);
    };
    next.onclose = () => {
      connecting = null;
      started = false;
      if (socket === next) socket = null;
    };
    next.onmessage = (ev) => {
      handlers.forEach((h) => h(ev.data));
    };
  });
  return connecting;
}

export async function ensureStarted() {
  await ensureConnected();
  const activeSocket = socket;
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
    throw new Error("The chat connection closed. Please try sending again.");
  }
  if (!started) {
    activeSocket.send(
      JSON.stringify({ type: "start", workspace: getWorkspace(), vibinSrc: getVibinSrc() })
    );
    started = true;
  }
}

export async function sendPrompt(prompt) {
  await ensureStarted();
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("The chat connection closed. Please try sending again.");
  socket.send(JSON.stringify({ type: "prompt", text: prompt }));
}

export async function sendApproval(id, decision) {
  await ensureStarted();
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("The chat connection closed. Please try again.");
  socket.send(JSON.stringify({ type: "approve", id, decision }));
}

export async function stopSession() {
  if (!socket) return;
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
  socket.close();
  socket = null;
  started = false;
}

export async function onAgentEvent(handler) {
  handlers.push(handler);
}
