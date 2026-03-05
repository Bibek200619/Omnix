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

---

## 📜 License
