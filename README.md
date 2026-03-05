# 🚀 Omnix AI Backend (RAG-Enabled System)

A production-oriented **AI backend system** built with FastAPI and Supabase, designed for scalable chat, document processing, and Retrieval-Augmented Generation (RAG).

This README is structured for both **developers and AI tools** to quickly understand and extend the system.

---

# 🧠 System Overview

This backend implements a modular AI architecture:

```text
Frontend (Next.js - planned)
        ↓
FastAPI (API + Business Logic)
        ↓
RAG Pipeline (Retrieval Engine)
        ↓
Supabase (Auth + Database)
        ↓
FAISS (Vector Search - temporary)
        ↓
LLM (optional / Dev Mode fallback)
```

---

# 🎯 Purpose

* Build a **scalable AI backend**
* Enable **document-based Q&A (RAG)**
* Maintain **full data control (no external APIs required)**
* Support chat, files, caching, and future AI features

---

# ⚙️ Tech Stack

* FastAPI (Backend API)
* Supabase (Auth + PostgreSQL)
* FAISS (Vector Search - temporary)
* sentence-transformers (Embeddings)
* PyJWT (Authentication)
* Uvicorn (ASGI Server)

---

# 🧩 Core Architecture

## 🔹 RAG Flow

```text
User Query
   ↓
Embedding (sentence-transformers)
   ↓
FAISS Search (vector similarity)
   ↓
Top Chunk IDs
   ↓
Supabase Fetch (source of truth)
   ↓
Context Builder
   ↓
ChatService (Dev Mode / LLM-ready)
```

---

# ✅ Current Features

## 🔹 Chat System

* Conversation-based messaging
* Message persistence
* Safe message lifecycle handling

## 🔹 RAG System

* Chunking (500 tokens, overlap)
* Embedding generation
* Vector search (FAISS)
* DB-backed chunk retrieval (no in-memory dict)

## 🔹 Multi-User Isolation

* Strict user-level filtering
* No cross-user data leakage

## 🔹 Dev Mode (LLM-Free)

* No dependency on external LLM
* Returns best matching chunk
* Clean, deduplicated responses

## 🔹 Backend Stability

* Async-safe operations
* Structured logging
* Error handling with fallbacks

---

# ⚠️ Current Limitations

* FAISS is **in-memory** (rebuilt on startup)
* No real LLM integration yet (Dev Mode only)
* Split storage:

  * FAISS → embeddings
  * Supabase → text data
* No frontend yet (planned)

---

# 🗄️ Database Schema (Supabase)

### Core Tables

* `profiles` → user data
* `conversations` → chat sessions
* `messages` → chat messages
* `files` → uploaded files
* `documents` → chunked text
* `embeddings` → vector mapping
* `cache` → response caching
* `api_logs` → request logs

---

# 🔐 Authentication

* Supabase JWT-based authentication
* Backend verifies token via JWKS
* Extracts `user_id` from token
* All queries filtered by `user_id`

---

# 💬 Chat Flow

```text
User sends message
    ↓
JWT validation
    ↓
Message stored in DB
    ↓
RAG retrieval (chunks)
    ↓
Context built
    ↓
Dev Mode response (or LLM)
    ↓
Response stored + returned
```

---

# 📁 Project Structure

```text
backend/
├── app/
│   ├── rag/
│   │   ├── ingestion.py
│   │   ├── chunking.py
│   │   ├── embedding.py
│   │   ├── vector_store.py
│   │   ├── retrieval.py
│   │   └── context_builder.py
│   │
│   ├── services/
│   │   ├── chat_service.py
│   │   ├── supabase_service.py
│   │   └── llm_service.py
│   │
│   ├── core/
│   │   ├── config.py
│   │   └── security.py
│   │
│   ├── routers/
│   │   ├── conversations.py
│   │   ├── messages.py
│   │   ├── files.py
│   │   └── cache.py
│
└── main.py
```

---

# 📡 API Endpoints

### Chat

* `POST /chat`

### Conversations

* `POST /conversations`
* `GET /conversations`

### Messages

* `GET /conversations/{id}/messages`

### Files

* `POST /files`
* `GET /files`

### System

* `GET /health`

---

# 🔧 Setup

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload
```

---

# ⚠️ Security Notes

* Never expose `SERVICE_ROLE_KEY`
* Always verify JWT in backend
* Use RLS in Supabase for frontend access
* Backend uses service role with strict filtering

---

# 🚀 Roadmap

## 🔹 Short-Term

* Frontend UI (Next.js)
* Improve retrieval quality (threshold tuning)
* Add logging/metrics

## 🔹 Mid-Term

* LLM integration (local via Ollama or API)
* Conversation memory enhancement
* File upload → RAG ingestion

## 🔹 Long-Term

* Replace FAISS with pgvector (Supabase)
* Background workers (Celery/queue)
* Multi-instance scaling

---

# 🧠 Design Philosophy

* Build working systems first, optimize later
* Separate concerns:

  * Vector search (FAISS)
  * Data storage (Supabase)
* Avoid over-engineering early
* Design for future scalability

---

# 📌 Status

🟢 Backend: Stable (MVP ready)
🟡 RAG: Functional (improving)
🟡 Frontend: In progress
🔵 LLM: Planned

---

# 🎯 Next Step

* Build frontend UI
* Connect chat endpoint
* Add real LLM integration

---
