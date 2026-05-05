import {
  HandLandmarker,
  FilesetResolver,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

let _landmarker: HandLandmarker | null = null;
let _initPromise: Promise<HandLandmarker> | null = null;

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

async function createLandmarker(delegate: "GPU" | "CPU"): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate,
    },
    numHands: 1,
    runningMode: "VIDEO",
    minHandDetectionConfidence: 0.25,
    minHandPresenceConfidence: 0.2,
    minTrackingConfidence: 0.2,
  });
}

export async function getHandLandmarker(): Promise<HandLandmarker> {
  if (_landmarker) return _landmarker;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Try GPU first (faster), fall back to CPU (universally supported).
    try {
      _landmarker = await createLandmarker("GPU");
    } catch (gpuErr) {
      console.warn("[HandTracker] GPU delegate failed, falling back to CPU", gpuErr);
      try {
        _landmarker = await createLandmarker("CPU");
      } catch (cpuErr) {
        _initPromise = null; // allow a retry on next call
        throw new Error(
          "MediaPipe failed to initialize on both GPU and CPU. " +
            "Likely cause: the model/WASM CDN was blocked by your network. " +
            `Original: ${(cpuErr as Error)?.message || cpuErr}`
        );
      }
    }
    return _landmarker;
  })();

  return _initPromise;
}

export interface HandSample {
  /** normalized [0,1] x of the hand center (averaged over palm landmarks) */
  x: number;
  /** normalized [0,1] y of the hand center */
  y: number;
  /** confidence proxy: 1 if detected this frame, smoothed otherwise */
  confidence: number;
  /** raw landmark count */
  landmarks: number;
}

export class HandStream {
  private video: HTMLVideoElement;
  private lm: HandLandmarker | null = null;
  private last: HandSample = { x: 0.5, y: 0.5, confidence: 0, landmarks: 0 };
  private running = false;
  private lastTs = -1;
  /** smoothing factor: 0=no smoothing, 1=hold last forever */
  smoothing = 0.25;
  /** if a new sample is more than this normalized distance away, skip smoothing */
  bigJumpDist = 0.12;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start() {
    this.lm = await getHandLandmarker();
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
  }

  getSample(): HandSample {
    return this.last;
  }

  private tick = () => {
    if (!this.running || !this.lm) return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth > 0) {
      const ts = performance.now();
      if (ts !== this.lastTs) {
        this.lastTs = ts;
        try {
          const res: HandLandmarkerResult = this.lm.detectForVideo(v, ts);
          if (res.landmarks && res.landmarks.length > 0) {
            const lms = res.landmarks[0];
            // Use palm center: average of wrist + base of fingers (0,5,9,13,17)
            const idxs = [0, 5, 9, 13, 17];
            let sx = 0,
              sy = 0;
            for (const i of idxs) {
              sx += lms[i].x;
              sy += lms[i].y;
            }
            sx /= idxs.length;
            sy /= idxs.length;
            // skip smoothing on big jumps so the paddle snaps after MediaPipe
            // re-acquires a fast-moving hand
            const dx = sx - this.last.x;
            const dy = sy - this.last.y;
            const dist = Math.hypot(dx, dy);
            const a = dist > this.bigJumpDist ? 0 : this.smoothing;
            this.last = {
              x: a * this.last.x + (1 - a) * sx,
              y: a * this.last.y + (1 - a) * sy,
              confidence: 1,
              landmarks: lms.length,
            };
          } else {
            // hold last sample at full confidence so the paddle stays put
            // (and resumes immediately when tracking re-acquires)
            this.last = { ...this.last, confidence: 1 };
          }
        } catch {
          // detector still warming up
        }
      }
    }
    requestAnimationFrame(this.tick);
  };
}
