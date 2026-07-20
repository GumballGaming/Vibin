import * as session from "./session.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function initChat({ scroll, inner, input, send }) {
  const scrollEl = document.getElementById(scroll);
  const innerEl = document.getElementById(inner);
  const inputEl = document.getElementById(input);
  const sendEl = document.getElementById(send);

  let assistantBody = null;

  const scrollToBottom = () => {
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
  };

  const addUserMessage = (text) => {
    const m = document.createElement("div");
    m.className = "msg";
    m.innerHTML = `<div class="ava user">YO</div><div class="msg-body"><div class="msg-name">You <span>just now</span></div><div class="msg-text">${escapeHtml(text)}</div></div>`;
    innerEl.appendChild(m);
    scrollToBottom();
  };

  const startAssistant = () => {
    const m = document.createElement("div");
    m.className = "msg";
    m.innerHTML = `<div class="ava agent">AI</div><div class="msg-body"></div>`;
    innerEl.appendChild(m);
    assistantBody = m.querySelector(".msg-body");
    scrollToBottom();
  };

  const appendSystem = (text, kind = "") => {
    const c = document.createElement("div");
    c.className = `callout ${kind}`.trim();
    c.innerHTML = `<div class="ct">${kind === "help" ? "Needs attention" : "Vibe agent"}</div><p>${escapeHtml(text)}</p>`;
    innerEl.appendChild(c);
    scrollToBottom();
  };

  const showApproval = (ev) => {
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
  };

  const handleEvent = (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    switch (ev.t) {
      case "text":
        if (!assistantBody) startAssistant();
        assistantBody.appendChild(document.createTextNode(ev.d));
        scrollToBottom();
        break;
      case "tool":
        if (!assistantBody) startAssistant();
        {
          const run = document.createElement("div");
          run.className = "run";
          run.innerHTML = `<span class="dot"></span><span class="txt">Using <b>${escapeHtml(
            ev.name
          )}</b>${ev.summary ? ` — ${escapeHtml(ev.summary)}` : ""}</span>`;
          assistantBody.appendChild(run);
          scrollToBottom();
        }
        break;
      case "assistant_start":
        startAssistant();
        break;
      case "assistant_end":
        assistantBody = null;
        break;
      case "info":
        appendSystem(ev.m);
        break;
      case "error":
        appendSystem(ev.m + (ev.h ? `\n${ev.h}` : ""), "help");
        break;
      case "need_approval":
        showApproval(ev);
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
        break;
    }
  };

  const doSend = () => {
    const v = inputEl.value.trim();
    if (!v) return;
    addUserMessage(v);
    inputEl.value = "";
    inputEl.style.height = "auto";
    session.sendPrompt(v).catch((e) => appendSystem(String(e), "help"));
  };

  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  sendEl.addEventListener("click", doSend);

  session.onAgentEvent(handleEvent);
  session.ensureStarted().catch((e) => appendSystem(String(e), "help"));
}
