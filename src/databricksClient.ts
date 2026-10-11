import { ChatMessage, PlaygroundSettings } from "./types";

export class DatabricksClient {
  constructor(
    private readonly getToken: () => Promise<string | undefined>,
    private readonly getSettings: () => PlaygroundSettings,
  ) {}

  async *streamChat(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
    const token = await this.getToken();
    if (!token) {
      throw new Error(
        "No token configured. Run 'Databricks Playground: Set Personal Access Token'.",
      );
    }

    const settings = this.getSettings();
    if (!settings.workspaceUrl || !settings.endpointName) {
      throw new Error(
        "Configure databricksPlayground.workspaceUrl and databricksPlayground.endpointName in Settings.",
      );
    }

    const baseUrl = settings.workspaceUrl.replace(/\/+$/, "");
    const endpoint = encodeURIComponent(settings.endpointName);
    const response = await fetch(`${baseUrl}/serving-endpoints/${endpoint}/invocations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        messages,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2000);
      throw new Error(`Databricks API returned HTTP ${response.status}: ${detail}`);
    }
    if (!response.body) {
      throw new Error("The endpoint returned no response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }

            const delta = extractTextDelta(parsed);
            if (delta) yield delta;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function extractTextDelta(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as {
    choices?: Array<{
      delta?: { content?: unknown };
      message?: { content?: unknown };
    }>;
    delta?: { content?: unknown };
  };

  const content =
    value.choices?.[0]?.delta?.content ??
    value.choices?.[0]?.message?.content ??
    value.delta?.content;

  return typeof content === "string" ? content : "";
}
