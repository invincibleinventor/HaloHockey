import GameRoom from "@/components/GameRoom";

export default function RoomPage({ params }: { params: { id: string } }) {
  return <GameRoom roomId={params.id.toUpperCase()} />;
}
