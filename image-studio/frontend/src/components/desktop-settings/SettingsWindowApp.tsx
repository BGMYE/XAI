import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bell, Copy, Database, FolderOpen, Info, Link2, LoaderCircle, Monitor, Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import { closeDesktopSettingsWindow, invokeDesktopHost, invokeDesktopService, invokeDesktopSettings, setDesktopSettingsDirty, setDesktopWindowTitle, subscribeDesktopSettings } from "../../platform/runtime/desktop";
import { EventsOn } from "../../platform/runtime/host";
import { makeBlankProfile } from "../../lib/profiles";
import { cleanBaseURL } from "../../lib/security";
import { buildUpstreamConfigExportFile, parseUpstreamConfigImportFile } from "../../lib/upstreamConfigTransfer";
import { importCompletionSoundFile, normalizeCompletionSoundConfig, playCompletionSound } from "../../lib/completionSound";
import { readSystemNotificationPermission, requestSystemNotificationPermission } from "../../lib/completionNotification";
import { appVersion } from "../../lib/version";
import { isMac } from "../../platform";
import type { UpstreamProfile } from "../../types/domain";
import { mergeModelIDs, preferenceDefaults, profileWithoutCredential, settingsPanes, type CredentialChange, type DesktopPreferences, type SettingsPane, type SettingsSnapshot } from "./settingsModel";
import "../xai/desktop-design.css";
import "./settings-window.css";

type Confirmation = { title: string; body: string; actions: { id: string; label: string; danger?: boolean }[]; resolve: (value: string) => void };
type ProbeResult = { modelCount: number; models?: { id: string }[]; responsesTransportOK?: boolean; responsesTransportError?: string };
const paneIcons = [Link2, Settings2, FolderOpen, Bell, Monitor, Database, Info];

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  const id = useId();
  const associate = (nodes: ReactNode): ReactNode => Children.map(nodes, (node) => {
    if (!isValidElement<{ id?: string; children?: ReactNode; "aria-describedby"?: string }>(node)) return node;
    if (node.type === "input" || node.type === "select" || node.type === "textarea") {
      return cloneElement(node, { id, "aria-describedby": help ? `${id}-help` : undefined });
    }
    return node.props.children ? cloneElement(node, {}, associate(node.props.children)) : node;
  });
  return <div className="desktop-settings-field"><label htmlFor={id}>{label}</label>{associate(children)}{help && <small id={`${id}-help`}>{help}</small>}</div>;
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="desktop-settings-group"><h2>{title}</h2><div>{children}</div></section>;
}
function Toggle({ label, help, value, onChange }: { label: string; help?: string; value: boolean; onChange: (value: boolean) => void }) {
  return <label className="desktop-settings-toggle"><span><b>{label}</b>{help && <small>{help}</small>}</span><input type="checkbox" role="switch" checked={value} onChange={(event) => onChange(event.target.checked)} /></label>;
}

