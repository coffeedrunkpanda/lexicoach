"""
Local Flask server for Agora Conversational AI

This is a thin wrapper that:
1. Loads .env file into environment
2. Extracts parameters from HTTP request
3. Calls core business logic (same as Lambda!)
4. Returns HTTP JSON response
"""

from dotenv import load_dotenv
load_dotenv(override=True)  # Load .env file before importing core modules, override existing env vars

import json
import threading
import urllib.request
from datetime import datetime

from flask import Flask, request, jsonify
from core.config import initialize_constants
from core.tokens import build_token_with_rtm
from core.agent import create_agent_payload, send_agent_to_channel, hangup_agent, build_auth_header
from core.utils import generate_random_channel
import copy
import re

app = Flask(__name__)

# Keys in agent payload that contain secrets and must be redacted
_SENSITIVE_KEYS = re.compile(
    r'(key|token|api_key|secret|certificate|password|authorization|credentials)',
    re.IGNORECASE
)


def _redact_payload(obj):
    """Deep-clone a payload and redact sensitive fields so no secrets leak to clients."""
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            if _SENSITIVE_KEYS.search(k) and isinstance(v, str) and len(v) > 8:
                result[k] = v[:4] + '***' + v[-4:]
            else:
                result[k] = _redact_payload(v)
        return result
    elif isinstance(obj, (list, tuple)):
        return [_redact_payload(item) for item in obj]
    return obj


def _duration_label(messages):
    timestamps = [
        m.get("timestamp")
        for m in messages
        if isinstance(m, dict) and isinstance(m.get("timestamp"), (int, float))
    ]
    if len(timestamps) < 2:
        return "under 1 second"
    duration_ms = max(timestamps) - min(timestamps)
    if duration_ms < 1000:
        return "under 1 second"
    total_seconds = int(duration_ms / 1000)
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    if minutes == 0:
        return f"{seconds}s"
    return f"{minutes}m {seconds}s"


def _build_transcript_text(messages, agent_uid):
    cleaned = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        text = (m.get("text") or "").strip()
        if not text:
            continue
        cleaned.append({
            "uid": str(m.get("uid", "")),
            "text": text,
            "timestamp": m.get("timestamp")
        })

    cleaned.sort(key=lambda x: x.get("timestamp") or 0)

    lines = []
    for m in cleaned:
        role = "agent" if agent_uid and m["uid"] == str(agent_uid) else "user"
        lines.append(f"{role}: {m['text']}")
    return cleaned, "\n".join(lines)


