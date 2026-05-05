"use client";

import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  z: number;
  c: string;
}

const COLORS = ["#ff2bd6", "#00e5ff", "#8a2be2", "#ffd400"];

export default function Particles({ density = 220 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let stars: Star[] = [];
    let w = 0,
      h = 0;

    const resize = () => {
      w = cv.width = window.innerWidth * devicePixelRatio;
      h = cv.height = window.innerHeight * devicePixelRatio;
      cv.style.width = `${window.innerWidth}px`;
      cv.style.height = `${window.innerHeight}px`;
      stars = Array.from({ length: density }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 0.8 + 0.2,
        c: COLORS[(Math.random() * COLORS.length) | 0],
      }));
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = () => {
      ctx.fillStyle = "rgba(5, 1, 13, 0.25)";
      ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        s.y += s.z * 1.6 * devicePixelRatio;
        if (s.y > h) {
          s.y = -2;
          s.x = Math.random() * w;
        }
        ctx.fillStyle = s.c;
        ctx.globalAlpha = s.z;
        ctx.fillRect(s.x, s.y, 1.5 * devicePixelRatio * s.z, 3 * devicePixelRatio * s.z);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [density]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 -z-0 opacity-70"
      aria-hidden
    />
  );
}
