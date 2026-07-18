import { Agent } from "../agent/agent";
import { SessionStore, type Session } from "../agent/session";
import { THINKING_MODES, type ThinkingMode } from "../agent/thinking";
import { listModels } from "../api/models";
import { OpenAICompatibleProvider } from "../api/openai-compatible";
import { CodexAuth } from "../api/codex-auth";
import { CodexResponsesProvider } from "../api/codex-responses";
import { activateProfile, removeProfile, saveConfig, type ProviderProfile, type VibinConfig } from "../config/config";
import { VibinError } from "../shared/errors";
import { ToolRunner } from "../tools/runner";
import { parseCommand } from "./commands";
import { color } from "./theme";
import { TerminalUI } from "./ui";

const help = `CHAT\n  Write normally to ask Vibin to inspect, plan, edit, and verify code.\n  Tab                     toggle between Plan and Work modes\n\nSESSION\n  /status                 show active model and workspace\n  /clear                  clear agent memory\n  /compact                summarize session context\n  /history                show this session's prompts\n  /context                show context policy\n\nWORKSPACE\n  /files [path]           list files without using an API\n  /read <path>            read a project file\n  /search <text>          search project files\n\nPROVIDERS\n  /provider               open the provider manager\n  /provider list          list saved provider profiles\n  /provider use <name>    switch profiles instantly\n  /provider add           create and activate a profile\n  /provider remove [name] remove a saved profile\n  /model                  open the model picker\n  /model <name>           use a known model directly\n  /config                 show active provider configuration\n\n  /quit, /exit            exit Vibin`;
export async function startApp(cwd: string, initial: VibinConfig, oneShot?: string): Promise<void> {
  const ui = new TerminalUI(); let config = initial; let controller: AbortController | undefined;
  const codexAuth = new CodexAuth();
  let thinkingMode: ThinkingMode = "medium";
  let mode: "work" | "plan" = "work";
  const alwaysAllowedCommands = new Set(initial.alwaysAllowedCommands);
  const saveAlwaysAllowedCommands = async (): Promise<void> => {
    config = { ...config, alwaysAllowedCommands: [...alwaysAllowedCommands].sort() };
    await saveConfig(cwd, config);
  };
  const createTools = () => new ToolRunner(cwd, (summary) => ui.confirm(summary), (command) => ui.confirmCommand(command), alwaysAllowedCommands, saveAlwaysAllowedCommands);
  const createAgent = () => new Agent(config.provider === "codex" ? new CodexResponsesProvider({ model: config.model, auth: codexAuth, endpoint: config.baseUrl }) : new OpenAICompatibleProvider({ apiKey: config.apiKey!, baseUrl: config.baseUrl, model: config.model, appName: "Vibin" }), createTools(), cwd, thinkingMode);
  let agent = createAgent(); const localTools = createTools();
  const sessions = new SessionStore(cwd); let prompts: string[] = [];
  let session: Session = { id: `session-${Date.now()}`, updatedAt: new Date().toISOString(), history: [], prompts: [], plan: null };
  const persist = async () => { session = await sessions.save({ ...session, history: agent.getHistory(), prompts }); };
  const setThinkingMode = async (mode: ThinkingMode): Promise<void> => {
    if (["maxthinking", "ultraagent"].includes(mode) && !(await ui.confirm(`${mode === "ultraagent" ? "UltraAgent splits requests into sub-agents" : "MaxThinking uses maximum-depth reasoning"} and can use a lot of your quota/tokens. Continue?`))) return;
    thinkingMode = mode; agent.setThinkingMode(mode); ui.info(`Thinking mode: ${THINKING_MODES.find((entry) => entry.value === mode)!.label}`);
  };
  const addProvider = async (): Promise<void> => {
    const provider = await ui.choose("CONNECT A PROVIDER", [
      { value: "openai", label: "OpenAI", detail: "Connect your OpenAI API key and choose from its available models." },
      { value: "openrouter", label: "OpenRouter", detail: "Browse models available through your OpenRouter account." },
      { value: "compatible", label: "OpenAI-compatible", detail: "Connect another provider that supports the OpenAI model-list API." },
      { value: "codex", label: "ChatGPT/Codex OAuth (experimental)", detail: "Use an eligible ChatGPT plan through the experimental Codex Responses backend." },
    ]);
    if (provider === "codex") {
      await codexAuth.login((url) => ui.info(`Open this URL to sign in with ChatGPT:\n${url}`));
      const profile: ProviderProfile = { provider: "codex", baseUrl: "https://chatgpt.com/backend-api/codex/responses", model: "gpt-5.3-codex" };
      config = { ...profile, profiles: { ...config.profiles, codex: profile }, activeProfile: "codex", alwaysAllowedCommands: config.alwaysAllowedCommands };
      await saveConfig(cwd, config); agent = createAgent(); ui.info("ChatGPT/Codex OAuth is connected for this Vibin project."); return;
    }
    const preset = provider === "openai" ? { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" } : provider === "openrouter" ? { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini" } : { baseUrl: "", model: "" };
    ui.panel(`${provider.toUpperCase()} SETUP`, "Paste an API key. Vibin keeps it only in this project's ignored .vibin folder.");
    const apiKey = await ui.secret("API key:"); const baseUrl = provider === "compatible" ? await ui.ask("Provider base URL:") : preset.baseUrl;
    if (!apiKey || !baseUrl) throw new VibinError("Provider setup needs an API key and base URL.");
    ui.info("Checking your connection and fetching available models…");
    let model: string;
    while (true) {
      try { model = await ui.chooseModel(await listModels({ apiKey, baseUrl, provider: provider as ProviderProfile["provider"] })); break; }
      catch (error) {
        const reason = error instanceof Error ? error.message : "Model lookup failed.";
        ui.error(reason, "Check the API key and connection, then retry.");
        const retry = await ui.choose("MODEL LIST UNAVAILABLE", [{ value: "retry", label: "Try again", detail: "Retry the connection with this key." }, { value: "cancel", label: "Cancel setup", detail: "Return without saving a provider." }]);
        if (retry === "cancel") return;
      }
    }
    const requestedName = await ui.ask(`Profile name ${color.dim("(optional)")}:`);
    const baseName = requestedName || provider;
    let profileName = baseName; let suffix = 2;
    while (config.profiles[profileName]) { profileName = `${baseName}-${suffix}`; suffix += 1; }
    const profile: ProviderProfile = { provider: provider as ProviderProfile["provider"], apiKey, model, baseUrl };
    config = { ...profile, profiles: { ...config.profiles, [profileName]: profile }, activeProfile: profileName, alwaysAllowedCommands: config.alwaysAllowedCommands }; await saveConfig(cwd, config); agent = createAgent(); ui.info(`Saved and activated '${profileName}'.`);
  };
  const listProviders = (): void => {
    const entries = Object.entries(config.profiles);
    ui.panel("SAVED PROVIDERS", entries.length ? entries.map(([name, profile]) => `${name}${name === config.activeProfile ? " (active)" : ""}\n  ${profile.provider} · ${profile.model}`).join("\n") : "No saved providers. Add one to get started.");
  };
  const switchProvider = async (): Promise<void> => {
    const entries = Object.entries(config.profiles);
    if (!entries.length) { ui.error("No saved providers.", "/provider add"); return; }
    const name = await ui.choose("SWITCH PROVIDER", entries.map(([profileName, profile]) => ({
      value: profileName, label: profileName, detail: `${profile.provider} · ${profile.model}${profileName === config.activeProfile ? " · active" : ""}`,
    })));
    config = activateProfile(config, name); await saveConfig(cwd, config); agent = createAgent(); ui.info(`Active provider: ${name} (${config.model})`);
  };
  const removeProvider = async (requestedName?: string): Promise<void> => {
    const entries = Object.entries(config.profiles);
    if (!entries.length) { ui.error("No saved providers.", "/provider add"); return; }
    const name = requestedName && config.profiles[requestedName] ? requestedName : requestedName ? "" : await ui.choose("REMOVE PROVIDER", entries.map(([profileName, profile]) => ({
      value: profileName, label: profileName, detail: `${profile.provider} · ${profile.model}${profileName === config.activeProfile ? " · active" : ""}`,
    })));
    if (!name) { ui.error(`No provider profile named '${requestedName}'.`, "/provider list"); return; }
    if (!(await ui.confirm(`Remove provider '${name}'?`))) return;
    config = removeProfile(config, name); await saveConfig(cwd, config); agent = createAgent();
    ui.info(Object.keys(config.profiles).length ? `Removed '${name}'. Active provider: ${config.activeProfile}.` : `Removed '${name}'. Use /provider add to connect a provider.`);
  };
  const manageProviders = async (): Promise<void> => {
    const action = await ui.choose("PROVIDER MANAGER", [
      { value: "switch", label: "Switch provider", detail: "Choose which saved provider Vibin uses now." },
      { value: "add", label: "Add provider", detail: "Connect an OpenAI, OpenRouter, or compatible provider." },
      { value: "remove", label: "Remove provider", detail: "Delete a saved provider profile after confirmation." },
      { value: "list", label: "View saved providers", detail: "See each saved provider and the active selection." },
    ]);
    if (action === "switch") await switchProvider();
    else if (action === "add") await addProvider();
    else if (action === "remove") await removeProvider();
    else listProviders();
  };
  ui.banner(config.provider, config.apiKey && config.model ? config.model : "setup required", cwd);
  if (!config.apiKey || !config.model || !config.baseUrl) {
    ui.panel("WELCOME TO VIBIN", "Set up a provider and model before starting your first session.");
    await addProvider();
    ui.status(config.provider, config.model, cwd);
  }
  const run = async (prompt: string) => {
    if ((config.provider !== "codex" && !config.apiKey) || !config.baseUrl || !config.model) { ui.error("The active provider is incomplete.", "Use /provider add to create a complete provider profile."); return; }
    prompts.push(prompt); controller = new AbortController(); ui.startAssistant();
    try { await agent.answer(prompt, { text: (text) => ui.text(text), tool: (name, summary) => ui.tool(name, summary) }, controller.signal); ui.finishAssistant(); }
    catch (error) { ui.finishAssistant(); const err = error instanceof VibinError ? error : new VibinError(error instanceof Error ? error.message : "Unexpected error."); ui.error(err.message, err.hint); }
    finally { controller = undefined; await persist(); }
  };
  const createPlan = async (request: string) => {
    if ((config.provider !== "codex" && !config.apiKey) || !config.baseUrl || !config.model) { ui.error("The active provider is incomplete.", "Use /provider add to create a complete provider profile."); return; }
    controller = new AbortController(); ui.startAssistant("plan");
    try { session.plan = await agent.plan(request, { text: (text) => ui.text(text), tool: () => {} }, controller.signal); await persist(); ui.finishAssistant(); }
    catch (error) { ui.finishAssistant(); ui.error(error instanceof Error ? error.message : "Could not create a plan."); }
    finally { controller = undefined; }
  };
  const interrupt = () => { if (controller) { controller.abort(); ui.info("Request cancelled."); } else { ui.close(); process.exit(0); } };
  process.on("SIGINT", interrupt);
  try {
    if (oneShot) { await run(oneShot); return; }
    while (true) {
      const input = await ui.prompt(await localTools.workspaceFiles(), config.model, cwd, mode, () => {
        mode = mode === "work" ? "plan" : "work";
        return mode;
      }); if (!input) continue;
      const command = parseCommand(input);
      const activeMode = mode as "work" | "plan";
      if (!command) { if (activeMode === "plan") await createPlan(input); else await run(input); continue; }
      if (command.type === "quit") break;
      if (command.type === "help") ui.panel("VIBIN COMMANDS", help);
      else if (command.type === "status") { ui.status(config.provider, config.model, cwd); ui.info(`Mode: ${mode}`); ui.info(`Thinking: ${THINKING_MODES.find((entry) => entry.value === thinkingMode)!.label}`); }
      else if (command.type === "thinking") {
        const requested = command.value.trim().toLowerCase();
        const mode = THINKING_MODES.find((entry) => entry.value === requested);
        if (requested && !mode) ui.error("Unknown thinking mode.", "low · medium · high · xhigh · maxthinking · ultraagent");
        else if (mode) await setThinkingMode(mode.value);
        else {
          const selected = await ui.choose("THINKING MODE", THINKING_MODES);
          const selectedMode = THINKING_MODES.find((entry) => entry.value === selected);
          if (selectedMode) await setThinkingMode(selectedMode.value);
        }
      }
      else if (command.type === "clear") { agent.clear(); prompts = []; session.plan = null; await persist(); ui.info("Session context and active plan cleared."); }
      else if (command.type === "compact") {
        try { ui.info(await agent.compact() ? "Session context compacted." : "There is no session context to compact yet."); }
        catch (error) { ui.error(error instanceof Error ? error.message : "Could not compact session context."); }
      }
      else if (command.type === "history") ui.panel("SESSION HISTORY", prompts.length ? prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n") : "No prompts in this session yet.");
      else if (command.type === "context") ui.panel("CONTEXT POLICY", "Vibin keeps the last 20 session messages and discovers AGENTS.md\nfrom the current project upward. @relative/path explicitly adds bounded\nfile content to a request. Sessions are stored locally in .vibin/sessions.");
      else if (command.type === "plan") {
        const action = command.value.trim();
        if (action === "show") ui.panel("ACTIVE PLAN", session.plan ?? "No active plan. Use /plan <request>.");
        else if (action === "clear") { session.plan = null; await persist(); ui.info("Active plan cleared."); }
        else if (action === "apply") { if (!session.plan) ui.error("There is no active plan.", "/plan <request>"); else await run(`Implement the following approved plan. Inspect the workspace and proceed carefully.\n\n${session.plan}`); }
        else if (!action) ui.error("Provide a request or plan action.", "/plan add session resume · /plan show · /plan apply");
        else await createPlan(action);
      }
      else if (command.type === "session") {
        const [action, name] = command.value.trim().split(/\s+/, 2);
        if (!action || action === "list") {
          const saved = await sessions.list();
          ui.panel("SAVED SESSIONS", saved.length ? saved.map((item) => `${item.id}${item.id === session.id ? " (active)" : ""}\n  ${item.updatedAt}${item.plan ? " · plan" : ""}`).join("\n") : "No saved sessions yet.");
        } else if (action === "save") {
          if (name) session = await sessions.rename(session, name);
          await persist(); ui.info(`Saved session '${session.id}'.`);
        } else if (action === "resume" && name) {
          const loaded = await sessions.load(name); session = loaded; prompts = [...loaded.prompts]; agent.setHistory(loaded.history); ui.info(`Resumed session '${loaded.id}'.`);
        } else ui.error("Session command not understood.", "/session list · /session save [name] · /session resume <name>");
      }
      else if (command.type === "config") ui.panel("ACTIVE PROFILE", `name: ${config.activeProfile}\nprovider: ${config.provider}\nmodel: ${config.model}\nbase URL: ${config.baseUrl}\nAPI key: ${config.apiKey ? "configured" : "missing"}`);
      else if (command.type === "files") { try { ui.panel("FILES", await localTools.run("list_files", JSON.stringify({ path: command.value || "." }))); } catch (error) { ui.error(error instanceof Error ? error.message : "Could not list files."); } }
      else if (command.type === "read") { if (!command.value) ui.error("Provide a file path.", "/read src/index.ts"); else try { ui.panel(command.value, await localTools.run("read_file", JSON.stringify({ path: command.value }))); } catch (error) { ui.error(error instanceof Error ? error.message : "Could not read file."); } }
      else if (command.type === "search") { if (!command.value) ui.error("Provide text to search for.", "/search VIBIN_SYSTEM_PROMPT"); else try { ui.panel(`SEARCH: ${command.value}`, await localTools.run("search_files", JSON.stringify({ query: command.value }))); } catch (error) { ui.error(error instanceof Error ? error.message : "Could not search files."); } }
      else if (command.type === "model") {
        let model = command.value;
        if (!model) {
          if (!config.apiKey || !config.baseUrl) { ui.error("Set up a provider first.", "/provider add"); continue; }
          try { model = await ui.chooseModel(await listModels({ apiKey: config.apiKey, baseUrl: config.baseUrl, provider: config.provider })); }
          catch (error) { ui.error(error instanceof Error ? error.message : "Could not fetch models.", "Check your provider connection and try /model again."); continue; }
        }
        config = { ...config, model, profiles: { ...config.profiles, [config.activeProfile]: { ...config, model } } }; await saveConfig(cwd, config); agent = createAgent(); ui.info(`Model: ${config.model}`);
      }
      else if (command.type === "provider") {
        const [action, name] = command.value.split(/\s+/, 2);
        if (!action) await manageProviders();
        else if (action === "list") listProviders();
        else if (action === "use" && name) { config = activateProfile(config, name); await saveConfig(cwd, config); agent = createAgent(); ui.info(`Active provider: ${name} (${config.model})`); }
        else if (action === "add") await addProvider();
        else if (action === "remove") await removeProvider(name);
        else ui.error("Provider command not understood.", "/provider · /provider list · /provider use <name> · /provider add · /provider remove [name]");
      }
      else ui.error("Unknown command.", help);
    }
  } finally { process.off("SIGINT", interrupt); ui.close(); }
}
