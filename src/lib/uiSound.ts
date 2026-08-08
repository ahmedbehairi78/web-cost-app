const STORAGE_KEY = 'costApp_uiSounds';

export function isUiSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) !== '0';
}

export function setUiSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}

let ctxRef: AudioContext | null = null;
let unlockAttached = false;
let userGestured = false;

export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  return ctxRef;
}

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || !userGestured) return null;
  if (!ctxRef) {
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctxRef = new AC();
    } catch {
      return null;
    }
  }
  return ctxRef;
}

export function unlockAudio(): void {
  if (typeof document === 'undefined' || unlockAttached) return;
  unlockAttached = true;
  const kick = () => {
    userGestured = true;
  };
  document.addEventListener('pointerdown', kick, { capture: true, passive: true });
  document.addEventListener('keydown', kick, { capture: true, passive: true });
  document.addEventListener('touchstart', kick, { capture: true, passive: true });
}

async function withAudio(fn: (ctx: AudioContext, t0: number) => void): Promise<void> {
  if (!isUiSoundEnabled() || !userGestured) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch {
    return;
  }
  if (ctx.state !== 'running') return;
  const t0 = ctx.currentTime + 0.02;
  fn(ctx, t0);
}

function oscNote(
  ctx: AudioContext,
  t0: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'sine',
  freqEnd?: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null && freqEnd > 0 && freqEnd !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur * 0.95);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

export function playTap(): void {
  void withAudio((ctx, t0) => oscNote(ctx, t0, 920, 0.045, 0.14));
}

export function playNavigate(): void {
  void withAudio((ctx, t0) => {
    oscNote(ctx, t0, 523.25, 0.06, 0.13);
    oscNote(ctx, t0 + 0.07, 659.25, 0.08, 0.12);
  });
}

export function playWindowMinimize(): void {
  void withAudio((ctx, t0) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.09);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.14);
  });
}

export function playWindowClose(): void {
  void withAudio((ctx, t0) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, t0);
    osc.frequency.exponentialRampToValueAtTime(100, t0 + 0.1);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.11, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  });
}

export function playWindowRestore(): void {
  void withAudio((ctx, t0) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t0);
    osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.12);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.11, t0 + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  });
}

export function playToggle(): void {
  void withAudio((ctx, t0) => {
    oscNote(ctx, t0, 620, 0.04, 0.11);
    oscNote(ctx, t0 + 0.05, 780, 0.045, 0.1);
  });
}

export function playToastSuccess(): void {
  void withAudio((ctx, t0) => {
    oscNote(ctx, t0, 660, 0.055, 0.11);
    oscNote(ctx, t0 + 0.06, 880, 0.065, 0.1);
  });
}

export function playToastError(): void {
  void withAudio((ctx, t0) => {
    oscNote(ctx, t0, 320, 0.06, 0.11);
    oscNote(ctx, t0 + 0.07, 220, 0.08, 0.12, 'sine', 150);
  });
}

export function playWarning(): void {
  void withAudio((ctx, t0) => {
    oscNote(ctx, t0, 440, 0.08, 0.1);
    oscNote(ctx, t0 + 0.1, 330, 0.12, 0.1);
  });
}

export function playModalOpen(): void {
  void withAudio((ctx, t0) => {
    oscNote(ctx, t0, 520, 0.04, 0.08);
    oscNote(ctx, t0 + 0.05, 740, 0.055, 0.09);
  });
}

export function playModalClose(): void {
  void withAudio((ctx, t0) => {
    oscNote(ctx, t0, 700, 0.045, 0.09);
    oscNote(ctx, t0 + 0.04, 480, 0.06, 0.08, 'sine', 380);
  });
}