def _call_llm_for_report(constants, transcript_text):
    llm_url = (constants.get("LLM_URL") or "").strip()
    if not llm_url:
        raise ValueError("LLM_URL is not configured for report generation")

    llm_model = constants.get("LLM_MODEL", "gpt-4o-mini")
    llm_api_key = (constants.get("LLM_API_KEY") or "").strip()

    system_prompt = (
        "You are an expert CEFR language tutor evaluator. "
        "Generate a concise structured post-session report from the transcript. "
        "Return ONLY valid JSON. "
        "Use these metric categories exactly: Engagement, Clarity, Conversation Flow, Speaking Confidence. "
        "Each metric score must be an integer 1-10 with a short rationale. "
        "Evaluate ONLY the learner/user (never evaluate the agent). "
        "For Conversation Flow, assess learner proactiveness vs passiveness: initiative, follow-up questions, "
        "topic development, and willingness to sustain the exchange."
    )

    user_prompt = (
        "Analyze this conversation transcript and return JSON with this exact shape:\n"
        "{\n"
        '  "overview": "string",\n'
        '  "metrics": [{"name":"Engagement|Clarity|Conversation Flow|Speaking Confidence","score":1,"rationale":"string"}],\n'
        '  "whatWentWell": ["string"],\n'
        '  "improvements": ["string"],\n'
        '  "nextSessionGoals": ["string"],\n'
        '  "evidence": ["string"]\n'
        "}\n"
        "Rules:\n"
        "- Provide exactly 4 metrics, one per required category in the listed order.\n"
        "- Keep text practical, encouraging, and specific.\n"
        "- Ground evidence in transcript content.\n"
        "- Keep all feedback user-centered; do not critique agent quality.\n"
        "- For Conversation Flow, explicitly comment on learner proactiveness vs passiveness.\n\n"
        f"Transcript:\n{transcript_text}"
    )

    payload = {
        "model": llm_model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    req = urllib.request.Request(
        llm_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {llm_api_key}"} if llm_api_key else {})
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
        body = json.loads(raw)

    content = (
        body.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    if not content:
        raise ValueError("LLM returned empty report content")

    report = json.loads(content)
    return report


@app.after_request
def after_request(response):
    """Add CORS headers to all responses"""
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response


@app.route('/start-agent', methods=['GET'])
def start_agent():
    """
    Start an agent and return connection details.

    Query Parameters:
        channel: Channel name (auto-generated if not provided)
        profile: Profile name for env var overrides
        connect: "true" (default) to start agent, "false" for token-only
        pipeline_id: Agent Builder pipeline ID (overrides inline LLM/TTS/ASR config)
        debug: Include debug info in response

    Examples:
        GET /start-agent?channel=test
        GET /start-agent?channel=test&profile=sales
        GET /start-agent?connect=false
    """
    # Get query parameters from HTTP request
    query_params = request.args.to_dict()

    # Get optional profile parameter (normalize to lowercase)
    profile = query_params.get('profile')
    if profile:
        profile = profile.lower()

    # Initialize constants with profile
    constants = initialize_constants(profile)

    # Get or generate channel
    channel = query_params.get('channel') or generate_random_channel(10)

    # Check if token-only mode
    token_only_mode = query_params.get('connect', 'true').lower() == 'false'

    # Check if avatar mode is enabled (avatar vendor determines mode)
    avatar_vendor = constants.get("AVATAR_VENDOR")

    # Use regular APP_ID (profile-aware, so AVATAR_APP_ID if profile=avatar)
    app_id_to_use = constants["APP_ID"]

    # Check if we have APP_CERTIFICATE for token generation
    has_certificate = bool(constants["APP_CERTIFICATE"] and constants["APP_CERTIFICATE"].strip())

    # Generate tokens (RTM UID includes channel for uniqueness, like agent does)
    user_rtm_uid = f"{constants['USER_UID']}-{channel}"
    if has_certificate:
        user_token_data = build_token_with_rtm(channel, constants["USER_UID"], constants, rtm_uid=user_rtm_uid)
        agent_video_token_data = build_token_with_rtm(channel, constants["AGENT_VIDEO_UID"], constants)
    else:
        user_token_data = {"token": constants["APP_ID"], "uid": constants["USER_UID"]}
        agent_video_token_data = {"token": constants["APP_ID"], "uid": constants["AGENT_VIDEO_UID"]}

    # Token-only mode response
    if token_only_mode:
        return jsonify({
            "audio_scenario": "10",
            "token": user_token_data["token"],
            "uid": user_token_data["uid"],
            "channel": channel,
            "appid": app_id_to_use,
            "user_token": user_token_data,
            "agent_video_token": agent_video_token_data,
            "agent": {
                "uid": constants["AGENT_UID"]
            },
            "agent_rtm_uid": f"{constants['AGENT_UID']}-{channel}",
            "user_rtm_uid": user_rtm_uid,
            "enable_string_uid": False,
            "token_generation_method": "v007 tokens with RTC+RTM services" if has_certificate else "APP_ID only (no APP_CERTIFICATE)",
            "agent_response": {
                "status_code": 200,
                "response": {"message": "Token-only mode: tokens generated successfully", "mode": "token_only", "connect": False},
                "success": True
            }
        })

    # Normal flow: create and send agent
    try:
        agent_payload = create_agent_payload(
            channel=channel,
            constants=constants,
            query_params=query_params,
            agent_video_token=agent_video_token_data["token"]
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Send agent to channel
    agent_response = send_agent_to_channel(channel, agent_payload, constants)

    # Register agent_id with custom LLM (non-blocking)
    if agent_response.get("success"):
        try:
            resp_body = json.loads(agent_response.get("response", "{}"))
            agent_id = resp_body.get("agent_id")
            if agent_id:
                llm_url = constants.get("LLM_URL", "")
                # Derive base URL from LLM_URL (strip /chat/completions path)
                if "/chat/completions" in llm_url:
                    llm_base = llm_url.rsplit("/chat/completions", 1)[0]
                else:
                    llm_base = llm_url.rstrip("/")
                register_url = f"{llm_base}/register-agent"
                # Extract custom LLM params (tokens, UIDs, API keys)
                # so custom-llm can start audio subscriber + Thymia immediately
                llm_params = (agent_payload.get("properties", {}).get("llm", {}).get("params", {}))
                register_payload = {
                    "app_id": app_id_to_use,
                    "channel": channel,
                    "agent_id": agent_id,
                    "auth_header": build_auth_header(constants),
                    "agent_endpoint": constants.get("AGENT_ENDPOINT",
                        "https://api.agora.io/api/conversational-ai-agent/v2/projects"),
                    "prompt": constants.get("DEFAULT_PROMPT", ""),
                    "user_uid": llm_params.get("user_uid"),
                    "subscriber_token": llm_params.get("subscriber_token"),
                    "rtm_token": llm_params.get("rtm_token"),
                    "rtm_uid": llm_params.get("rtm_uid"),
                    "thymia_api_key": llm_params.get("thymia_api_key"),
                }
                def _register():
                    try:
                        req_data = json.dumps(register_payload).encode('utf-8')
                        req_obj = urllib.request.Request(
                            register_url, data=req_data,
                            headers={'Content-Type': 'application/json'},
                            method='POST'
                        )
                        with urllib.request.urlopen(req_obj, timeout=5) as resp:
                            print(f"[RegisterAgent] POST {register_url} → {resp.status} agent_id={agent_id}")
                    except Exception as e:
                        print(f"[RegisterAgent] FAILED POST {register_url}: {e}")
                threading.Thread(target=_register, daemon=True).start()
        except Exception as e:
            print(f"[RegisterAgent] Error parsing agent response: {e}")

    # Build response
    response_data = {
        "audio_scenario": "10",
        "token": user_token_data["token"],
        "uid": user_token_data["uid"],
        "channel": channel,
        "appid": app_id_to_use,
        "user_token": user_token_data,
        "agent_video_token": agent_video_token_data,
        "agent": {
            "uid": constants["AGENT_UID"]
        },
        "agent_rtm_uid": f"{constants['AGENT_UID']}-{channel}",
        "user_rtm_uid": user_rtm_uid,
        "enable_string_uid": False,
        "agent_response": agent_response
    }

    # Add debug info if requested (redact secrets)
    if 'debug' in query_params:
        response_data["debug"] = {
            "agent_payload": _redact_payload(agent_payload),
            "channel": channel,
            "api_url": f"{constants.get('AGENT_ENDPOINT', 'https://api.agora.io/api/conversational-ai-agent/v2/projects')}/{constants['APP_ID']}/join",
            "token_generation_method": "v007 tokens with RTC+RTM services" if has_certificate else "APP_ID only (no APP_CERTIFICATE)",
            "has_app_certificate": has_certificate
        }

    return jsonify(response_data)


@app.route('/hangup-agent', methods=['GET'])
def hangup_agent_route():
    """
    Disconnect an agent from the channel.

    Query Parameters:
        agent_id: The agent ID to disconnect (required)
        profile: Profile name for env var overrides

    Example:
        GET /hangup-agent?agent_id=abc123
    """
    # Get query parameters
    query_params = request.args.to_dict()

    # Get optional profile parameter (normalize to lowercase)
    profile = query_params.get('profile')
    if profile:
        profile = profile.lower()

    # Initialize constants
    constants = initialize_constants(profile)

    # Check for required agent_id
    if 'agent_id' not in query_params:
        return jsonify({"error": "Missing agent_id parameter"}), 400

    agent_id = query_params['agent_id']
    hangup_response = hangup_agent(agent_id, constants)

    # Unregister agent from custom LLM (non-blocking) to clean up audio subscriber + Thymia
    try:
        llm_url = constants.get("LLM_URL", "")
        if "/chat/completions" in llm_url:
            llm_base = llm_url.rsplit("/chat/completions", 1)[0]
        else:
            llm_base = llm_url.rstrip("/")
        unregister_url = f"{llm_base}/unregister-agent"
        channel = query_params.get('channel', '')
        app_id = constants["APP_ID"]
        unregister_payload = {"app_id": app_id, "channel": channel, "agent_id": agent_id}
        def _unregister():
            try:
                req_data = json.dumps(unregister_payload).encode('utf-8')
                req_obj = urllib.request.Request(
                    unregister_url, data=req_data,
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                with urllib.request.urlopen(req_obj, timeout=5) as resp:
                    print(f"[UnregisterAgent] POST {unregister_url} → {resp.status} agent_id={agent_id}")
            except Exception as e:
                print(f"[UnregisterAgent] FAILED POST {unregister_url}: {e}")
        threading.Thread(target=_unregister, daemon=True).start()
    except Exception as e:
        print(f"[UnregisterAgent] Error: {e}")

    return jsonify({
        "agent_response": hangup_response
    })


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "ok", "service": "agora-convoai-backend"})


@app.route('/generate-report', methods=['POST'])
def generate_report():
    """
    Generate a structured tutor report from conversation transcript using LLM.

    Request JSON:
      {
        "profile": "VIDEO",
        "agent_uid": "100",
        "messages": [{"uid":"101","text":"...","timestamp":123}]
      }
    """
    payload = request.get_json(silent=True) or {}
    profile = (payload.get("profile") or "VIDEO").lower()
    messages = payload.get("messages") or []
    agent_uid = payload.get("agent_uid")

    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "messages array is required"}), 400

    constants = initialize_constants(profile)
    cleaned, transcript_text = _build_transcript_text(messages, agent_uid)
    if not cleaned or not transcript_text.strip():
        return jsonify({"error": "no usable transcript messages found"}), 400

    user_count = len([m for m in cleaned if not (agent_uid and m["uid"] == str(agent_uid))])
    agent_count = len(cleaned) - user_count

    try:
        llm_report = _call_llm_for_report(constants, transcript_text)
    except Exception as e:
        return jsonify({"error": f"llm_report_failed: {str(e)}"}), 502

    response = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "turns": len(cleaned),
        "userMessages": user_count,
        "agentMessages": agent_count,
        "duration": _duration_label(cleaned),
        "overview": llm_report.get("overview", ""),
        "metrics": llm_report.get("metrics", []),
        "whatWentWell": llm_report.get("whatWentWell", []),
        "improvements": llm_report.get("improvements", []),
        "nextSessionGoals": llm_report.get("nextSessionGoals", []),
        "evidence": llm_report.get("evidence", []),
    }
    return jsonify(response)


if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 8082))
    print("=" * 60)
    print("Agora ConvoAI Local Server")
    print("=" * 60)
    print(f"Starting Flask server on http://0.0.0.0:{port}")
    print("\nEndpoints:")
    print("  GET /start-agent?channel=test")
    print("  GET /hangup-agent?agent_id=xxx")
    print("  POST /generate-report")
    print("  GET /health")
    print("\nPress CTRL+C to stop")
    print("=" * 60)
    app.run(host='0.0.0.0', port=port, debug=True)
