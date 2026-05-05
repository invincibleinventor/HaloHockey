"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import GameCanvas, { CanvasFx } from "./GameCanvas";
import Particles from "./Particles";
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
  const [actualRoomId, setActualRoomId] = useState<string | null>(roomId);
  const [diag, setDiag] = useState<string>("");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const fxRef = useRef<CanvasFx | null>(null);
  const stateRef = useRef<GameState>(freshGame());
  const peerRef = useRef<PeerHandle | null>(null);
  const handStreamRef = useRef<HandStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
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
  const [, forceRender] = useState(0);

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
            "Camera unavailable on this page. Open the app over HTTPS (or localhost). Phones browsing your laptop's LAN IP over plain http:// will hit this — use `npm run dev:https`, ngrok, or deploy to Vercel."
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 60, min: 30 },
            facingMode: "user",
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          await localVideoRef.current.play().catch(() => {});
        }

        // start hand tracking on local video once ready
        const hs = new HandStream(localVideoRef.current!);
        handStreamRef.current = hs;
        hs.start().catch((e) => {
          console.error("hand tracker init failed", e);
          setError("Hand tracker failed to load. Refresh and try again.");
        });

        const onTrack = (s: MediaStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = s;
            remoteVideoRef.current.play().catch(() => {});
          }
        };
        const onMessage = (msg: any) => {
          if (msg.t === "hand") {
            remoteSampleRef.current = {
              x: msg.x,
              y: msg.y,
              confidence: msg.c ?? 1,
              landmarks: 21,
            };
          } else if (msg.t === "puck" && !isHost) {
            // guest applies authoritative state from host with soft snap
            const s = stateRef.current;
            const dx = msg.px - s.puck.x;
            const dy = msg.py - s.puck.y;
            const distSq = dx * dx + dy * dy;
            // big jump (e.g. after a goal serve) -> hard snap; otherwise lerp
            if (distSq > 0.04) {
              s.puck.x = msg.px;
              s.puck.y = msg.py;
            } else {
              s.puck.x += dx * 0.4;
              s.puck.y += dy * 0.4;
            }
            s.puck.vx = msg.vx;
            s.puck.vy = msg.vy;
            // top paddle: also soft-lerp so it doesn't snap at 30Hz
            s.topPaddle.x += (msg.tx - s.topPaddle.x) * 0.6;
            s.topPaddle.y += (msg.ty - s.topPaddle.y) * 0.6;
            s.topScore = msg.ts;
            s.bottomScore = msg.bs;
            s.status = msg.st;
            s.lastScorer = msg.ls ?? null;
          } else if (msg.t === "score" && !isHost) {
            // VFX trigger from host
            if (msg.who === "top") {
              fxRef.current?.burst(0.5, 0.05, "#ff2bd6", 80);
              fxRef.current?.flash("rgba(255,43,214,0.8)");
            } else {
              fxRef.current?.burst(0.5, ARENA.H - 0.05, "#00e5ff", 80);
              fxRef.current?.flash("rgba(0,229,255,0.8)");
            }
            fxRef.current?.shake(22, 480);
            sfx.goal();
          } else if (msg.t === "ready") {
            // both ready — host starts countdown
            if (isHost) startCountdown();
          } else if (msg.t === "reset" && !isHost) {
            // host restarted
          }
        };
        const onOpen = () => {
          setConn("ready");
          // tell peer we're ready
          if (peerRef.current) sendDc(peerRef.current, { t: "ready" });
        };
        const onClose = () => {
          setConn("connecting");
        };

        let failTimer: ReturnType<typeof setTimeout> | null = null;
        let restartedOnce = false;
        const clearFail = () => {
          if (failTimer) {
            clearTimeout(failTimer);
            failTimer = null;
          }
        };
        const onState = (label: string) => {
          setDiag(label);
          // recovery on transient ICE failure: try ICE restart once (host only)
          if ((label === "ice:failed" || label === "pc:failed") && !restartedOnce) {
            if (isHost && peerRef.current) {
              restartedOnce = true;
              try {
                (peerRef.current.pc as any).restartIce?.();
              } catch {}
            }
            // give it 8s to recover before declaring fatal
            clearFail();
            failTimer = setTimeout(() => {
              setError(
                "Couldn't establish a peer connection. On cellular / strict NATs you usually need a TURN server. Add NEXT_PUBLIC_TURN_URL / _USERNAME / _CREDENTIAL to .env.local (free TURN: metered.ca) and reload."
              );
              setConn("error");
            }, 8000);
          }
          if (label === "ice:connected" || label === "ice:completed" || label === "dc:open") {
            clearFail();
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
          // strip ?host=1 from the URL so the host can share the bare /room/CODE
          if (typeof window !== "undefined") {
            const u = new URL(window.location.href);
            u.search = "";
            history.replaceState({}, "", u.toString());
          }
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
      handStreamRef.current?.stop();
      peerRef.current?.cleanup();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ---- COUNTDOWN ----
  const [countdown, setCountdown] = useState<number | null>(null);
  function startCountdown() {
    if (stateRef.current.status === "playing") return;
    stateRef.current = freshGame();
    stateRef.current.status = "countdown";
    let n = 3;
    setCountdown(n);
    sfx.countdown();
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        setCountdown(null);
        stateRef.current.status = "playing";
        serveTowards(stateRef.current, Math.random() < 0.5 ? "top" : "bottom");
        sfx.start();
      } else {
        setCountdown(n);
        sfx.countdown();
      }
    }, 900);
  }

  // ---- GAME LOOP (host runs physics, both render) ----
  useEffect(() => {
    let raf = 0;
    let lastSend = 0;
    let lastBroadcast = 0;
    let last = performance.now();

    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const s = stateRef.current;

      // 0) snapshot previous paddle positions (for collision velocity transfer)
      const prevTop = { ...prevPaddleRef.current.top };
      const prevBot = { ...prevPaddleRef.current.bot };

      // 1) compute MY paddle from MY hand
      const my = handStreamRef.current?.getSample();
      if (my && my.confidence > 0.05) {
        const mirroredX = 1 - my.x;
        if (selfSide === "top") {
          const py =
            ARENA.TOP_LINE + my.y * (1 - ARENA.PADDLE_R - ARENA.TOP_LINE);
          s.topPaddle.x = mirroredX;
          s.topPaddle.y = py;
          clampTopPaddle(s.topPaddle);
        } else {
          const py =
            1 + ARENA.PADDLE_R + my.y * (ARENA.BOTTOM_LINE - 1 - ARENA.PADDLE_R);
          s.bottomPaddle.x = mirroredX;
          s.bottomPaddle.y = py;
          clampBottomPaddle(s.bottomPaddle);
        }
      }

      // 2) get OPPONENT paddle from remote sample
      const op = remoteSampleRef.current;
      if (op.confidence > 0.05) {
        const mirroredX = 1 - op.x;
        if (selfSide === "top") {
          // opponent is bottom
          s.bottomPaddle.x = mirroredX;
          s.bottomPaddle.y =
            1 + ARENA.PADDLE_R + op.y * (ARENA.BOTTOM_LINE - 1 - ARENA.PADDLE_R);
          clampBottomPaddle(s.bottomPaddle);
        } else {
          s.topPaddle.x = mirroredX;
          s.topPaddle.y =
            ARENA.TOP_LINE + op.y * (1 - ARENA.PADDLE_R - ARENA.TOP_LINE);
          clampTopPaddle(s.topPaddle);
        }
      }

      // 3) host runs physics; guest integrates puck locally for smooth motion
      if (isHost) {
        const r = stepPhysics(s, dt, prevTop, prevBot);

        if (r.paddleHit) {
          fxRef.current?.burst(s.puck.x, s.puck.y, "#ffd400", 22);
          fxRef.current?.shake(7, 180);
          sfx.hit();
        }
        if (r.wallHit) {
          fxRef.current?.burst(
            s.puck.x,
            s.puck.y,
            "#00e5ff",
            10
          );
          sfx.wallBounce();
        }
        if (r.goal) {
          const who = r.goal;
          if (who === "top") s.topScore += 1;
          else s.bottomScore += 1;
          s.lastScorer = who;
          s.status = "goal";
          fxRef.current?.flash(
            who === "top"
              ? "rgba(255,43,214,0.8)"
              : "rgba(0,229,255,0.8)"
          );
          fxRef.current?.shake(24, 520);
          fxRef.current?.burst(
            0.5,
            who === "top" ? 0.05 : ARENA.H - 0.05,
            who === "top" ? "#ff2bd6" : "#00e5ff",
            90
          );
          sfx.goal();
          if (peerRef.current)
            sendDc(peerRef.current, { t: "score", who });

          if (s.topScore >= WIN_SCORE || s.bottomScore >= WIN_SCORE) {
            s.status = "over";
          } else {
            // serve again after delay, toward the player who just got scored on
            setTimeout(() => {
              if (stateRef.current.status === "goal") {
                stateRef.current.status = "playing";
                serveTowards(stateRef.current, who === "top" ? "bottom" : "top");
              }
            }, 1300);
          }
        }
      } else if (s.status === "playing") {
        // guest: integrate puck velocity locally between authoritative updates
        s.puck.x += s.puck.vx * dt;
        s.puck.y += s.puck.vy * dt;
        const damp = Math.pow(0.995, dt * 60);
        s.puck.vx *= damp;
        s.puck.vy *= damp;
      }

      // remember paddle positions for next frame's velocity calc
      prevPaddleRef.current.top = { ...s.topPaddle };
      prevPaddleRef.current.bot = { ...s.bottomPaddle };

      // 4) send my hand to peer (~30Hz)
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

      // 5) host broadcasts authoritative state ~60Hz
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

      forceRender((n) => (n + 1) % 1000);
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
    if (peerRef.current) sendDc(peerRef.current, { t: "reset" });
  };

  const s = stateRef.current;

  return (
    <main className="relative h-screen w-screen overflow-hidden text-white">
      <Particles density={120} />

      {/* GAME ARENA */}
      <div className="relative z-10 h-full w-full mx-auto max-w-[820px] aspect-[3/5] sm:aspect-auto sm:max-h-[100vh] flex flex-col bg-black/40 border-x border-cyan-400/20">
        {/* hole strip - top */}
        <div className="relative w-full" style={{ height: "7%" }} />

        {/* top video (host's feed) */}
        <div className="relative w-full flex-1 overflow-hidden">
          <video
            ref={isHost ? localVideoRef : remoteVideoRef}
            autoPlay
            playsInline
            muted
            className="video-mirror absolute inset-0 w-full h-full object-cover"
          />
          {/* feed label */}
          <div className="absolute top-2 left-2 z-20 text-[10px] font-mono tracking-[0.3em] px-2 py-1 bg-black/60 border border-cyber-pink/60 text-cyber-pink">
            {isHost ? "P1 // YOU" : "P1 // OPPONENT"}
          </div>
        </div>

        {/* center divider */}
        <div className="relative w-full h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

        {/* bottom video (guest's feed) */}
        <div className="relative w-full flex-1 overflow-hidden">
          <video
            ref={isHost ? remoteVideoRef : localVideoRef}
            autoPlay
            playsInline
            muted
            className="video-mirror absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute bottom-2 left-2 z-20 text-[10px] font-mono tracking-[0.3em] px-2 py-1 bg-black/60 border border-cyber-cyan/60 text-cyber-cyan">
            {isHost ? "P2 // OPPONENT" : "P2 // YOU"}
          </div>
        </div>

        {/* hole strip - bottom */}
        <div className="relative w-full" style={{ height: "7%" }} />

        {/* GAME CANVAS OVERLAY */}
        <GameCanvas read={read} selfSide={selfSide} fxRef={fxRef} holeFraction={0.07} />

        {/* HUD: top status bar */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-40 flex gap-3 items-center text-[10px] font-mono tracking-[0.3em] pointer-events-none">
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
          {actualRoomId && (
            <span className="px-2 py-0.5 border border-white/40 text-white">
              ROOM&nbsp;{actualRoomId}
            </span>
          )}
          {diag && conn !== "ready" && (
            <span className="px-2 py-0.5 border border-yellow-300/40 text-yellow-200">
              {diag}
            </span>
          )}
        </div>

        {/* WAITING / COUNTDOWN / WIN OVERLAY */}
        <AnimatePresence>
          {conn !== "ready" && conn !== "error" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-6 pointer-events-auto"
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
              {actualRoomId && conn === "waiting" && (
                <>
                  <div className="text-fuchsia-300 text-xs font-mono tracking-[0.4em]">
                    SHARE THIS CODE WITH YOUR FRIEND
                  </div>
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className="font-display text-5xl sm:text-6xl font-black text-cyber-pink neon-text tracking-[0.4em] cursor-pointer max-w-full break-all text-center px-4"
                    style={{
                      textShadow:
                        "0 0 12px #ff2bd6, 0 0 32px #ff2bd6, 0 0 64px #ff2bd6",
                    }}
                    onClick={() => {
                      navigator.clipboard
                        .writeText(actualRoomId)
                        .catch(() => {});
                      sfx.uiClick();
                    }}
                    title="Click to copy"
                  >
                    {actualRoomId}
                  </motion.div>
                  <div className="text-cyan-300/60 text-[10px] font-mono tracking-[0.3em]">
                    OR SHARE LINK · click code to copy
                  </div>
                </>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => router.push("/")}
                  className="btn-arcade text-cyan-300/80 text-sm"
                >
                  ◂ EXIT
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ERROR */}
        <AnimatePresence>
          {conn === "error" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-50 bg-black/85 flex flex-col items-center justify-center gap-4 p-6 text-center"
            >
              <div className="text-cyber-red text-2xl font-display tracking-widest">
                CONNECTION FAILED
              </div>
              <div className="text-white/70 max-w-md text-sm">{error}</div>
              <button
                onClick={() => router.push("/")}
                className="btn-arcade text-cyber-pink mt-4"
              >
                ◂ BACK TO LOBBY
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* READY-TO-START prompt for host */}
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
                  textShadow:
                    "0 0 24px #ff2bd6, 0 0 64px #ff2bd6, 0 0 128px #ff2bd6",
                }}
              >
                {countdown}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* GOAL FLASH TEXT */}
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

        {/* WIN OVERLAY */}
        <AnimatePresence>
          {s.status === "over" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4"
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
                <button
                  onClick={() => router.push("/")}
                  className="btn-arcade text-cyan-300 text-lg"
                >
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
