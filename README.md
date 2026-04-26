# AI Backend (Supabase + FastAPI + LLM)

A production-ready backend for an AI application that supports authentication, chat conversations, file handling, logging, caching, and is designed to integrate with an LLM (e.g., vLLM) and a vector store (FAISS) for RAG.

This README is written so another AI (or developer) can quickly understand the system without extra explanation.

---

## 🧠 System Overview

This backend follows a clean layered architecture:

```
Frontend (React)
        ↓
FastAPI (API + Logic)
        ↓
LLM Server (vLLM / local model)
        ↓
Supabase (Auth + Database)
        ↓
FAISS (Vector Search - future)
```

---

## 🎯 Purpose

* Build a scalable AI backend
* Avoid token limits of external APIs by using local models
* Maintain full control over data
* Support chat, memory, files, and future RAG

---

## ⚙️ Tech Stack

* FastAPI (backend API)
* Supabase (auth + PostgreSQL)
* PyJWT (JWT verification)
* vLLM / OpenAI-compatible server (LLM)
* FAISS (planned vector search)
* Uvicorn (ASGI server)

---

## 📁 Project Structure

```
backend/
├── app/
│   ├── main.py                # Entry point
│   ├── core/
│   │   ├── config.py          # Environment config
│   │   └── security.py        # JWT verification
│   ├── db/
│   │   └── supabase.py        # DB connection
│   ├── schemas/
│   │   └── chat.py            # Request/response models
│   ├── services/
│   │   ├── chat_service.py    # LLM interaction
│   │   └── supabase_service.py# DB helpers
│   └── routers/
│       ├── health.py
│       ├── conversations.py
│       ├── messages.py
│       ├── files.py
│       └── cache.py
├── requirements.txt
└── .env
```

---

## 🔐 Authentication Flow

1. User logs in via Supabase
2. Supabase returns JWT access token
3. Frontend sends token in header:

   ```
   Authorization: Bearer <token>
   ```
4. FastAPI verifies token using JWKS
5. Extracts `user_id = token['sub']`
6. All queries are filtered by user_id

---

## 🗄️ Database Schema

### Tables

* profiles
* conversations
* messages
* files
* documents
* embeddings
* api_logs
* cache

### Relationships

```
User
 ├── Profile
 ├── Conversations
 │     └── Messages
 ├── Files
 │     └── Documents
 │            └── Embeddings
 ├── API Logs
 └── Cache
```

---

## 🔐 Security (RLS)

* Row Level Security enabled on all tables
* Users can only access their own data
* Backend uses service role key (bypasses RLS)
* Frontend uses anon key (RLS enforced)

---

## 💬 Chat Flow

```
User sends message
    ↓
FastAPI validates JWT
    ↓
Message stored in DB
    ↓
Context built from past messages
    ↓
Sent to LLM
    ↓
Response generated
    ↓
Response stored
    ↓
Returned to user
```

---

## 🧠 LLM Integration

Uses OpenAI-compatible API:

Endpoint:

```
POST /v1/chat/completions
```

Payload:

```
{
  "model": "local-model",
  "messages": [...]
}
```

---

## 📡 API Endpoints

### Health

* GET /health

### Conversations

* POST /conversations
* GET /conversations
* GET /conversations/{id}

### Messages

* POST /chat
* GET /conversations/{id}/messages

### Files

* POST /files
* GET /files

### Cache

* POST /cache
* GET /cache/{key}

---

## 🧪 Example Request

```
curl -X POST http://localhost:8000/chat \
-H "Authorization: Bearer TOKEN" \
-H "Content-Type: application/json" \
-d '{"message": "Hello AI"}'
```

---

## 📦 Setup

### Install

```
pip install -r requirements.txt
```

### Run

```
uvicorn app.main:app --reload
```

---

## ⚠️ Important Notes

* Never expose service role key
* Always verify JWT in backend
* Assistant messages should only be created by backend
* Keep model separate from API logic

---

## 🚀 Future Enhancements

* FAISS integration (vector search)
* RAG pipeline
* Multi-agent system
* Streaming responses
* Rate limiting

---

## 🧠 Design Philosophy

* Modular architecture
* Clear separation of concerns
* Scalable from prototype → production
* Backend acts as "AI operating system"

---

## 📌 Summary

This backend is:

* Secure (JWT + RLS)
* Scalable (modular design)
* AI-ready (LLM + future RAG)
* Clean (structured SDLC approach)

