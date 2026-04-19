# OMNIX — Project Instructions & Overview

This file serves as the foundational mandate for the OMNIX project. It contains the core vision, architectural principles, and project-specific conventions. All development and AI interactions within this workspace must align with these instructions.

## What is OMNIX?

OMNIX is an AI-native productivity, collaboration, automation, and knowledge platform designed to combine the capabilities of multiple modern tools into one intelligent ecosystem.

**The Core Vision:**
> “One unified workspace where humans, AI agents, teams, automation systems, and knowledge interact together seamlessly.”

OMNIX aims to centralize chat, project management, AI assistance, meetings, workflow automation, document collaboration, and knowledge retrieval into a single AI-powered operating system.

---

## Core Components

### 1. AI Workspace
The heart of OMNIX. Users can chat with AI, generate content, analyze files, summarize documents, and collaborate. It is context-aware, memory-driven, and deeply integrated.

### 2. Multi-Model AI System
Access multiple AI models (OpenAI GPT, Google Gemini, Anthropic Claude, DeepSeek, etc.) from one interface for comparison, ensemble reasoning, and specialized routing.

### 3. Agentic AI System
Evolution from chatbot → assistant → autonomous AI agents capable of scheduling, reporting, and operating tools independently.

### 4. Real-Time Collaboration
Team workspaces, shared canvases, live editing, and synchronized chats. Features include team rooms, hierarchy, and AI-assisted meetings.

### 5. Knowledge Management System
A "second brain" featuring AI semantic search, document indexing, workspace memory, and contextual retrieval using vector databases and knowledge graphs.

### 6. Automation Engine
AI workflows, triggers, actions, and pipelines for automated summaries, reports, and task creation.

### 7. Integrated Communication Layer
Merging messaging, meetings, and voice with AI-driven summaries and contextual collaboration.

### 8. Smart AI Memory
Persistent workspace intelligence storing user preferences, project context, and historical discussions for personalized behavior.

### 9. Multi-Perspective Reasoning (Omnix AI Panel)
Simulated expert reasoning panels where multiple AI perspectives debate and refine outputs for deeper reasoning and fewer hallucinations.

---

## Technical Architecture Vision

### Frontend
- **Stack:** React, Next.js, TypeScript, Tailwind, Framer Motion, WebSockets.

### Backend
- **Stack:** Node.js, Python microservices (FastAPI), PostgreSQL, Redis, Supabase, Vector databases.

### AI Infrastructure
- **Stack:** RAG pipelines, multi-model routing, embeddings, local inference, Bedrock/OpenAI APIs, autonomous agents, memory systems.

---

## Development Mandates & Conventions

- **AI-First:** AI is not an add-on; it is the foundation. Every feature should consider how AI enhances the experience.
- **Modular Design:** Maintain clean, modular code across the `frontend`, `backend`, and `scripts` directories.
- **Type Safety:** Use TypeScript for all frontend and relevant backend development.
- **Real-time focus:** Architecture must support live collaboration and streaming AI responses.
- **Security & Privacy:** Ensure robust handling of user data, especially when indexing for Knowledge Management.

---

## Workspace Structure (Current)
- `backend/`: Core logic, API, and AI integrations.
- `frontend/`: User interface and real-time collaboration features.
- `scripts/`: Utility and automation scripts.
- `docs/`: Project documentation.
- `uploads/`: Local storage for processed files (verify cleanup policies).

---

## Future Goals
- AI app marketplace & plugin ecosystem.
- Autonomous business agents.
- Local/Offline AI deployment options.
- Voice-native interfaces.
