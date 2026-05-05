"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { customAlphabet } from "nanoid";
import Particles from "./Particles";
import { sfx } from "@/lib/audio";

const codeGen = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

export default function Lobby() {
  const router = useRouter();
  const [mode, setMode] = useState<"home" | "join">("home");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onCreate = () => {
    sfx.start();
    const id = codeGen();
    router.push(`/room/${id}?host=1`);
  };

  const onJoin = () => {
    if (!code.trim()) {
      setError("Enter a room code, soldier.");
      return;
    }
    sfx.start();
    router.push(`/room/${code.trim().toUpperCase()}`);
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden text-white scanlines scanline-sweep">
      <Particles density={260} />
      <div className="grid-floor absolute inset-0 pointer-events-none opacity-50 z-10" />

      <div className="relative z-20 h-full w-full flex flex-col items-center justify-center px-6">
        {/* TITLE */}
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-12"
        >
          <h1 className="font-display font-black text-6xl sm:text-7xl md:text-9xl leading-none">
            <span
              className="text-cyber-pink neon-text"
              style={{ textShadow: "0 0 12px #ff2bd6, 0 0 32px #ff2bd6, 0 0 64px #ff2bd6" }}
            >
              HALO
            </span>{" "}
            <span
              className="text-cyber-cyan neon-text"
              style={{ textShadow: "0 0 12px #00e5ff, 0 0 32px #00e5ff, 0 0 64px #00e5ff" }}
            >
              HOCKEY
            </span>
          </h1>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="h-[2px] mt-4 bg-gradient-to-r from-cyber-pink via-cyber-cyan to-cyber-pink"
          />
        </motion.div>

        {/* CARD */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="relative w-full max-w-lg"
        >
          <div
            className="absolute -inset-1 rounded-xl opacity-70 blur-xl"
            style={{
              background:
                "linear-gradient(135deg, #ff2bd6 0%, #8a2be2 50%, #00e5ff 100%)",
            }}
          />
          <div className="relative rounded-xl bg-[#08021a]/85 border border-cyan-400/30 backdrop-blur-sm p-8">
            <AnimatePresence mode="wait">
              {mode === "home" ? (
                <motion.div
                  key="home"
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 20, opacity: 0 }}
                  className="space-y-5"
                >
                  <button
                    onMouseEnter={() => sfx.uiHover()}
                    onClick={onCreate}
                    className="btn-arcade w-full text-cyber-pink text-xl"
                  >
                    ▸ HOST NEW MATCH
                  </button>
                  <button
                    onMouseEnter={() => sfx.uiHover()}
                    onClick={() => {
                      sfx.uiClick();
                      setMode("join");
                    }}
                    className="btn-arcade w-full text-cyber-cyan text-xl"
                  >
                    ▸ JOIN BY CODE
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="join"
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -20, opacity: 0 }}
                  className="space-y-5"
                >
                  <input
                    autoFocus
                    value={code}
                    maxLength={6}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      setError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && onJoin()}
                    className="cli-input w-full"
                    placeholder="XXXXXX"
                  />
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-cyber-red text-xs font-mono tracking-[0.3em] text-center"
                      >
                        ✕ {error}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onMouseEnter={() => sfx.uiHover()}
                      onClick={() => {
                        sfx.uiClick();
                        setMode("home");
                        setError(null);
                      }}
                      className="btn-arcade text-cyan-300/70"
                    >
                      ◂ BACK
                    </button>
                    <button
                      onMouseEnter={() => sfx.uiHover()}
                      onClick={onJoin}
                      className="btn-arcade text-cyber-pink"
                    >
                      JACK IN ▸
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
