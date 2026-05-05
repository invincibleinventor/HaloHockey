# NEON SLAM // Camera Air Hockey

Two-player real-time air hockey, controlled by **your hands** in front of your webcam.

- Top half of the arena = Player 1's camera feed
- Bottom half = Player 2's camera feed
- Each player's hand position drives their paddle (computer vision, on-device)
- A "defend line" near the back of each half clamps how far back your paddle can travel
- Beyond the defend line is the **goal slot** — if the puck makes it through, the other player scores
- First to 7. Hollywood-grade VFX.

## Tech

- **Next.js 14 (App Router)** + TypeScript + Tailwind, deployable to Vercel
- **WebRTC** peer-to-peer for video and a data channel for game state (~30 Hz)
- **Firebase Firestore** as the WebRTC signaling backplane (offer / answer / ICE candidates)
- **MediaPipe Tasks Vision (`HandLandmarker`)** for hand tracking — runs in-browser on WASM/GPU. The `.task` model file is fetched from `storage.googleapis.com/mediapipe-models/...`. If you'd rather use ONNX Runtime Web with a different hand-pose ONNX model, swap the implementation in `lib/handTracker.ts`; everything downstream consumes the normalized `HandSample`.
- **Framer Motion** + custom canvas particle system + Web Audio for VFX/SFX

## Setup

1. **Firebase**: create a project at https://console.firebase.google.com, enable Firestore in test mode, and grab the web app config.
2. Copy `.env.local.example` to `.env.local` and fill in your Firebase keys:

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

3. Install + run:

```
npm install
npm run dev
```

Open `http://localhost:3000`. Allow camera access. Click **HOST NEW MATCH**, share the code with a friend (or open another tab/device and **JOIN BY CODE**), and play.

## Deploying to Vercel

```
vercel
```

Add the same `NEXT_PUBLIC_FIREBASE_*` env vars in Vercel project settings. That's it — no server, no infra.

## Notes

- The `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers in `next.config.mjs` enable `SharedArrayBuffer` so MediaPipe can run in multi-threaded WASM mode.
- Both peers should be on networks that allow STUN. For tricky NATs you can add a TURN server to the `iceServers` list in `lib/webrtc.ts`.
- Firestore rules: keep things permissive in test mode for now. For production, tighten reads/writes on `rooms/{roomId}` to be time-bounded and size-limited.

## File map

```
app/
  page.tsx                  # /  → lobby
  room/[id]/page.tsx        # /room/XXXXXX  → game
  layout.tsx, globals.css
components/
  Lobby.tsx                 # neon menu, create/join
  GameRoom.tsx              # boots camera + WebRTC + tracker, runs game loop
  GameCanvas.tsx            # all game rendering + VFX (paddles, puck, holes, particles, shake, flash)
  Particles.tsx             # background starfield
lib/
  firebase.ts               # firestore client
  webrtc.ts                 # createRoom / joinRoom + data-channel helpers
  handTracker.ts            # MediaPipe HandLandmarker wrapper, HandStream
  game.ts                   # arena constants + physics step + helpers
  audio.ts                  # Web Audio SFX
```

## Controls

Show your **open palm** to the camera. Move it around — your paddle follows. Only your X position and limited Y range matter:

- Top player paddle Y is clamped between the **defend line** (top of the top feed) and the center.
- Bottom player paddle Y is clamped between the center and the **defend line** (bottom of the bottom feed).

Everything else is just chaos and neon.