# 🚀 AI Backend System (RAG-Enabled)

## 📌 Overview

This project is a **local-first AI backend system** designed to run large language models (LLMs) with **no token limitations**, full control, and scalable architecture.

It includes:
- FastAPI backend
- Supabase (auth + database)
- FAISS (vector storage)
- RAG (Retrieval-Augmented Generation)
- Modular AI pipeline

---

## 🧠 System Goals

- Run AI models locally / on cloud (AWS/GCP)
- Remove token restrictions from APIs
- Build scalable AI infrastructure
- Enable document-based Q&A (RAG)
- Maintain full control over data and logic

---

## 🏗️ Architecture

Frontend
↓
FastAPI Backend
↓
Core Services
Auth (Supabase JWT)
Chat Service
RAG Engine
↓
Storage Layer
Supabase (Postgres)
FAISS (Vector DB)

↓
LLM (Local / vLLM / API)


---

## 🔐 Authentication

- Managed via Supabase
- JWT-based authentication
- All routes (except health/docs) are protected
- User isolation enforced at application level

---

## 🗄️ Database Schema (Supabase)

### Core Tables

- `profiles` → user data  
- `conversations` → chat sessions  
- `messages` → chat messages  
- `files` → uploaded files  
- `documents` → chunked text  
- `embeddings` → vector mapping  
- `cache` → response caching  
- `api_logs` → request logs  

---

## ⚙️ Backend Features

### ✅ Chat System
- Conversation-based chat
- Message history
- Failure-safe message handling
- Rate-limited

---

### ✅ Security
- Strong JWT validation
- No raw DB error leaks
- User data isolation
- Controlled model access

---

### ✅ Performance
- Pagination implemented
- Input/output limits enforced
- Reduced DB roundtrips
- Bounded LLM calls

---

### ✅ Stability
- Non-blocking logging
- Background tasks
- Concurrency control
- Timeout handling

---

## 🧠 RAG System (In Progress)

### Design


Upload File
↓
Background Processing
↓
Chunking (500 tokens, 50 overlap)
↓
Embedding Generation
↓
FAISS Storage
↓
Query → Retrieval → Context → LLM


---

### Components

- `ingestion.py` → file processing
- `chunking.py` → text splitting
- `embedding.py` → embeddings
- `vector_store.py` → FAISS
- `retrieval.py` → search engine

---

### Key Decisions

- Global FAISS index
- Background ingestion
- Selective RAG (not always-on)
- User-level data isolation

---

## 📡 API Endpoints (Core)

### Auth
- `/auth/login`
- `/auth/signup`

### Chat
- `/chat`
- `/conversations`
- `/messages`

### Files
- `/files/upload`
- `/files/list`

### System
- `/health`

---

## 🔧 Environment Variables

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

SUPABASE_JWKS_URL=...

MODEL_URL=http://localhost:8000/v1/chat/completions

SECRET_KEY=...
⚠️ Security Notes
NEVER expose SERVICE_ROLE_KEY
.env must be in .gitignore
Rotate keys if leaked
All access controlled via JWT
🧪 Testing Strategy
Postman / curl for API testing
UI (planned) for real-world validation
Stress testing via multiple requests
Failure simulation (LLM down, DB slow)
🚀 Current Status
✅ Completed
Backend architecture
Security hardening
Performance optimization
Chat system
Supabase integration
🔄 In Progress
RAG ingestion
FAISS integration
⏳ Planned
UI
Deployment (AWS/GCP)
Advanced RAG (reranking, hybrid search)
🧠 Development Philosophy
System-first design (not feature-first)
Security before scaling
Controlled complexity
Modular architecture
AI-assisted development workflow
👨‍💻 Workflow

This project uses:

Codex / Cursor → code generation
Claude / Gemini → reasoning/debugging
ChatGPT → system architecture guidance
📌 Future Enhancements
Hybrid search (keyword + vector)
Re-ranking models
Distributed vector storage
Real-time streaming responses
Multi-model orchestration
📄 License

Internal / Personal Project

🤝 Contribution

Currently single-developer system
Designed for extensibility and future collaboration


---

# 🧠 Why this README is good

- Structured for humans **and AI tools**
- Reduces repeated explanation
- Matches your actual architecture
- Scales with your project

---

# 🎯 Next step

Save this as:

```bash
README.md