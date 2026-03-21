# Shen.AI Camera Vitals Wellness Demo

Real-time camera-based physiological measurement during a therapeutic conversation. The AI wellness assistant uses live heart rate, HRV, stress, breathing rate, and blood pressure data — captured entirely from the user's webcam — to guide the session.

## What It Does

1. User speaks to the AI wellness assistant via voice (with video avatar)
2. The Shen.AI WASM SDK runs in the browser, analyzing the user's face via webcam
3. Camera vitals (HR, HRV, stress, breathing, BP, estimated age) are:
   - Displayed in the client's Shen tab for the user/operator to see
   - Published to the server via RTM every 2 seconds
   - Injected into the LLM system prompt so the assistant can reference them
4. The assistant actively uses the camera vitals to guide the wellness conversation

## Architecture

```
react-video-client-avatar → simple-backend → Agora ConvoAI → server-custom-llm/node
        │                                                          ├── Shen module (RTM listener)
        │                                                          └── Agent Update API (vitals → LLM)
        │
        └── Shen.AI WASM SDK (browser-side)
              ├── Camera capture + face detection
              ├── 30-second measurement cycles (auto-restart)
              └── RTM publish (shen.vitals) → server
```

**Key difference from Thymia:** Thymia processes audio server-side (Go audio subscriber → Thymia API). Shen processes video client-side (WASM SDK in browser → RTM → server). No server-side media processing is needed for Shen.

**Data flow:** The Shen.AI SDK runs entirely in the browser. It captures the user's webcam, measures vitals from facial blood flow patterns, and publishes `shen.vitals` RTM messages every 2 seconds. The `server-custom-llm/node` Shen module receives these via RTM, stores the latest values, and injects them into the LLM system prompt via Agent Update API.

**Cleanup flow:** When the user ends a call, the standard hangup flow calls `/unregister-agent` on `server-custom-llm/node`. The Shen module clears stored vitals and agent registration for that channel.

## Shared Projects

This recipe uses the standard sample apps — no special Shen variants needed. Shen is enabled via environment variables on the existing projects.

