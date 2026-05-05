"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface ChatMessage {
  id: number;
  from: "me" | "them";
  text: string;
  ts: number;
}

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export default function Chat({ messages, onSend }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSeenLen = useRef(0);

  useEffect(() => {
    if (open) {
      lastSeenLen.current = messages.length;
      setUnread(0);
      // scroll to bottom
      requestAnimationFrame(() => {
        if (listRef.current)
          listRef.current.scrollTop = listRef.current.scrollHeight;
      });
    } else {
      const newCount = messages.length - lastSeenLen.current;
      if (newCount > 0 && messages[messages.length - 1].from === "them") {
        setUnread(newCount);
      }
    }
  }, [messages, open]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft("");
  };

  return (
    <div className="absolute bottom-3 right-3 z-40 pointer-events-auto">
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ duration: 0.16 }}
            className="w-72 max-w-[80vw] flex flex-col bg-black/85 backdrop-blur-md border border-cyber-cyan/40 shadow-[0_0_24px_rgba(0,229,255,0.25)]"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-cyan-400/20">
              <span className="text-cyber-cyan text-[10px] font-mono tracking-[0.4em]">
                CHAT
              </span>
              <button
                className="text-white/60 hover:text-white text-sm leading-none"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>
            <div
              ref={listRef}
              className="px-3 py-2 h-44 overflow-y-auto no-scrollbar text-sm flex flex-col gap-1.5"
            >
              {messages.length === 0 && (
                <div className="text-white/30 text-xs font-mono tracking-wider text-center mt-12">
                  no messages yet
                </div>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    "max-w-[85%] px-2 py-1 rounded-sm " +
                    (m.from === "me"
                      ? "self-end bg-cyber-pink/20 border border-cyber-pink/40 text-cyber-pink"
                      : "self-start bg-cyber-cyan/20 border border-cyber-cyan/40 text-cyber-cyan")
                  }
                >
                  {m.text}
                </div>
              ))}
            </div>
            <form
              onSubmit={submit}
              className="flex border-t border-cyan-400/20"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="message..."
                maxLength={240}
                className="flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none font-mono"
              />
              <button
                type="submit"
                className="px-3 text-cyber-pink text-xs font-mono tracking-[0.2em] hover:text-white"
              >
                SEND ▸
              </button>
            </form>
          </motion.div>
        ) : (
          <motion.button
            key="bubble"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setOpen(true)}
            className="relative px-4 py-2 bg-black/80 border border-cyber-cyan/60 text-cyber-cyan text-xs font-mono tracking-[0.3em] hover:text-white"
          >
            CHAT
            {unread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-cyber-pink text-black text-[10px] font-bold flex items-center justify-center">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
