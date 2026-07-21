# Chat composer model controls

## Goal

Move the desktop model selection out of task cards and into the chat composer. Show the active provider, selected model, and thinking level together so they are visible where a message is sent.

## Experience

The composer contains a compact control row below the message field. It shows the provider as context, plus model and thinking selectors. The attachment and send controls remain at the right side of the composer. Task cards no longer own model state.

Changing the model or thinking level takes effect immediately for the active agent session. The selected thinking level is saved with the active provider profile and restored when the application starts.

## Implementation

The desktop frontend will retrieve the active provider, model, and thinking level through the local backend, render the composer controls, and send dedicated updates when a selector changes. The CLI configuration will add a validated thinking field to provider profiles and initialize agents from it. The thinking command remains available as a command-line fallback.

## Error handling and verification

Invalid thinking values fall back to Medium. Failed control updates use the existing chat callout. Tests cover profile persistence and validation; verification runs the repository typecheck, tests, smoke check, and desktop build.