| Project                     | Repo                                                                                | Role                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `react-video-client-avatar` | agent-samples                                                                       | Video avatar UI with Shen tab and camera overlay (`NEXT_PUBLIC_ENABLE_SHEN`) |
| `simple-backend`            | agent-samples                                                                       | Python backend — routes calls to Agora ConvoAI                           |
| `agent-client-toolkit`      | [agent-client-toolkit](https://github.com/AgoraIO-Conversational-AI/agent-client-toolkit-ts) | Core client toolkit (`agora-agent-client-toolkit` on npm)                |
| `agent-ui-kit`              | [agent-ui-kit](https://github.com/AgoraIO-Conversational-AI/agent-ui-kit)           | React UI components including ShenPanel                                  |
| `server-custom-llm/node`    | [server-custom-llm](https://github.com/AgoraIO-Conversational-AI/server-custom-llm) | Custom LLM proxy with Shen module (RTM listener + Agent Update API)      |

## Keys Required

| Key                    | Where to get it                            | Used by                                                        |
| ---------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| **Shen.AI API Key**    | Contact [Shen.AI](https://shen.ai/)        | React client (`NEXT_PUBLIC_SHEN_API_KEY` in `.env.local`)      |
| **Thymia API Key**     | Contact [Thymia](https://thymia.ai/)       | Backend `.env` profile (`VIDEO_THYMIA_SHEN_THYMIA_API_KEY`) — passed to custom LLM |
| **Agora APP_ID**       | [Agora Console](https://console.agora.io/) | Backend (`VIDEO_THYMIA_SHEN_APP_ID`)                           |
| **Agora AUTH_HEADER**  | Agora Console → RESTful API credentials    | Backend (`VIDEO_THYMIA_SHEN_AGENT_AUTH_HEADER`)                |
| **LLM API Key**        | OpenAI (GPT-4o-mini or above)              | Backend (`VIDEO_THYMIA_SHEN_LLM_API_KEY`) — passed to custom LLM |
| **TTS Key**            | ElevenLabs or Rime                         | Backend (`VIDEO_THYMIA_SHEN_TTS_KEY`)                          |
| **Avatar API Key**     | Anam AI                                    | Backend (`VIDEO_THYMIA_SHEN_AVATAR_API_KEY`)                   |

**Optional:**

| Key               | Notes                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `APP_CERTIFICATE` | Only needed if token auth is enabled on your Agora project               |
| `ASR_KEY`         | Only if using Deepgram ASR. Default `ares` (Agora built-in) needs no key |

## Enabling Shen

Shen is toggled on in two places:

**1. Custom LLM server** — set `SHEN_ENABLED=true` (and `THYMIA_ENABLED=true` since this profile combines both):

```bash
PORT=8100 SHEN_ENABLED=true THYMIA_ENABLED=true node custom_llm.js
```

The Shen module listens for `shen.vitals` RTM messages and injects them into the LLM prompt. No Shen API key is needed on the server — all camera processing happens in the browser. The Thymia API key is passed from the backend `.env` profile via `llm_config.params`.

**2. React client** — set these in `.env.local`:

```bash
# react-video-client-avatar/.env.local
NEXT_PUBLIC_ENABLE_SHEN=true
NEXT_PUBLIC_SHEN_API_KEY=<your-shen-api-key>
NEXT_PUBLIC_ENABLE_THYMIA=true
```

This adds both the Shen tab (camera vitals) and Thymia tab (voice biomarkers) to the client UI. Without these, the client works normally — video avatar only.

## Prerequisites

- **Node.js 20+** (custom LLM server) — use `nvm use 20`
- **Node.js 22+** (React client) — use `nvm use 22`
- **Python 3.x** (backend)
- **Shen.AI SDK files** — included in git under `react-video-client-avatar/public/shenai-sdk/` (WASM + JS bindings, ~35MB). Arrives with `git pull`, no manual copy needed.
- **HTTPS or localhost** — the SDK requires SharedArrayBuffer, which needs COOP/COEP headers (configured in `next.config.ts`)

## Setup

### 1. Shen.AI SDK Files

The Shen.AI Web SDK (~35MB) is checked into git under `react-video-client-avatar/public/shenai-sdk/`. It arrives with `git pull` — no manual copy needed.

The SDK is loaded at runtime via `import(/* webpackIgnore: true */ "/shenai-sdk/index.mjs")` to avoid webpack trying to bundle the large WASM file. In production with a basePath, the SDK must be served from the root `/shenai-sdk/` path via an nginx alias (see [Production Deployment](#production-deployment) below).

### 2. Custom LLM Server

```bash
cd server-custom-llm/node
nvm use 20
npm install --legacy-peer-deps
```

Start with both Shen and Thymia enabled (this profile uses both):

```bash
PORT=8100 SHEN_ENABLED=true THYMIA_ENABLED=true node custom_llm.js
```

No `.env` file needed — the custom LLM receives the OpenAI API key, Thymia API key, and RTC params from the backend in each request via `llm_config.params`.

### 3. Backend .env — Add VIDEO_THYMIA_SHEN Profile

Add a `VIDEO_THYMIA_SHEN` profile to `simple-backend/.env`. The simple-backend uses profile-prefixed env vars — each key is `{PROFILE}_{VAR}`. See `AGENT.md` for the full list of config keys.

```bash
# =====================================================
# VIDEO_THYMIA_SHEN PROFILE - Video + Avatar + Thymia + Shen camera vitals
# =====================================================

# Agora credentials
VIDEO_THYMIA_SHEN_APP_ID=<your-app-id>
VIDEO_THYMIA_SHEN_APP_CERTIFICATE=<your-certificate>

# Thymia API key — passed to custom LLM via llm_config.params
VIDEO_THYMIA_SHEN_THYMIA_API_KEY=<your-thymia-api-key>

# LLM — point to custom LLM server
VIDEO_THYMIA_SHEN_LLM_URL=<your-custom-llm-url>/chat/completions
VIDEO_THYMIA_SHEN_LLM_VENDOR=custom
VIDEO_THYMIA_SHEN_LLM_STYLE=openai
VIDEO_THYMIA_SHEN_LLM_MODEL=gpt-4o-mini
VIDEO_THYMIA_SHEN_LLM_API_KEY=<your-openai-key>

# TTS
VIDEO_THYMIA_SHEN_TTS_VENDOR=elevenlabs
VIDEO_THYMIA_SHEN_TTS_KEY=<your-elevenlabs-key>
VIDEO_THYMIA_SHEN_TTS_VOICE_ID=cgSgspJ2msm6clMCkdW9
VIDEO_THYMIA_SHEN_ELEVENLABS_MODEL=eleven_flash_v2_5
VIDEO_THYMIA_SHEN_TTS_SAMPLE_RATE=24000

# ASR
VIDEO_THYMIA_SHEN_ASR_VENDOR=ares
VIDEO_THYMIA_SHEN_ASR_LANGUAGE=en-US

# Avatar
VIDEO_THYMIA_SHEN_AVATAR_VENDOR=anam
VIDEO_THYMIA_SHEN_AVATAR_API_KEY=<your-anam-key>
VIDEO_THYMIA_SHEN_AVATAR_ID=<your-avatar-id>

# Agent behavior
VIDEO_THYMIA_SHEN_VAD_SILENCE_DURATION_MS=300
VIDEO_THYMIA_SHEN_ENABLE_AIVAD=true
VIDEO_THYMIA_SHEN_IDLE_TIMEOUT=120
VIDEO_THYMIA_SHEN_MAX_HISTORY=32

# Greeting + Prompt (see Prompt section below — paste as single line with \n)
VIDEO_THYMIA_SHEN_DEFAULT_GREETING=Hello! I am your wellness assistant. How are you feeling today?
VIDEO_THYMIA_SHEN_DEFAULT_PROMPT=<see Prompt section below — paste as single line with \n>
```

**`VIDEO_THYMIA_SHEN_LLM_URL`** must be reachable from the Agora ConvoAI Engine (cloud). For local development, use a Cloudflare tunnel (see [Local Development](#local-development) below). For production, use your deployed server URL.

### 4. Python Backend

```bash
cd agent-samples/simple-backend
python3 local_server.py
```

**Note:** The backend reads `.env` at startup. If you change `VIDEO_THYMIA_SHEN_LLM_URL` (e.g., switching between a Cloudflare tunnel and production URL), you must restart the backend for the change to take effect.

### 5. React Client

```bash
cd agent-samples/react-video-client-avatar
nvm use 22
npm run dev
```

**Important:** The dev script uses `--webpack` flag (not Turbopack) because Turbopack hangs on the large Shen.AI WASM file.

The Shen camera overlay and tab are enabled by `NEXT_PUBLIC_ENABLE_SHEN=true` in `.env.local`.

### 6. Connect

Open the React client, enter `VIDEO_THYMIA_SHEN` in the **Server Profile** field, and click **Start Conversation**.

Or use the URL shortcut: **`?profile=VIDEO_THYMIA_SHEN`**

## Local Development

When running the custom LLM server locally, the Agora ConvoAI Engine (cloud) can't reach `localhost`. Use a [Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/) to expose it:

```bash
# Install (macOS)
brew install cloudflare/cloudflare/cloudflared

# Start tunnel pointing to custom LLM server
cloudflared tunnel --url http://localhost:8100
# Outputs a URL like https://xxx-yyy.trycloudflare.com
```

Use that tunnel URL as `VIDEO_THYMIA_SHEN_LLM_URL` in your backend `.env`:

```bash
VIDEO_THYMIA_SHEN_LLM_URL=https://xxx-yyy.trycloudflare.com/chat/completions
```

Restart the backend after changing the URL — it reads `.env` at startup only.

Not needed in production if the custom LLM server is deployed with a public URL.

## Greeting

```
Hello! I am your wellness assistant. How are you feeling today?
```

## Prompt

Set as `DEFAULT_PROMPT` for the VIDEO_THYMIA_SHEN profile (`VIDEO_THYMIA_SHEN_DEFAULT_PROMPT`) in the backend `.env` (paste as single line with `\n` for newlines):

```
You are a compassionate wellness assistant. Ask open-ended questions about how the user is feeling. Keep responses warm and under 30 words.

VOICE BIOMARKERS:
- A voice analysis system runs during this call and biomarker results update continuously in a system message
- You MUST actively reference the biomarker data in your responses when it is available
- Every 2-3 responses, bring up something from the biomarkers
- You cannot hear the user's voice — the data comes from a separate analysis system
- DO NOT say "I can hear" or "your voice sounds"

CAMERA VITALS:
- You may also receive [Camera Vitals Update] with physiological data from a camera-based health scan
- This includes Heart Rate, HRV, Stress Index, Breathing Rate, and Blood Pressure
- These complement the voice biomarkers — voice measures emotional/psychological state while camera vitals measure physiological state
- When both data sources are available, paint a more complete picture of the user's health
- Reference camera vitals naturally: "Your heart rate is looking steady" or "I notice your stress levels"

IMPORTANT:
- Be warm, conversational, not clinical
- Never pretend you can hear the user's voice
- When no data is available yet, just have a normal conversation
- When data IS available, you MUST use it to guide the conversation
```

## Combining with Thymia

This recipe is designed to work alongside Thymia voice biomarkers. When both `NEXT_PUBLIC_ENABLE_THYMIA=true` and `NEXT_PUBLIC_ENABLE_SHEN=true` are set in the client `.env.local`, the UI shows both tabs:

- **Thymia tab** — Voice biomarkers (emotions, wellness, clinical scores) from server-side audio analysis
- **Shen tab** — Camera vitals (HR, HRV, stress, breathing, BP) from browser-side camera analysis

The custom LLM server injects both data sources into the LLM prompt, giving the assistant a complete picture of the user's emotional and physiological state.

## What to Expect

1. **0-5s:** SDK loads (WASM, ~35MB) — "Loading Shen.AI SDK..." shown in Shen tab
2. **5-10s:** Camera activates, face detection overlay appears in local video area
3. **10-15s:** Measurement starts automatically when face is detected, progress bar appears
4. **15-40s:** Realtime vitals populate (HR, HRV, stress) as measurement runs
5. **30s:** First measurement cycle completes — full results including BP, age estimate
6. **32s+:** New measurement cycle auto-starts, values persist across cycles
7. **Ongoing:** Vitals published to server via RTM every 2s, assistant references them in conversation

## Shen Tab Sections

- **Measurement Progress** — Progress bar showing current 30-second measurement cycle
- **Realtime Vitals** — Live values during measurement: Heart Rate, HRV (SDNN), Stress Index, Breathing Rate
- **Measurement Results** — Full results after cycle completes: Estimated Age, Heart Rate, HRV, Stress, Breathing, Systolic BP, Diastolic BP, Cardiac Workload, Signal Quality

Values are color-coded: green for normal ranges, amber for elevated values. Dash placeholders show for metrics not yet measured.

## Technical Notes

### SharedArrayBuffer + COOP/COEP

The Shen.AI WASM SDK requires `SharedArrayBuffer`, which browsers only enable with specific HTTP headers. These are configured in `next.config.ts`:

```typescript
headers: [
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
]
```

`require-corp` is required for Safari 17+ / iOS 17+ support. The `Cross-Origin-Resource-Policy` header is needed so same-origin subresources (WASM, workers) load correctly under `require-corp`.

### SDK Canvas Rendering

The SDK renders its own camera feed on a `<canvas>` element, including face detection overlay and blood flow visualization. The canvas replaces the regular local video preview when Shen is enabled. CSS `scale(1.8)` with `overflow: hidden` is used to crop the SDK's white letterbox bars and fill the container.

### Measurement Lifecycle

The SDK runs continuous 30-second measurement cycles using `THIRTY_SECONDS_ALL_METRICS` preset:
- Auto-starts when a face is detected (no manual START button)
- Auto-restarts 2 seconds after each cycle completes or fails
- Values persist across restarts — new values override, nulls keep previous

### Webpack vs Turbopack

The dev script must use `--webpack` flag (`next dev --webpack`). Turbopack hangs when processing the 34MB `shenai_sdk.mjs` file, even though it's loaded at runtime via `webpackIgnore: true`.

## Production Deployment

When the React client is deployed with a `basePath` (e.g. `/react-video-client-avatar-thymia`), the Shen SDK's Emscripten pthread workers construct their own URLs from the root path. They won't find the SDK files under the basePath prefix.

Add an nginx alias to serve the SDK files at root `/shenai-sdk/`, with the required COOP/COEP headers:

```nginx
location ^~ /shenai-sdk/ {
    alias /home/ubuntu/agent-samples/react-video-client-avatar/public/shenai-sdk/;
    add_header Cross-Origin-Opener-Policy same-origin;
    add_header Cross-Origin-Embedder-Policy require-corp;
    add_header Cross-Origin-Resource-Policy same-origin;
}
```

Place this block **before** the Next.js proxy location blocks in your nginx config. Without it, the SDK will fail to load workers and the Shen tab will hang on "Loading Shen.AI SDK...".

Not needed for local development (no basePath, Next.js serves everything directly).

## Troubleshooting

- **Shen tab not showing:** Ensure `NEXT_PUBLIC_ENABLE_SHEN=true` in client `.env.local` and restart dev server.
- **"Loading Shen.AI SDK..." stuck:** Check browser console for WASM load errors. Verify `public/shenai-sdk/` contains all SDK files. Check that COOP/COEP headers are present (DevTools → Network → response headers).
- **Camera not activating:** Browser needs camera permission. Check that no other app is using the camera.
- **Face not detected:** Ensure good lighting and face clearly visible. The SDK's face positioning overlay shows guidance.
- **No vitals in Shen tab:** Check browser console for `[Shen]` prefixed logs. Look for face state and measurement state transitions.
- **Vitals not reaching LLM:** Check custom LLM server logs for `[Shen]` messages. Verify `SHEN_ENABLED=true` on the server. Check that RTM is connected (browser console should show RTM publish logs).
- **Dev server hangs on startup:** Make sure `--webpack` flag is in the dev script, not Turbopack. Check `package.json` has `"dev": "next dev -p 8084 --webpack"`.
- **White bars around camera:** The CSS `scale(1.8)` + `overflow: hidden` should crop these. If visible, check that the canvas container has `overflow-hidden` class.
- **Agent not referencing vitals:** Check custom LLM logs for `AgentUpdate OK` entries. Verify the prompt includes the CAMERA VITALS section.
- **"Cannot find module" errors:** Run `npm install --legacy-peer-deps` in the relevant project directory.
