"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Settings,
  Phone,
  PhoneOff,
  SendHorizontal,
} from "lucide-react";
import { useAgoraVideoClient } from "@/hooks/useAgoraVideoClient";
import { useAudioVisualization } from "@/hooks/useAudioVisualization";
import { IconButton } from "@agora/agent-ui-kit";
import { Conversation, ConversationContent } from "@agora/agent-ui-kit";
import { Message, MessageContent } from "@agora/agent-ui-kit";
import { Response } from "@agora/agent-ui-kit";
import { AvatarVideoDisplay, LocalVideoPreview } from "@agora/agent-ui-kit";
import { VideoGrid, MobileTabs } from "@agora/agent-ui-kit";
import { SettingsDialog } from "@agora/agent-ui-kit";
import { ShenPanel } from "@agora/agent-ui-kit";
import { ThymiaPanel, useThymia } from "@agora/agent-ui-kit/thymia";
import { useShenai } from "@/hooks/useShenai";
import AgoraRTC from "agora-rtc-sdk-ng";
import { ThemeToggle } from "./ThemeToggle";

const DEFAULT_BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8082";
const DEFAULT_PROFILE = process.env.NEXT_PUBLIC_DEFAULT_PROFILE || "VIDEO";
const THYMIA_ENABLED = process.env.NEXT_PUBLIC_ENABLE_THYMIA === "true";
const SHEN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SHEN === "true";
const SHEN_API_KEY = process.env.NEXT_PUBLIC_SHEN_API_KEY || "";

const SENSITIVE_KEYS = [
  "api_key",
  "key",
  "token",
  "adc_credentials_string",
  "subscriber_token",
  "rtm_token",
  "ticket",
];

type ConversationMessage = {
  uid: string;
  text: string;
  timestamp?: number;
};

type AssessmentMetric = {
  name: string;
  score: number;
  rationale: string;
};

type TutorReport = {
  generatedAt: string;
  overview: string;
  turns: number;
  userMessages: number;
  agentMessages: number;
  duration: string;
  metrics: AssessmentMetric[];
  whatWentWell: string[];
  improvements: string[];
  nextSessionGoals: string[];
  evidence: string[];
  thymiaInsights?: {
    confidencePct: number | null;
    stressPct: number | null;
    fatiguePct: number | null;
    distressPct: number | null;
    safetyAlert: string | null;
    speechSeconds: number;
    triggerSeconds: number;
    summary: string;
  };
};

type ThymiaSnapshot = {
  biomarkers: Record<string, number | null>;
  wellness: Record<string, number | null>;
  clinical: Record<string, number | null>;
  progress: Record<
    string,
    { speech_seconds: number; trigger_seconds: number; processing: boolean }
  >;
  safety: Record<string, unknown>;
};

const REQUIRED_METRIC_NAMES = [
  "Engagement",
  "Clarity",
  "Conversation Flow",
  "Speaking Confidence",
];

type KnowledgePack = {
  id: string;
  label: string;
  level: string;
  useCase: string;
  words: string[];
};

const KNOWLEDGE_PACKS: KnowledgePack[] = [
  {
    id: "top_100_frequent_en",
    label: "Top 100 Frequent English Words",
    level: "A1",
    useCase: "general",
    words: [
      "school",
      "teacher",
      "student",
      "lesson",
      "homework",
      "book",
      "notebook",
      "pencil",
      "pen",
      "class",
      "language",
      "word",
      "sentence",
      "question",
      "answer",
      "conversation",
      "pronunciation",
      "grammar",
      "vocabulary",
      "practice",
      "improve",
      "learn",
      "study",
      "read",
      "write",
      "speak",
      "listen",
      "understand",
      "explain",
      "describe",
      "compare",
      "discuss",
      "remember",
      "review",
      "repeat",
      "correct",
      "mistake",
      "progress",
      "goal",
      "confidence",
      "clear",
      "fluent",
      "topic",
      "idea",
      "opinion",
      "example",
      "reason",
      "detail",
      "story",
      "message",
      "email",
      "meeting",
      "project",
      "deadline",
      "task",
      "plan",
      "schedule",
      "office",
      "team",
      "manager",
      "colleague",
      "customer",
      "service",
      "problem",
      "solution",
      "change",
      "result",
      "success",
      "challenge",
      "opportunity",
      "travel",
      "airport",
      "hotel",
      "ticket",
      "passport",
      "station",
      "train",
      "bus",
      "taxi",
      "street",
      "restaurant",
      "menu",
      "order",
      "bill",
      "payment",
      "money",
      "market",
      "shop",
      "price",
      "product",
      "family",
      "friend",
      "neighbor",
      "health",
      "doctor",
      "medicine",
      "exercise",
      "hobby",
      "music",
      "movie",
    ],
  },
  {
    id: "from_last_session_with_tutor_en",
    label: "From My Previous Lessons",
    level: "A1-A2",
    useCase: "tutor",
    words: [
      "schedule",
      "meeting",
      "project",
      "deadline",
      "practice",
      "mistake",
      "improve",
      "repeat",
      "pronunciation",
      "example",
      "question",
      "answer",
      "explain",
      "understand",
      "remember",
      "yesterday",
      "today",
      "tomorrow",
      "week",
      "goal",
    ],
  },
];

const KNOWLEDGE_THEMES = [
  "Daily Life",
  "Ordering in a Restaurant",
  "Shopping",
  "Travel",
  "Work and Meetings",
];

const LEARNING_FOCUS_PRIMARY_OPTIONS = [
  "Last lesson with tutor",
  "Suggested by tutor",
  "Other",
];

const LEARNING_FOCUS_OTHER_OPTIONS = [
  "Increase vocabulary range",
  "Improve pronunciation and clarity",
  "Practice my knowledge",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function redactSensitiveFields(obj: any): any {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveFields);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(k) && typeof v === "string" && v.length > 6) {
      out[k] = v.slice(0, 6) + "***";
    } else {
      out[k] = redactSensitiveFields(v);
    }
  }
  return out;
}

