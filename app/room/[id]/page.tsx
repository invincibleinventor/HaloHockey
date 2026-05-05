"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

// Client-only render: avoids SSR for the game room. With SSR, useSearchParams
// returns empty during the server pass for client components without Suspense,
// which races with hydration and produces mis-detected isHost / data-feed.
const GameRoom = dynamic(() => import("@/components/GameRoom"), {
  ssr: false,
  loading: () => (
    <div
      style={{ height: "100dvh" }}
      className="w-screen bg-black flex items-center justify-center text-cyber-cyan font-mono tracking-[0.5em] text-xs"
    >
      LOADING ROOM
    </div>
  ),
});

export default function RoomPage() {
  const params = useParams();
  const id = String((params?.id as string) || "").toUpperCase();
  return <GameRoom roomId={id} />;
}
