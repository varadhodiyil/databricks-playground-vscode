# Databricks AI Playground for VS Code

A starter VS Code extension that sends chat prompts to a Databricks Model Serving endpoint and streams the response into a webview.

## Requirements

- VS Code 1.85+
- Node.js 24+ and npm
- A Databricks workspace and a queryable Model Serving endpoint
- A permitted development credential (this starter uses a personal access token)

> Authentication note: PAT support depends on workspace policy and endpoint type. For team/production use, replace the PAT provider with your organization's approved Databricks OAuth flow. Do not distribute a shared token.

## Run locally

1. Open this folder in VS Code.
2. Run `npm install`.
3. Press `F5` to launch the Extension Development Host.
4. In the new VS Code window, run **Databricks Playground: Configure Workspace** from the Command Palette.
5. Run **Databricks Playground: Set Personal Access Token** and paste your development token.
6. Run **Databricks Playground: Open**.
7. Enter a prompt and press **Send**.

Configure endpoint settings under **Settings → Extensions → Databricks Playground** or in `settings.json`:

```json
{
  "databricksPlayground.workspaceUrl": "https://your-workspace.cloud.databricks.com",
  "databricksPlayground.endpointName": "your-serving-endpoint",
  "databricksPlayground.maxTokens": 1024,
  "databricksPlayground.temperature": 0.2
}
```

The extension uses the OpenAI-compatible chat-completions route:

`POST {workspaceUrl}/serving-endpoints/{endpointName}/invocations`

Request format: `messages`, `max_tokens`, `temperature`, `stream: true`.

Not every endpoint supports this exact API schema or all parameters. Consult the documentation for your endpoint type and adjust `src/databricksClient.ts` if needed.

## Package a VSIX

```bash
npm install
npm run package
```

This produces a `.vsix` file in the project directory. Install it with **Extensions → ... → Install from VSIX...**.

## Security notes

- Credentials are stored using VS Code `SecretStorage`; they are not stored in settings or webview state.
- The webview communicates with the extension host through validated messages.
- Do not add tokens to logs, prompts, telemetry, or source control.
- Review your organization's policy before using PATs. For a team rollout, implement per-user OAuth and distribute through an approved internal channel.
