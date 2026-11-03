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
Updated-ly-project/
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
git clone https://github.com/manasalganti3005/Updated-ly-project.git
```

Enter the project:

```powershell
cd Updated-ly-project
```

The expected structure is:

```text
Updated-ly-project/
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

The actual MongoDB URI and API credentials must be supplied locally.

Do not put those credentials into Git.

---

# 3. Install Dependencies

## FIR Python dependencies

From:

```text
Updated-ly-project/ly-project/fir-service
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
cd C:\path\to\Updated-ly-project\ly-project\server
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
cd C:\path\to\Updated-ly-project\ly-project\web
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
cd C:\path\to\Updated-ly-project\ly-project\fir-service
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
cd C:\path\to\Updated-ly-project\ly-project\server
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
cd C:\path\to\Updated-ly-project\ly-project\web
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
