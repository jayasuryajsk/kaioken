const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 6;

export class PairingLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(): Promise<Response> {
    const now = Date.now();
    const attempts = (
      (await this.state.storage.get<number[]>("attempts")) ?? []
    ).filter((at) => now - at < WINDOW_MS);
    const allowed = attempts.length < MAX_ATTEMPTS;
    if (allowed) attempts.push(now);
    await this.state.storage.put("attempts", attempts);
    await this.state.storage.setAlarm(now + WINDOW_MS);
    return Response.json({
      allowed,
      remaining: MAX_ATTEMPTS - attempts.length,
    });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const attempts = (
      (await this.state.storage.get<number[]>("attempts")) ?? []
    ).filter((at) => now - at < WINDOW_MS);
    if (attempts.length === 0) await this.state.storage.deleteAll();
    else await this.state.storage.put("attempts", attempts);
  }
}
