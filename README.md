# LexiCoach

LexiCoach is a real-time vocabulary practice AI agent built for the Preply hackathon on top of Agora Conversational AI. It uses a video avatar experience where the learner practices target words in natural conversation.

## Project Purpose

LexiCoach helps learners actively use vocabulary, not just memorize it.

- Uses a learner knowledge base (level/theme/known words) to steer practice
- Runs a live spoken conversation with an AI tutor
- Focuses each session on targeted vocabulary usage
- Gives corrective feedback when usage is incorrect and asks the learner to retry naturally

## How This Project Was Built (Codex)

This repository was assembled and configured through Codex-driven development.

- Started from `AgoraIO-Conversational-AI/agent-samples`
- Read and followed `AGENT.md` setup guidance
- Configured the `VIDEO` profile in `simple-backend/.env`
- Kept only the avatar path (`react-video-client-avatar` + `simple-backend`)
- Updated defaults for LexiCoach behavior (including the video prompt)
- Updated docs to use Codex-oriented setup language

## Quickstart

### Prerequisites

- Node.js 20+
- Python 3.x
- Agora App ID + App Certificate
- LLM key (OpenAI-compatible)
- TTS and avatar credentials (for your chosen providers)

### 1) Configure Backend Environment

```bash
cd simple-backend
cp .env.example .env
```

Edit `.env` and set the `VIDEO_*` values you need (minimum: Agora + LLM + TTS + Avatar).

### 2) Start Backend

```bash
cd /Users/anne/Documents/Preply-hackaton/agent-samples/simple-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-local.txt
python3 -u local_server.py
```

Backend runs on `http://localhost:8082`.

### 3) Start Frontend (Avatar Client)

In a second terminal:

```bash
cd /Users/anne/Documents/Preply-hackaton/agent-samples/react-video-client-avatar
npm install --legacy-peer-deps
npm run dev
```

Frontend runs on `http://localhost:8084`.

### 4) Use The App

- Open `http://localhost:8084`
- Click **Start Call**
- Speak with the avatar agent
- End and restart call after prompt/env changes so new settings apply

## Tech Stack

- Frontend: Next.js 16, React, TypeScript, Tailwind CSS
- Realtime media/data: Agora RTC + Agora RTM
- Agent integration: `agora-agent-client-toolkit`, `@agora/agent-ui-kit`
- Backend: Python + Flask (`simple-backend`)
- AI orchestration: Agora Conversational AI Agent API
- LLM/TTS/Avatar providers: configured via environment (`VIDEO_*` profile)

## Project Structure

- `react-video-client-avatar/` — main web client with avatar UI
- `simple-backend/` — local backend for token generation + agent start/stop
- `AGENT.md` — detailed implementation/configuration guide

## Notes

- Secrets are stored locally in `simple-backend/.env` and ignored by git
- The backend should be run with `python3 -u` for unbuffered logs
