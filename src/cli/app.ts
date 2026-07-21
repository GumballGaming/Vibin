import { Agent } from "../agent/agent";
import { SessionStore, type Session } from "../agent/session";
import { THINKING_MODES, type ThinkingMode } from "../agent/thinking";
import { listCodexModels, listModels } from "../api/models";
import { OpenAICompatibleProvider } from "../api/openai-compatible";
import { AnthropicProvider } from "../api/anthropic";
import { CodexAuth } from "../api/codex-auth";
import { CODEX_OAUTH_MODEL, CodexResponsesProvider } from "../api/codex-responses";
import { activateProfile, hasUsableApiKey, removeProfile, saveConfig, type ProviderProfile, type VibinConfig } from "../config/config";
import { VibinError } from "../shared/errors";
import { ToolRunner } from "../tools/runner";
import { parseCommand } from "./commands";
import { color } from "./theme";
import { TerminalUI } from "./ui";
import { HeadlessUI } from "./headless";
import { globalMcpPath, loadMcpConfig, mergeMcpConfigs, projectMcpPath } from "../config/mcp-config";
import { canonicalProjectPath, formatLaunchTrustPreview, loadMcpTrust, serverFingerprint, serverTrustKey, writeMcpTrustAtomic } from "../config/mcp-trust";
import { McpManager, type McpInitializationResult } from "../tools/mcp-manager";
import { join } from "node:path";

