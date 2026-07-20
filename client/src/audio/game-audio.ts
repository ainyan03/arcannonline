const STORAGE_KEY = 'arcn-sound-enabled';

// 個別音量が控えめ (0.035〜0.16) なので、マスターで底上げする。
// 音の重なりによるクリップはコンプレッサーで抑える。
const MASTER_VOLUME = 0.6;

/**
 * 外部音源を使わない小さなWeb Audio効果音システム。
 * 大量の弾衝突で発音数が増えすぎないよう、種類ごとにレート制限する。
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<string, number>();
  private soundEnabled = localStorage.getItem(STORAGE_KEY) !== '0';
  private readonly unlockListener = () => void this.unlock();

  constructor() {
    window.addEventListener('pointerdown', this.unlockListener, { capture: true });
    window.addEventListener('keydown', this.unlockListener, { capture: true });
  }

  get enabled(): boolean {
    return this.soundEnabled;
  }

  toggle(): boolean {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem(STORAGE_KEY, this.soundEnabled ? '1' : '0');
    if (this.soundEnabled) void this.unlock();
    if (this.master) this.master.gain.value = this.soundEnabled ? MASTER_VOLUME : 0;
    return this.soundEnabled;
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlockListener, { capture: true });
    window.removeEventListener('keydown', this.unlockListener, { capture: true });
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  async unlock(): Promise<void> {
    if (!this.soundEnabled) return;
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        // Web Audioが利用できない環境では、ゲーム本体だけを継続する。
        return;
      }
      this.master = this.context.createGain();
      this.master.gain.value = MASTER_VOLUME;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 12;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      this.master.connect(limiter).connect(this.context.destination);
      this.noiseBuffer = this.makeNoiseBuffer(this.context);
    }
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        // 次のユーザー操作で再試行する。
      }
    }
  }

  playCollision(size = 0.3): void {
    if (!this.canPlay('collision', 45)) return;
    const ctx = this.ready();
    if (!ctx) return;
    const gain = Math.min(0.16, 0.055 + size * 0.08);
    this.noise(ctx.currentTime, 0.055, gain, 850);
    this.tone(170 + size * 90, ctx.currentTime, 0.07, gain * 0.75, 'triangle', 90);
  }

  playJoin(): void {
    if (!this.canPlay('join', 180)) return;
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    this.tone(523.25, at, 0.12, 0.12, 'sine', 659.25);
    this.tone(783.99, at + 0.11, 0.17, 0.1, 'sine', 1046.5);
  }

  playLeave(): void {
    if (!this.canPlay('leave', 180)) return;
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    this.tone(659.25, at, 0.14, 0.085, 'sine', 523.25);
    this.tone(392, at + 0.1, 0.2, 0.075, 'sine', 293.66);
  }

  playChat(): void {
    if (!this.canPlay('chat', 120)) return;
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    this.tone(880, at, 0.09, 0.09, 'sine', 990);
    this.tone(1320, at + 0.065, 0.12, 0.065, 'sine', 1174.66);
  }

  playFire(): void {
    if (!this.canPlay('fire', 90)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(420, ctx.currentTime, 0.11, 0.075, 'triangle', 860);
  }

  playEnemyFire(distance: number): void {
    if (distance > 48 || !this.canPlay('enemy-fire', 100)) return;
    const ctx = this.ready();
    if (!ctx) return;
    const proximity = 1 - Math.min(distance / 48, 1);
    this.tone(260, ctx.currentTime, 0.14, 0.035 + proximity * 0.06, 'sawtooth', 150);
  }

  playHit(): void {
    if (!this.canPlay('hit', 85)) return;
    const ctx = this.ready();
    if (!ctx) return;
    this.noise(ctx.currentTime, 0.09, 0.12, 320);
    this.tone(115, ctx.currentTime, 0.13, 0.1, 'square', 70);
  }

  playDefeat(): void {
    if (!this.canPlay('defeat', 160)) return;
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime;
    this.noise(at, 0.16, 0.12, 520);
    this.tone(520, at, 0.22, 0.1, 'triangle', 130);
    this.tone(780, at + 0.04, 0.18, 0.07, 'sine', 260);
  }

  private ready(): AudioContext | null {
    return this.soundEnabled && this.context?.state === 'running' ? this.context : null;
  }

  private canPlay(kind: string, intervalMs: number): boolean {
    if (!this.soundEnabled) return false;
    const now = performance.now();
    const last = this.lastPlayed.get(kind) ?? -Infinity;
    if (now - last < intervalMs) return false;
    this.lastPlayed.set(kind, now);
    return true;
  }

  private tone(
    frequency: number,
    at: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    endFrequency = frequency,
  ): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(frequency, 1), at);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(endFrequency, 1),
      at + duration,
    );
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }

  private noise(
    at: number,
    duration: number,
    volume: number,
    frequency: number,
  ): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master || !this.noiseBuffer) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const envelope = ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    envelope.gain.setValueAtTime(Math.max(volume, 0.0002), at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(envelope).connect(master);
    source.start(at);
    source.stop(at + duration);
  }

  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
