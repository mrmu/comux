/**
 * 簡單的記憶體內固定視窗限流（單一 Node 進程，comux 只跑一個實例）。
 * 過期項目由背景計時器定期清掉，避免 Map 被大量不同 key 撐爆。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const SWEEP_INTERVAL_MS = 60_000;

export class FixedWindowLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {
    const timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // 不要讓計時器卡住進程結束
    timer.unref?.();
  }

  /** 記一次嘗試；回傳是否已超過上限。 */
  hit(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now > b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return 1 > this.limit;
    }
    b.count++;
    return b.count > this.limit;
  }

  /** 只查詢、不計次。 */
  isLimited(key: string): boolean {
    const b = this.buckets.get(key);
    if (!b || Date.now() > b.resetAt) return false;
    return b.count >= this.limit;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  sweep(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (now > b.resetAt) this.buckets.delete(k);
    }
  }
}
