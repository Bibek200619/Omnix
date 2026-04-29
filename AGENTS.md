# Omnix Architecture Rules

Omnix is an AI-native collaborative operating system.

Core architecture:
- Workspace hierarchy is the spine
- Never break onboarding gate
- Never break stream recovery
- Preserve workspace switching
- Preserve auth session persistence

Critical systems:
- frontend/src/workspaces/
- backend/app/workspace/
- backend/app/ai/
- frontend/src/lib/streaming/

Rules:
- Avoid admin-panel UI
- Preserve cinematic premium design
- Use truthful analytics only
- Never fake collaboration states