export default function SettingsWindowApp() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const snapshotRef = useRef<SettingsSnapshot | null>(null);
  const [pane, setPane] = useState<SettingsPane>("connections");
  const [draft, setDraft] = useState<UpstreamProfile | null>(null);
  const [original, setOriginal] = useState("");
  const [credential, setCredential] = useState<CredentialChange>({ action: "keep" });
  const [showKey, setShowKey] = useState(false);
  const [modelInput, setModelInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [importText, setImportText] = useState<string | null>(null);
  const [permission, setPermission] = useState(readSystemNotificationPermission());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const probeSerial = useRef(0);
  const originalExisted = useRef(false);
  const closing = useRef(false);
  const preferenceWrites = useRef(Promise.resolve());
  const dirtyWrites = useRef(Promise.resolve());
  const dirty = !!draft && (JSON.stringify(draft) !== original || credential.action !== "keep");
  const closeRef = useRef<() => void>(() => {});
  const prefs = preferenceDefaults(snapshot?.preferences ?? {});
  const selectedSaved = snapshot?.profiles.find((profile) => profile.id === draft?.id);

  function accept(next: SettingsSnapshot) {
    if (snapshotRef.current && next.revision < snapshotRef.current.revision) return;
    snapshotRef.current = next; setSnapshot(next);
    document.documentElement.style.setProperty("--font-scale", String(next.preferences.fontScale || 1));
  }
  function select(profile: UpstreamProfile | null) {
    probeSerial.current++; setProbing(false);
    const next = profile ? profileWithoutCredential(profile) : null;
    originalExisted.current = !!snapshotRef.current?.profiles.some((item) => item.id === profile?.id);
    setDraft(next); setOriginal(JSON.stringify(next)); setCredential({ action: "keep" }); setShowKey(false); setModelInput(""); setStatus(null);
  }
  function ask(title: string, body: string, actions: Confirmation["actions"]) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise<string>((resolve) => setConfirmation({ title, body, actions, resolve }));
  }
  function finishConfirmation(value: string) { confirmation?.resolve(value); setConfirmation(null); }
  useEffect(() => {
    if (confirmation) dialogRef.current?.showModal();
    else {
      dialogRef.current?.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [confirmation]);
  useEffect(() => {
    dirtyWrites.current = dirtyWrites.current.then(() => setDesktopSettingsDirty(dirty)).catch(() => undefined);
  }, [dirty]);
  useEffect(() => { void setDesktopWindowTitle(`${settingsPanes.find(([id]) => id === pane)?.[1]} · 设置`); }, [pane]);
  useEffect(() => {
    document.documentElement.dataset.desktopStudio = "true";
    let live = true;
    const refresh = () => invokeDesktopSettings<SettingsSnapshot>("GetSnapshot").then((value) => { if (live) accept(value); });
    const off = subscribeDesktopSettings(() => { void refresh().catch(() => { if (live) setStatus({ text: "设置同步失败，请重新载入。", error: true }); }); });
    void invokeDesktopSettings<SettingsSnapshot>("GetSnapshot").then((value) => {
      if (!live) return;
      accept(value);
      const storedPane = value.preferences.lastSettingsPane;
      if (settingsPanes.some(([id]) => id === storedPane)) setPane(storedPane!);
      select(value.profiles.find((profile) => profile.id === value.activeProfileId) ?? value.profiles[0] ?? null);
    }).catch(() => { if (live) setStatus({ text: "无法载入设置，请关闭后重试。", error: true }); });
    const offClose = EventsOn("desktop-settings-close-request", () => closeRef.current());
    const offResults = EventsOn("desktop-workspace-command-result", (result: { success: boolean; message: string }) => {
      if (live) { setBusy(false); setStatus({ text: result.message, error: !result.success }); }
    });
    void invokeDesktopHost("SettingsWindowReady");
    return () => { live = false; off(); offClose(); offResults(); };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus(null);
    try { await action(); } catch (error) {
      const message = error instanceof Error ? error.message : "操作未完成，请重试。";
      const safeMessage = credential.value ? message.replaceAll(credential.value, "[已隐藏]") : message;
      setStatus({ text: safeMessage, error: true });
      void invokeDesktopSettings<SettingsSnapshot>("GetSnapshot").then(accept).catch(() => undefined);
    } finally { setBusy(false); }
  }
  async function save(): Promise<boolean> {
    if (!draft || !snapshotRef.current) return true;
    let saved = false;
    await run(async () => {
      const latest = await invokeDesktopSettings<SettingsSnapshot>("GetSnapshot");
      accept(latest);
      const current = latest.profiles.find((profile) => profile.id === draft.id);
      if (originalExisted.current && (!current || JSON.stringify(profileWithoutCredential(current)) !== original)) {
        throw new Error("这项配置已在另一窗口更改。请重新载入配置，再保存。草稿仍保留在此处。");
      }
      const next = await invokeDesktopSettings<SettingsSnapshot>("SaveProfile", {
        expectedRevision: latest.revision, profile: { ...draft, baseURL: cleanBaseURL(draft.baseURL) }, credential,
        setActive: !latest.activeProfileId,
      });
      accept(next); select(next.profiles.find((profile) => profile.id === draft.id) ?? next.profiles[next.profiles.length - 1]);
      setStatus({ text: "配置已保存。" }); saved = true;
    });
    return saved;
  }
  async function leaveDraft() {
    if (!dirty) return true;
    const action = await ask("保存更改？", "此配置有尚未保存的更改。", [{ id: "cancel", label: "继续编辑" }, { id: "discard", label: "不保存" }, { id: "save", label: "保存" }]);
    if (action === "save") return save();
    return action === "discard";
  }
  closeRef.current = () => {
    if (closing.current) return;
    closing.current = true;
    void leaveDraft().then(async (canClose) => {
      if (canClose) await closeDesktopSettingsWindow();
      else await invokeDesktopHost("CancelSettingsCloseRequest");
    }).catch(() => setStatus({ text: "窗口未能关闭，请重试。", error: true })).finally(() => { closing.current = false; });
  };
  async function patchPreferences(patch: Partial<DesktopPreferences>) {
    const write = preferenceWrites.current.then(() => run(async () => {
      const latest = await invokeDesktopSettings<SettingsSnapshot>("GetSnapshot");
      accept(await invokeDesktopSettings<SettingsSnapshot>("PatchPreferences", latest.revision, patch));
    }));
    preferenceWrites.current = write;
    await write;
  }
  function patchProfile(patch: Partial<UpstreamProfile>) { setDraft((current) => current ? { ...current, ...patch } : current); }
  async function chooseProfile(profile: UpstreamProfile) { if (await leaveDraft()) select(snapshotRef.current?.profiles.find((p) => p.id === profile.id) ?? profile); }
  async function newProfile() {
    if (!await leaveDraft()) return;
    const profile = makeBlankProfile("images", snapshot?.profiles ?? []);
    select(profile); setOriginal("");
  }
  async function changeRole(role: "generation" | "assistant") {
    if (!draft || !await save()) return;
    await run(async () => { const latest = await invokeDesktopSettings<SettingsSnapshot>("GetSnapshot"); accept(await invokeDesktopSettings<SettingsSnapshot>("SetProfileRole", latest.revision, role, draft.id)); });
  }
  async function probe() {
    if (!draft) return;
    const serial = ++probeSerial.current;
    setProbing(true); setStatus(null);
    try {
      const result = await invokeDesktopSettings<ProbeResult>("ProbeProfile", { profileId: draft.id, draft: { ...draft, baseURL: cleanBaseURL(draft.baseURL) }, credential, proxyMode: prefs.proxyMode, proxyURL: prefs.proxyURL });
      if (serial !== probeSerial.current) return;
      const ids = (result.models ?? []).map((model) => model.id);
      setDraft((current) => current ? { ...current, modelIDs: mergeModelIDs(current.modelIDs ?? [], ids) } : current);
      setStatus({ text: result.responsesTransportOK === false ? `模型目录已获取，但 WebSocket 连接失败：${result.responsesTransportError ?? "请检查上游设置"}` : `连接成功，已获取 ${ids.length} 个模型。保存后可在工作台选择。`, error: result.responsesTransportOK === false });
    } catch (error) { if (serial === probeSerial.current) setStatus({ text: error instanceof Error ? error.message : "连接失败，请检查地址和 API Key。", error: true }); }
    finally { if (serial === probeSerial.current) setProbing(false); }
  }
  async function importConfigurations(text: string) {
    const parsed = parseUpstreamConfigImportFile(text);
    let current = await invokeDesktopSettings<SettingsSnapshot>("GetSnapshot");
    const ids = new Map<string, string>();
    for (const input of parsed.profiles) {
      const { apiKey, ...profile } = input;
      const id = makeBlankProfile().id;
      ids.set(profile.id, id);
      current = await invokeDesktopSettings<SettingsSnapshot>("SaveProfile", { expectedRevision: current.revision, profile: { ...profile, id, fallbackProfileId: undefined }, credential: apiKey ? { action: "replace", value: apiKey } : { action: "keep" } });
    }
    for (const input of parsed.profiles) {
      const fallback = input.fallbackProfileId && ids.get(input.fallbackProfileId);
      if (!fallback) continue;
      const profile = current.profiles.find((value) => value.id === ids.get(input.id))!;
      current = await invokeDesktopSettings<SettingsSnapshot>("SaveProfile", { expectedRevision: current.revision, profile: { ...profile, fallbackProfileId: fallback }, credential: { action: "keep" } });
    }
    if (parsed.activeProfileId && ids.has(parsed.activeProfileId)) current = await invokeDesktopSettings<SettingsSnapshot>("SetProfileRole", current.revision, "generation", ids.get(parsed.activeProfileId));
    if (parsed.aiProfileId && ids.has(parsed.aiProfileId)) current = await invokeDesktopSettings<SettingsSnapshot>("SetProfileRole", current.revision, "assistant", ids.get(parsed.aiProfileId));
    accept(current); select(current.profiles.find((profile) => profile.id === ids.get(parsed.profiles[0].id)) ?? null);
    setImportText(null); setStatus({ text: `已导入 ${parsed.profiles.length} 个配置。` });
  }
  async function historyCommand(command: string, destructive = false) {
    if (destructive && await ask("删除历史记录？", "选中的历史记录将从本地数据库删除，无法撤销。", [{ id: "cancel", label: "取消" }, { id: "delete", label: "删除", danger: true }]) !== "delete") return;
    setBusy(true); setStatus({ text: "正在主窗口处理…" });
    try { await invokeDesktopHost("RequestWorkspaceCommand", command, crypto.randomUUID()); }
    catch { setBusy(false); setStatus({ text: "主窗口不可用，请重新打开主窗口。", error: true }); }
  }
  const openURL = (url: string) => void run(async () => { await invokeDesktopService("OpenExternalURL", url); });

  return <div className="desktop-settings-window">
    <header className="desktop-settings-titlebar">{!isMac && <div className="desktop-settings-traffic"><button className="close" aria-label="关闭设置" onClick={() => closeRef.current()} /><span className="disabled" /><span className="disabled" /></div>}<span>{settingsPanes.find(([id]) => id === pane)?.[1]} · 设置</span></header>
    <div className="desktop-settings-layout">
      <nav className="desktop-settings-nav studio-glass" aria-label="设置分类">{settingsPanes.map(([id, label], index) => {
        const Icon = paneIcons[index];
        return <button key={id} aria-current={pane === id ? "page" : undefined} onClick={() => { setPane(id); if (contentRef.current) contentRef.current.scrollTop = 0; void patchPreferences({ lastSettingsPane: id }); }}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>;
      })}</nav>
      <main ref={contentRef} className="desktop-settings-content" aria-busy={!snapshot || busy}>
        <div className="desktop-settings-heading"><h1>{settingsPanes.find(([id]) => id === pane)?.[1]}</h1>{pane === "connections" && <button className="studio-button" onClick={() => void newProfile()} disabled={busy}><Plus size={16} />添加连接</button>}</div>
        {status && <div className={`desktop-settings-status ${status.error ? "error" : ""}`} role={status.error ? "alert" : "status"}>{status.text}</div>}
        {!snapshot ? <div className="studio-empty"><LoaderCircle className="spin" />正在载入设置…</div> : <>
        {pane === "connections" && <>
          <div className="desktop-settings-connections">
            <aside className="desktop-settings-profiles" aria-label="上游连接">{snapshot.profiles.map((profile) => <button key={profile.id} className={draft?.id === profile.id ? "selected" : ""} onClick={() => void chooseProfile(profile)} disabled={busy}><span>{profile.name}</span><small>{profile.id === snapshot.activeProfileId ? "用于生成" : profile.apiMode === "images" ? "Images API" : "Responses API"}{profile.id === snapshot.aiProfileId ? " · AI 辅助" : ""}</small></button>)}{!snapshot.profiles.length && <p>添加一个连接，开始创作。</p>}
              <div className="desktop-settings-profile-tools"><button className="studio-button" disabled={!selectedSaved || busy} onClick={() => void run(async () => { if (!draft || !await leaveDraft()) return; const before = await invokeDesktopSettings<SettingsSnapshot>("GetSnapshot"); const next = await invokeDesktopSettings<SettingsSnapshot>("DuplicateProfile", before.revision, draft.id); accept(next); select(next.profiles.find((p) => !before.profiles.some((old) => old.id === p.id)) ?? null); })}><Copy size={15} />复制</button><button className="studio-button danger" disabled={!selectedSaved || busy} onClick={() => void run(async () => { if (!draft || await ask("删除连接？", `“${draft.name}”及其 API Key 将永久删除。`, [{ id: "cancel", label: "取消" }, { id: "delete", label: "删除", danger: true }]) !== "delete") return; const latest = await invokeDesktopSettings<SettingsSnapshot>("GetSnapshot"); const next = await invokeDesktopSettings<SettingsSnapshot>("DeleteProfile", latest.revision, draft.id); accept(next); select(next.profiles[0] ?? null); })}><Trash2 size={15} />删除</button></div>
            </aside>
            <fieldset className="desktop-settings-editor" disabled={busy}>{!draft ? <div className="studio-empty"><Link2 size={28} /><h2>连接图像模型</h2><p>填写服务地址和 API Key，或导入已有配置。</p><button className="studio-button primary" onClick={() => void newProfile()}>添加连接</button></div> : <>
              <Group title="连接信息">
                <Field label="名称"><input className="studio-field" value={draft.name} onChange={(e) => patchProfile({ name: e.target.value })} autoComplete="off" /></Field>
                <div className="desktop-settings-pair"><Field label="API 形态"><select className="studio-field" value={draft.apiMode} onChange={(e) => patchProfile({ apiMode: e.target.value as UpstreamProfile["apiMode"] })}><option value="images">Images API</option><option value="responses">Responses API</option></select></Field><Field label="请求策略"><select className="studio-field" value={draft.requestPolicy} onChange={(e) => patchProfile({ requestPolicy: e.target.value as UpstreamProfile["requestPolicy"] })}><option value="openai">OpenAI 标准</option><option value="compat">兼容中转扩展</option></select></Field></div>
                <Field label="服务地址" help="填写 Base URL，应用会自动补全接口路径。"><input className="studio-field" type="url" value={draft.baseURL} onChange={(e) => patchProfile({ baseURL: e.target.value })} placeholder="https://api.example.com" spellCheck={false} /></Field>
                <Field label="API Key" help={selectedSaved?.hasAPIKey && credential.action === "keep" ? "已保存在系统凭据存储。留空保留，输入新值替换。" : "仅保存在系统凭据存储。"}><span className="desktop-settings-key"><input className="studio-field" type={showKey ? "text" : "password"} value={credential.value ?? ""} onChange={(e) => setCredential(e.target.value ? { action: "replace", value: e.target.value } : { action: "keep" })} placeholder={selectedSaved?.hasAPIKey ? "已保存" : "输入 API Key"} autoComplete="off" spellCheck={false} /><button type="button" className="studio-button" aria-label={showKey ? "隐藏输入的 API Key" : "显示输入的 API Key"} onClick={() => setShowKey(!showKey)}>{showKey ? "隐藏" : "显示"}</button></span></Field>
                {selectedSaved?.hasAPIKey && <button className="studio-button danger" onClick={() => void ask("清除 API Key？", "保存配置后，此连接将需要新的 API Key 才能使用。", [{ id: "cancel", label: "取消" }, { id: "clear", label: "清除", danger: true }]).then((value) => { if (value === "clear") setCredential({ action: "clear" }); })}>{credential.action === "clear" ? "保存时将清除 API Key" : "清除已保存的 API Key"}</button>}
              </Group>
              <Group title="模型">
                <div className="desktop-settings-inline"><button className="studio-button" onClick={() => void probe()} disabled={probing || !draft.baseURL.trim() || (!selectedSaved?.hasAPIKey && !credential.value?.trim())}><RefreshCw size={16} className={probing ? "spin" : ""} />{probing ? "正在连接…" : "测试连接并获取模型"}</button></div>
                <Field label="图像模型"><input className="studio-field" list="settings-image-models" value={draft.imageModelID} onChange={(e) => patchProfile({ imageModelID: e.target.value })} placeholder="输入或选择模型 ID" spellCheck={false} /></Field>
                {draft.apiMode === "responses" && <Field label="文本模型"><input className="studio-field" list="settings-image-models" value={draft.textModelID} onChange={(e) => patchProfile({ textModelID: e.target.value })} spellCheck={false} /></Field>}
                <Field label="视频模型（可选）"><input className="studio-field" list="settings-image-models" value={draft.videoModelID} onChange={(e) => patchProfile({ videoModelID: e.target.value })} spellCheck={false} /></Field>
                <datalist id="settings-image-models">{(draft.modelIDs ?? []).map((id) => <option key={id} value={id} />)}</datalist>
                <Field label="自定义模型"><span className="desktop-settings-key"><input className="studio-field" value={modelInput} onChange={(e) => setModelInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); patchProfile({ modelIDs: mergeModelIDs(draft.modelIDs ?? [], [modelInput]) }); setModelInput(""); } }} placeholder="模型 ID" spellCheck={false} /><button className="studio-button" disabled={!modelInput.trim()} onClick={() => { patchProfile({ modelIDs: mergeModelIDs(draft.modelIDs ?? [], [modelInput]) }); setModelInput(""); }}>添加</button></span></Field>
                {!!draft.modelIDs?.length && <div className="desktop-settings-models" aria-label="已添加的模型">{draft.modelIDs.map((id) => <span key={id}><button onClick={() => patchProfile({ imageModelID: id })} title={id}>{id}</button><button aria-label={`移除模型 ${id}`} onClick={() => patchProfile({ modelIDs: draft.modelIDs!.filter((model) => model !== id) })}><X size={12} /></button></span>)}</div>}
              </Group>
              <details className="desktop-settings-advanced"><summary>高级连接选项</summary><div>
                {draft.apiMode === "responses" && <Field label="传输方式"><select className="studio-field" value={draft.responsesTransport ?? "sse"} onChange={(e) => patchProfile({ responsesTransport: e.target.value as "sse" | "websocket" })}><option value="sse">SSE</option><option value="websocket">WebSocket</option></select></Field>}
                <Field label="推理强度"><select className="studio-field" value={draft.reasoningEffort} onChange={(e) => patchProfile({ reasoningEffort: e.target.value as UpstreamProfile["reasoningEffort"] })}>{["low", "medium", "high", "xhigh"].map((value) => <option key={value}>{value}</option>)}</select></Field>
                <Field label="最大并发数" help="0 表示不限制。"><input className="studio-field" type="number" min={0} step={1} value={draft.concurrencyLimit} onChange={(e) => patchProfile({ concurrencyLimit: Math.max(0, Math.floor(Number(e.target.value))) })} /></Field>
                <Field label="备用连接"><select className="studio-field" value={draft.fallbackProfileId ?? ""} onChange={(e) => patchProfile({ fallbackProfileId: e.target.value })}><option value="">不使用备用连接</option>{snapshot.profiles.filter((p) => p.id !== draft.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                <Toggle label="New API 兼容" value={draft.imagesNewAPICompat === true} onChange={(value) => patchProfile({ imagesNewAPICompat: value })} />
                <Toggle label="允许不安全连接" help="仅适用于可信网络：允许 HTTP 并跳过证书校验，API Key 和图片可能被截取。" value={draft.allowInsecureConnection === true} onChange={(value) => patchProfile({ allowInsecureConnection: value })} />
              </div></details>
              <div className="desktop-settings-editor-actions"><button className="studio-button" disabled={!selectedSaved || busy} onClick={() => void chooseProfile(selectedSaved!)}>重新载入</button><button className="studio-button" disabled={busy} onClick={() => void changeRole("generation")}>用于生成</button>{draft.apiMode === "responses" && <button className="studio-button" disabled={busy} onClick={() => void changeRole("assistant")}>用于 AI 辅助</button>}<button className="studio-button primary" disabled={!dirty || busy || !draft.name.trim()} onClick={() => void save()}>{busy ? "正在保存…" : "保存"}</button></div>
            </>}</fieldset>
          </div>
          <Group title="导入与导出"><div className="desktop-settings-inline"><button className="studio-button" disabled={busy} onClick={() => void run(async () => { if (!await leaveDraft()) return; const text = await invokeDesktopService<string>("ImportUpstreamConfigFromFile"); if (text) await importConfigurations(text); })}>导入配置</button><button className="studio-button" disabled={busy} onClick={() => void leaveDraft().then((leave) => { if (leave) setImportText(""); })}>粘贴 JSON</button><button className="studio-button" disabled={!snapshot.profiles.length || busy} onClick={() => void run(async () => { await invokeDesktopService("ExportUpstreamConfigToFile", JSON.stringify(buildUpstreamConfigExportFile(snapshot.profiles, snapshot.activeProfileId, snapshot.aiProfileId), null, 2)); setStatus({ text: "配置已导出，不包含 API Key。" }); })}>导出配置</button><button className="studio-button" disabled={busy} onClick={() => void run(async () => { if (!await leaveDraft()) return; const config = await invokeDesktopService<{ baseURL: string; apiKey: string; model?: string }>("LoadCodexAPIConfig"); const profile = makeBlankProfile("responses", snapshot.profiles); profile.baseURL = config.baseURL; profile.textModelID = config.model ?? ""; select(profile); setOriginal(""); setCredential({ action: "replace", value: config.apiKey }); })}>从 Codex 导入</button></div>{importText !== null && <div className="desktop-settings-json"><Field label="JSON 配置"><textarea className="studio-field" rows={7} value={importText} onChange={(e) => setImportText(e.target.value)} spellCheck={false} /></Field><div className="desktop-settings-inline"><button className="studio-button" onClick={() => setImportText(null)}>取消</button><button className="studio-button primary" disabled={!importText.trim() || busy} onClick={() => void run(() => importConfigurations(importText))}>导入</button></div></div>}</Group>
        </>}
        {pane === "general" && <><Group title="运行"><Field label="运行内核"><select className="studio-field" value={prefs.kernelRuntimeMode} onChange={(e) => void patchPreferences({ kernelRuntimeMode: e.target.value as DesktopPreferences["kernelRuntimeMode"] })}><option value="auto">自动选择</option><option value="local">本地内核</option><option value="remote">远程内核</option></select></Field><Toggle label="自动重试" value={prefs.autoRetryEnabled} onChange={(value) => void patchPreferences({ autoRetryEnabled: value })} /><Field label="重试次数"><input className="studio-field" type="number" min={0} max={10} value={prefs.autoRetryCount} onChange={(e) => void patchPreferences({ autoRetryCount: Number(e.target.value) })} /></Field><Toggle label="保护流式预览" help="生成完成前保留有效预览。" value={prefs.protectStreamPreview} onChange={(value) => void patchPreferences({ protectStreamPreview: value })} /></Group><Group title="网络"><Field label="代理"><select className="studio-field" value={prefs.proxyMode} onChange={(e) => void patchPreferences({ proxyMode: e.target.value as DesktopPreferences["proxyMode"] })}><option value="system">系统代理</option><option value="none">直接连接</option><option value="custom">自定义代理</option></select></Field>{prefs.proxyMode === "custom" && <Field label="代理地址"><input key={prefs.proxyURL} className="studio-field" defaultValue={prefs.proxyURL} placeholder="http://127.0.0.1:7890" onBlur={(e) => { if (e.target.value !== prefs.proxyURL) void patchPreferences({ proxyURL: e.target.value }); }} /></Field>}</Group></>}
        {pane === "files" && <><Group title="保存位置"><p className="desktop-settings-path">{prefs.outputDir || "系统默认图片目录"}</p><div className="desktop-settings-inline"><button className="studio-button" onClick={() => void run(async () => { const path = await invokeDesktopService<string>("ChooseDirectory", "选择生成图片的保存目录"); if (path) await patchPreferences({ outputDir: path }); })}>选择文件夹…</button><button className="studio-button" onClick={() => void run(async () => { await invokeDesktopService("OpenOutputDir"); })}>打开文件夹</button><button className="studio-button" onClick={() => void patchPreferences({ outputDir: "" })}>恢复默认</button></div></Group><Group title="保存与清理"><Toggle label="生成后提醒另存" value={!prefs.savePromptSuppressed} onChange={(value) => void patchPreferences({ savePromptSuppressed: !value })} /><Toggle label="保留运行日志" value={prefs.keepLogs} onChange={(value) => void patchPreferences({ keepLogs: value })} /><Toggle label="退出时清理预览缓存" help="原始作品不受影响。" value={prefs.cleanupPreviewCacheOnExit} onChange={(value) => void patchPreferences({ cleanupPreviewCacheOnExit: value })} /></Group></>}
        {pane === "notifications" && <><Group title="完成提示"><Toggle label="播放提示音" value={prefs.completionSound.enabled} onChange={(value) => void patchPreferences({ completionSound: { ...prefs.completionSound, enabled: value } })} /><Field label="提示音"><select className="studio-field" value={prefs.completionSound.mode} onChange={(e) => void patchPreferences({ completionSound: { ...prefs.completionSound, mode: e.target.value as "default" | "custom" } })}><option value="default">默认提示音</option>{prefs.completionSound.customDataURL && <option value="custom">{prefs.completionSound.customName || "自定义提示音"}</option>}</select></Field><div className="desktop-settings-inline"><button className="studio-button" onClick={() => void playCompletionSound(prefs.completionSound, { force: true })}>试听</button><label className="studio-button desktop-settings-file-button">选择音频…<input type="file" accept="audio/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) void run(async () => { const sound = await importCompletionSoundFile(file); await patchPreferences({ completionSound: { ...prefs.completionSound, mode: "custom", customName: sound.name, customDataURL: sound.dataURL } }); }); e.target.value = ""; }} /></label><button className="studio-button" onClick={() => void patchPreferences({ completionSound: normalizeCompletionSoundConfig({ enabled: prefs.completionSound.enabled }) })}>恢复默认</button></div></Group><Group title="系统通知"><Toggle label="生成完成时通知" value={prefs.completionNotification.enabled} onChange={(value) => void run(async () => { const next = value ? await requestSystemNotificationPermission() : readSystemNotificationPermission(); setPermission(next); if (!value || next === "granted") await patchPreferences({ completionNotification: { enabled: value } }); else setStatus({ text: "请在系统设置中允许 XAI 发送通知。" }); })} /><p>通知权限：{permission === "granted" ? "已允许" : permission === "denied" ? "已关闭" : "尚未授权"}</p></Group></>}
        {pane === "display" && <><Group title="外观"><div className="desktop-settings-fact"><span>默认外观</span><b>浅色</b></div><p>对比度、透明度和动态效果跟随系统辅助功能偏好。</p></Group><Group title="文字大小"><Field label={`字号 ${Math.round(prefs.fontScale * 100)}%`}><select className="studio-field" value={prefs.fontScale} onChange={(e) => void patchPreferences({ fontScale: Number(e.target.value) })}>{[0.85, 1, 1.15, 1.3, 1.5, 1.75, 2].map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%{scale === 1 ? "（默认）" : ""}</option>)}</select></Field><p className="desktop-settings-type-preview">为想象留出空间。<br /><span>清晰的文字，让创作更从容。</span></p></Group></>}
        {pane === "data" && <><Group title="历史记录"><p>备份作品记录和生成参数。</p><div className="desktop-settings-inline"><button className="studio-button" disabled={busy} onClick={() => void historyCommand("export-history")}>导出历史…</button><button className="studio-button" disabled={busy} onClick={() => void historyCommand("import-history")}>导入历史…</button></div></Group><Group title="清理历史"><p>清理操作无法撤销，建议先导出备份。</p><div className="desktop-settings-inline"><button className="studio-button" disabled={busy} onClick={() => void historyCommand("prune-history-3", true)}>删除 3 天前记录</button><button className="studio-button" disabled={busy} onClick={() => void historyCommand("prune-history-7", true)}>删除 7 天前记录</button><button className="studio-button danger" disabled={busy} onClick={() => void historyCommand("clear-history", true)}>删除全部历史</button></div></Group></>}
        {pane === "about" && <><div className="desktop-settings-about"><div aria-hidden="true">X</div><h2>XAI</h2><p>版本 {appVersion}</p><p>图像与想象的工作空间。</p></div><Group title="项目"><div className="desktop-settings-inline"><button className="studio-button" onClick={() => openURL("https://github.com/BGMYE/XAI")}>源代码</button><button className="studio-button" onClick={() => openURL("https://github.com/BGMYE/XAI/releases")}>检查更新</button><button className="studio-button" onClick={() => openURL("https://github.com/BGMYE/XAI/issues")}>反馈问题</button><button className="studio-button" onClick={() => openURL("https://www.gnu.org/licenses/agpl-3.0.html")}>AGPL-3.0 许可证</button></div></Group></>}
        </>}
      </main>
    </div>
    <dialog ref={dialogRef} className="desktop-settings-confirm" onCancel={(event) => { event.preventDefault(); finishConfirmation("cancel"); }} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} aria-labelledby="settings-confirm-title" aria-describedby="settings-confirm-body"><h2 id="settings-confirm-title">{confirmation?.title}</h2><p id="settings-confirm-body">{confirmation?.body}</p><div>{confirmation?.actions.map((action) => <button key={action.id} className={`studio-button ${action.danger ? "danger" : action.id === "save" ? "primary" : ""}`} onClick={() => finishConfirmation(action.id)}>{action.label}</button>)}</div></dialog>
  </div>;
}

export { SettingsWindowApp };
