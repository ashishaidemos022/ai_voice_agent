# AI Voice Agent

## A2UI Testing Notes

### Workspace (Chat + Voice)
1) Open an agent preset in Settings and toggle **Enable A2UI (agent-generated UI)** on.
2) Start a chat or voice session with that preset.
3) Ask the agent to return A2UI (example: "Show a simple form with a submit button").
4) Verify the UI renders in the assistant bubble and button/form clicks send an `A2UI_EVENT` user message.

### Embeds (Chat + Voice)
1) Create or enable an embed for the same preset.
2) Load the chat embed `.../embed/chat/<public_id>` and confirm A2UI renders only when enabled.
3) Load the voice embed `.../embed/voice/<public_id>` and confirm A2UI renders in the conversation log.
4) Toggle A2UI off in the preset and refresh embeds; UI should stop rendering and fallback text should display.

### Regression Checks
- With A2UI off, responses must remain plain text (no UI rendering).
- Verify existing realtime behavior is unchanged when A2UI is disabled.
