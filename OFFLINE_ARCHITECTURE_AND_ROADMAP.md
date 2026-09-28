# Offline Mode Architecture & Future Roadmap

This document outlines the architectural changes made to enable a 100% air-gapped, offline execution of the AI Tender Qualification Assistant, as well as the roadmap for future enhancements.

## 🛠️ Implemented Offline Features

To satisfy strict Indian PSU data residency, cross-border transmission rules, and network constraints, we decoupled the application from Google Cloud Platform / Firebase dependencies using a **Twin-Track Architecture**.

### 1. Local AI Execution (Ollama Integration)
- **Ollama Adapter Service (`ollamaService.ts`)**: Built a robust adapter to route AI requests to a local Ollama instance (`http://localhost:11434/api/generate`) instead of the Gemini Cloud API.
- **Dynamic Routing (`server.ts`)**: The core extraction function `generateContentWithResilience` dynamically routes traffic to Ollama if `VITE_OFFLINE_MODE=true` is detected.
- **Model Selection**: Standardized on **Qwen2.5-VL (7B)** (`qwen2.5vl:7b`) due to its superior multimodal vision capabilities for processing scanned PDFs (dense OCR, tables) completely offline.

### 2. Authentication Bypass (Zero Identity Dependency)
- **Frontend Auth Spoofing (`AppContext.tsx`)**: The `onAuthStateChanged` Firebase listener is intercepted. In offline mode, a mock user profile (`LOCAL_OFFICER`) is instantly injected into the app context, skipping Google OAuth login entirely.
- **Backend Auth Bypass (`server.ts`)**: The Express authentication middleware bypasses Firebase ID token verification, automatically trusting the offline environment.

### 3. Local JSON Persistence (Replacing Firestore)
- **Local Database API (`server.ts`)**: Replaced Google Cloud Firestore with a local file-based database. Implemented new REST endpoints (`/api/local-tenders/*`) directly on the Express server to handle CRUD operations.
- **File System Storage (`localTenderPersistence.ts`)**: Tender records, technical queries, and audit logs are now stored persistently in `data/tenders.json` on the local file system.
- **Sync Interception (`firebaseSyncService.ts`)**: The frontend's Firebase Sync service was patched. When `VITE_OFFLINE_MODE=true`, it skips the Firestore `setDoc`/`onSnapshot` listeners and uses `fetch()` to sync state via the local backend endpoints.

---

## 🚀 Future Roadmap & Scaling Plan

While the current offline prototype works excellently on a local machine, moving to enterprise production requires the following architectural upgrades:

### Phase 1: Hardware-Optimized Enterprise Rollout
- **Deploy 72B Models**: Transition from `qwen2.5vl:7b` to **`qwen2.5-vl:72b`** or **`llama3.2-vision:90b`** once deployed on company on-premise GPU servers (requires ~80GB VRAM, e.g., 2x NVIDIA A6000 or 1x A100).
- **vLLM Integration**: Replace Ollama with **vLLM** for the production backend to handle concurrent tender evaluations from multiple engineers with high-throughput continuous batching.

### Phase 2: Document Storage & Persistent Volumes
- **Local Binary Blob Storage**: Replace the temporary in-memory base64 PDF buffering with a persistent local object store (e.g., MinIO or local filesystem `data/uploads`) to permanently store heavy tender documents.
- **Database Upgrade**: Migrate the simplistic `data/tenders.json` to a robust local relational database like **PostgreSQL** or **SQLite** (using Prisma/Drizzle ORM) for safer concurrent editing and ACID compliance.

### Phase 3: Sovereign Cloud "Hybrid" Option (Optional)
- If hardware procurement is slow, migrate the localized deployment to a **MeitY-empanelled sovereign GPU cloud** (e.g., Yotta Shakti, E2E Networks).
- Alternatively, leverage **AWS Bedrock (ap-south-1 Mumbai)** or **GCP Vertex AI (asia-south1)** with enterprise agreements stipulating Zero Data Retention (ZDR) and strict geographical fencing.

### Phase 4: Purchase Technical Review (TR) Workflows
- Build the extended roadmap for **Purchase TR mode** as defined in `BACKLOG.md`.
- Implement cross-referencing capabilities where the local LLM evaluates technical deviations across multiple uploaded bids simultaneously to generate a unified Technical Bid Analysis (TBA) comparison sheet.