const help = `CHAT\n  Write normally to ask Vibin to inspect, plan, edit, and verify code.\n  Tab                     toggle between Plan and Work modes\n\nSESSION\n  /status                 show active model and workspace\n  /clear                  clear agent memory\n  /compact                summarize session context\n  /history                show this session's prompts\n  /context                show context policy\n\nWORKSPACE\n  /files [path]           list files without using an API\n  /read <path>            read a project file\n  /search <text>          search project files\n\nPROVIDERS\n  /provider               open the provider manager\n  /provider list          list saved provider profiles\n  /provider use <name>    switch profiles instantly\n  /provider add           create and activate a profile\n  /provider remove [name] remove a saved profile\n  /model                  open the model picker\n  /model <name>           use a known model directly\n  /config                 show active provider configuration\n\n  /quit, /exit            exit Vibin`;
export async function startApp(cwd: string, initial: VibinConfig, oneShot?: string, dataDir = cwd, ui: TerminalUI | HeadlessUI = new TerminalUI()): Promise<void> {
  const headless = ui instanceof HeadlessUI; let config = initial; let controller: AbortController | undefined;
  const codexAuth = new CodexAuth();
  let thinkingMode: ThinkingMode = config.thinking;
  let mode: "work" | "plan" = "work";
  const alwaysAllowedCommands = new Set(initial.alwaysAllowedCommands);
  const saveAlwaysAllowedCommands = async (): Promise<void> => {
    config = { ...config, alwaysAllowedCommands: [...alwaysAllowedCommands].sort() };
    await saveConfig(dataDir, config);
  };
  const createTools = () => new ToolRunner(cwd, (summary) => ui.confirm(summary), (command) => ui.confirmCommand(command), alwaysAllowedCommands, saveAlwaysAllowedCommands);
  let mcpIntegration: { manager: McpManager; initialization: McpInitializationResult } | undefined; let mcpManager: McpManager | undefined;
  const createAgent = () => new Agent(config.provider === "codex" ? new CodexResponsesProvider({ model: config.model, auth: codexAuth, endpoint: config.baseUrl }) : config.provider === "anthropic" ? new AnthropicProvider({ apiKey: config.apiKey!, baseUrl: config.baseUrl, model: config.model }) : new OpenAICompatibleProvider({ apiKey: config.apiKey!, baseUrl: config.baseUrl, model: config.model, appName: "Vibin", supportsNativeReasoning: config.provider === "openai" }), createTools(), cwd, thinkingMode, mcpIntegration);
  let agent = createAgent(); const localTools = createTools();
  const sessions = new SessionStore(dataDir); let prompts: string[] = [];
  let session: Session = { id: `session-${Date.now()}`, updatedAt: new Date().toISOString(), history: [], prompts: [], plan: null };
  const persist = async () => { session = await sessions.save({ ...session, history: agent.getHistory(), prompts }); };
  const setThinkingMode = async (mode: ThinkingMode): Promise<void> => {
    thinkingMode = mode;
    config = { ...config, thinking: mode, profiles: { ...config.profiles, [config.activeProfile]: { ...config, thinking: mode } } };
    await saveConfig(dataDir, config);
    agent.setThinkingMode(mode);
    ui.info(`Thinking mode: ${THINKING_MODES.find((entry) => entry.value === mode)!.label}`);
  };
  const addProvider = async (): Promise<void> => {
    const provider = await ui.choose("CONNECT A PROVIDER", [
      { value: "openai", label: "OpenAI", detail: "Connect your OpenAI API key and choose from its available models." },
      { value: "openrouter", label: "OpenRouter", detail: "Browse models available through your OpenRouter account." },
      { value: "anthropic", label: "Anthropic", detail: "Connect directly to the official Anthropic Messages API." },
      { value: "compatible", label: "OpenAI-compatible", detail: "Connect another provider that supports the OpenAI model-list API." },
      { value: "codex", label: "ChatGPT/Codex sign-in (experimental)", detail: `Use the Codex backend with ${CODEX_OAUTH_MODEL}. This is not an OpenAI API-key connection.` },
    ]);
    if (provider === "codex") {
      await codexAuth.login((url) => ui.info(`Open this URL to sign in with ChatGPT:\n${url}`));
      let model: string;
      try { model = await ui.chooseModel(await listCodexModels(codexAuth)); }
      catch (error) {
        ui.error(error instanceof Error ? error.message : "Could not fetch ChatGPT models.", `Using the default Codex model (${CODEX_OAUTH_MODEL}).`);
        model = CODEX_OAUTH_MODEL;
      }
      const profile: ProviderProfile = { provider: "codex", baseUrl: "https://chatgpt.com/backend-api/codex/responses", model, thinking: "medium" };
      config = { ...profile, profiles: { ...config.profiles, codex: profile }, activeProfile: "codex", alwaysAllowedCommands: config.alwaysAllowedCommands };
      await saveConfig(dataDir, config); agent = createAgent(); ui.info("ChatGPT/Codex OAuth is connected for this Vibin project."); return;
    }
    const preset = provider === "openai" ? { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" } : provider === "openrouter" ? { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini" } : provider === "anthropic" ? { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" } : { baseUrl: "", model: "" };
    ui.panel(`${provider.toUpperCase()} SETUP`, "Paste an API key. Vibin keeps it only in this project's ignored .vibin folder.");
    const apiKey = await ui.secret("API key:"); const baseUrl = provider === "compatible" ? await ui.ask("Provider base URL:") : preset.baseUrl;
    if (!apiKey || !baseUrl) throw new VibinError("Provider setup needs an API key and base URL.");
    if (!hasUsableApiKey({ provider: provider as ProviderProfile["provider"], apiKey, model: preset.model, baseUrl, thinking: "medium" })) throw new VibinError("The OpenRouter API key is incomplete.", "Create or copy the full key from OpenRouter, then run /provider add.");
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
    const profileName = provider === "compatible"
      ? (await ui.ask("Provider name:"))
      : provider;
    if (!profileName) throw new VibinError("Provider setup needs a name.");
    const profile: ProviderProfile = { provider: provider as ProviderProfile["provider"], apiKey, model, baseUrl, thinking: "medium" };
    config = { ...profile, profiles: { ...config.profiles, [profileName]: profile }, activeProfile: profileName, alwaysAllowedCommands: config.alwaysAllowedCommands }; await saveConfig(dataDir, config); agent = createAgent(); ui.info(`Saved and activated '${profileName}'.`);
  };
  const legacyListProviders = (): void => {
    const entries = Object.entries(config.profiles);
    ui.panel("SAVED PROVIDERS", entries.length ? entries.map(([name, profile]) => `${name}${name === config.activeProfile ? " (active)" : ""}\n  ${profile.provider} · ${profile.model}`).join("\n") : "No saved providers. Add one to get started.");
  };
  const listProviders = (): void => {
    const entries = Object.entries(config.profiles);
    ui.panel("SAVED PROVIDERS", entries.length ? entries.map(([name, profile]) => `${name}${name === config.activeProfile ? " (active)" : ""} - ${profile.model}`).join("\n") : "No saved providers. Add one to get started.");
  };
  const switchProvider = async (): Promise<void> => {
    const entries = Object.entries(config.profiles);
    if (!entries.length) { ui.error("No saved providers.", "/provider add"); return; }
    const name = await ui.choose("SWITCH PROVIDER", entries.map(([profileName, profile]) => ({
      value: profileName, label: profileName, detail: `${profile.provider} · ${profile.model}${profileName === config.activeProfile ? " · active" : ""}`,
    })));
    config = activateProfile(config, name); thinkingMode = config.thinking; await saveConfig(dataDir, config); agent = createAgent(); ui.info(`Active provider: ${name} (${config.model})`);
  };
  const removeProvider = async (requestedName?: string): Promise<void> => {
    const entries = Object.entries(config.profiles);
    if (!entries.length) { ui.error("No saved providers.", "/provider add"); return; }
    const name = requestedName && config.profiles[requestedName] ? requestedName : requestedName ? "" : await ui.choose("REMOVE PROVIDER", entries.map(([profileName, profile]) => ({
      value: profileName, label: profileName, detail: `${profile.provider} · ${profile.model}${profileName === config.activeProfile ? " · active" : ""}`,
    })));
    if (!name) { ui.error(`No provider profile named '${requestedName}'.`, "/provider list"); return; }
    if (!(await ui.confirm(`Remove provider '${name}'?`))) return;
    config = removeProfile(config, name); await saveConfig(dataDir, config); agent = createAgent();
    ui.info(Object.keys(config.profiles).length ? `Removed '${name}'. Active provider: ${config.activeProfile}.` : `Removed '${name}'. Use /provider add to connect a provider.`);
  };
  const manageProviders = async (): Promise<void> => {
    const action = await ui.choose("PROVIDER MANAGER", [
      { value: "switch", label: "Switch provider", detail: "Choose which saved provider Vibin uses now." },
      { value: "add", label: "Add provider", detail: "Connect an OpenAI, OpenRouter, Anthropic, or compatible provider." },
      { value: "remove", label: "Remove provider", detail: "Delete a saved provider profile after confirmation." },
      { value: "list", label: "View saved providers", detail: "See each saved provider and the active selection." },
    ]);
    if (action === "switch") await switchProvider();
    else if (action === "add") await addProvider();
    else if (action === "remove") await removeProvider();
    else listProviders();
  };
  const globalMcp = await loadMcpConfig(globalMcpPath(dataDir)); const projectMcp = await loadMcpConfig(projectMcpPath(cwd));
  let effectiveMcp = mergeMcpConfigs(globalMcp, projectMcp); const trustPath = join(dataDir, "mcp-trust.json"); const trust = await loadMcpTrust(trustPath); const projectIdentity = await canonicalProjectPath(cwd); let trustChanged = false;
  if (effectiveMcp.some((server) => server.source === "project") && !trust.projects.includes(projectIdentity)) {
    if (await ui.confirm(`Trust project '${projectIdentity}' to launch its configured MCP servers?`)) { trust.projects.push(projectIdentity); trustChanged = true; }
    else effectiveMcp = mergeMcpConfigs(globalMcp, { mcpServers: {} });
  }
  const launchable = [];
  for (const server of effectiveMcp) {
    const key = serverTrustKey(server, projectIdentity); const fingerprint = serverFingerprint(server, projectIdentity, cwd);
    if (trust.servers[key] === fingerprint || await ui.confirm(`Allow this MCP server to launch?\n${formatLaunchTrustPreview(server, cwd)}`)) {
      if (trust.servers[key] !== fingerprint) { trust.servers[key] = fingerprint; trustChanged = true; }
      launchable.push(server);
    }
  }
  if (trustChanged) await writeMcpTrustAtomic(trustPath, trust);
  mcpManager = new McpManager((preview) => ui.confirm(preview), cwd); const initialization = await mcpManager.initialize(launchable); mcpIntegration = { manager: mcpManager, initialization }; agent = createAgent();
  for (const warning of initialization.warnings) ui.info(`MCP warning (${warning.server}): ${warning.message}`);
  ui.banner(config.provider, hasUsableApiKey(config) && config.model ? config.model : "setup required", cwd);
  if (!hasUsableApiKey(config) || !config.model || !config.baseUrl) {
    if (headless) {
      ui.setupRequired();
      return;
    }
    ui.panel("WELCOME TO VIBIN", "Set up a provider and model before starting your first session.");
    await addProvider();
    ui.status(config.provider, config.model, cwd);
  }
  const run = async (prompt: string) => {
    if ((config.provider !== "codex" && !hasUsableApiKey(config)) || !config.baseUrl || !config.model) { ui.error("The active provider is incomplete.", "Use /provider add to create a complete provider profile."); return; }
    prompts.push(prompt); controller = new AbortController(); ui.startAssistant();
    try { await agent.answer(prompt, { text: (text) => ui.text(text), tool: (name, summary) => ui.tool(name, summary) }, controller.signal); ui.finishAssistant(); }
    catch (error) { ui.finishAssistant(); const err = error instanceof VibinError ? error : new VibinError(error instanceof Error ? error.message : "Unexpected error."); ui.error(err.message, err.hint); }
    finally { controller = undefined; await persist(); }
  };
  const createPlan = async (request: string) => {
    if ((config.provider !== "codex" && !hasUsableApiKey(config)) || !config.baseUrl || !config.model) { ui.error("The active provider is incomplete.", "Use /provider add to create a complete provider profile."); return; }
    controller = new AbortController(); ui.startAssistant("plan");
    try { session.plan = await agent.plan(request, { text: (text) => ui.text(text), tool: () => {} }, controller.signal); await persist(); ui.finishAssistant(); }
    catch (error) { ui.finishAssistant(); ui.error(error instanceof Error ? error.message : "Could not create a plan."); }
    finally { controller = undefined; }
  };
  const interrupt = () => {
    if (controller) { controller.abort(); ui.info("Request cancelled."); }
    else if (mcpManager) void mcpManager.closeAll().finally(() => { ui.close(); process.exit(0); });
    else { ui.close(); process.exit(0); }
  };
  process.on("SIGINT", interrupt);
  try {
    if (oneShot) { await run(oneShot); if (headless) ui.done(); return; }
    while (true) {
      let input: string;
      try {
        input = headless
          ? await ui.getInput()
          : await ui.prompt(await localTools.workspaceFiles(), config.model, cwd, mode, () => {
              mode = mode === "work" ? "plan" : "work";
              return mode;
            });
      } catch (error) {
        ui.error(error instanceof Error ? error.message : "Command failed.");
        if (headless) { ui.ready(); continue; }
        continue;
      }
      if (!input) continue;
      const command = parseCommand(input);
      const activeMode = mode as "work" | "plan";
      if (!command) { if (activeMode === "plan") await createPlan(input); else await run(input); continue; }
       if (command.type === "quit") { if (headless) ui.done(); break; }
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
          if (config.provider === "codex") {
            try { model = await ui.chooseModel(await listCodexModels(codexAuth)); }
            catch (error) { ui.error(error instanceof Error ? error.message : "Could not fetch ChatGPT models.", "Check your subscription connection and try /model again."); continue; }
          } else {
            if (!config.apiKey || !config.baseUrl) { ui.error("Set up a provider first.", "/provider add"); continue; }
            try { model = await ui.chooseModel(await listModels({ apiKey: config.apiKey, baseUrl: config.baseUrl, provider: config.provider })); }
            catch (error) { ui.error(error instanceof Error ? error.message : "Could not fetch models.", "Check your provider connection and try /model again."); continue; }
          }
        }
        config = { ...config, model, profiles: { ...config.profiles, [config.activeProfile]: { ...config, model } } }; await saveConfig(dataDir, config); agent = createAgent(); ui.info(`Model: ${config.model}`);
      }
      else if (command.type === "provider") {
        const [action, name] = command.value.split(/\s+/, 2);
        if (!action) await manageProviders();
        else if (action === "list") listProviders();
        else if (action === "use" && name) { config = activateProfile(config, name); thinkingMode = config.thinking; await saveConfig(dataDir, config); agent = createAgent(); ui.info(`Active provider: ${name} (${config.model})`); }
        else if (action === "add") await addProvider();
        else if (action === "remove") await removeProvider(name);
        else ui.error("Provider command not understood.", "/provider · /provider list · /provider use <name> · /provider add · /provider remove [name]");
      }
       else ui.error("Unknown command.", help);
      if (headless) ui.ready();
    }
  } finally { process.off("SIGINT", interrupt); await mcpManager?.closeAll(); ui.close(); }
}
