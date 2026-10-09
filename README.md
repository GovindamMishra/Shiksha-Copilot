# Shiksha Copilot — Syllabus-Adaptive Learning Build

Shiksha Copilot is a responsive learning dashboard for the AVINYA 2K26 / SIIC, IIT Kanpur hackathon concept. This build extends the previous Gemini-based foundation with a persistent backend state store, explicit demo mode, objective local grading, syllabus document extraction, and a clear separation between live AI and deterministic fallback responses.

## What's implemented

- Premium responsive dashboard, AI Tutor, Syllabus Intelligence, Adaptive Assessment, Learning Path, and Learner Profile views.
- General Learning and Personalized Preparation tutor modes.
- Syllabus parsing from pasted text and import from text-based PDF, DOCX, and TXT files. Imported content is not treated as officially verified; review the extracted text before parsing/saving. Scanned PDFs need OCR and are not supported by this importer.
- Topic-aware local demo question bank for arrays, linked lists, stacks, queues, trees, probability, photosynthesis, and operating systems; a generic study-skills fallback is also included.
- Deterministic objective answer grading and transparent remediation messages in demo mode.
- Optional Gemini live AI via a server-side API key. When Gemini is missing or unavailable, the app falls back to a clearly labeled deterministic demo response instead of pretending that live AI succeeded.
- Persistent learner profile, syllabus, mastery estimates, weak areas, mistakes, activity, study plan, and recent tutor history in `backend/data/state.json`.
- Topic mastery is shown as **Not assessed** until there is recorded evidence; lesson/syllabus completion is not treated as mastery.
- Backend endpoints for state, syllabus, preparation summary, topic progress, study plan, revision queue, assessment history, tutor context, and AI actions.
- Reset local demo data control.
- Automated smoke/unit tests for demo question generation, objective grading, general tutoring fallback, persistence, and evidence-aware readiness.

## Requirements

- Node.js 18 or newer (Node 20+ recommended).
- Internet connection only if you configure Gemini or install the optional document parsing dependencies.
- No API key is required to run the local demo.

## Run on Windows

1. Extract this ZIP to a folder you can write to.
2. Open a terminal in the extracted folder.
3. Run:

   ```bat
   cd backend
   npm install
   ```

4. Copy `.env.example` to `.env` if it does not already exist. You can leave the key blank to use demo mode.
5. Start the server:

   ```bat
   node server.js
   ```

6. Open `http://localhost:8787` in a browser.

Or double-click `START_SHIKSHA.bat`; it installs dependencies if needed, starts the server, and opens the local site.

## Enable live Gemini AI

Edit `backend/.env` and set a valid Google Gemini API key and a model available to that API project:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=your-currently-supported-model
GEMINI_FALLBACK_MODELS=your-fallback-model
GEMINI_RETRIES=2
GEMINI_MAX_OUTPUT_TOKENS=4096
GEMINI_TEMPERATURE=0.55
DEMO_FALLBACK=true
PORT=8787
```

The model shown above is an example; confirm current availability for your account. Do not put API keys in frontend files or commit `.env`. The server attempts live AI first when configured. If the provider reports a quota, capacity, or other failure and `DEMO_FALLBACK=true`, the response is explicitly marked as demo fallback. It is not a live AI-generated answer. A quota-limited API key cannot be fixed by changing frontend code; use an available model/project quota or remain in demo mode.

## API overview

- `GET /api/health` — server and AI mode.
- `GET /api/state`, `POST /api/state`, `POST /api/state/reset` — persistent local learner state.
- `GET /api/syllabus`, `POST /api/syllabus`, `PATCH /api/syllabus` — saved syllabus.
- `POST /api/syllabus/parse` — parse pasted syllabus text (Gemini enhancement is optional).
- `POST /api/syllabus/import` — extract text from PDF/DOCX/TXT upload payload.
- `POST /api/ai` — tutor, notes, quiz, evaluation, plan, readiness and analysis actions.
- `GET /api/progress`, `GET /api/progress/topics`, `GET /api/preparation/summary` — progress records.
- `GET /api/tutor/context` — bounded learner context for tutor use.
- `GET/POST/PATCH /api/study-plan` — retrieve/save study plan.
- `GET /api/revision/due` — recorded mistakes not yet marked revised.
- `GET /api/assessments/history` — assessment activity history.

This is a local hackathon/demo application, not a multi-user production deployment. It has no authentication, and its JSON state file is intended for one local demo learner. Do not expose the server publicly without authentication, rate limiting, stricter origin policy, and deployment hardening.

## Testing

From `backend`, run:

```bat
npm test
```

The tests validate deterministic demo question generation, objective grading, general-topic fallback, persistence, and honest no-evidence readiness. Manual UI test: load the Data Structures sample syllabus; generate a linked-list question; submit both correct and incorrect choices; refresh/restart and confirm saved state remains; switch tutor modes; check the AI status badge to distinguish live AI from demo.

## Known limitations

- The local demo content bank is deliberately small; unsupported questions are honestly identified rather than fabricated as live AI.
- PDF text extraction does not perform OCR on scanned images.
- Mastery updates in the current UI are lightweight evidence estimates, not a validated psychometric model.
- Study-plan generation in demo mode is rule-based and its readiness estimate does not incorporate official exam weightage unless entered and modeled in future work.
- Persistent JSON is suitable for a single-user demonstration, not concurrent multi-user production use.

## Five-minute hackathon demonstration

1. **0:00–0:30 — Open the dashboard.** Point out the honest empty-state mastery and the live/demo status badge.
2. **0:30–1:00 — Load sample syllabus.** Open *Syllabus AI* and click **Load Sample Data**. Explain that the sample begins with Arrays at 75% and Linked Lists at 35%; Stacks, Queues and Trees are not assessed. These are explicitly labeled sample values.
3. **1:00–2:00 — Show syllabus coverage.** Cycle a topic status from Not started → In progress → Completed. Explain that completion is tracked separately from mastery.
4. **2:00–3:00 — Run an adaptive assessment.** Click **Start Adaptive Session**, choose an answer and submit. The answer is graded against the stored correct option, a mistake is recorded when wrong, mastery is updated, and the next question is selected from another available syllabus topic where possible.
5. **3:00–4:00 — Compare tutor modes.** Ask a general question in General Learning mode, then switch to Personalized Preparation and ask “Explain my weakest topic” or “Show my preparation progress.” The personalized answer uses saved learner evidence; unsupported demo requests are labeled honestly.
6. **4:00–5:00 — Demonstrate persistence and AI modes.** Refresh the page and show the saved learner state. Open AI Configuration to show the mode. With a valid, quota-enabled key, live Gemini is used; without one, the local demo remains functional. Generate notes or a seven-day plan from the syllabus.
