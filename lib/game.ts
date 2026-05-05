// Normalized arena. width = 1, height = 2 (2 stacked feeds). Origin top-left.
// y in [0,1)        -> top feed (player A, "top")
// y in [1,2]        -> bottom feed (player B, "bottom")
// Top hole strip:    y in [-HOLE_H, 0)
// Bottom hole strip: y in (2, 2+HOLE_H]

export const ARENA = {
  W: 1,
  H: 2,
  HOLE_H: 0.08,
  /** racket can't go above this (top player back wall) */
  TOP_LINE: 0.08,
  /** racket can't go below this (bottom player back wall) */
  BOTTOM_LINE: 1.92,
  PADDLE_R: 0.085,
  PUCK_R: 0.038,
};

export interface PuckState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PaddleState {
  x: number;
  y: number;
}

export interface GameState {
  puck: PuckState;
  topPaddle: PaddleState;
  bottomPaddle: PaddleState;
  topScore: number;
  bottomScore: number;
  status: "lobby" | "countdown" | "playing" | "goal" | "over";
  lastScorer: "top" | "bottom" | null;
  /** seconds remaining in the post-serve grace period — paddles can't hit
   *  the puck while this is > 0, so a paddle parked at the center line
   *  can't insta-launch the spawning puck. */
  serveGrace: number;
}

export const WIN_SCORE = 7;

export function freshGame(): GameState {
  return {
    puck: { x: 0.5, y: 1.0, vx: 0, vy: 0 },
    topPaddle: { x: 0.5, y: ARENA.TOP_LINE + ARENA.PADDLE_R },
    bottomPaddle: { x: 0.5, y: ARENA.BOTTOM_LINE - ARENA.PADDLE_R },
    topScore: 0,
    bottomScore: 0,
    status: "lobby",
    lastScorer: null,
    serveGrace: 0,
  };
}

export function serveTowards(s: GameState, side: "top" | "bottom") {
  const dir = side === "top" ? -1 : 1;
  const speed = 0.95;
  const angle = (Math.random() - 0.5) * 0.8;
  s.puck.x = 0.5;
  s.puck.y = 1.0;
  s.puck.vx = Math.sin(angle) * speed;
  s.puck.vy = dir * Math.cos(angle) * speed;
  s.serveGrace = 0.4;
}

export interface StepResult {
  paddleHit: "top" | "bottom" | null;
  wallHit: boolean;
  goal: "top" | "bottom" | null; // who scored
}

/**
 * Advance physics by dt seconds. Mutates state.
 * Constraints:
 * - top paddle clamped to y in [TOP_LINE, 1 - PADDLE_R]
 * - bottom paddle clamped to y in [1 + PADDLE_R, BOTTOM_LINE]
 * - puck reflects off side walls
 * - puck enters top hole (y < 0) -> bottom scores
 * - puck enters bottom hole (y > H) -> top scores
 */
export function stepPhysics(
  s: GameState,
  dt: number,
  prevTop: PaddleState,
  prevBot: PaddleState
): StepResult {
  const out: StepResult = { paddleHit: null, wallHit: false, goal: null };
  if (s.status !== "playing") return out;

  // tick down serve grace timer
  if (s.serveGrace > 0) s.serveGrace = Math.max(0, s.serveGrace - dt);

  const p = s.puck;
  // integrate
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // very light damping — keep the puck fast
  const damp = Math.pow(0.998, dt * 60);
  p.vx *= damp;
  p.vy *= damp;

  // side walls
  if (p.x - ARENA.PUCK_R < 0) {
    p.x = ARENA.PUCK_R;
    p.vx = Math.abs(p.vx);
    out.wallHit = true;
  } else if (p.x + ARENA.PUCK_R > ARENA.W) {
    p.x = ARENA.W - ARENA.PUCK_R;
    p.vx = -Math.abs(p.vx);
    out.wallHit = true;
  }

  // paddle collisions (circle-circle)
  const collide = (
    paddle: PaddleState,
    prev: PaddleState,
    label: "top" | "bottom"
  ) => {
    const dx = p.x - paddle.x;
    const dy = p.y - paddle.y;
    const dist = Math.hypot(dx, dy);
    const minDist = ARENA.PADDLE_R + ARENA.PUCK_R;
    if (dist < minDist && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      // separate
      p.x = paddle.x + nx * minDist;
      p.y = paddle.y + ny * minDist;
      // reflect velocity over normal
      const vDotN = p.vx * nx + p.vy * ny;
      p.vx -= 2 * vDotN * nx;
      p.vy -= 2 * vDotN * ny;
      // add paddle velocity influence (clamped to avoid teleport pops)
      const pvxRaw = (paddle.x - prev.x) / Math.max(dt, 1e-3);
      const pvyRaw = (paddle.y - prev.y) / Math.max(dt, 1e-3);
      const pvMag = Math.hypot(pvxRaw, pvyRaw);
      const pvCap = 3.0;
      const pvk = pvMag > pvCap ? pvCap / pvMag : 1;
      p.vx += pvxRaw * pvk * 0.85;
      p.vy += pvyRaw * pvk * 0.85;
      // boost on hit
      const sp = Math.hypot(p.vx, p.vy);
      const target = Math.min(sp + 0.12, 2.6);
      const k = target / Math.max(sp, 1e-3);
      p.vx *= k;
      p.vy *= k;
      out.paddleHit = label;
    }
  };
  // skip paddle collision during the serve grace window so a paddle parked
  // at the center line can't insta-launch the spawning puck
  if (s.serveGrace <= 0) {
    collide(s.topPaddle, prevTop, "top");
    collide(s.bottomPaddle, prevBot, "bottom");
  }

  // goals: puck enters hole strip past racket lines AND goes off the field
  if (p.y < -ARENA.PUCK_R * 0.5) {
    out.goal = "bottom";
  } else if (p.y > ARENA.H + ARENA.PUCK_R * 0.5) {
    out.goal = "top";
  }

  return out;
}

export function clampTopPaddle(p: PaddleState) {
  p.x = Math.max(ARENA.PADDLE_R, Math.min(ARENA.W - ARENA.PADDLE_R, p.x));
  p.y = Math.max(ARENA.TOP_LINE, Math.min(1 - ARENA.PADDLE_R, p.y));
}
export function clampBottomPaddle(p: PaddleState) {
  p.x = Math.max(ARENA.PADDLE_R, Math.min(ARENA.W - ARENA.PADDLE_R, p.x));
  p.y = Math.max(1 + ARENA.PADDLE_R, Math.min(ARENA.BOTTOM_LINE, p.y));
}
