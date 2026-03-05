# 🧠 Developer Guide – AI Backend System

## 📌 Purpose

This document provides **deep technical context** for developers and AI agents working on this project.

It defines:

* System architecture
* Design decisions
* Constraints
* Rules that must NOT be violated

---

## 🏗️ Core Architecture

### Backend Stack

* FastAPI (API layer)
* Supabase (auth + database)
* FAISS (vector storage)
* LLM (local / vLLM / API)

---

### System Layers

```
API Layer (FastAPI)
   ↓
Service Layer
   ├── Chat Service
   ├── RAG Service
   ├── Auth Layer
   ↓
Data Layer
   ├── Supabase (Postgres)
   ├── FAISS (vectors)
```

---

## 🔐 Authentication Model

* Supabase JWT is the **source of truth**
* Backend verifies JWT using JWKS (cached)
* No trust in frontend data
* `user_id` always derived from token

### Rules:

* NEVER trust user_id from request body
* ALL protected routes require JWT
* Reject invalid/expired tokens

---

## 🗄️ Database Access Model

### Current Design

* Uses **Supabase service role key**
* RLS is NOT enforced by database
* Security handled at application layer

### Implications

* Every query MUST include ownership filtering
* Missing filter = full data leak

### Rules:

* NEVER use `select("*")`
* ALWAYS filter by `user_id` where applicable
* Use centralized DB helper functions only
* Do NOT access Supabase client directly in routers

---

## ⚙️ API Design Rules

* All endpoints must:

  * validate input
  * enforce ownership
  * return consistent responses

* Error handling:

  * NO raw exceptions returned to client
  * Log internally only

---

## ⚡ Performance Constraints

* Supabase uses REST → each query = HTTP request
* Avoid excessive DB roundtrips
* Use pagination for all list endpoints
* Limit payload sizes

---

## 🤖 Chat System Design

### Flow

```
User → /chat → Backend → LLM → Response
```

### Constraints

* LLM calls are:

  * rate-limited
  * timeout-controlled
  * concurrency-limited

* Chat must:

  * never block system
  * handle failures gracefully
  * maintain consistency

---

## 🧠 RAG System Architecture

### Components

* ingestion.py → file processing
* chunking.py → text splitting
* embedding.py → embedding generation
* vector_store.py → FAISS
* retrieval.py → semantic search

---

### Data Flow

```
Upload → Background Task → Chunk → Embed → Store → FAISS
```

---

### Retrieval Flow

```
Query → Embed → FAISS → Top-K → Filter(user_id) → Return
```

---

### RAG Rules

* MUST filter by `user_id`
* MUST limit top-k results
* MUST NOT block request thread
* MUST NOT expose raw chunks blindly

---

## 🧱 Background Tasks

Used for:

* logging
* RAG ingestion

### Rules:

* Must be non-blocking
* Must handle failures silently
* Must not grow unbounded queues

---

## 🚦 Rate Limiting

* Applied on `/chat`
* Prevent abuse and cost explosion

---

## 📊 Logging

* Fire-and-forget
* Never block request
* Best-effort only

---

## ❗ Critical Risks (Known)

1. Service role key bypasses RLS
2. DB access relies on correct filtering
3. Supabase REST adds latency per query

---

## 🚫 Things NOT to Do

* Do NOT redesign architecture without reason
* Do NOT add heavy dependencies
* Do NOT block async endpoints
* Do NOT expose secrets
* Do NOT bypass auth checks

---

## 🧠 Development Workflow

Use:

* Codex / Cursor → implementation
* AI prompts → structured tasks
* Manual validation → required

### Rule:

AI generates → developer verifies

---

## 🧪 Testing Philosophy

* Test failure scenarios
* Test concurrency
* Test invalid inputs
* Test ownership boundaries

---

## 📌 Future Improvements

* Move from service-role to RLS-based access
* Add Redis for rate limiting
* Add async DB layer
* Introduce hybrid search (RAG)

---

## 🧠 Key Principle

This system prioritizes:

> **Correctness → Safety → Stability → Performance → Features**
