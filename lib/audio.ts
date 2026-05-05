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
  hit: () => {
    tone(880, 0.08, "square", 0.22, 320);
    tone(1320, 0.05, "triangle", 0.1, 700);
  },
  wallBounce: () => tone(520, 0.06, "triangle", 0.14, 280),
  goal: () => {
    tone(220, 0.18, "sawtooth", 0.28, 880);
    setTimeout(() => tone(660, 0.22, "square", 0.22, 1320), 80);
    setTimeout(() => tone(440, 0.32, "sawtooth", 0.18, 1760), 160);
    noiseBurst(0.4, 0.2);
  },
  uiClick: () => tone(720, 0.04, "square", 0.12),
  uiHover: () => tone(540, 0.025, "sine", 0.06),
  countdown: () => {
    tone(660, 0.1, "triangle", 0.2);
    tone(990, 0.06, "sine", 0.08, 1320);
  },
  start: () => {
    tone(440, 0.1, "square", 0.2, 880);
    setTimeout(() => tone(880, 0.18, "square", 0.2, 1760), 80);
    setTimeout(() => tone(1320, 0.22, "sawtooth", 0.16, 2200), 160);
    noiseBurst(0.18, 0.12);
  },
  chat: () => tone(820, 0.05, "sine", 0.09, 1100),
  mute: () => tone(280, 0.08, "square", 0.14, 140),
  unmute: () => tone(560, 0.08, "square", 0.14, 880),
};
