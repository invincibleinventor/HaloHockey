# HALO HOCKEY

Two-player real-time air hockey, controlled by **your hands** in front of your webcam.

- Top half = Player 1's camera feed, bottom half = Player 2's
- Each player's hand position drives their paddle (computer vision, on-device)
- A "defend line" near the back of each half clamps how far back the paddle can travel
- Beyond the defend line is the **goal slot** — if the puck makes it through, the other player scores
- First to 7. Hollywood-grade VFX.

## Tech

- **Next.js 14 (App Router)** + TypeScript + Tailwind, deploys to Vercel
- **WebRTC** peer-to-peer for video and a 60 Hz data channel for game state
- **Firebase Firestore** as the WebRTC signaling backplane
- **MediaPipe Tasks Vision (`HandLandmarker`)** for hand tracking, in-browser WASM/GPU. Swap to `onnxruntime-web` with a hand-pose ONNX model in `lib/handTracker.ts` if you'd rather use ONNX Runtime — the rest of the app consumes a normalized `HandSample`.
- **Framer Motion** + custom canvas particle system + Web Audio for VFX/SFX

## Setup

1. **Firebase**: create a project, enable Firestore. Paste the rules from `firestore.rules` (Firestore → Rules → Publish). Grab the web-app config.
2. Copy `.env.local.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

3. **TURN (required for cross-network play)**. WebRTC needs a TURN relay across strict NATs (cellular, two different ISPs, hotspots, corporate networks). For two friends in different cities, **you must configure TURN or the connection will fail**.

   Free TURN options without a credit card:

   - **Cloudflare Calls** (recommended). Sign up free at https://dash.cloudflare.com, open Calls, generate a TURN token. No card.
   - **ExpressTURN** free tier — email signup.
   - **Self-host CoTURN** on a free VPS (Fly.io, Oracle Cloud Always Free) if you want full control.

   Add the credentials to your env:

   ```
   NEXT_PUBLIC_TURN_URL=turn:host:port,turns:host:port?transport=tcp
   NEXT_PUBLIC_TURN_USERNAME=...
   NEXT_PUBLIC_TURN_CREDENTIAL=...
   ```

   The app falls back to Metered's OpenRelay public TURN if no env vars are set; that public service has been flaky and may now require a Metered account, so don't rely on it for production.

4. Install + run:

```
npm install
npm run dev
```

Visit `http://localhost:3000`. To play with your phone over the LAN, use `npm run dev:https` — Next will mint a self-signed cert. Phones browsing your laptop's LAN IP need HTTPS for `getUserMedia`.

## Deploy to Vercel

```
vercel
```

Add the same `NEXT_PUBLIC_FIREBASE_*` and (importantly) `NEXT_PUBLIC_TURN_*` env vars in Vercel project settings → Environment Variables. Redeploy.

## Controls

Show your **open palm** to the camera. Move it around — your paddle follows your X position, with Y constrained between the defend line and the center.

## Production notes

- Firestore rules in `firestore.rules` allow public read/write only on `rooms/*` with strict shape checks (offer/answer/status). Apply them in the Firebase console — test-mode rules expire after 30 days.
- Rooms are deleted by the host on cleanup, but Firestore doesn't cascade-delete the candidate subcollections. For long-running deployments, schedule a Cloud Function or scheduled task to prune `rooms` older than 1 day.
- The data channel is `ordered: true, maxRetransmits: 0` — ordered but unreliable. Newer puck snapshots supersede older ones and any drop is invisible.
- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` are set so MediaPipe can use multi-threaded WASM.
- The host runs authoritative physics at the rAF rate (≈60 Hz) and broadcasts the puck/score state at 60 Hz. The guest does client-side prediction by integrating velocity locally and soft-snapping toward authoritative state on each broadcast.
- Hand tracker thresholds (`lib/handTracker.ts`) are tuned permissive (0.25/0.2/0.2) so fast/blurry hands still register. Big position jumps bypass smoothing so the paddle snaps back the moment MediaPipe re-acquires.

## File map

```
app/
  page.tsx                  # /  → lobby
  room/[id]/page.tsx        # /room/CODE → game
  layout.tsx, globals.css
components/
  Lobby.tsx                 # menu, create/join
  GameRoom.tsx              # boot camera, peer, tracker, game loop
  GameCanvas.tsx            # canvas overlay (paddles, puck, holes, VFX)
  VideoFeed.tsx             # declarative <video> with srcObject lifecycle
  Particles.tsx             # background starfield
lib/
  firebase.ts               # firestore client
  webrtc.ts                 # createRoom / joinRoom + data-channel helpers
  handTracker.ts            # MediaPipe HandLandmarker wrapper
  game.ts                   # arena + physics
  audio.ts                  # Web Audio SFX
firestore.rules             # apply in Firebase console
```
