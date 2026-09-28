# AI Tender Qualification Assistant (AI TBA Analyser)

Enterprise technical bid evaluation platform for refinery, petrochemical, and industrial projects with NIT/PQC compliance, ARC annualization, technical queries, and Gemini multimodal vision document extraction.

## Development Commands

- **Run Dev Server**: `npm run dev` (Starts Express backend + Vite SPA middleware on `http://localhost:3000`)
- **Build Production**: `npm run build` (Compiles Vite frontend and Esbuild `server.ts` to `dist/server.cjs`)
- **Start Production Server**: `npm run start` (Runs `node dist/server.cjs`)
- **Type Check / Lint**: `npm run lint` (Executes `tsc --noEmit`)
- **Firebase Deploy (frontend)**: `node node_modules/firebase-tools/lib/bin/firebase.js deploy --only hosting --non-interactive` (Deploys `dist/` to `tender-scrutiny-assistant.web.app`)
- **Cloud Run Deploy (backend)**: `gcloud run deploy tba-api --source . --region asia-south1` (builds the `Dockerfile` via Cloud Build)

## Deployment Architecture

Firebase Hosting serves only static files, so the Express backend runs separately on Cloud Run.
The frontend calls it directly via `VITE_API_BASE_URL` (baked in at build time) rather than
through a Hosting rewrite, because Hosting rewrites hard-timeout at 60s and a large PDF
extraction can exceed that (a 12.75MB / 78-page PDF measured ~37s).

- Firestore and Auth live in Firebase project `gen-lang-client-0023695976` (see `firebase-applet-config.json`), which is **not** the same project as Hosting (`tender-scrutiny-assistant` in `.firebaserc`). Deploy `firestore.rules` to `gen-lang-client-0023695976` explicitly (`.firebaserc` alias `data`, e.g. `--project data`).
- Any new frontend origin must be added to the backend's `ALLOWED_ORIGINS` (CORS) **and** to Firebase Auth's authorized domains in `gen-lang-client-0023695976`.
- `GEMINI_API_KEY` must be supplied to Cloud Run via Secret Manager, never baked into the image.
- **Original PDFs & evidence boxes**: uploads are kept by SHA-256 in IndexedDB and Firebase Storage (`src/services/sourcePdfStore.ts`, rules in `storage.rules`, deploy with `--only storage --project gen-lang-client-0023695976`). Browser downloads also need the bucket CORS config in `storage-cors.json` (`gcloud storage buckets update gs://gen-lang-client-0023695976.firebasestorage.app --cors-file=storage-cors.json`); add new frontend origins there too. The viewer locates extracted values via the PDF text layer, then `/api/locate-evidence` (Gemini on page images, quotes verified client-side). Never draw boxes at guessed positions.
- **TBA row rules** (`src/utils/tbaRules.ts`): column 5 decides the recommendation — a work order that is not of similar nature is rejected with a remark citing the NIT clause (`similarNatureClause`, set in Tender Setup), and moving it back to Yes clears that remark so the engineer states why it is accepted. The NIL deviation undertaking is per bid, so changing it on one row applies to every work order of that bidder.
- **Demo mode**: "Try the demo" signs judges in anonymously. Guests only see their own `DEMO-` tenders (`demoOwner` in `firestore.rules`) and get a capped daily Gemini allowance enforced in `server.ts` (counters in Firestore `demoUsage/{date}`, limits via `DEMO_*` env vars). Anonymous sign-in must stay enabled in Firebase Auth for `gen-lang-client-0023695976`.

## Environment Setup

Create .env at repository root with:
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
NODE_ENV=development

## Architecture & Code Structure

- **server.ts**: Express backend server handling document extraction API (/api/extract-document), health checks (/api/health), NIT extraction (/api/extract-nit), and technical query generation. Integrated with @google/genai using model gemini-3.6-flash.
- **src/App.tsx**: Main React entry point with sidebar navigation, tab routing, and global state management.
- **src/context/AppContext.tsx**: Global state provider for bidders, tenders, evaluation sheets, and Cloud Firestore synchronization (src/services/firebaseSyncService.ts).
- **src/components/**: Modular React components for onboarding wizard (NIT + bidder uploads), TBA evaluation sheet, technical queries, and the original-PDF evidence viewer. The app has four tabs: Home, Tender Setup, TBA Sheet, Technical Queries.

