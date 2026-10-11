import * as vscode from "vscode";
import { DatabricksClient } from "./databricksClient";
import { ChatMessage, WebviewMessage } from "./types";

export class PlaygroundPanel {
  private static currentPanel: PlaygroundPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private activeController: AbortController | undefined;
  private conversation: ChatMessage[] = [];

  static createOrShow(context: vscode.ExtensionContext, getClient: () => DatabricksClient): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (PlaygroundPanel.currentPanel) {
      PlaygroundPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "databricksPlayground",
      "Databricks AI Playground",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [],
        retainContextWhenHidden: true,
      },
    );

    PlaygroundPanel.currentPanel = new PlaygroundPanel(panel, context, getClient);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly getClient: () => DatabricksClient,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.panel.webview.postMessage({ type: "history", messages: this.conversation });
        return;
      case "cancel":
        this.activeController?.abort();
        return;
      case "clear":
        this.activeController?.abort();
        this.conversation = [];
        this.panel.webview.postMessage({ type: "cleared" });
        return;
      case "submit":
        if (typeof message.prompt !== "string" || !message.prompt.trim()) return;
        if (this.activeController) {
          this.panel.webview.postMessage({
            type: "error",
            message: "A response is already in progress.",
          });
          return;
        }
        await this.submit(message.prompt.trim(), message.systemPrompt ?? "");
        return;
    }
  }

  private async submit(prompt: string, systemPrompt: string): Promise<void> {
    if (systemPrompt.trim() && !this.conversation.some((m) => m.role === "system")) {
      this.conversation.push({ role: "system", content: systemPrompt.trim() });
    }

    this.conversation.push({ role: "user", content: prompt });
    this.panel.webview.postMessage({ type: "userMessage", content: prompt });

    const controller = new AbortController();
    this.activeController = controller;
    this.panel.webview.postMessage({ type: "assistantStart" });
    let responseText = "";

    try {
      for await (const chunk of this.getClient().streamChat(this.conversation, controller.signal)) {
        responseText += chunk;
        this.panel.webview.postMessage({ type: "assistantChunk", content: chunk });
      }
      if (!controller.signal.aborted) {
        this.conversation.push({ role: "assistant", content: responseText });
        this.panel.webview.postMessage({ type: "assistantDone" });
      } else {
        this.panel.webview.postMessage({ type: "cancelled" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (!controller.signal.aborted) {
        this.panel.webview.postMessage({ type: "error", message });
      } else {
        this.panel.webview.postMessage({ type: "cancelled" });
      }
    } finally {
      this.activeController = undefined;
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Databricks AI Playground</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0; }
  .layout { max-width: 1000px; margin: 0 auto; display: flex; flex-direction: column; height: calc(100vh - 24px); gap: 12px; }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  h1 { font-size: 18px; font-weight: 600; }
  .controls { display:flex; flex-wrap:wrap; gap:8px; }
  button, textarea, input { font: inherit; color: inherit; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; padding: 8px; }
  button { cursor:pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border:0; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #messages { flex:1; overflow:auto; display:flex; flex-direction:column; gap:12px; padding:4px; }
  .message { border:1px solid var(--vscode-panel-border); border-radius:8px; padding:12px; white-space:pre-wrap; overflow-wrap:anywhere; }
  .role { font-size:11px; text-transform:uppercase; opacity:.7; margin-bottom:6px; }
  .composer { display:flex; flex-direction:column; gap:8px; }
  textarea { width:100%; box-sizing:border-box; resize:vertical; }
  #prompt { min-height:80px; }
  #system { min-height:48px; }
  .status { min-height:18px; font-size:12px; opacity:.8; }
  .error { color: var(--vscode-errorForeground); }
</style>
</head>
<body>
<div class="layout">
  <header>
    <h1>Databricks AI Playground</h1>
    <div class="controls">
      <button class="secondary" id="clear">Clear chat</button>
      <button class="secondary" id="cancel" disabled>Cancel</button>
    </div>
  </header>
  <label for="system">System prompt (applies to new conversation)</label>
  <textarea id="system" placeholder="You are a helpful assistant."></textarea>
  <div id="messages" aria-live="polite"></div>
  <div class="composer">
    <label for="prompt">Message</label>
    <textarea id="prompt" placeholder="Ask the selected Databricks model..." autofocus></textarea>
    <div class="controls"><button id="send">Send</button></div>
    <div id="status" class="status" role="status">Configure workspace, endpoint, and token from the Command Palette / Settings.</div>
  </div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById('messages');
  const prompt = document.getElementById('prompt');
  const system = document.getElementById('system');
  const status = document.getElementById('status');
  const send = document.getElementById('send');
  const cancel = document.getElementById('cancel');
  let currentAssistant = null;

  function addMessage(role, content) {
    const article = document.createElement('article');
    article.className = 'message';
    const label = document.createElement('div');
    label.className = 'role';
    label.textContent = role;
    const body = document.createElement('div');
    body.textContent = content;
    article.append(label, body);
    messages.appendChild(article);
    messages.scrollTop = messages.scrollHeight;
    return body;
  }

  function setBusy(busy) {
    send.disabled = busy;
    cancel.disabled = !busy;
  }

  function submit() {
    const text = prompt.value.trim();
    if (!text) return;
    setBusy(true);
    status.textContent = 'Waiting for Databricks...';
    status.className = 'status';
    vscode.postMessage({ type: 'submit', prompt: text, systemPrompt: system.value });
    prompt.value = '';
  }

  send.addEventListener('click', submit);
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

  window.addEventListener('message', (event) => {
    const data = event.data;
    switch (data.type) {
      case 'history':
        messages.replaceChildren();
        (data.messages || []).forEach((m) => addMessage(m.role, m.content));
        break;
      case 'userMessage':
        addMessage('You', data.content);
        break;
      case 'assistantStart':
        currentAssistant = addMessage('Assistant', '');
        status.textContent = 'Generating response...';
        break;
      case 'assistantChunk':
        if (currentAssistant) currentAssistant.textContent += data.content;
        messages.scrollTop = messages.scrollHeight;
        break;
      case 'assistantDone':
        currentAssistant = null;
        setBusy(false);
        status.textContent = 'Response complete.';
        break;
      case 'cancelled':
        currentAssistant = null;
        setBusy(false);
        status.textContent = 'Generation cancelled.';
        break;
      case 'error':
        currentAssistant = null;
        setBusy(false);
        status.textContent = data.message || 'Request failed.';
        status.className = 'status error';
        break;
      case 'cleared':
        messages.replaceChildren();
        currentAssistant = null;
        setBusy(false);
        status.textContent = 'Conversation cleared.';
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }

  private dispose(): void {
    this.activeController?.abort();
    PlaygroundPanel.currentPanel = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
