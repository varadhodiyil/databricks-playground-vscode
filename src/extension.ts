import * as vscode from "vscode";
import { DatabricksClient } from "./databricksClient";
import { PlaygroundPanel } from "./playgroundPanel";

const TOKEN_KEY = "databricksPlayground.personalAccessToken";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("databricksPlayground.open", () => {
      PlaygroundPanel.createOrShow(context, () => createClient(context));
    }),
    vscode.commands.registerCommand("databricksPlayground.configure", async () => {
      const config = vscode.workspace.getConfiguration("databricksPlayground");
      const current = config.get<string>("workspaceUrl", "");
      const value = await vscode.window.showInputBox({
        title: "Databricks workspace URL",
        prompt: "Enter your workspace URL (https://...)",
        value: current,
        ignoreFocusOut: true,
        validateInput: (input: string) => {
          try {
            const url = new URL(input);
            return url.protocol === "https:" ? undefined : "Workspace URL must use HTTPS.";
          } catch {
            return "Enter a valid HTTPS URL.";
          }
        },
      });
      if (value !== undefined) {
        await config.update(
          "workspaceUrl",
          value.replace(/\/+$/, ""),
          vscode.ConfigurationTarget.Global,
        );
        vscode.window.showInformationMessage("Databricks workspace URL saved.");
      }
    }),
    vscode.commands.registerCommand("databricksPlayground.setToken", async () => {
      const token = await vscode.window.showInputBox({
        title: "Databricks development token",
        prompt: "Paste a token permitted by your workspace policy. It will be stored securely.",
        password: true,
        ignoreFocusOut: true,
      });
      if (token !== undefined) {
        await context.secrets.store(TOKEN_KEY, token);
        vscode.window.showInformationMessage("Databricks token stored in VS Code SecretStorage.");
      }
    }),
  );
}

function createClient(context: vscode.ExtensionContext): DatabricksClient {
  return new DatabricksClient(
    async () => context.secrets.get(TOKEN_KEY),
    () => {
      const config = vscode.workspace.getConfiguration("databricksPlayground");
      return {
        workspaceUrl: config.get<string>("workspaceUrl", ""),
        endpointName: config.get<string>("endpointName", ""),
        maxTokens: config.get<number>("maxTokens", 1024),
        temperature: config.get<number>("temperature", 0.2),
      };
    },
  );
}
export function deactivate(): void {
  // No background resources to dispose.
}
