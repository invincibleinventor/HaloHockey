"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import GameCanvas, { CanvasFx } from "./GameCanvas";
import Particles from "./Particles";
import VideoFeed from "./VideoFeed";
import Chat, { ChatMessage } from "./Chat";
import { HandStream, HandSample } from "@/lib/handTracker";
import {
  ARENA,
  GameState,
  WIN_SCORE,
  clampBottomPaddle,
  clampTopPaddle,
  freshGame,
  serveTowards,
  stepPhysics,
} from "@/lib/game";
import {
  PeerHandle,
  createRoom,
  joinRoom,
  send as sendDc,
} from "@/lib/webrtc";
import { sfx } from "@/lib/audio";

type ConnState =
  | "init"
  | "permissions"
  | "waiting"
  | "connecting"
  | "ready"
  | "peerLeft"
  | "error";

interface Props {
  roomId: string;
}

export default function GameRoom({ roomId }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const isHost = params.get("host") === "1";
  const selfSide: "top" | "bottom" = isHost ? "top" : "bottom";

  const [conn, setConn] = useState<ConnState>("init");
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<string>("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // throttled state version that drives React re-renders for the HUD/score
  const [tick, setTick] = useState(0);
  const chatIdRef = useRef(1);

  const fxRef = useRef<CanvasFx | null>(null);
  const stateRef = useRef<GameState>(freshGame());
  const peerRef = useRef<PeerHandle | null>(null);
  const handStreamRef = useRef<HandStream | null>(null);
  const remoteSampleRef = useRef<HandSample>({
    x: 0.5,
    y: 0.5,
    confidence: 0,
    landmarks: 0,
  });
  const prevPaddleRef = useRef({
    top: { x: 0.5, y: ARENA.TOP_LINE + ARENA.PADDLE_R },
    bot: { x: 0.5, y: ARENA.BOTTOM_LINE - ARENA.PADDLE_R },
  });
  // guest-side authoritative target from latest host puck broadcast
  const puckTargetRef = useRef<{
    px: number;
    py: number;
    vx: number;
    vy: number;
    tx: number;
    ty: number;
  } | null>(null);
  const goalServeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerEverConnectedRef = useRef(false);
  const leftIntentionallyRef = useRef(false);

  // ---- BOOT: get camera & wire peer ----
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        setConn("permissions");
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error(
            "Camera unavailable on this page. Camera APIs only work over HTTPS or localhost. If you're on a phone hitting a laptop's LAN IP over plain http://, use the Vercel deployment or `npm run dev:https`."
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 60, min: 30 },
            facingMode: "user",
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setLocalStream(stream);

        const onTrack = (s: MediaStream) => setRemoteStream(s);

        const onMessage = (msg: any) => {
          if (msg.t === "hand") {
            remoteSampleRef.current = {
              x: msg.x,
              y: msg.y,
              confidence: msg.c ?? 1,
              landmarks: 21,
            };
          } else if (msg.t === "puck" && !isHost) {
            const s = stateRef.current;
            // hard-snap on big jumps (serve/goal); store as smoothing target otherwise
            const dx = msg.px - s.puck.x;
            const dy = msg.py - s.puck.y;
            if (dx * dx + dy * dy > 0.06) {
              s.puck.x = msg.px;
              s.puck.y = msg.py;
              s.topPaddle.x = msg.tx;
              s.topPaddle.y = msg.ty;
            }
            puckTargetRef.current = {
              px: msg.px,
              py: msg.py,
              vx: msg.vx,
              vy: msg.vy,
              tx: msg.tx,
              ty: msg.ty,
            };
            s.topScore = msg.ts;
            s.bottomScore = msg.bs;
            s.status = msg.st;
            s.lastScorer = msg.ls ?? null;
          } else if (msg.t === "score" && !isHost) {
            if (msg.who === "top") {
              fxRef.current?.burst(0.5, 0.05, "#ff2bd6", 80);
              fxRef.current?.flash("rgba(255,43,214,0.8)");
            } else {
              fxRef.current?.burst(0.5, ARENA.H - 0.05, "#00e5ff", 80);
              fxRef.current?.flash("rgba(0,229,255,0.8)");
            }
            fxRef.current?.shake(22, 480);
            sfx.goal();
          } else if (msg.t === "hit" && !isHost) {
            fxRef.current?.burst(msg.x, msg.y, "#ffd400", 22);
            fxRef.current?.shake(7, 180);
            sfx.hit();
          } else if (msg.t === "wall" && !isHost) {
            fxRef.current?.burst(msg.x, msg.y, "#00e5ff", 10);
            sfx.wallBounce();
          } else if (msg.t === "leave") {
            setConn("peerLeft");
          } else if (msg.t === "chat" && typeof msg.text === "string") {
            const text = String(msg.text).slice(0, 240);
            setChatMessages((prev) => [
              ...prev.slice(-49),
              { id: chatIdRef.current++, from: "them", text, ts: Date.now() },
            ]);
            sfx.chat();
          }
        };

        const onOpen = () => {
          peerEverConnectedRef.current = true;
          setConn("ready");
          // clear any pending fail timer
          if (failTimerRef.current) {
            clearTimeout(failTimerRef.current);
            failTimerRef.current = null;
          }
        };
        const onClose = () => {
          if (leftIntentionallyRef.current) return;
          if (peerEverConnectedRef.current) {
            setConn("peerLeft");
          } else {
            setConn("connecting");
          }
        };

        let restartedOnce = false;
        const onState = (label: string) => {
          setDiag(label);
          if (
            (label === "ice:failed" ||
              label === "pc:failed" ||
              label === "ice:disconnected") &&
            !peerEverConnectedRef.current
          ) {
            // never connected — try ICE restart on host, then 10s grace
            if (
              isHost &&
              !restartedOnce &&
              peerRef.current &&
              label === "ice:failed"
            ) {
              restartedOnce = true;
              try {
                (peerRef.current.pc as any).restartIce?.();
              } catch {}
            }
            if (failTimerRef.current) clearTimeout(failTimerRef.current);
            failTimerRef.current = setTimeout(() => {
              setError(
                "Couldn't establish a peer connection. WebRTC needs a TURN relay across strict NATs (e.g. cellular, different ISPs). The free OpenRelay fallback is built in — if it's blocked or down, sign up free at metered.ca and add NEXT_PUBLIC_TURN_URL / _USERNAME / _CREDENTIAL to your env."
              );
              setConn("error");
            }, 10000);
          }
          if (
            (label === "ice:connected" ||
              label === "ice:completed" ||
              label === "dc:open") &&
            failTimerRef.current
          ) {
            clearTimeout(failTimerRef.current);
            failTimerRef.current = null;
          }
          if (
            (label === "pc:disconnected" || label === "ice:disconnected") &&
            peerEverConnectedRef.current
          ) {
            // already connected before — peer probably left
            setConn("peerLeft");
          }
        };

        if (isHost) {
          setConn("waiting");
          const { handle } = await createRoom(roomId, stream, {
            onTrack,
            onMessage,
            onOpen,
            onClose,
            onState,
          });
          if (cancelled) {
            handle.cleanup();
            return;
          }
          peerRef.current = handle;
          // NOTE: Do NOT strip ?host=1 from the URL. In Next.js the
          // useSearchParams hook can re-evaluate on history changes, flipping
          // isHost mid-session. That swaps the data-feed attribute, slot
          // streams, and selfSide — and breaks paddle control. The friend
          // joins by typing the 6-char code into the lobby, not by visiting
          // the host's URL, so the trailing ?host=1 is harmless.
        } else {
          setConn("connecting");
          const handle = await joinRoom(roomId, stream, {
            onTrack,
            onMessage,
            onOpen,
            onClose,
            onState,
          });
          if (cancelled) {
            handle.cleanup();
            return;
          }
          peerRef.current = handle;
        }
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Could not start the room.");
        setConn("error");
      }
    }
    boot();

    return () => {
      cancelled = true;
      leftIntentionallyRef.current = true;
      // tell peer we're leaving so they show a clean message immediately
      try {
        if (peerRef.current?.dc?.readyState === "open") {
          peerRef.current.dc.send(JSON.stringify({ t: "leave" }));
        }
      } catch {}
      if (failTimerRef.current) clearTimeout(failTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (goalServeTimerRef.current) clearTimeout(goalServeTimerRef.current);
      handStreamRef.current?.stop();
      peerRef.current?.cleanup();
      // localStream tracks belong to React state; capture and stop
      setLocalStream((s) => {
        s?.getTracks().forEach((t) => t.stop());
        return null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ---- HAND TRACKER: bind to the <video data-feed="local"> element. ----
  // Identifying the local video by a DOM data attribute is bulletproof — there
  // is exactly one element in the document with this attribute and it's set
  // statically in JSX based on which slot owns the local stream.
  useEffect(() => {
    if (!localStream || handStreamRef.current) return;
    let cancelled = false;
    let attempts = 0;
    const tryInit = () => {
      if (cancelled || handStreamRef.current) return;
      const target = document.querySelector(
        'video[data-feed="local"]'
      ) as HTMLVideoElement | null;
      if (target && target.srcObject && target.readyState >= 1) {
        // eslint-disable-next-line no-console
        console.log(
          "[HandTracker] bound to video[data-feed=local], srcObject===localStream:",
          target.srcObject === localStream
        );
        const hs = new HandStream(target);
        handStreamRef.current = hs;
        hs.start().catch((e) => {
          console.error("hand tracker init failed", e);
          handStreamRef.current = null;
          setError(
            "Hand tracker failed to load. " +
              (e?.message || String(e)) +
              " — try a hard refresh (Cmd/Ctrl+Shift+R) or another browser."
          );
          setConn("error");
        });
        return;
      }
      if (attempts++ < 200) setTimeout(tryInit, 50);
    };
    tryInit();
    return () => {
      cancelled = true;
    };
  }, [localStream]);

  // ---- COUNTDOWN ----
  const [countdown, setCountdown] = useState<number | null>(null);
  const startCountdown = useCallback(() => {
    if (stateRef.current.status === "playing") return;
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    stateRef.current = freshGame();
    stateRef.current.status = "countdown";
    let n = 3;
    setCountdown(n);
    sfx.countdown();
    countdownIntervalRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        setCountdown(null);
        stateRef.current.status = "playing";
        serveTowards(stateRef.current, Math.random() < 0.5 ? "top" : "bottom");
        sfx.start();
      } else {
        setCountdown(n);
        sfx.countdown();
      }
    }, 900);
  }, []);

  // ---- GAME LOOP ----
  useEffect(() => {
    let raf = 0;
    let lastSend = 0;
    let lastBroadcast = 0;
    let lastRender = 0;
    let last = performance.now();

    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const s = stateRef.current;
      const prevTop = { ...prevPaddleRef.current.top };
      const prevBot = { ...prevPaddleRef.current.bot };

      const my = handStreamRef.current?.getSample();
      if (my && my.confidence > 0.05) {
        const mirroredX = 1 - my.x;
        if (selfSide === "top") {
          s.topPaddle.x = mirroredX;
          s.topPaddle.y =
            ARENA.TOP_LINE + my.y * (1 - ARENA.PADDLE_R - ARENA.TOP_LINE);
          clampTopPaddle(s.topPaddle);
        } else {
          s.bottomPaddle.x = mirroredX;
          s.bottomPaddle.y =
            1 + ARENA.PADDLE_R + my.y * (ARENA.BOTTOM_LINE - 1 - ARENA.PADDLE_R);
          clampBottomPaddle(s.bottomPaddle);
        }
      }

      // Host needs the opponent's hand applied directly (drives physics). Guest
      // does NOT — the opponent paddle on guest is the host's authoritative
      // top paddle from the puck broadcast, smoothed in the else branch below.
      // Updating from the raw hand sample at 60Hz fights with that smoothing.
      if (isHost) {
        const op = remoteSampleRef.current;
        if (op.confidence > 0.05) {
          const mirroredX = 1 - op.x;
          s.bottomPaddle.x = mirroredX;
          s.bottomPaddle.y =
            1 + ARENA.PADDLE_R + op.y * (ARENA.BOTTOM_LINE - 1 - ARENA.PADDLE_R);
          clampBottomPaddle(s.bottomPaddle);
        }
      }

      if (isHost) {
        const r = stepPhysics(s, dt, prevTop, prevBot);

        if (r.paddleHit) {
          fxRef.current?.burst(s.puck.x, s.puck.y, "#ffd400", 22);
          fxRef.current?.shake(7, 180);
          sfx.hit();
          if (peerRef.current)
            sendDc(peerRef.current, { t: "hit", x: s.puck.x, y: s.puck.y });
        }
        if (r.wallHit) {
          fxRef.current?.burst(s.puck.x, s.puck.y, "#00e5ff", 10);
          sfx.wallBounce();
          if (peerRef.current)
            sendDc(peerRef.current, { t: "wall", x: s.puck.x, y: s.puck.y });
        }
        if (r.goal) {
          const who = r.goal;
          if (who === "top") s.topScore += 1;
          else s.bottomScore += 1;
          s.lastScorer = who;
          s.status = "goal";
          fxRef.current?.flash(
            who === "top" ? "rgba(255,43,214,0.8)" : "rgba(0,229,255,0.8)"
          );
          fxRef.current?.shake(24, 520);
          fxRef.current?.burst(
            0.5,
            who === "top" ? 0.05 : ARENA.H - 0.05,
            who === "top" ? "#ff2bd6" : "#00e5ff",
            90
          );
          sfx.goal();
          if (peerRef.current) sendDc(peerRef.current, { t: "score", who });

          if (s.topScore >= WIN_SCORE || s.bottomScore >= WIN_SCORE) {
            s.status = "over";
          } else {
            if (goalServeTimerRef.current) clearTimeout(goalServeTimerRef.current);
            goalServeTimerRef.current = setTimeout(() => {
              if (stateRef.current.status === "goal") {
                stateRef.current.status = "playing";
                serveTowards(stateRef.current, who === "top" ? "bottom" : "top");
              }
            }, 1300);
          }
        }
      } else {
        // GUEST smoothing: blend velocity toward authoritative target while
        // integrating locally + gentle position correction. Smooth visuals at
        // 60Hz broadcasts without ever freezing between packets.
        const tgt = puckTargetRef.current;
        if (tgt) {
          s.puck.vx += (tgt.vx - s.puck.vx) * Math.min(1, dt * 18);
          s.puck.vy += (tgt.vy - s.puck.vy) * Math.min(1, dt * 18);
          s.puck.x += s.puck.vx * dt;
          s.puck.y += s.puck.vy * dt;
          s.puck.x += (tgt.px - s.puck.x) * Math.min(1, dt * 12);
          s.puck.y += (tgt.py - s.puck.y) * Math.min(1, dt * 12);
          s.topPaddle.x += (tgt.tx - s.topPaddle.x) * Math.min(1, dt * 22);
          s.topPaddle.y += (tgt.ty - s.topPaddle.y) * Math.min(1, dt * 22);
        }
      }

      prevPaddleRef.current.top = { ...s.topPaddle };
      prevPaddleRef.current.bot = { ...s.bottomPaddle };

      if (peerRef.current && now - lastSend > 33) {
        lastSend = now;
        const me = handStreamRef.current?.getSample();
        if (me) {
          sendDc(peerRef.current, {
            t: "hand",
            x: me.x,
            y: me.y,
            c: me.confidence,
          });
        }
      }

      if (isHost && peerRef.current && now - lastBroadcast > 16) {
        lastBroadcast = now;
        sendDc(peerRef.current, {
          t: "puck",
          px: s.puck.x,
          py: s.puck.y,
          vx: s.puck.vx,
          vy: s.puck.vy,
          tx: s.topPaddle.x,
          ty: s.topPaddle.y,
          ts: s.topScore,
          bs: s.bottomScore,
          st: s.status,
          ls: s.lastScorer,
        });
      }

      // host auto-starts countdown when BOTH players have a confident hand sample
      if (
        isHost &&
        s.status === "lobby" &&
        !countdownIntervalRef.current &&
        (handStreamRef.current?.getSample().confidence ?? 0) > 0.5 &&
        remoteSampleRef.current.confidence > 0.5
      ) {
        startCountdown();
      }

      // throttle React rerenders to ~12Hz; canvas reads state directly via ref
      if (now - lastRender > 80) {
        lastRender = now;
        setTick((t) => (t + 1) & 0xff);
      }

      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [isHost, selfSide]);

  const read = useMemo(() => () => stateRef.current, []);

  const startWhenReady = () => {
    sfx.uiClick();
    startCountdown();
  };

  const restart = () => {
    if (!isHost) return;
    sfx.uiClick();
    startCountdown();
  };

  const toggleMic = () => {
    if (!localStream) return;
    setMicMuted((prev) => {
      const next = !prev;
      localStream.getAudioTracks().forEach((t) => (t.enabled = !next));
      next ? sfx.mute() : sfx.unmute();
      return next;
    });
  };

  const sendChat = (text: string) => {
    const trimmed = text.trim().slice(0, 240);
    if (!trimmed) return;
    setChatMessages((prev) => [
      ...prev.slice(-49),
      { id: chatIdRef.current++, from: "me", text: trimmed, ts: Date.now() },
    ]);
    if (peerRef.current) sendDc(peerRef.current, { t: "chat", text: trimmed });
  };

  const exit = () => {
    leftIntentionallyRef.current = true;
    try {
      if (peerRef.current?.dc?.readyState === "open") {
        peerRef.current.dc.send(JSON.stringify({ t: "leave" }));
      }
    } catch {}
    router.push("/");
  };

  const s = stateRef.current;
  // suppress unused-var warnings for the throttled tick state
  void tick;

  // determine which slot owns the local feed
  const topStream = isHost ? localStream : remoteStream;
  const bottomStream = isHost ? remoteStream : localStream;

  return (
    <main
      className="relative w-screen overflow-hidden text-white"
      style={{ height: "100dvh" }}
    >
      <Particles density={120} />

      <div
        className="relative z-10 w-full mx-auto max-w-[820px] flex flex-col bg-black/40 border-x border-cyan-400/20"
        style={{ height: "100dvh" }}
      >
        {/* hole strip - top */}
        <div className="relative w-full" style={{ height: "7%" }} />

        {/* TOP feed */}
        <div className="relative w-full flex-1 overflow-hidden">
          <VideoFeed
            stream={topStream}
            feed={isHost ? "local" : "remote"}
            muted={isHost ? true : false}
            mirror
          />
          <div className="absolute top-2 left-2 z-20 text-[10px] font-mono tracking-[0.3em] px-2 py-1 bg-black/60 border border-cyber-pink/60 text-cyber-pink">
            {isHost ? "P1 // YOU" : "P1 // OPPONENT"}
          </div>
        </div>

        <div className="relative w-full h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

        {/* BOTTOM feed */}
        <div className="relative w-full flex-1 overflow-hidden">
          <VideoFeed
            stream={bottomStream}
            feed={isHost ? "remote" : "local"}
            muted={isHost ? false : true}
            mirror
          />
          <div className="absolute bottom-2 left-2 z-20 text-[10px] font-mono tracking-[0.3em] px-2 py-1 bg-black/60 border border-cyber-cyan/60 text-cyber-cyan">
            {isHost ? "P2 // OPPONENT" : "P2 // YOU"}
          </div>
        </div>

        <div className="relative w-full" style={{ height: "7%" }} />

        <GameCanvas read={read} selfSide={selfSide} fxRef={fxRef} holeFraction={0.07} />

        {/* MIC TOGGLE — only meaningful once we have a peer */}
        {(conn === "ready" ||
          conn === "waiting" ||
          conn === "connecting") && (
          <button
            onClick={toggleMic}
            className={
              "absolute bottom-3 left-3 z-40 px-3 py-2 border bg-black/70 backdrop-blur-sm font-mono text-[10px] tracking-[0.3em] " +
              (micMuted
                ? "border-cyber-red/70 text-cyber-red"
                : "border-cyber-cyan/70 text-cyber-cyan hover:text-white")
            }
            title={micMuted ? "Unmute mic" : "Mute mic"}
          >
            {micMuted ? "✕ MIC OFF" : "● MIC ON"}
          </button>
        )}

        {/* TEXT CHAT */}
        {(conn === "ready" ||
          conn === "waiting" ||
          conn === "connecting") && (
          <Chat messages={chatMessages} onSend={sendChat} />
        )}

        {/* HUD */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-40 flex gap-2 items-center text-[10px] font-mono tracking-[0.3em] pointer-events-none">
          <span
            className={
              "px-2 py-0.5 border " +
              (conn === "ready"
                ? "border-cyber-cyan/70 text-cyber-cyan"
                : "border-cyber-pink/70 text-cyber-pink animate-pulse")
            }
          >
            ◉ {conn.toUpperCase()}
          </span>
          {roomId && (
            <span className="px-2 py-0.5 border border-white/40 text-white">
              ROOM&nbsp;{roomId}
            </span>
          )}
          {diag && conn !== "ready" && (
            <span className="px-2 py-0.5 border border-yellow-300/40 text-yellow-200">
              {diag}
            </span>
          )}
          {(() => {
            const myConf = handStreamRef.current?.getSample().confidence ?? 0;
            const myHasMoved =
              (handStreamRef.current?.getSample().landmarks ?? 0) > 0;
            const opConf = remoteSampleRef.current.confidence;
            const opHasMoved = remoteSampleRef.current.landmarks > 0;
            return (
              <>
                <span
                  className={
                    "px-2 py-0.5 border " +
                    (myConf > 0.5 && myHasMoved
                      ? "border-cyber-cyan/70 text-cyber-cyan"
                      : "border-white/30 text-white/40")
                  }
                >
                  MY HAND {myConf > 0.5 && myHasMoved ? "✓" : "—"}
                </span>
                <span
                  className={
                    "px-2 py-0.5 border " +
                    (opConf > 0.5 && opHasMoved
                      ? "border-cyber-pink/70 text-cyber-pink"
                      : "border-white/30 text-white/40")
                  }
                >
                  OPP HAND {opConf > 0.5 && opHasMoved ? "✓" : "—"}
                </span>
              </>
            );
          })()}
        </div>

        {/* WAITING / CONNECTING OVERLAY */}
        <AnimatePresence>
          {(conn === "init" ||
            conn === "permissions" ||
            conn === "waiting" ||
            conn === "connecting") && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-6 pointer-events-auto p-6 text-center"
            >
              <div className="text-cyber-cyan text-xs font-mono tracking-[0.5em]">
                {conn === "permissions"
                  ? "REQUESTING CAMERA"
                  : conn === "waiting"
                  ? "AWAITING CHALLENGER"
                  : conn === "connecting"
                  ? "ESTABLISHING LINK"
                  : "BOOTING"}
              </div>
              {roomId && conn === "waiting" && (
                <>
                  <div className="text-fuchsia-300 text-xs font-mono tracking-[0.4em]">
                    SHARE THIS CODE WITH YOUR FRIEND
                  </div>
                  <motion.div
                    initial={{ scale: 0.85 }}
                    animate={{ scale: 1 }}
                    className="font-display text-5xl sm:text-6xl font-black text-cyber-pink neon-text tracking-[0.4em] cursor-pointer max-w-full break-all px-4"
                    style={{
                      textShadow:
                        "0 0 12px #ff2bd6, 0 0 32px #ff2bd6, 0 0 64px #ff2bd6",
                    }}
                    onClick={() => {
                      navigator.clipboard.writeText(roomId).catch(() => {});
                      sfx.uiClick();
                    }}
                    title="Click to copy"
                  >
                    {roomId}
                  </motion.div>
                  <div className="text-cyan-300/60 text-[10px] font-mono tracking-[0.3em]">
                    click code to copy
                  </div>
                </>
              )}
              <button onClick={exit} className="btn-arcade text-cyan-300/80 text-sm mt-2">
                ◂ EXIT
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PEER LEFT */}
        <AnimatePresence>
          {conn === "peerLeft" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-6 text-center"
            >
              <div className="text-cyber-pink text-2xl font-display tracking-widest">
                OPPONENT LEFT
              </div>
              <div className="text-white/60 text-xs max-w-md">
                The other player closed their tab or lost their connection.
              </div>
              <button onClick={exit} className="btn-arcade text-cyber-pink mt-4">
                ◂ BACK TO LOBBY
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ERROR */}
        <AnimatePresence>
          {conn === "error" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-6 text-center"
            >
              <div className="text-cyber-red text-2xl font-display tracking-widest">
                CONNECTION FAILED
              </div>
              <div className="text-white/70 max-w-md text-sm whitespace-pre-line">{error}</div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => {
                    if (typeof window !== "undefined") window.location.reload();
                  }}
                  className="btn-arcade text-cyber-cyan"
                >
                  ↻ RETRY
                </button>
                <button onClick={exit} className="btn-arcade text-cyber-pink">
                  ◂ BACK TO LOBBY
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* READY-TO-START */}
        <AnimatePresence>
          {conn === "ready" && s.status === "lobby" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 flex items-center justify-center"
            >
              <div className="bg-black/70 backdrop-blur-sm p-8 border border-cyber-cyan/40 text-center max-w-sm">
                <div className="text-cyber-cyan text-xs font-mono tracking-[0.5em] mb-2">
                  LINK ESTABLISHED
                </div>
                <div className="text-white text-2xl font-display tracking-widest mb-4">
                  RAISE A HAND
                </div>
                <div className="text-white/60 text-xs mb-6">
                  Show your open palm to the camera. Move it to control your paddle.
                </div>
                {isHost ? (
                  <button onClick={startWhenReady} className="btn-arcade text-cyber-pink text-lg">
                    ▸ START MATCH
                  </button>
                ) : (
                  <div className="text-cyber-pink text-sm font-mono tracking-[0.3em] animate-pulse">
                    waiting for host...
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* COUNTDOWN */}
        <AnimatePresence>
          {countdown !== null && (
            <motion.div
              key={countdown}
              initial={{ scale: 2.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
            >
              <div
                className="font-display text-[20vh] font-black text-cyber-pink neon-text"
                style={{
                  textShadow: "0 0 24px #ff2bd6, 0 0 64px #ff2bd6, 0 0 128px #ff2bd6",
                }}
              >
                {countdown}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* GOAL */}
        <AnimatePresence>
          {s.status === "goal" && s.lastScorer && (
            <motion.div
              initial={{ scale: 0.4, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 1.4, opacity: 0 }}
              className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
            >
              <div
                className="font-display text-[16vh] font-black"
                style={{
                  color: s.lastScorer === "top" ? "#ff2bd6" : "#00e5ff",
                  textShadow: `0 0 24px ${
                    s.lastScorer === "top" ? "#ff2bd6" : "#00e5ff"
                  }, 0 0 96px ${s.lastScorer === "top" ? "#ff2bd6" : "#00e5ff"}`,
                }}
              >
                GOAL!
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* WIN */}
        <AnimatePresence>
          {s.status === "over" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-6 text-center"
            >
              <div className="text-white/70 text-xs font-mono tracking-[0.5em]">
                MATCH OVER
              </div>
              <div
                className="font-display text-7xl font-black"
                style={{
                  color: s.topScore > s.bottomScore ? "#ff2bd6" : "#00e5ff",
                  textShadow: `0 0 24px ${
                    s.topScore > s.bottomScore ? "#ff2bd6" : "#00e5ff"
                  }, 0 0 96px ${
                    s.topScore > s.bottomScore ? "#ff2bd6" : "#00e5ff"
                  }`,
                }}
              >
                {s.topScore > s.bottomScore ? "P1 WINS" : "P2 WINS"}
              </div>
              <div className="text-white/80 text-2xl font-mono">
                {s.topScore} - {s.bottomScore}
              </div>
              <div className="flex gap-3 mt-4">
                {isHost && (
                  <button onClick={restart} className="btn-arcade text-cyber-pink text-lg">
                    ▸ REMATCH
                  </button>
                )}
                <button onClick={exit} className="btn-arcade text-cyan-300 text-lg">
                  ◂ EXIT
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
