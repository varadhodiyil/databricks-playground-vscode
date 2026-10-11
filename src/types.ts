export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PlaygroundSettings {
  workspaceUrl: string;
  endpointName: string;
  maxTokens: number;
  temperature: number;
}

export type WebviewMessage =
  | { type: "ready" }
  | { type: "submit"; prompt: string; systemPrompt: string }
  | { type: "cancel" }
  | { type: "clear" };
