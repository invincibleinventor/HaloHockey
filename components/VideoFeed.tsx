"use client";

import { useEffect, useRef } from "react";

interface Props {
  stream: MediaStream | null;
  /** "local" or "remote" — added as a data attribute to the <video> element so
   *  the GameRoom can find the correct element via a stable DOM query. */
  feed: "local" | "remote";
  /** mute the audio of this <video> element. local feed must be muted to avoid
   *  feedback; remote feed should be unmuted so we can hear the peer. */
  muted?: boolean;
  mirror?: boolean;
  className?: string;
}

export default function VideoFeed({
  stream,
  feed,
  muted = true,
  mirror = true,
  className = "",
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) {
      v.srcObject = stream || null;
    }
    if (stream) {
      const tryPlay = () => v.play().catch(() => {});
      tryPlay();
      v.onloadedmetadata = tryPlay;
    }
    return () => {
      if (v) v.onloadedmetadata = null;
    };
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      data-feed={feed}
      className={
        (mirror ? "video-mirror " : "") +
        "absolute inset-0 w-full h-full object-cover " +
        className
      }
    />
  );
}

