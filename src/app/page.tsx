import { RoomStage } from '@/components/room/room-stage';
import { LiveRoom } from '@/components/live/live-room';

// The live app is the Claude Design room driven by the real backend (src/components/live). NEXT_PUBLIC_DOR_UI=room
// keeps the earlier room UI available as a fallback.
export default function HomePage() {
  return process.env.NEXT_PUBLIC_DOR_UI === 'room' ? <RoomStage /> : <LiveRoom />;
}
