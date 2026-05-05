"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface Props {
  stream: MediaStream | null;
  mirror?: boolean;
  className?: string;
}

const VideoFeed = forwardRef<HTMLVideoElement, Props>(function VideoFeed(
  { stream, mirror = true, className = "" },
  externalRef
) {
  const ref = useRef<HTMLVideoElement>(null);
  useImperativeHandle(externalRef, () => ref.current as HTMLVideoElement);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) {
      v.srcObject = stream || null;
    }
    if (stream) {
      const tryPlay = () => v.play().catch(() => {});
      tryPlay();
      // some browsers need a nudge after metadata is available
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
      muted
      className={
        (mirror ? "video-mirror " : "") +
        "absolute inset-0 w-full h-full object-cover " +
        className
      }
    />
  );
});

export default VideoFeed;
