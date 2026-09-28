# AI Tender Qualification Local Assistant (Offline Edition)

A 100% offline, privacy-first technical bid evaluation platform for Indian PSUs (refinery, petrochemical, pipelines, and infrastructure projects). Runs locally on your machine with **Ollama** and requires **zero external cloud services** (no Google Gemini API key and no Firebase required).

---

## 💻 System Compatibility & Sizing

This offline assistant is tuned for standard engineering laptops and workstations:
- **Detected System Specs**: Windows 11, Intel Iris Xe Graphics, 16 GB RAM (~7.7 GB free RAM).
- **Execution Mode**: CPU / GPU inference via Ollama.
- **Recommended Model Footprint**: 3B to 8B quantized models (Q4_K_M) that run comfortably within 4 GB to 6 GB of RAM on CPU.

---

## 🚀 Quick Setup (3 Steps)

### Step 1: Install Ollama

Choose one of the following methods to install Ollama on Windows:

- **Option A (PowerShell / Windows Terminal - Recommended)**:
  ```powershell
  winget install Ollama.Ollama
  ```
- **Option B (Direct Download)**:
  Download the Windows installer from [ollama.com/download/windows](https://ollama.com/download/windows) and run `OllamaSetup.exe`.

Verify your installation:
```powershell
ollama --version
```
*(Ollama automatically runs in the background and can be found in the Windows system tray).*

---

### Step 2: Download Recommended Offline Models

Open PowerShell and pull one or more of the recommended models:

#### 1. Primary Recommendation (Best for Tender & NIT Extraction):
```powershell
ollama pull qwen2.5:7b
```
> **Why Qwen 2.5 (7B)?** Excellent adherence to strict JSON formatting, superior table understanding, and high accuracy for financial/turnover numbers and Indian contract clauses.

#### 2. Ultra-Fast Lightweight Model (Low Resource / Quick Scrutiny):
```powershell
ollama pull llama3.2:3b
```
> **Why Llama 3.2 (3B)?** Takes under 2.5 GB of RAM, runs fast on pure CPU, ideal for quick summaries and basic work order extraction.

#### 3. Deep Reasoning Model (For Complex Technical Queries & Deviations):
```powershell
ollama pull deepseek-r1:8b
```
> **Why DeepSeek-R1 (8B)?** Chain-of-thought reasoning for complex technical deviation analysis, contract dispute clauses, and consortium/JV share validations.

#### 4. Multimodal Vision Model (For Scanned PDFs / Image Scrutiny):
```powershell
ollama pull llama3.2-vision:11b
```
*(Requires ~8 GB free RAM)*

---

### Step 3: Configure Environment (`.env`)

In the project root (`AI-Tender-Qualification-Local-Assistant`), ensure your `.env` contains:

```env
# ==========================================
# Offline Local AI Model Settings
# ==========================================
OFFLINE_MODE=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b

# Server Configuration
PORT=3000
NODE_ENV=development

# Optional: Cloud fallback (leave empty for 100% offline air-gapped mode)
GEMINI_API_KEY=
```

---

## 🛠️ Running the Application

### Start Development Server
```powershell
npm run dev
```
*(or `bun run dev`)*

The server will launch at:
```
http://localhost:3000
```

### Production Build & Run
```powershell
npm run build
npm run start
```

---

## 🔒 Offline & Air-Gapped Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Browser Frontend                     │
│  - Local Scrutiny Officer (No Google Login Required)   │
│  - Instant IndexedDB Caching & PDF Evidence Viewer     │
└───────────────────────────┬────────────────────────────┘
                            │ REST (localhost:3000)
┌───────────────────────────▼────────────────────────────┐
│               Local Express Server                     │
│  - Offline Auth Bypass (Local session tokens)          │
│  - Local JSON/SQLite Tender Persistence (./data/)      │
│  - Built-in PDF Digital Text Extraction (pdf-parse)    │
└─────────────┬───────────────────────────┬──────────────┘
              │                           │
  Ollama API  │                           │ Fallback (Zero AI)
 (localhost)  ▼                           ▼
┌─────────────────────────┐   ┌──────────────────────────┐
│   Ollama Local LLM      │   │ Built-in PSU Rule Engine │
│ (Qwen2.5 / Llama 3.2)   │   │ (Deterministic Regex/    │
│ - NIT PQC Extraction    │   │  Heuristic PSU Extractor)│
│ - Work Order Scrutiny   │   └──────────────────────────┘
│ - Technical Queries     │
└─────────────────────────┘
```

1. **Local Authentication**: No Google Firebase sign-in prompt. You are automatically signed in as a local scrutiny officer (`Local Officer (Offline)`).
2. **Local Persistence**: Tenders and evaluation sheets are stored in local disk persistence (`data/tenders.json`) and cached in browser IndexedDB.
3. **Double Fallback Resilience**:
   - If Ollama is running: Queries and document extraction use the local LLM with structured JSON output.
   - If Ollama is temporarily stopped: The built-in deterministic PSU NIT parser extracts clauses, work orders, and dates using regex and heuristics without crashing.
4. **Data Privacy**: No data or documents leave your machine. Fully compliant with PSU security guidelines and air-gapped intranet environments.

---

## ❓ Frequently Asked Questions

### How do I switch models?
Change the `OLLAMA_MODEL` variable in `.env`:
```env
OLLAMA_MODEL=llama3.2:3b
```
Restart `npm run dev` and the server will immediately use the new model.

### Can I run this without internet connection?
**Yes.** Once Ollama and your chosen model are downloaded, disconnect your network adapter or Wi-Fi. The application will function completely offline.

### What if a PDF is a scanned photocopy with no text layer?
- If using `llama3.2-vision:11b` or `qwen2.5-vl`, Ollama will process the rendered page images directly.
- Alternatively, for digital PDFs, the built-in parser extracts text layers in under 2 seconds locally.

---

## 🏢 Hybrid Deployment Strategy (API First → Local Later)

If your current laptop lacks the GPU/RAM needed for fast inference (e.g., you need to run heavy vision models like **Qwen2.5-VL 72B** or **Llama 3.2-Vision 90B**), but you want a path to eventual **on-premise company servers**, use the **Twin-Track Hybrid Architecture**:

1. **Phase 1 (Now - Cloud Prototyping):** Use a **Privacy-Hardened Cloud API** that hosts Open-Weight models and guarantees **Zero Data Retention (ZDR)** and strict **Data Residency in India**. 
   - **Recommended Providers:** **AWS Bedrock** (ap-south-1 Mumbai) or **Google Cloud Vertex AI** (asia-south1). Both are MeitY-empanelled and offer Llama/Mistral models without training on your data.
   - *Do not use direct US endpoints (Groq, Together AI, Anthropic direct) for sensitive PSU data due to cross-border data transfer laws.*

2. **Phase 2 (Later - Full Air-Gapped):** When your company provisions on-premise servers or sovereign Indian cloud GPUs (e.g., Yotta, E2E Networks), you install **Ollama** or **vLLM** on them.
   - Because you chose Open-Weight models in Phase 1, you can download the exact same model weights (e.g., `qwen2.5-vl`) and run them locally.
   - **Migration Code:** Since AWS/Azure and Ollama all support the standard OpenAI `/v1/chat/completions` REST format, switching from Cloud to Local requires changing just the `OLLAMA_BASE_URL` in your `.env` file. Zero code rewrite required!
