# Legal Research + FIR Assistant

A full-stack legal technology application combining:

1. **Legal Research** — document search, case exploration, legal chat, and citation graph functionality.
2. **FIR Assistant** — a guided conversational system for collecting, validating, reviewing, and generating FIR information.

The two systems are integrated into one user-facing application while remaining **architecturally isolated**.

---

## Table of Contents

* [Project Overview](#project-overview)
* [Architecture](#architecture)
* [Repository Structure](#repository-structure)
* [Technology Stack](#technology-stack)
* [Prerequisites](#prerequisites)
* [Clone the Repository](#clone-the-repository)
* [Environment Variables](#environment-variables)
* [1. Configure the FIR Backend](#1-configure-the-fir-backend)
* [2. Configure the Legal Research Backend](#2-configure-the-legal-research-backend)
* [3. Install Dependencies](#3-install-dependencies)
* [4. Start the Application](#4-start-the-application)
* [5. Verify That Everything Is Running](#5-verify-that-everything-is-running)
* [Using the Application](#using-the-application)
* [FIR Assistant Flow](#fir-assistant-flow)
* [Legal Research Flow](#legal-research-flow)
* [User Accounts](#user-accounts)
* [API Routing](#api-routing)
* [Data and Privacy Isolation](#data-and-privacy-isolation)
* [Troubleshooting](#troubleshooting)
* [Development and Testing](#development-and-testing)
* [Git Workflow](#git-workflow)
* [Security](#security)
* [Important Notes](#important-notes)

---

# Project Overview

The project contains two major applications:

### Legal Research

The main LY application provides the legal research experience, including:

* Legal document search
* Case exploration
* Legal chat
* Citation graph
* Bail outcome & judgment analysis (granted / rejected, reasons, factors, supporting paragraphs)
* Retrieval/RAG functionality
* MongoDB-backed legal research functionality
* Embedding-based retrieval

### FIR Assistant

The FIR Assistant is a separate conversational service designed to:

* Start an FIR-related session
* Collect information conversationally
* Ask follow-up questions
* Extract structured facts
* Detect contradictions or incomplete information
* Allow the user to review collected facts
* Confirm the information
* Generate the final FIR output

The FIR backend is implemented as an independent FastAPI application.

---

# Architecture

The application uses three running processes.

```text
                         Browser
                            |
                            |
                     React Frontend
                       localhost:5173
                            |
                  ---------------------
                  |                   |
                  |                   |
             Legal Research      /api/fir/*
                  |                   |
                  |                   v
                  |             LY Express Proxy
                  |               localhost:8080
                  |                   |
                  |                   v
                  |             FIR FastAPI
                  |               localhost:8000
                  |
                  v
             LY Express
              :8080
                  |
          Legal Research services
```

## Service Responsibilities

### React Frontend

Port:

```text
5173
```

The React application provides the user interface.

It contains both:

```text
Legal Research
```

and:

```text
FIR Assistant
```

experiences.

---

### LY Express Backend

Port:

```text
8080
```

The Express server handles the main Legal Research backend functionality.

It also exposes the FIR proxy:

```text
/api/fir/*
```

The browser communicates with the FIR backend through this proxy rather than directly connecting to port `8000`.

---

### FIR FastAPI Backend

Port:

```text
8000
```

The FIR application runs independently.

It maintains its own:

* API routes
* conversation manager
* CaseState
* LLM configuration
* storage
* validation
* extraction logic

---

# Repository Structure

The combined repository contains both projects.

```text
ly-legal-research-platform/
│
├── README.md
├── .gitignore
│
├── ly-project/
│   │
│   ├── server/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── cases.ts
│   │   │   │   ├── chat.ts
│   │   │   │   ├── search.ts
│   │   │   │   ├── graph.ts
│   │   │   │   ├── bail.ts          ← bail outcome & judgment analysis
│   │   │   │   └── fir.ts           ← proxy to fir-service
│   │   │   │
│   │   │   ├── lib/
│   │   │   │   └── bailAnalysis.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── package.json
│   │   └── .env.example
│   │
│   ├── web/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   └── fir.ts
│   │   │   │
│   │   │   ├── components/
│   │   │   │   └── BailAnalysisPanel.tsx
│   │   │   │
│   │   │   ├── pages/
│   │   │   │   └── fir/
│   │   │   │       ├── FirHomePage.tsx
│   │   │   │       ├── FirConversationPage.tsx
│   │   │   │       ├── FirReviewPage.tsx
│   │   │   │       ├── FirConfirmPage.tsx
│   │   │   │       └── FirOutputPage.tsx
│   │   │   │
│   │   │   └── ...
│   │   │
│   │   └── package.json
│   │
│   └── fir-service/            ← FIR Assistant backend (FastAPI)
│       ├── app/
│       │   ├── api/
│       │   ├── conversation/
│       │   ├── extraction/
│       │   ├── llm/
│       │   ├── models/
│       │   ├── storage/
│       │   ├── utils/
│       │   └── validation/
│       │
│       ├── tests/
│       ├── docs/
│       ├── frontend/           ← legacy standalone UI; the React pages replace it
│       ├── data/
│       ├── requirements.txt
│       └── .env.example
```

All three services live under `ly-project/` as siblings: `server` and `web`
are the Node/React app, `fir-service` is the Python backend the server proxies
to. It is still its own process (it is Python, the server is Node), but it is
part of the same project rather than a second project beside it.

---

# Technology Stack

## Legal Research Application

* React
* TypeScript
* Vite
* Express
* Node.js
* MongoDB
* Retrieval-Augmented Generation (RAG)
* Embeddings
* Hugging Face embedding model
* LLM API integration

## FIR Assistant

* Python
* FastAPI
* Uvicorn
* Pydantic
* SQLite/local storage
* LLM provider integration
* Conversational state management
* Structured fact extraction
* Validation and contradiction detection

---

# Prerequisites

Install the following before starting the project.

### Required

* Git
* Node.js
* npm
* Python 3
* MongoDB access
* A supported LLM API key for the FIR service
* The required Legal Research LLM/API credentials

Verify installations:

```powershell
git --version
node --version
npm --version
python --version
```

---

# Clone the Repository

Clone the combined repository:

```powershell
git clone https://github.com/kritika-d5/ly-legal-research-platform.git
```

Enter the project:

```powershell
cd ly-legal-research-platform
```

The expected structure is:

```text
ly-legal-research-platform/
└── ly-project/
    ├── server/
    ├── web/
    └── fir-service/
```

---

# Environment Variables

There are two independent backend environments.

## FIR environment

Located at:

```text
ly-project/fir-service/.env
```

## LY server environment

Located at:

```text
ly-project/server/.env
```

These files are intentionally **not committed to Git**.

Only the corresponding `.env.example` files are committed.

Never put real API keys into:

* README files
* source code
* `.env.example`
* GitHub commits
* screenshots
* documentation

---

# 1. Configure the FIR Backend

Enter the FIR directory:

```powershell
cd ly-project\fir-service
```

Create the environment file from the example:

```powershell
Copy-Item .env.example .env
```

Open it:

```powershell
notepad .env
```

Configure the required variables using the variable names already provided in:

```text
ly-project/fir-service/.env.example
```

The important LLM configuration follows this pattern:

```env
LLM_PROVIDER=groq
LLM_API_KEY=YOUR_API_KEY_HERE
```

Do **not** literally use `YOUR_API_KEY_HERE`.

Replace it locally with your own API key.

For example:

```env
LLM_PROVIDER=groq
LLM_API_KEY=<your-private-key>
```

Never commit this `.env` file.

### Supported provider configuration

The FIR project supports the provider configuration implemented by its LLM factory.

Use the provider and model settings documented in:

```text
ly-project/fir-service/.env.example
```

and:

```text
ly-project/fir-service/docs/SETUP.md
```

---

# 2. Configure the Legal Research Backend

Enter the server directory:

```powershell
cd ..\server
```

Create the environment file:

```powershell
Copy-Item .env.example .env
```

Open it:

```powershell
notepad .env
```

Fill in the required values using:

```text
ly-project/server/.env.example
```

The LY server requires its configured MongoDB and LLM credentials.

The FIR proxy must point to:

```env
FIR_BACKEND_URL=http://localhost:8000
```

User accounts also need a `JWT_SECRET`, a long random string that signs login
cookies. Generate one and paste it after `JWT_SECRET=`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The server refuses to start without it. Each teammate can use their own; it only
matters that it stays secret. Changing it logs every user out.

The FIR Assistant also needs a **shared secret** so the FIR backend only
accepts requests that came through this server's login check. Generate one value
and put it in **both** files:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

```env
# ly-project/server/.env
FIR_SHARED_SECRET=<the value>

# fir_chatbot/.env
PROXY_SHARED_SECRET=<the same value>
```

If `FIR_SHARED_SECRET` is missing, the FIR Assistant shows "not configured".
If `PROXY_SHARED_SECRET` is left empty, the FIR backend runs in *standalone
mode* (its own UI at http://localhost:8000, no login, every case visible),
which is only meant for Part 1 development and the tests.

The actual MongoDB URI and API credentials must be supplied locally.

Do not put those credentials into Git.

---

# 3. Install Dependencies

## FIR Python dependencies

From:

```text
ly-legal-research-platform/ly-project/fir-service
```

create a virtual environment:

```powershell
python -m venv .venv
```

Activate it:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install dependencies:

```powershell
pip install -r requirements.txt
```

---

## LY Express dependencies

Open a new terminal.

Navigate to:

```powershell
cd C:\path\to\ly-legal-research-platform\ly-project\server
```

Install dependencies:

```powershell
npm install
```

---

## LY React dependencies

Open another terminal.

Navigate to:

```powershell
cd C:\path\to\ly-legal-research-platform\ly-project\web
```

Install dependencies:

```powershell
npm install
```

---

# 4. Start the Application

The application requires **three terminals**.

Start them in the following order.

---

## Terminal 1 — FIR FastAPI

Navigate to:

```powershell
cd C:\path\to\ly-legal-research-platform\ly-project\fir-service
```

Activate the Python environment:

```powershell
.\.venv\Scripts\Activate.ps1
```

Start FastAPI:

```powershell
uvicorn app.main:app --reload
```

FIR should run on:

```text
http://localhost:8000
```

Keep this terminal running.

---

## Terminal 2 — LY Express Server

Open a second PowerShell terminal.

Navigate to:

```powershell
cd C:\path\to\ly-legal-research-platform\ly-project\server
```

Start the Express server:

```powershell
npm run dev
```

The LY backend runs on:

```text
http://localhost:8080
```

Keep this terminal running.

---

## Terminal 3 — React Frontend

Open a third PowerShell terminal.

Navigate to:

```powershell
cd C:\path\to\ly-legal-research-platform\ly-project\web
```

Start the frontend:

```powershell
npm run dev
```

The frontend runs on:

```text
http://localhost:5173
```

---

# 5. Verify That Everything Is Running

All three services should be running simultaneously.

```text
FIR FastAPI       → localhost:8000
LY Express        → localhost:8080
React             → localhost:5173
```

Open the application in your browser:

```text
http://localhost:5173
```

The browser should communicate with the FIR service through:

```text
/api/fir/*
```

on the LY backend.

The React frontend should **not** directly call:

```text
http://localhost:8000
```

for normal FIR application traffic.

---

# Using the Application

Open:

```text
http://localhost:5173
```

The main application contains two independent areas.

```text
HOME
│
├── Legal Research
│   ├── Search
│   ├── Cases
│   ├── Legal Chat
│   └── Citation Graph
│
└── FIR Assistant
    ├── Start FIR
    ├── Conversation
    ├── Review Facts
    ├── Confirm
    └── FIR Output
```

---

# FIR Assistant Flow

The FIR Assistant follows a guided workflow.

## 1. Start FIR

The user starts a new FIR session.

A separate FIR case/session is created.

---

## 2. Conversation

The user communicates with the FIR Assistant.

The FIR service:

* asks relevant follow-up questions
* collects information
* maintains conversational state
* extracts structured facts

---

## 3. Review Facts

The collected information is presented for review.

This allows the user to inspect the information that has been extracted.

---

## 4. Confirm

The user confirms the reviewed information.

---

## 5. FIR Output

The application generates the final FIR-oriented output using the FIR service.

---

# Legal Research Flow

Legal Research remains independent of the FIR Assistant.

Its functionality includes:

```text
Search
Cases
Legal Chat
Citation Graph
```

The existing Legal Research backend continues to handle these operations independently.

---

# User Accounts

Anyone can search and read judgments without an account. Signing up adds a
profile, and lawyers and judges can have their credentials verified.

## Roles

| Role | Sign-up asks for | Status after sign-up |
|---|---|---|
| Citizen | name, email, password | Active |
| Law student / Researcher | + institution, programme | Active |
| Lawyer | + Bar Council enrolment no., state of enrolment | **Pending** until an admin approves |
| Judge | + court, designation | **Pending** until an admin approves |
| Admin | created from the command line only | Active |

A pending lawyer or judge can use everything a citizen can. If a verified
lawyer or judge edits their enrolment number or court details, the account goes
back to pending.

## Creating the first admin

Admins cannot sign up through the website, otherwise anyone could approve
themselves. From `ly-project/server`:

```bash
npm run create-admin -- --email you@example.com --name "Your Name"
```

You are asked for a password at a hidden prompt. If the email already has an
account, that account is promoted to admin and keeps its password. Admins
approve or reject lawyers and judges at `/admin`.

## What an account gives you

* **Saved judgments**: a bookmark on every search result and case page. Each
  saved judgment can carry a private note and sit in any number of folders
  (for example one per client matter). See them at `/saved`.
* **My FIRs**: the FIR Assistant requires login, and each user sees only the
  FIRs they started.
* **Profile**: details, verification status, password change, and a workspace
  summary with counts.

## Citizen features

* **Know your bail rights** (`/rights`, public): a plain-language guide covering
  bailable and non-bailable offences, anticipatory bail, default bail, rights on
  arrest, limits on undertrial detention, and how courts decide. Each topic cites
  the BNSS section and the former CrPC section, and links to the landmark
  judgments in the library. The content lives in
  `ly-project/web/src/content/bailRights.ts` so it can be reviewed without
  touching page code.
* **Free legal help**: NALSA helpline 15100, the online legal-aid application,
  and the directory of state authorities, named after the state in the user's
  profile. Shown on the guide, the FIR Assistant, and after an FIR is confirmed.
* **What may happen next**: after an FIR is confirmed, hand-picked judgments on
  how courts approach bail for that type of accusation. It reads only the fixed
  incident categories and the weapon flag, never names, places or free text, and
  nothing is sent to the server.

## Precedent check (everyone)

Every case page warns when later judgments in the library disagreed with the
judgment, wholly or in part, and names them. Saved judgments carry the same
warning on the Saved page.

## Lawyers' desk

For verified lawyers (and admins). Open it from the account menu.

* **Matters** (`/lawyer/matters`): a matter is one of your folders with client,
  court, case number, stage, next hearing date and the issue it turns on.
  Upcoming hearings come first, with a countdown; each matter shows how many of
  its authorities were later disagreed with.
* **Bail argument builder** (`/lawyer/brief`): for a matter, each authority
  with the paragraphs most relevant to the issue (the court's own words only,
  with their para / page numbers), the precedent check and your note. Tick the
  paragraphs you rely on and copy a formatted list of authorities. Nothing in
  it is machine-written: the paragraphs are retrieved text and the propositions
  are your notes.

## Judges' research desk

For verified judges (and admins). Open it from the account menu, or from the
**Treatment** and **Compare with…** buttons on any case page.

* **Compare two judgments** (`/judge/compare`): two judgments and a legal
  question. The comparison is written only from labelled extracts of the two
  judgments (`[A1]`, `[B2]`…), shown below it; each label is clickable. Any
  quotation not found in those extracts is flagged. The model is instructed never
  to suggest an outcome, and a question like "should I grant bail?" also gets a
  fixed notice from the server before the model answers.
* **Treatment timeline** (`/judge/treatment/:tid`): every later judgment in
  the library that cites a case, in date order, marked relied on / disagreed /
  mixed, with a warning when any disagreed.
* **Research memo** (`/judge/memo`): turns one of your folders (saved judgments
  plus your notes) into a printable memorandum with treatment counts. Nothing
  in it is machine-written. Use **Print or save as PDF**.

## Where account data lives

Accounts, saved judgments and folders are stored in a separate MongoDB
database, `legalplatform_app` (collections `users`, `saved_cases`, `folders`),
on the same Atlas cluster as `bail_rag`. The research data in `bail_rag` is
never written to. Passwords are stored only as bcrypt hashes. The session is an
httpOnly cookie that page JavaScript cannot read.

FIRs stay in the FIR backend's SQLite file. Its `cases` table has an `owner_id`
column holding the account id. The Express proxy sends that id
(`X-User-Id`) together with the shared secret (`X-Proxy-Secret`); the browser
cannot set either header. Someone else's FIR returns 404, so case ids cannot be
probed. Old database files gain the column automatically; FIRs created before
this have no owner and are not shown to anyone in the app.

## Endpoints

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/signup` | anyone (rate-limited) |
| POST | `/api/auth/login` | anyone (rate-limited) |
| POST | `/api/auth/logout` | anyone |
| GET | `/api/auth/me` | anyone (`{ user: null }` when logged out) |
| GET / PATCH | `/api/me/profile` | logged in |
| POST | `/api/me/password` | logged in; logs out other devices |
| GET | `/api/admin/users?status=pending` | admin |
| POST | `/api/admin/users/:id/verify` | admin |
| GET | `/api/me/saved?folder=all\|unfiled\|<id>&q=` | logged in |
| GET | `/api/me/saved/ids` | logged in |
| GET / PUT / DELETE | `/api/me/saved/:tid` | logged in (PUT saves, or updates note / folders) |
| GET / POST | `/api/me/folders` | logged in |
| PATCH / DELETE | `/api/me/folders/:id` | logged in (deleting keeps the judgments saved) |
| any | `/api/fir/*` | logged in; forwarded with the user's id |
| GET | `/api/lawyer/matters` | verified lawyer or admin |
| PUT | `/api/lawyer/matters/:folderId` | verified lawyer or admin (own folders only) |
| GET | `/api/lawyer/brief/:folderId?issue=` | verified lawyer or admin (own folders only) |
| GET | `/api/judge/treatment/:tid` | verified judge or admin |
| POST | `/api/judge/compare` | verified judge or admin (SSE stream) |
| GET | `/api/judge/memo/:folderId` | verified judge or admin (own folders only) |

---

# API Routing

The browser communicates with the LY Express backend.

For FIR functionality:

```text
Browser
   |
   v
React
   |
   v
/api/fir/*
   |
   v
LY Express :8080
   |
   v
FIR FastAPI :8000
```

This proxy architecture prevents the frontend from needing to know the FIR service's internal address.

---

# Data and Privacy Isolation

The FIR and Legal Research systems are intentionally separated.

## FIR data does NOT become Legal Research data

FIR facts are not sent into:

* Legal Research search
* Legal Research RAG
* Legal Chat
* Citation Graph

---

## Separate conversation state

FIR conversations are maintained by the FIR system.

They are not merged with Legal Research chat history.

---

## Separate databases/storage

The FIR backend and Legal Research application maintain their own storage mechanisms.

The systems do not share a database simply because they are presented inside the same frontend.

---

## Independent backend services

FIR is a separate FastAPI service.

LY remains the main application/backend.

If the FIR service is unavailable, Legal Research should remain independently usable.

If Legal Research functionality has an issue, the FIR service remains independently structured.

---

# Troubleshooting

## FIR reports that the LLM API key is empty

You may see an error similar to:

```text
LLM_PROVIDER is 'groq' but LLM_API_KEY is empty
```

Check:

```text
ly-project/fir-service/.env
```

Make sure the relevant variables are configured.

For example:

```env
LLM_PROVIDER=groq
LLM_API_KEY=<your-real-key>
```

Restart the FIR server after changing `.env`:

```text
Ctrl + C
```

then:

```powershell
uvicorn app.main:app --reload
```

Never paste the API key into GitHub or into a support message.

---

## LY reports that MONGO_URI is missing

Check:

```text
ly-project/server/.env
```

Make sure the MongoDB connection variable required by:

```text
ly-project/server/.env.example
```

is configured.

Restart the LY server after changing `.env`.

---

## FIR backend is not running

Check Terminal 1.

It should contain:

```powershell
uvicorn app.main:app --reload
```

and the service should be listening on:

```text
localhost:8000
```

---

## LY server is not running

Check Terminal 2.

Run:

```powershell
npm run dev
```

from:

```text
ly-project/server
```

---

## Frontend is not running

Check Terminal 3.

Run:

```powershell
npm run dev
```

from:

```text
ly-project/web
```

Then open the URL printed by Vite, normally:

```text
http://localhost:5173
```

---

## Port already in use

The expected ports are:

```text
8000 → FIR
8080 → LY Express
5173 → React/Vite
```

If a port is already occupied, identify the process using it and stop the conflicting process before starting the corresponding service.

---

## BGE / Hugging Face model loading problem

The LY server uses an embedding model that may need to be downloaded locally.

The model cache is intentionally excluded from Git.

If the model download is interrupted or corrupted:

1. Stop the LY server.
2. Remove only the corrupted local model/cache.
3. Restart the LY server.
4. Allow the model to download again.
5. Wait for the model to finish loading before testing the application.

Do not commit the downloaded model cache to Git.

---

## FIR proxy problems

If FIR works directly but the React application cannot use it, verify:

```env
FIR_BACKEND_URL=http://localhost:8000
```

in:

```text
ly-project/server/.env
```

Then restart the LY Express server.

The frontend should use:

```text
/api/fir/*
```

rather than directly calling:

```text
localhost:8000
```

---

# Development and Testing

## FIR tests

The FIR backend has a Python test suite under:

```text
ly-project/fir-service/tests/
```

Run:

```powershell
cd ly-project\fir-service
.\.venv\Scripts\Activate.ps1
pytest
```

---

## LY server type checking

From:

```text
ly-project/server
```

run the project's TypeScript check using the script/configuration defined in:

```text
package.json
```

---

## LY web type checking

From:

```text
ly-project/web
```

run the project's TypeScript check using the script/configuration defined in:

```text
package.json
```

---

# Security

## Never commit `.env`

The following files must remain local:

```text
ly-project/fir-service/.env
ly-project/server/.env
```

The repository only contains:

```text
.env.example
```

files.

---

## Never commit API keys

Never put API keys into:

* source code
* README
* `.env.example`
* Git commits
* screenshots
* issue descriptions

Use local `.env` files instead.

---

## If an API key is accidentally committed

Immediately:

1. Revoke/rotate the exposed key through its provider.
2. Replace the local key.
3. Remove the secret from the repository history as appropriate.
4. Verify that the replacement key is stored only in the local environment.

Simply deleting a secret from the latest file does not necessarily remove it from Git history.

---

# Files Intentionally Excluded From Git

The root `.gitignore` prevents local/generated material from being committed.

Examples include:

```text
.env
.env.*
node_modules/
.venv/
__pycache__/
.cache/
huggingface/
*.db
*.sqlite
*.sqlite3
logs/
dist/
build/
coverage/
```

The exact ignore configuration is maintained in:
