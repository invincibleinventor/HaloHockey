"use client";

import { useEffect, useRef } from "react";
import { ARENA, GameState } from "@/lib/game";

export interface CanvasFx {
  /** trigger a VFX burst at normalized coords */
  burst: (x: number, y: number, color: string, n?: number) => void;
  shake: (intensity?: number, ms?: number) => void;
  flash: (color?: string) => void;
}

export interface GameCanvasProps {
  /** read latest authoritative state per frame */
  read: () => GameState;
  /** "top" or "bottom" — used for HUD personalization */
  selfSide: "top" | "bottom";
  /** ref handle for triggering VFX from outside */
  fxRef?: React.MutableRefObject<CanvasFx | null>;
  /** how big the hole strips should be relative to game height (0..0.5) */
  holeFraction?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface PuckTrail {
  x: number;
  y: number;
  t: number;
}

export default function GameCanvas({
  read,
  selfSide,
  fxRef,
  holeFraction = 0.07,
}: GameCanvasProps) {
  const cvRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = cvRef.current!;
    const ctx = cv.getContext("2d", { alpha: true })!;
    const parent = cv.parentElement!;
    const particles: Particle[] = [];
    const trail: PuckTrail[] = [];
    let shakeAmp = 0;
    let shakeUntil = 0;
    let flashColor = "rgba(255,255,255,0)";
    let flashUntil = 0;
    let raf = 0;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = parent.getBoundingClientRect();
      cv.width = r.width * dpr();
      cv.height = r.height * dpr();
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const burst = (nx: number, ny: number, color: string, n = 28) => {
      const W = cv.width;
      const H = cv.height;
      const px = nx * W;
      const py = (ny / ARENA.H) * H;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (Math.random() * 220 + 80) * dpr();
        particles.push({
          x: px,
          y: py,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 0,
          max: 0.35 + Math.random() * 0.5,
          color,
          size: (1.5 + Math.random() * 3.5) * dpr(),
        });
      }
    };
    const shake = (intensity = 14, ms = 380) => {
      shakeAmp = Math.max(shakeAmp, intensity);
      shakeUntil = performance.now() + ms;
    };
    const flash = (color = "rgba(255, 255, 255, 0.8)") => {
      flashColor = color;
      flashUntil = performance.now() + 280;
    };
    if (fxRef) fxRef.current = { burst, shake, flash };

    let last = performance.now();
    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const W = cv.width;
      const H = cv.height;
      const holeH = H * holeFraction;
      // arena maps y in [0, ARENA.H] -> [holeH, H - holeH]
      const arenaH = H - 2 * holeH;
      const yArena = (yNorm: number) => holeH + (yNorm / ARENA.H) * arenaH;
      const xArena = (xNorm: number) => xNorm * W;

      ctx.save();
      ctx.clearRect(0, 0, W, H);

      // screen shake
      let sx = 0,
        sy = 0;
      if (now < shakeUntil) {
        const k = (shakeUntil - now) / 380;
        sx = (Math.random() * 2 - 1) * shakeAmp * k * dpr();
        sy = (Math.random() * 2 - 1) * shakeAmp * k * dpr();
        ctx.translate(sx, sy);
      }

      // ---- HOLE STRIPS ----
      const drawHole = (y: number, label: "TOP GOAL" | "BOTTOM GOAL", color: string) => {
        const grd = ctx.createLinearGradient(0, y, 0, y + holeH);
        const top = label === "TOP GOAL";
        grd.addColorStop(0, top ? color : "rgba(0,0,0,0.85)");
        grd.addColorStop(0.5, "rgba(0,0,0,0.92)");
        grd.addColorStop(1, top ? "rgba(0,0,0,0.85)" : color);
        ctx.fillStyle = grd;
        ctx.fillRect(0, y, W, holeH);
        // chevron pattern
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * dpr();
        ctx.globalAlpha = 0.55;
        const step = 28 * dpr();
        for (let x = -holeH; x < W + holeH; x += step) {
          ctx.beginPath();
          if (top) {
            ctx.moveTo(x, y + holeH);
            ctx.lineTo(x + holeH * 0.5, y);
            ctx.lineTo(x + holeH, y + holeH);
          } else {
            ctx.moveTo(x, y);
            ctx.lineTo(x + holeH * 0.5, y + holeH);
            ctx.lineTo(x + holeH, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // label
        ctx.fillStyle = color;
        ctx.font = `${(holeH * 0.42).toFixed(0)}px Orbitron, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowBlur = 18 * dpr();
        ctx.shadowColor = color;
        ctx.fillText(label, W / 2, y + holeH / 2);
        ctx.shadowBlur = 0;
      };
      drawHole(0, "TOP GOAL", "#ff2bd6");
      drawHole(H - holeH, "BOTTOM GOAL", "#00e5ff");

      // ---- ARENA BORDER ----
      ctx.strokeStyle = "rgba(0,229,255,0.85)";
      ctx.lineWidth = 2 * dpr();
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 18 * dpr();
      ctx.strokeRect(0, holeH, W, arenaH);
      ctx.shadowBlur = 0;

      // ---- CENTER LINE ----
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.setLineDash([14 * dpr(), 12 * dpr()]);
      ctx.beginPath();
      ctx.moveTo(0, yArena(1));
      ctx.lineTo(W, yArena(1));
      ctx.stroke();
      ctx.setLineDash([]);
      // center circle
      ctx.beginPath();
      ctx.arc(W / 2, yArena(1), Math.min(W, arenaH) * 0.07, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.stroke();

      // ---- RACKET LINES (constraint zones) ----
      const drawConstraintLine = (yNorm: number, color: string, label: string) => {
        const y = yArena(yNorm);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 * dpr();
        ctx.shadowColor = color;
        ctx.shadowBlur = 16 * dpr();
        ctx.setLineDash([22 * dpr(), 14 * dpr()]);
        ctx.lineDashOffset = -now / 18;
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(W - 8, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        // label tab
        ctx.fillStyle = color;
        ctx.font = `${(10 * dpr()).toFixed(0)}px JetBrains Mono, monospace`;
        ctx.textAlign = "left";
        ctx.fillText(label, 14 * dpr(), y - 6 * dpr());
      };
      drawConstraintLine(ARENA.TOP_LINE, "#ff2bd6", "DEFEND LINE // TOP");
      drawConstraintLine(ARENA.BOTTOM_LINE, "#00e5ff", "DEFEND LINE // BOTTOM");

      const s = read();

      // ---- PUCK TRAIL ----
      trail.push({ x: s.puck.x, y: s.puck.y, t: now });
      while (trail.length > 18) trail.shift();
      for (let i = 0; i < trail.length; i++) {
        const t = trail[i];
        const a = i / trail.length;
        ctx.beginPath();
        ctx.arc(
          xArena(t.x),
          yArena(t.y),
          ARENA.PUCK_R * Math.min(W, arenaH) * (0.4 + 0.6 * a),
          0,
          Math.PI * 2
        );
        ctx.fillStyle = `rgba(255, 212, 0, ${0.05 + a * 0.35})`;
        ctx.fill();
      }

      // ---- PADDLES ----
      const drawPaddle = (
        x: number,
        y: number,
        color: string,
        accent: string,
        label: string
      ) => {
        const cx = xArena(x);
        const cy = yArena(y);
        const r = ARENA.PADDLE_R * Math.min(W, arenaH);

        // outer glow
        const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.6);
        g.addColorStop(0, color);
        g.addColorStop(0.5, color + "55");
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
        ctx.fill();

        // disc
        ctx.fillStyle = "#0a0418";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3 * dpr();
        ctx.shadowColor = color;
        ctx.shadowBlur = 24 * dpr();
        ctx.stroke();
        ctx.shadowBlur = 0;

        // inner ring
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * dpr();
        ctx.stroke();

        // tick marks
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + now / 800;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
          ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5 * dpr();
          ctx.stroke();
        }

        // label below paddle
        ctx.fillStyle = color;
        ctx.font = `${(9 * dpr()).toFixed(0)}px JetBrains Mono, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(label, cx, cy + r + 14 * dpr());
      };
      const isSelfTop = selfSide === "top";
      drawPaddle(
        s.topPaddle.x,
        s.topPaddle.y,
        "#ff2bd6",
        "#ffe6fa",
        isSelfTop ? "P1 // YOU" : "P1"
      );
      drawPaddle(
        s.bottomPaddle.x,
        s.bottomPaddle.y,
        "#00e5ff",
        "#e6fbff",
        !isSelfTop ? "P2 // YOU" : "P2"
      );

      // ---- PUCK ----
      {
        const cx = xArena(s.puck.x);
        const cy = yArena(s.puck.y);
        const r = ARENA.PUCK_R * Math.min(W, arenaH);
        const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 2.5);
        g.addColorStop(0, "#fff8c0");
        g.addColorStop(0.4, "#ffd400");
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fffbe6";
        ctx.shadowColor = "#ffd400";
        ctx.shadowBlur = 28 * dpr();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#ffaa00";
        ctx.lineWidth = 2 * dpr();
        ctx.stroke();
      }

      // ---- PARTICLES ----
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.max) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
        const a = 1 - p.life / p.max;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12 * dpr();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // ---- SCOREBOARD over the holes ----
      const drawScore = (n: number, y: number, color: string, side: "top" | "bottom") => {
        const txt = String(n);
        ctx.font = `900 ${(holeH * 0.85).toFixed(0)}px Orbitron, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillText(txt, W * 0.12, y + holeH / 2);
        ctx.fillText(txt, W * 0.88, y + holeH / 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 30 * dpr();
        ctx.font = `900 ${(holeH * 0.85).toFixed(0)}px Orbitron, sans-serif`;
        // only draw the live score on far edges so it doesn't clip GOAL label
        ctx.fillText(txt, W * 0.07, y + holeH / 2);
        ctx.fillText(txt, W * 0.93, y + holeH / 2);
        ctx.shadowBlur = 0;
        // self indicator
        if (
          (side === "top" && selfSide === "top") ||
          (side === "bottom" && selfSide === "bottom")
        ) {
          ctx.fillStyle = color;
          ctx.font = `${(holeH * 0.18).toFixed(0)}px JetBrains Mono, monospace`;
          ctx.fillText("YOU", W * 0.07, y + holeH * 0.85);
        }
      };
      drawScore(s.topScore, 0, "#ff2bd6", "top");
      drawScore(s.bottomScore, H - holeH, "#00e5ff", "bottom");

      // ---- FLASH ----
      if (now < flashUntil) {
        const a = (flashUntil - now) / 280;
        ctx.fillStyle = flashColor.replace(/[\d.]+\)$/, `${a.toFixed(2)})`);
        ctx.fillRect(-W, -H, W * 3, H * 3);
      }

      // ---- STATUS OVERLAY ----
      if (s.status === "countdown" || s.status === "goal" || s.status === "over") {
        ctx.fillStyle = "rgba(5,1,13,0.45)";
        ctx.fillRect(0, holeH, W, arenaH);
      }

      ctx.restore();

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, selfSide, holeFraction]);

  return (
    <canvas
      ref={cvRef}
      className="absolute inset-0 z-30 pointer-events-none"
    />
  );
}
