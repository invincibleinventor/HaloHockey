let ctx: AudioContext | null = null;

function ac(): AudioContext {
  if (typeof window === "undefined") throw new Error("no window");
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.2,
  slideTo?: number
) {
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, a.currentTime + duration);
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + duration);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + duration);
  } catch {}
}

function noiseBurst(duration: number, gain = 0.3) {
  try {
    const a = ac();
    const buf = a.createBuffer(1, a.sampleRate * duration, a.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(g).connect(a.destination);
    src.start();
  } catch {}
}

export const sfx = {
  hit: () => tone(880, 0.08, "square", 0.18, 220),
  wallBounce: () => tone(440, 0.05, "triangle", 0.12, 360),
  goal: () => {
    tone(220, 0.18, "sawtooth", 0.25, 880);
    setTimeout(() => tone(660, 0.22, "square", 0.2, 1320), 80);
    noiseBurst(0.3, 0.18);
  },
  uiClick: () => tone(720, 0.04, "square", 0.1),
  uiHover: () => tone(540, 0.025, "sine", 0.06),
  countdown: () => tone(660, 0.12, "triangle", 0.18),
  start: () => {
    tone(440, 0.1, "square", 0.18, 880);
    setTimeout(() => tone(880, 0.18, "square", 0.18, 1760), 80);
  },
};