export function VideoAvatarClient() {
  const backendUrl = DEFAULT_BACKEND_URL;
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const enableLocalVideo = true;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [enableAivad, setEnableAivad] = useState(true);
  const [language, setLanguage] = useState("en-US");
  const profile = DEFAULT_PROFILE;
  const [prompt, setPrompt] = useState("");
  const [greeting, setGreeting] = useState("");
  const [activeTab, setActiveTab] = useState("video");
  const _conversationRef = useRef<HTMLDivElement>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const channelRef = useRef<string | null>(null);
  const [selectedMic, setSelectedMic] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("selectedMicId") || ""
      : "",
  );
  const [sessionAgentId, setSessionAgentId] = useState<string | null>(null);
  const [sessionPayload, setSessionPayload] = useState<object | null>(null);
  const [tutorReport, setTutorReport] = useState<TutorReport | null>(null);
  const [reportCopied, setReportCopied] = useState(false);
  const [showTutorReport, setShowTutorReport] = useState(false);
  const [isEndingCall, setIsEndingCall] = useState(false);
  const [learningTheme, setLearningTheme] = useState(KNOWLEDGE_THEMES[0]);
  const [learningFocus, setLearningFocus] = useState(
    LEARNING_FOCUS_PRIMARY_OPTIONS[0],
  );
  const [learningFocusOther, setLearningFocusOther] = useState(
    LEARNING_FOCUS_OTHER_OPTIONS[0],
  );
  const [selectedKnowledgePackId, setSelectedKnowledgePackId] = useState(
    KNOWLEDGE_PACKS[0].id,
  );
  const [targetWordsInput, setTargetWordsInput] = useState("");
  const isStartingRef = useRef(false);

  const sortedKnowledgePacks = useMemo(
    () =>
      [...KNOWLEDGE_PACKS].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      ),
    [],
  );

  const sortedLearningFocusOtherOptions = useMemo(
    () =>
      [...LEARNING_FOCUS_OTHER_OPTIONS].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    [],
  );

  const sortedKnowledgeThemes = useMemo(
    () =>
      [...KNOWLEDGE_THEMES].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    [],
  );

  // Read URL parameters on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const ru = params.get("returnurl");
      if (ru) {
        setReturnUrl(ru);
      }
    }
  }, []);

  const {
    isConnected,
    isMuted,
    micState,
    messageList,
    currentInProgressMessage,
    isAgentSpeaking: _isAgentSpeaking,
    localAudioTrack,
    remoteVideoTrack: avatarVideoTrack,
    joinChannel,
    leaveChannel,
    toggleMute,
    sendMessage,
    agentUid,
    rtcClientRef,
    rtmClientRef,
    rtmSource,
  } = useAgoraVideoClient();

  // Handle mic selection change: persist to localStorage and live-switch if connected
  const handleMicChange = async (deviceId: string) => {
    setSelectedMic(deviceId);
    if (deviceId) {
      localStorage.setItem("selectedMicId", deviceId);
    } else {
      localStorage.removeItem("selectedMicId");
    }
    if (isConnected && localAudioTrack && deviceId) {
      try {
        await localAudioTrack.setDevice(deviceId);
      } catch (err) {
        console.error("Failed to switch microphone:", err);
      }
    }
  };

  // Get audio visualization data (restart on mute/unmute to fix Web Audio API connection)
  const frequencyData = useAudioVisualization(
    localAudioTrack,
    isConnected && !isMuted,
  );

  // Thymia voice biomarker data (opt-in via NEXT_PUBLIC_ENABLE_THYMIA)
  const {
    biomarkers,
    wellness,
    clinical,
    progress: thymiaProgress,
    safety: thymiaSafety,
  } = useThymia(rtmSource, THYMIA_ENABLED && isConnected);

  // Shen.AI camera vitals (opt-in via NEXT_PUBLIC_ENABLE_SHEN)
  // RTM publish function for Shen to push vitals to server
  const shenRtmPublish = useMemo(() => {
    if (!SHEN_ENABLED) return null;
    const rtm = rtmClientRef.current;
    if (!rtm) return null;
    return async (message: string): Promise<boolean> => {
      try {
        const ch = channelRef.current;
        if (!ch) return false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (rtm as any).publish?.(ch, message);
        return true;
      } catch {
        return false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtmClientRef.current]);

  const shenState = useShenai(
    SHEN_ENABLED && isConnected,
    SHEN_API_KEY,
    shenRtmPublish,
    "shen-canvas",
  );

  // Move the shen canvas between desktop/mobile containers based on screen size
  useEffect(() => {
    if (!SHEN_ENABLED || !isConnected) return;

    // Create the canvas once
    let canvas = document.getElementById("shen-canvas") as HTMLCanvasElement;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "shen-canvas";
      canvas.className = "absolute top-1/2 left-1/2 h-full";
      canvas.style.transform = "translate(-50%, -50%) scale(1.8)";
    }

    const moveCanvas = () => {
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      const containerId = isMobile
        ? "shen-container-mobile"
        : "shen-container-desktop";
      const container = document.getElementById(containerId);
      if (container && canvas.parentElement !== container) {
        container.appendChild(canvas);
      }
    };

    moveCanvas();
    const mql = window.matchMedia("(max-width: 767px)");
    mql.addEventListener("change", moveCanvas);
    return () => mql.removeEventListener("change", moveCanvas);
  }, [isConnected]);

  // Local video state - managed directly via AgoraRTC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [localVideoTrack, setLocalVideoTrack] = useState<any>(null);
  const [isLocalVideoActive, setIsLocalVideoActive] = useState(false);

  const selectedKnowledgePack = useMemo(
    () =>
      KNOWLEDGE_PACKS.find((pack) => pack.id === selectedKnowledgePackId) ||
      KNOWLEDGE_PACKS[0],
    [selectedKnowledgePackId],
  );

  const knowledgeWords = useMemo(() => {
    const top100Pack = KNOWLEDGE_PACKS.find(
      (pack) => pack.id === "top_100_frequent_en",
    );
    const merged = [
      ...selectedKnowledgePack.words,
      ...(top100Pack?.words || []),
    ];
    return Array.from(new Set(merged)).slice(0, 50);
  }, [selectedKnowledgePack.words]);

  const targetWords = useMemo(() => {
    const manual = targetWordsInput
      .split(/[\s,]+/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
    if (manual.length > 0) {
      return Array.from(new Set(manual)).slice(0, 8);
    }
    return knowledgeWords.slice(0, 5);
  }, [knowledgeWords, targetWordsInput]);

  const effectiveLearningFocus = useMemo(
    () => (learningFocus === "Other" ? learningFocusOther : learningFocus),
    [learningFocus, learningFocusOther],
  );

  const handleStart = async () => {
    if (isStartingRef.current || isConnected || isLoading || isEndingCall) return;
    isStartingRef.current = true;
    setIsLoading(true);
    setReportCopied(false);
    setShowTutorReport(false);
    try {
      // Build query params for backend
      const params = new URLSearchParams();

      // Use fixed server profile
      params.append("profile", profile);

      // Add agent settings
      params.append("enable_aivad", enableAivad.toString());
      params.append("asr_language", language);

      // Inject knowledge-base context from the session setup.
      const knowledgePrompt = buildKnowledgePrompt({
        learnerLevel: "A1",
        learningTheme,
        learningFocus: effectiveLearningFocus,
        knownWords: knowledgeWords,
        targetWords,
      });
      const finalPrompt = prompt.trim()
        ? `${prompt.trim()}\n\n${knowledgePrompt}`
        : knowledgePrompt;
      params.append("prompt", finalPrompt);
      if (greeting.trim()) {
        params.append("greeting", greeting.trim());
      }

      // Phase 1: Get tokens only (don't start agent yet)
      params.append("connect", "false");
      const tokenUrl = `${backendUrl}/start-agent?${params.toString()}`;
      const tokenResponse = await fetch(tokenUrl);

      if (!tokenResponse.ok) {
        throw new Error(`Backend error: ${tokenResponse.statusText}`);
      }

      const data = await tokenResponse.json();

      // Phase 2: Join channel first so RTM is ready for greeting
      channelRef.current = data.channel;
      await joinChannel({
        appId: data.appid,
        channel: data.channel,
        token: data.token || null,
        uid: parseInt(data.uid),
        rtmUid: data.user_rtm_uid, // Channel-scoped RTM UID for multi-session support
        agentUid: data.agent?.uid ? String(data.agent.uid) : undefined,
        agentRtmUid: data.agent_rtm_uid,
        ...(selectedMic ? { microphoneId: selectedMic } : {}),
      });

      // Auto-enable local video if checkbox was checked
      if (enableLocalVideo && rtcClientRef.current && !localVideoTrack) {
        const videoTrack = await AgoraRTC.createCameraVideoTrack({
          encoderConfig: "720p_2",
        });
        try {
          await rtcClientRef.current.publish(videoTrack);
        } catch (e) {
          const err = e as { code?: string; message?: string };
          if (err?.code !== "CAN_NOT_PUBLISH_MULTIPLE_VIDEO_TRACKS") {
            throw e;
          }
        }
        setLocalVideoTrack(videoTrack);
        setIsLocalVideoActive(true);
      }

      // Phase 3: Now start the agent (client is listening for greeting)
      params.delete("connect");
      params.append("channel", data.channel);
      params.append("debug", "true");
      const agentUrl = `${backendUrl}/start-agent?${params.toString()}`;
      const agentResponse = await fetch(agentUrl);

      if (!agentResponse.ok) {
        throw new Error(`Agent start error: ${agentResponse.statusText}`);
      }

      const agentData = await agentResponse.json();

      // Store agent_id from the actual agent response
      if (agentData.agent_response?.response) {
        try {
          const resp =
            typeof agentData.agent_response.response === "string"
              ? JSON.parse(agentData.agent_response.response)
              : agentData.agent_response.response;
          if (resp.agent_id) {
            setAgentId(resp.agent_id);
            setSessionAgentId(resp.agent_id);
          }
        } catch {
          // ignore parse errors
        }
      }

      // Store redacted payload for session panel
      if (agentData.debug?.agent_payload) {
        setSessionPayload(redactSensitiveFields(agentData.debug.agent_payload));
      }
    } catch (error) {
      console.error("Failed to start:", error);
      alert(
        `Failed to start: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
      isStartingRef.current = false;
    }
  };

  const handleStop = async () => {
    if (isEndingCall) return;
    setIsEndingCall(true);

    const transcript: ConversationMessage[] = [...messageList];
    if (currentInProgressMessage?.text?.trim()) {
      transcript.push({
        uid: currentInProgressMessage.uid,
        text: currentInProgressMessage.text,
        timestamp: currentInProgressMessage.timestamp,
      });
    }
    const thymiaSnapshot: ThymiaSnapshot = {
      biomarkers,
      wellness,
      clinical,
      progress: thymiaProgress,
      safety: thymiaSafety,
    };
    const localReport =
      buildTutorReport(transcript, isAgentMessage, thymiaSnapshot, THYMIA_ENABLED) ||
      buildFallbackTutorReport(transcript, isAgentMessage);
    setTutorReport(localReport);
    setReportCopied(false);
    setShowTutorReport(true);

    // Stop and close local video track to release camera hardware
    if (localVideoTrack) {
      localVideoTrack.stop();
      localVideoTrack.close();
      setLocalVideoTrack(null);
      setIsLocalVideoActive(false);
    }
    setSessionAgentId(null);
    setSessionPayload(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        "last_avatar_call_report",
        JSON.stringify(localReport),
      );
    }
    if (returnUrl) {
      window.location.href = returnUrl;
      return;
    }

    // Keep report deterministic for demo: do not asynchronously replace it later.

    // Complete channel leave in background so UI transitions instantly.
    void leaveChannel()
      .catch((err) => {
        console.error("Failed to leave channel cleanly:", err);
      })
      .finally(() => {
        setIsEndingCall(false);
      });
  };

  const requestTutorReportFromBackend = async (
    transcript: ConversationMessage[],
    thymiaSnapshot: ThymiaSnapshot,
  ): Promise<TutorReport | null> => {
    try {
      const response = await fetch(`${backendUrl}/generate-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: profile.trim() || DEFAULT_PROFILE,
          agent_uid: agentUid,
          messages: transcript,
        }),
      });

      if (!response.ok) {
        throw new Error(`Report endpoint failed: ${response.status}`);
      }

      const report = await response.json();
      const thymiaInsights = buildThymiaInsights(thymiaSnapshot, THYMIA_ENABLED);

      return normalizeTutorReport({
        generatedAt: report.generatedAt || new Date().toLocaleString(),
        overview: report.overview || "No overview provided.",
        turns: Number(report.turns || 0),
        userMessages: Number(report.userMessages || 0),
        agentMessages: Number(report.agentMessages || 0),
        duration: report.duration || "N/A",
        metrics: Array.isArray(report.metrics) ? report.metrics : [],
        whatWentWell: Array.isArray(report.whatWentWell)
          ? report.whatWentWell
          : [],
        improvements: Array.isArray(report.improvements)
          ? report.improvements
          : [],
        nextSessionGoals: Array.isArray(report.nextSessionGoals)
          ? report.nextSessionGoals
          : [],
        evidence: Array.isArray(report.evidence) ? report.evidence : [],
        thymiaInsights,
      });
    } catch (error) {
      console.warn(
        "Falling back to local report generation:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !isConnected) return;

    const success = await sendMessage(chatMessage);

    if (success) {
      setChatMessage("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleVideo = async () => {
    if (isLocalVideoActive && localVideoTrack) {
      // Turn off: unpublish, stop, and close to release camera hardware
      if (rtcClientRef.current) {
        await rtcClientRef.current.unpublish(localVideoTrack);
      }
      localVideoTrack.stop();
      localVideoTrack.close();
      setLocalVideoTrack(null);
      setIsLocalVideoActive(false);
    } else if (!isLocalVideoActive && rtcClientRef.current) {
      // Turn on: create new track and publish
      const videoTrack = await AgoraRTC.createCameraVideoTrack({
        encoderConfig: "720p_2",
      });
      await rtcClientRef.current.publish(videoTrack);
      setLocalVideoTrack(videoTrack);
      setIsLocalVideoActive(true);
    }
  };

  // Helper to determine if message is from agent
  // Agent messages have uid matching the agent's RTC UID (provided by backend)
  const isAgentMessage = (uid: string) => {
    return agentUid ? uid === agentUid : false;
  };

  const formatTime = (ts?: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const copyTutorReport = async () => {
    if (!tutorReport || typeof window === "undefined") return;
    const lines = [
      "Tutor Report",
      `Generated: ${tutorReport.generatedAt}`,
      `Overview: ${tutorReport.overview}`,
      `Turns: ${tutorReport.turns}`,
      `User messages: ${tutorReport.userMessages}`,
      `Agent messages: ${tutorReport.agentMessages}`,
      `Duration: ${tutorReport.duration}`,
      "",
      "Assessment:",
      ...tutorReport.metrics.map(
        (m) => `- ${m.name}: ${m.score}/10 (${m.rationale})`,
      ),
      "",
      "What Went Well:",
      ...tutorReport.whatWentWell.map((item) => `- ${item}`),
      "",
      "What Can Be Improved:",
      ...tutorReport.improvements.map((item) => `- ${item}`),
      "",
      "Next Session Goals:",
      ...tutorReport.nextSessionGoals.map((item) => `- ${item}`),
      "",
      "Evidence:",
      ...tutorReport.evidence.map((item) => `- ${item}`),
    ];
    if (tutorReport.thymiaInsights) {
      lines.push(
        "",
        "Thymia Signals:",
        `- Confidence: ${formatPercent(tutorReport.thymiaInsights.confidencePct)}`,
        `- Stress: ${formatPercent(tutorReport.thymiaInsights.stressPct)}`,
        `- Fatigue: ${formatPercent(tutorReport.thymiaInsights.fatiguePct)}`,
        `- Distress: ${formatPercent(tutorReport.thymiaInsights.distressPct)}`,
        `- Safety alert: ${tutorReport.thymiaInsights.safetyAlert ?? "none"}`,
      );
    }
    await navigator.clipboard.writeText(lines.join("\n"));
    setReportCopied(true);
  };

  const isSessionActive = isConnected && !isEndingCall;

  const isReportView = !isSessionActive && showTutorReport && !!tutorReport;

  return (
    <div
      className={`flex flex-col bg-[#f6f6fb] ${
        isReportView ? "min-h-screen" : "h-screen overflow-hidden"
      }`}
    >
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[#ececf4] bg-white/90 px-4 py-3 backdrop-blur-sm md:py-4">
        <div className="flex items-start justify-between">
          <div className="flex flex-col justify-center">
            <h1 className="text-xl font-bold leading-none text-[#161622] md:text-2xl">
              LexiCoach
            </h1>
            <p className="pt-1 text-xs text-[#696978] md:text-sm">
              Your speaking tutor with confidence coaching
            </p>
          </div>
          <div className="flex items-center gap-1 self-start">
            <ThemeToggle />
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="cursor-pointer rounded-full p-2 hover:bg-accent transition-colors"
              aria-label="Toggle settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className={`flex flex-1 min-w-0 px-4 py-1 md:py-6 ${
          isReportView ? "overflow-visible" : "min-h-0 overflow-hidden"
        }`}
      >
        {!isSessionActive ? (
          showTutorReport && tutorReport ? (
            <div className="flex flex-1 justify-center pb-10">
              <div className="w-full max-w-5xl rounded-lg border bg-card p-6 shadow-lg space-y-6">
                <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold leading-tight md:text-2xl">
                      Tutor Report
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tutorReport.generatedAt} • {tutorReport.duration} •{" "}
                      {tutorReport.turns} turns
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <button
                      onClick={copyTutorReport}
                      className="cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-accent"
                    >
                      {reportCopied ? "Copied" : "Copy Report"}
                    </button>
                    <button
                      onClick={() => setShowTutorReport(false)}
                      className="cursor-pointer rounded-md bg-[#ff2f92] px-3 py-2 text-sm font-semibold text-white hover:bg-[#e32a83]"
                    >
                      Back
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="text-sm">
                    <span className="font-semibold">Overall assessment:</span>{" "}
                    {tutorReport.overview}
                  </p>
                </div>

                {tutorReport.thymiaInsights && (
                  <div className="rounded-lg border p-4">
                    <h3 className="font-semibold mb-2">
                      Thymia Speaking Signals
                    </h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      {tutorReport.thymiaInsights.summary}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div className="rounded border p-2">
                        <p className="text-xs text-muted-foreground">Confidence</p>
                        <p className="font-semibold">
                          {formatPercent(tutorReport.thymiaInsights.confidencePct)}
                        </p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-xs text-muted-foreground">Stress</p>
                        <p className="font-semibold">
                          {formatPercent(tutorReport.thymiaInsights.stressPct)}
                        </p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-xs text-muted-foreground">Fatigue</p>
                        <p className="font-semibold">
                          {formatPercent(tutorReport.thymiaInsights.fatiguePct)}
                        </p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-xs text-muted-foreground">Distress</p>
                        <p className="font-semibold">
                          {formatPercent(tutorReport.thymiaInsights.distressPct)}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Safety alert:{" "}
                      {tutorReport.thymiaInsights.safetyAlert ?? "none"} • Speech
                      processed: {Math.round(tutorReport.thymiaInsights.speechSeconds)}
                      s
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:auto-rows-fr">
                  {tutorReport.metrics.map((metric) => (
                    <div
                      key={metric.name}
                      className="flex h-full min-h-[220px] flex-col rounded-lg border p-4"
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {metric.name}
                      </p>
                      <p className="text-2xl font-bold mt-1">
                        {metric.score}
                        <span className="text-sm text-muted-foreground"> / 10</span>
                      </p>
                      <p className="mt-2 max-h-28 overflow-auto break-words pr-1 text-sm leading-relaxed text-muted-foreground">
                        {metric.rationale}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <section className="rounded-lg border p-4">
                    <h3 className="font-semibold mb-2">What Went Well</h3>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {tutorReport.whatWentWell.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="rounded-lg border p-4">
                    <h3 className="font-semibold mb-2">What Can Be Improved</h3>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {tutorReport.improvements.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <section className="rounded-lg border p-4">
                    <h3 className="font-semibold mb-2">Next Session Goals</h3>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {tutorReport.nextSessionGoals.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="rounded-lg border p-4">
                    <h3 className="font-semibold mb-2">Evidence from Conversation</h3>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {tutorReport.evidence.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                </div>

              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="w-full max-w-3xl rounded-2xl border border-[#ececf4] bg-white px-6 py-6 shadow-sm">
                <h2 className="text-xl font-semibold text-[#272738]">
                  Prepare Your Practice Session
                </h2>
                <p className="mt-1 text-sm text-[#6d6d80]">
                  Set your learning focus, then start only when you are ready.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm md:col-span-2">
                    <span className="text-[#55556a]">Knowledge Base Pack</span>
                    <select
                      value={selectedKnowledgePackId}
                      onChange={(e) => setSelectedKnowledgePackId(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {sortedKnowledgePacks.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="rounded-lg border bg-[#fafafe] p-3 md:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#77778c]">
                      Example
                    </p>
                    <p className="mt-2 text-sm text-[#55556a]">
                      {knowledgeWords.slice(0, 20).join(", ")}
                      {knowledgeWords.length > 20 ? ", ..." : ""}
                    </p>
                    <p className="mt-2 text-xs text-[#77778c]">
                      Target words for prompt: {targetWords.join(", ")}
                    </p>
                  </div>

                  <label className="space-y-1 text-sm md:col-span-2">
                    <span className="text-[#55556a]">Learning Focus</span>
                    <select
                      value={learningFocus}
                      onChange={(e) => setLearningFocus(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {LEARNING_FOCUS_PRIMARY_OPTIONS.map((focus) => (
                        <option key={focus} value={focus}>
                          {focus}
                        </option>
                      ))}
                    </select>
                  </label>

                  {learningFocus === "Other" && (
                    <label className="space-y-1 text-sm md:col-span-2">
                      <span className="text-[#55556a]">Other Focus</span>
                      <select
                        value={learningFocusOther}
                        onChange={(e) => setLearningFocusOther(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {sortedLearningFocusOtherOptions.map((focus) => (
                          <option key={focus} value={focus}>
                            {focus}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {learningFocus === "Other" && (
                    <label className="space-y-1 text-sm md:col-span-2">
                      <span className="text-[#55556a]">Theme</span>
                      <select
                        value={learningTheme}
                        onChange={(e) => setLearningTheme(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {sortedKnowledgeThemes.map((theme) => (
                          <option key={theme} value={theme}>
                            {theme}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="space-y-1 text-sm md:col-span-2">
                    <span className="text-[#55556a]">
                      Target Words (optional, comma-separated)
                    </span>
                    <input
                      type="text"
                      value={targetWordsInput}
                      onChange={(e) => setTargetWordsInput(e.target.value)}
                      placeholder="ex: confident, explain, progress"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <button
                    onClick={handleStart}
                    disabled={isLoading}
                    className="cursor-pointer rounded-xl bg-[#ff2f92] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#e32a83] disabled:opacity-50 shadow-[0_10px_24px_rgba(255,47,146,0.3)]"
                  >
                    {isLoading ? "Starting..." : "Practice Speaking"}
                  </button>
                </div>
              </div>
            </div>
          )
        ) : (
          /* Connected: Responsive Layout */
          <>
            {/* Desktop Layout - Hidden on mobile */}
            <VideoGrid
              className="hidden md:grid flex-1 min-w-0"
              style={{
                gridTemplateColumns: "2fr 3fr",
                gridTemplateRows: "1fr 1fr",
                gap: "1rem",
              }}
              chat={
                <div className="flex flex-col h-full">
                  {/* Conversation Header */}
                  <div className="border-b p-4 flex-shrink-0 flex items-center justify-between">
                    <h2 className="font-semibold">Conversation</h2>
                    <p className="text-sm text-muted-foreground">
                      {messageList.length} message
                      {messageList.length !== 1 ? "s" : ""}
                    </p>
                  </div>

                  {/* Messages */}
                  <Conversation
                    height=""
                    className="flex-1 min-h-0"
                    style={{ overflow: "auto" }}
                  >
                    <ConversationContent className="gap-3">
                      {messageList.map((msg, idx) => {
                        const isAgent = isAgentMessage(msg.uid);
                        const label = isAgent ? "Agent" : "You";
                        const time = formatTime(msg.timestamp);
                        return (
                          <Message
                            key={`${msg.turn_id}-${msg.uid}-${idx}`}
                            from={isAgent ? "assistant" : "user"}
                            name={time ? `${label}  ${time}` : label}
                          >
                            <MessageContent
                              className={
                                isAgent
                                  ? "px-3 py-2"
                                  : "px-3 py-2 bg-foreground text-background"
                              }
                            >
                              <Response>{msg.text}</Response>
                            </MessageContent>
                          </Message>
                        );
                      })}

                      {/* In-progress message */}
                      {currentInProgressMessage &&
                        (() => {
                          const isAgent = isAgentMessage(
                            currentInProgressMessage.uid,
                          );
                          const label = isAgent ? "Agent" : "You";
                          const time = formatTime(
                            currentInProgressMessage.timestamp,
                          );
                          return (
                            <Message
                              from={isAgent ? "assistant" : "user"}
                              name={time ? `${label}  ${time}` : label}
                            >
                              <MessageContent
                                className={`animate-pulse px-3 py-2 ${isAgent ? "" : "bg-foreground text-background"}`}
                              >
                                <Response>
                                  {currentInProgressMessage.text}
                                </Response>
                              </MessageContent>
                            </Message>
                          );
                        })()}
                    </ConversationContent>
                  </Conversation>

                  {/* Input Box */}
                  <div className="border-t p-4 flex-shrink-0">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatMessage}
                        onChange={(e) => setChatMessage(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type a message"
                        disabled={!isSessionActive}
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      />
                      <button
                        onClick={handleSendMessage}
                        disabled={!isSessionActive || !chatMessage.trim()}
                        className="cursor-pointer h-10 w-10 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        <SendHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              }
              avatar={
                <div className="flex flex-col h-full">
                  {/* Avatar Video + optional Thymia/Shen tabs */}
                  {THYMIA_ENABLED || SHEN_ENABLED ? (
                    <MobileTabs
                      tabs={[
                        {
                          id: "avatar",
                          label: "Avatar",
                          content: (
                            <div className="flex-1 flex items-center justify-center bg-muted/20 p-2 h-full">
                              <AvatarVideoDisplay
                                videoTrack={avatarVideoTrack}
                                state={
                                  avatarVideoTrack
                                    ? "connected"
                                    : "disconnected"
                                }
                                className="h-full w-full"
                                useMediaStream={true}
                              />
                            </div>
                          ),
                        },
                        ...(THYMIA_ENABLED
                          ? [
                              {
                                id: "thymia",
                                label: "Thymia",
                                content: (
                                  <ThymiaPanel
                                    biomarkers={biomarkers}
                                    wellness={wellness}
                                    clinical={clinical}
                                    progress={thymiaProgress}
                                    safety={thymiaSafety}
                                    isConnected={isConnected}
                                  />
                                ),
                              },
                            ]
                          : []),
                        ...(SHEN_ENABLED
                          ? [
                              {
                                id: "shen",
                                label: "Shen",
                                content: (
                                  <ShenPanel
                                    shenState={shenState}
                                    isConnected={isConnected}
                                  />
                                ),
                              },
                            ]
                          : []),
                      ]}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center bg-muted/20 p-2">
                      <AvatarVideoDisplay
                        videoTrack={avatarVideoTrack}
                        state={avatarVideoTrack ? "connected" : "disconnected"}
                        className="h-full w-full"
                        useMediaStream={true}
                      />
                    </div>
                  )}

                  {/* Controls below avatar */}
                  <div className="border-t p-4 flex-shrink-0">
                    <div className="flex gap-3 justify-center">
                      <IconButton
                        shape="square"
                        variant={isMuted ? "standard" : "filled"}
                        size="md"
                        onClick={toggleMute}
                        className={
                          isMuted
                            ? "rounded-lg bg-muted text-destructive hover:bg-muted/80"
                            : "rounded-lg"
                        }
                      >
                        {isMuted ? (
                          <MicOff className="size-4" />
                        ) : (
                          <Mic className="size-4" />
                        )}
                      </IconButton>
                      <IconButton
                        shape="square"
                        variant={isLocalVideoActive ? "filled" : "standard"}
                        size="md"
                        onClick={toggleVideo}
                        className={
                          !isLocalVideoActive
                            ? "rounded-lg bg-muted text-destructive hover:bg-muted/80"
                            : "rounded-lg"
                        }
                      >
                        {isLocalVideoActive ? (
                          <Video className="size-4" />
                        ) : (
                          <VideoOff className="size-4" />
                        )}
                      </IconButton>
                      <button
                        onClick={handleStop}
                        disabled={isEndingCall}
                        className="cursor-pointer flex items-center gap-2 rounded-lg bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
                      >
                        <PhoneOff className="h-4 w-4" />
                        End Call
                      </button>
                    </div>
                  </div>
                </div>
              }
              localVideo={
                <div className="h-full flex items-center justify-center p-2">
                  {SHEN_ENABLED ? (
                    <div
                      id="shen-container-desktop"
                      className="relative h-full w-full rounded-lg overflow-hidden bg-black"
                    />
                  ) : (
                    <LocalVideoPreview
                      videoTrack={isLocalVideoActive ? localVideoTrack : null}
                      className="h-full w-full"
                      useMediaStream={true}
                    />
                  )}
                </div>
              }
            />

            {/* Mobile Layout - Hidden on desktop */}
            <div className="flex md:hidden flex-1 flex-col min-h-0 overflow-hidden">
              <MobileTabs
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tabs={[
                  {
                    id: "video",
                    label: "Video",
                    content: (
                      <div className="flex flex-col h-full gap-2 p-2">
                        {/* Avatar - 50% */}
                        <div className="flex-1 rounded-lg border bg-card shadow-lg overflow-hidden">
                          <AvatarVideoDisplay
                            videoTrack={avatarVideoTrack}
                            state={
                              avatarVideoTrack ? "connected" : "disconnected"
                            }
                            className="h-full w-full"
                            useMediaStream={true}
                          />
                        </div>

                        {/* Local Video - 50% */}
                        {SHEN_ENABLED ? (
                          <div
                            id="shen-container-mobile"
                            className="relative flex-1 rounded-lg border bg-black shadow-lg overflow-hidden"
                          />
                        ) : (
                          <div className="flex-1 rounded-lg border bg-card shadow-lg overflow-hidden">
                            <LocalVideoPreview
                              videoTrack={
                                isLocalVideoActive ? localVideoTrack : null
                              }
                              className="h-full w-full"
                              useMediaStream={true}
                            />
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: "chat",
                    label: "Chat",
                    content: (
                      <div className="flex flex-col h-full gap-2 p-2">
                        {/* Avatar - 50% (matches Video tab) */}
                        <div className="flex-[50] rounded-lg border bg-card shadow-lg overflow-hidden">
                          <AvatarVideoDisplay
                            videoTrack={avatarVideoTrack}
                            state={
                              avatarVideoTrack ? "connected" : "disconnected"
                            }
                            className="h-full w-full"
                            useMediaStream={true}
                          />
                        </div>

                        {/* Chat - 50% */}
                        <div className="flex-[50] rounded-lg border bg-card shadow-lg overflow-hidden flex flex-col">
                          {/* Messages */}
                          <Conversation
                            height=""
                            className="flex-1 min-h-0"
                            style={{ overflow: "auto" }}
                          >
                            <ConversationContent className="gap-3">
                              {messageList.map((msg, idx) => {
                                const isAgent = isAgentMessage(msg.uid);
                                const label = isAgent ? "Agent" : "You";
                                const time = formatTime(msg.timestamp);
                                return (
                                  <Message
                                    key={`${msg.turn_id}-${msg.uid}-${idx}`}
                                    from={isAgent ? "assistant" : "user"}
                                    name={time ? `${label}  ${time}` : label}
                                  >
                                    <MessageContent
                                      className={
                                        isAgent
                                          ? "px-3 py-2"
                                          : "px-3 py-2 bg-foreground text-background"
                                      }
                                    >
                                      <Response>{msg.text}</Response>
                                    </MessageContent>
                                  </Message>
                                );
                              })}

                              {/* In-progress message */}
                              {currentInProgressMessage &&
                                (() => {
                                  const isAgent = isAgentMessage(
                                    currentInProgressMessage.uid,
                                  );
                                  const label = isAgent ? "Agent" : "You";
                                  const time = formatTime(
                                    currentInProgressMessage.timestamp,
                                  );
                                  return (
                                    <Message
                                      from={isAgent ? "assistant" : "user"}
                                      name={time ? `${label}  ${time}` : label}
                                    >
                                      <MessageContent
                                        className={`animate-pulse px-3 py-2 ${isAgent ? "" : "bg-foreground text-background"}`}
                                      >
                                        <Response>
                                          {currentInProgressMessage.text}
                                        </Response>
                                      </MessageContent>
                                    </Message>
                                  );
                                })()}
                            </ConversationContent>
                          </Conversation>

                          {/* Input Box */}
                          <div className="border-t p-2 flex-shrink-0">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={chatMessage}
                                onChange={(e) => setChatMessage(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="Type a message"
                                disabled={!isSessionActive}
                                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                              />
                              <button
                                onClick={handleSendMessage}
                                disabled={!isSessionActive || !chatMessage.trim()}
                                className="cursor-pointer h-10 w-10 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              >
                                <SendHorizontal className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  ...(THYMIA_ENABLED
                    ? [
                        {
                          id: "thymia",
                          label: "Thymia",
                          content: (
                            <ThymiaPanel
                              biomarkers={biomarkers}
                              wellness={wellness}
                              clinical={clinical}
                              progress={thymiaProgress}
                              safety={thymiaSafety}
                              isConnected={isConnected}
                            />
                          ),
                        },
                      ]
                    : []),
                  ...(SHEN_ENABLED
                    ? [
                        {
                          id: "shen",
                          label: "Shen",
                          content: (
                            <ShenPanel
                              shenState={shenState}
                              canvasId="shen-canvas"
                              isConnected={isConnected}
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
              />

              {/* Mobile: Fixed Bottom Controls */}
              <div className="flex gap-3 p-2 border-t bg-card flex-shrink-0 justify-center">
                <IconButton
                  shape="square"
                  variant={isMuted ? "standard" : "filled"}
                  size="md"
                  onClick={toggleMute}
                  className={
                    isMuted
                      ? "rounded-lg bg-muted text-destructive hover:bg-muted/80"
                      : "rounded-lg"
                  }
                >
                  {isMuted ? (
                    <MicOff className="size-4" />
                  ) : (
                    <Mic className="size-4" />
                  )}
                </IconButton>
                <IconButton
                  shape="square"
                  variant={isLocalVideoActive ? "filled" : "standard"}
                  size="md"
                  onClick={toggleVideo}
                  className={
                    !isLocalVideoActive
                      ? "rounded-lg bg-muted text-destructive hover:bg-muted/80"
                      : "rounded-lg"
                  }
                >
                  {isLocalVideoActive ? (
                    <Video className="size-4" />
                  ) : (
                    <VideoOff className="size-4" />
                  )}
                </IconButton>
                <button
                  onClick={handleStop}
                  disabled={isEndingCall}
                  className="cursor-pointer flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 min-h-[44px]"
                >
                  <PhoneOff className="h-4 w-4" />
                  End Call
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Settings Dialog */}
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        enableAivad={enableAivad}
        onEnableAivadChange={setEnableAivad}
        language={language}
        onLanguageChange={setLanguage}
        prompt={prompt}
        onPromptChange={setPrompt}
        greeting={greeting}
        onGreetingChange={setGreeting}
        disabled={isConnected}
        selectedMicId={selectedMic}
        onMicChange={handleMicChange}
      />
    </div>
  );
}

function buildTutorReport(
  messages: ConversationMessage[],
  isAgentMessage: (uid: string) => boolean,
  thymia: ThymiaSnapshot,
  thymiaEnabled: boolean,
): TutorReport | null {
  const cleaned = messages
    .map((m) => ({ ...m, text: (m.text || "").trim() }))
    .filter((m) => m.text.length > 0);

  if (!cleaned.length) return null;

  const userMessages = cleaned.filter((m) => !isAgentMessage(m.uid));
  const agentMessages = cleaned.filter((m) => isAgentMessage(m.uid));

  const timestamps = cleaned
    .map((m) => m.timestamp)
    .filter((ts): ts is number => typeof ts === "number");
  const durationMs =
    timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const duration = formatDuration(durationMs);

  const firstUser = userMessages[0]?.text;
  const lastUser = userMessages[userMessages.length - 1]?.text;
  const lastAgent = agentMessages[agentMessages.length - 1]?.text;
  const userTexts = userMessages.map((m) => m.text);
  const avgUserWords = averageWordCount(userTexts);
  const uniqueUserTerms = countUniqueTerms(userTexts);
  const questionCount = userTexts.filter((text) => text.includes("?")).length;
  const longUserMessages = userTexts.filter((text) => wordCount(text) > 25).length;
  const hasUserParticipation = userMessages.length > 0;
  const proactiveActs = questionCount + userTexts.filter((text) => wordCount(text) >= 10).length;

  const engagementScore = hasUserParticipation
    ? scoreClamp(4 + Math.min(4, userMessages.length) + Math.min(2, questionCount))
    : 0;
  const clarityScore = hasUserParticipation
    ? scoreClamp(9 - longUserMessages - (avgUserWords > 20 ? 1 : 0))
    : 0;
  const conversationFlowScore = hasUserParticipation
    ? scoreClamp(3 + Math.min(4, proactiveActs) + Math.min(3, userMessages.length))
    : 0;

  const metrics: AssessmentMetric[] = [
    {
      name: "Engagement",
      score: engagementScore,
      rationale: `${userMessages.length} user turns and ${questionCount} user questions indicate participation.`,
    },
    {
      name: "Clarity",
      score: clarityScore,
      rationale: `Average user message length is ${avgUserWords.toFixed(1)} words.`,
    },
    {
      name: "Conversation Flow",
      score: conversationFlowScore,
      rationale: `Learner proactiveness signals: ${questionCount} questions, ${userMessages.length} turns, and ${proactiveActs} initiative acts.`,
    },
  ];

  const thymiaInsights = buildThymiaInsights(thymia, thymiaEnabled);
  const estimatedConfidence = hasUserParticipation
    ? scoreClamp((engagementScore + clarityScore + conversationFlowScore) / 3)
    : 0;
  const confidenceScore = !hasUserParticipation
    ? 0
    : scoreClamp(
        thymiaInsights?.confidencePct != null
          ? thymiaInsights.confidencePct / 10
          : estimatedConfidence,
      );
  metrics.push({
    name: "Speaking Confidence",
    score: confidenceScore,
    rationale: !hasUserParticipation
      ? "No learner speech detected, so confidence is scored as 0."
      : thymiaInsights?.confidencePct != null
        ? `Thymia confidence signal is ${formatPercent(thymiaInsights.confidencePct)} with safety alert "${thymiaInsights.safetyAlert ?? "none"}".`
        : "Confidence estimated from learner participation, clarity, and proactiveness (Thymia signal unavailable).",
  });

  const overallScore = Math.round(
    metrics.reduce((acc, metric) => acc + metric.score, 0) / metrics.length,
  );

  const whatWentWell: string[] = [];
  if (userMessages.length >= 3) {
    whatWentWell.push("The learner maintained a back-and-forth conversation.");
  }
  if (questionCount > 0) {
    whatWentWell.push("The learner asked questions, showing curiosity and initiative.");
  }
  if (avgUserWords <= 20) {
    whatWentWell.push("Most learner responses were concise and easy to follow.");
  }
  if (!whatWentWell.length) {
    whatWentWell.push("The learner completed the session and produced usable speaking data.");
  }

  const improvements: string[] = [];
  if (userMessages.length < 4) {
    improvements.push("Increase the number of learner turns to build fluency.");
  }
  if (avgUserWords < 5) {
    improvements.push("Encourage fuller responses with complete sentences.");
  }
  if (longUserMessages > 0) {
    improvements.push("Break long responses into shorter ideas for better clarity.");
  }
  if (questionCount === 0 || proactiveActs < 2) {
    improvements.push("Increase learner proactiveness by asking follow-up questions and expanding responses.");
  }
  if (
    thymiaInsights?.stressPct != null &&
    thymiaInsights.stressPct >= 60
  ) {
    improvements.push(
      "Introduce short breathing pauses and slower pacing to reduce speaking stress.",
    );
  }
  if (
    thymiaInsights?.confidencePct != null &&
    thymiaInsights.confidencePct < 45
  ) {
    improvements.push(
      "Use confidence scaffolds: sentence starters, rehearsal time, and positive reinforcement.",
    );
  }
  if (!improvements.length) {
    improvements.push("Challenge the learner with follow-up questions to deepen expression.");
  }

  const nextSessionGoals = [
    "Target at least 6 learner turns.",
    "Use one example + one reason in each learner response.",
    "End with a short learner recap in their own words.",
  ];

  const evidence: string[] = [
    `User opened with: "${truncate(firstUser || "N/A", 100)}"`,
    `User closed with: "${truncate(lastUser || "N/A", 100)}"`,
    `Avatar final reply: "${truncate(lastAgent || "N/A", 100)}"`,
    `Unique learner vocabulary terms detected: ${uniqueUserTerms}`,
  ];
  if (thymiaInsights) {
    evidence.push(
      `Thymia signals -> confidence: ${formatPercent(thymiaInsights.confidencePct)}, stress: ${formatPercent(thymiaInsights.stressPct)}, fatigue: ${formatPercent(thymiaInsights.fatiguePct)}.`,
    );
  }

  return {
    generatedAt: new Date().toLocaleString(),
    overview: `Overall performance is ${overallScore}/10. The session showed ${cleaned.length} turns with a ${duration} interaction.`,
    turns: cleaned.length,
    userMessages: userMessages.length,
    agentMessages: agentMessages.length,
    duration,
    metrics,
    whatWentWell,
    improvements,
    nextSessionGoals,
    evidence,
    thymiaInsights,
  };
}

function buildFallbackTutorReport(
  messages: ConversationMessage[],
  isAgentMessage: (uid: string) => boolean,
): TutorReport {
  const cleaned = messages
    .map((m) => ({ ...m, text: (m.text || "").trim() }))
    .filter((m) => m.text.length > 0);
  const userMessages = cleaned.filter((m) => !isAgentMessage(m.uid));
  const agentMessages = cleaned.filter((m) => isAgentMessage(m.uid));
  const timestamps = cleaned
    .map((m) => m.timestamp)
    .filter((ts): ts is number => typeof ts === "number");
  const durationMs =
    timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

  return normalizeTutorReport({
    generatedAt: new Date().toLocaleString(),
    overview:
      "Session ended before enough speech was captured for a full report.",
    turns: cleaned.length,
    userMessages: userMessages.length,
    agentMessages: agentMessages.length,
    duration: formatDuration(durationMs),
    metrics: [
      {
        name: "Engagement",
        score: 0,
        rationale: "Not enough learner speech captured for scoring.",
      },
      {
        name: "Clarity",
        score: 0,
        rationale: "Not enough learner speech captured for scoring.",
      },
      {
        name: "Conversation Flow",
        score: 0,
        rationale: "Not enough turns captured for scoring.",
      },
      {
        name: "Speaking Confidence",
        score: 0,
        rationale: "No confidence score can be computed without learner speech.",
      },
    ],
    whatWentWell: ["Call connected and interaction data was captured."],
    improvements: [
      "Speak for at least 3-5 learner turns to generate full tutor scoring.",
    ],
    nextSessionGoals: [
      "Use complete short sentences in each turn.",
      "Use at least three target words naturally.",
      "Keep the conversation going for at least one minute.",
    ],
    evidence: [
      `Captured turns: ${cleaned.length}`,
      `Captured user turns: ${userMessages.length}`,
      `Captured agent turns: ${agentMessages.length}`,
    ],
  });
}

function normalizeTutorReport(report: TutorReport): TutorReport {
  const metricMap = new Map<string, AssessmentMetric>();
  for (const metric of report.metrics || []) {
    if (!metric?.name) continue;
    metricMap.set(metric.name, {
      name: metric.name,
      score: Number.isFinite(metric.score) ? metric.score : 0,
      rationale: metric.rationale || "No rationale provided.",
    });
  }

  const metrics: AssessmentMetric[] = REQUIRED_METRIC_NAMES.map((name) => {
    const found = metricMap.get(name);
    return (
      found || {
        name,
        score: 0,
        rationale: "No data available for this metric.",
      }
    );
  });

  return {
    ...report,
    metrics,
    whatWentWell:
      report.whatWentWell && report.whatWentWell.length
        ? report.whatWentWell
        : ["No highlights captured for this session."],
    improvements:
      report.improvements && report.improvements.length
        ? report.improvements
        : ["Keep practicing with longer learner turns."],
    nextSessionGoals:
      report.nextSessionGoals && report.nextSessionGoals.length
        ? report.nextSessionGoals
        : ["Use complete responses and include target vocabulary."],
    evidence:
      report.evidence && report.evidence.length
        ? report.evidence
        : ["No detailed evidence was captured."],
  };
}

function formatDuration(durationMs: number): string {
  if (!durationMs || durationMs < 1000) return "under 1 second";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function buildThymiaInsights(
  thymia: ThymiaSnapshot,
  thymiaEnabled: boolean,
): TutorReport["thymiaInsights"] | undefined {
  if (!thymiaEnabled) return undefined;

  const confidenceRaw =
    findValue(
      [thymia.biomarkers, thymia.wellness, thymia.clinical],
      ["confidence", "self_confidence", "speaking_confidence"],
    ) ??
    invertScale(
      findValue(
        [thymia.biomarkers, thymia.wellness, thymia.clinical],
        ["low_self_esteem"],
      ),
    );

  const stressRaw = findValue(
    [thymia.biomarkers, thymia.wellness, thymia.clinical],
    ["stress"],
  );
  const fatigueRaw = findValue(
    [thymia.biomarkers, thymia.wellness, thymia.clinical],
    ["fatigue"],
  );
  const distressRaw = findValue(
    [thymia.biomarkers, thymia.wellness, thymia.clinical],
    ["distress"],
  );

  const progressEntries = Object.values(thymia.progress || {});
  const speechSeconds = progressEntries.reduce(
    (sum, item) => sum + (item?.speech_seconds || 0),
    0,
  );
  const triggerSeconds = progressEntries.reduce(
    (sum, item) => sum + (item?.trigger_seconds || 0),
    0,
  );

  const safetyAlert = getSafetyAlert(thymia.safety);
  const confidencePct = toPercent(confidenceRaw);
  const stressPct = toPercent(stressRaw);
  const fatiguePct = toPercent(fatigueRaw);
  const distressPct = toPercent(distressRaw);

  const hasSignals =
    confidencePct !== null ||
    stressPct !== null ||
    fatiguePct !== null ||
    distressPct !== null ||
    speechSeconds > 0;
  if (!hasSignals) return undefined;

  const summaryParts = [
    confidencePct !== null ? `confidence ${confidencePct}%` : null,
    stressPct !== null ? `stress ${stressPct}%` : null,
    fatiguePct !== null ? `fatigue ${fatiguePct}%` : null,
    distressPct !== null ? `distress ${distressPct}%` : null,
    speechSeconds > 0 ? `${Math.round(speechSeconds)}s analyzed` : null,
  ].filter(Boolean);

  return {
    confidencePct,
    stressPct,
    fatiguePct,
    distressPct,
    safetyAlert,
    speechSeconds,
    triggerSeconds,
    summary:
      summaryParts.length > 0
        ? `Thymia detected ${summaryParts.join(", ")}.`
        : "Thymia is enabled but no assessment data was received yet.",
  };
}

function findValue(
  sources: Array<Record<string, number | null> | undefined>,
  keys: string[],
): number | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return null;
}

function invertScale(value: number | null): number | null {
  if (value === null) return null;
  return 1 - value;
}

function toPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function formatPercent(value: number | null): string {
  return value === null ? "N/A" : `${value}%`;
}

function getSafetyAlert(safety: Record<string, unknown>): string | null {
  if (!safety || Object.keys(safety).length === 0) return null;
  const raw = safety.alert;
  if (typeof raw === "string") return raw;
  if (typeof raw === "boolean") return raw ? "monitor" : "none";
  return null;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function averageWordCount(values: string[]): number {
  if (!values.length) return 0;
  const total = values.reduce((acc, value) => acc + wordCount(value), 0);
  return total / values.length;
}

function countUniqueTerms(values: string[]): number {
  const tokens = values
    .join(" ")
    .toLowerCase()
    .match(/[a-z0-9']+/g);
  if (!tokens) return 0;
  return new Set(tokens).size;
}

function scoreClamp(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function buildKnowledgePrompt({
  learnerLevel,
  learningTheme,
  learningFocus,
  knownWords,
  targetWords,
}: {
  learnerLevel: string;
  learningTheme: string;
  learningFocus: string;
  knownWords: string[];
  targetWords: string[];
}): string {
  return [
    "You are LexiCoach, a supportive speaking tutor for language learners.",
    `Learner CEFR level: ${learnerLevel}.`,
    `Conversation theme: ${learningTheme}.`,
    `Learning focus: ${learningFocus}.`,
    `Learner known vocabulary: ${knownWords.join(", ")}.`,
    `Target words for this session: ${targetWords.join(", ")}.`,
    "At the beginning, say exactly:",
    `Theme: ${learningTheme}`,
    `Target words: ${targetWords.join(", ")}`,
    "Keep responses concise and natural.",
    "Encourage the learner to use the target words in context.",
    'When a target word is correct, say: Great use of "<word>".',
    'When incorrect, say: Try again with "<word>", then ask a follow-up question.',
    "End when all target words have been used correctly at least once.",
  ].join("\n");
}
