import type { PetBossRecord, PetStats } from "./petState.ts";

export type BossId = "quarterly_earnings";

export type BossStepKind = "work" | "trade_win" | "audit_response" | "praise";

export interface BossStep {
  readonly kind: BossStepKind;
  readonly description: string;
}

export interface BossDef {
  readonly id: BossId;
  readonly title: string;
  readonly steps: ReadonlyArray<BossStep>;
  readonly durationMs: number;
  readonly reward: number;
}

export const BOSS_QUARTERLY: BossDef = {
  id: "quarterly_earnings",
  title: "QUARTERLY EARNINGS CALL",
  steps: [
    { kind: "work", description: "1 /work" },
    { kind: "trade_win", description: "1 /trade win" },
    { kind: "audit_response", description: "respond to 1 audit event" },
    { kind: "praise", description: "/praise to seal the call" },
  ],
  durationMs: 30 * 60_000,
  reward: 200,
};

export const BOSS_DEFS: ReadonlyArray<BossDef> = [BOSS_QUARTERLY];

function clampStat(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function getBossDef(id: string): BossDef | null {
  return BOSS_DEFS.find((d) => d.id === id) ?? null;
}

export interface BossStartOutcome {
  ok: boolean;
  reason?: "already_active";
  def?: BossDef;
  stats: PetStats;
  message: string;
}

export function startBoss(stats: PetStats, def: BossDef, now: number): BossStartOutcome {
  if (stats.boss) {
    return {
      ok: false,
      reason: "already_active",
      def: getBossDef(stats.boss.id) ?? def,
      stats,
      message: "Boss encounter already in progress.",
    };
  }
  const record: PetBossRecord = {
    id: def.id,
    step: 0,
    startedAt: now,
    deadline: now + def.durationMs,
  };
  return {
    ok: true,
    def,
    stats: { ...stats, boss: record },
    message: `BOSS UNLOCKED — ${def.title}. Steps: ${def.steps.map((s) => s.description).join(" → ")}.`,
  };
}

export function bossNeedsAudit(stats: PetStats, now: number = Date.now()): boolean {
  const record = stats.boss;
  if (!record || now >= record.deadline) return false;
  const def = getBossDef(record.id);
  return def?.steps[record.step]?.kind === "audit_response";
}

export interface BossAdvanceResult {
  stats: PetStats;
  advanced: boolean;
  completed: boolean;
  expired: boolean;
  message?: string;
}

// Advance the boss state machine by one matching step. Other actions
// pass through unchanged. Idempotent — repeating a satisfied step does
// nothing (V59).
export function advanceBoss(
  stats: PetStats,
  trigger: BossStepKind,
  now: number,
): BossAdvanceResult {
  const record = stats.boss;
  if (!record) return { stats, advanced: false, completed: false, expired: false };
  const def = getBossDef(record.id);
  if (!def) {
    const { boss: _drop, ...rest } = stats;
    void _drop;
    return { stats: rest as PetStats, advanced: false, completed: false, expired: false };
  }
  if (now >= record.deadline) {
    const { boss: _drop, ...rest } = stats;
    void _drop;
    const failed: PetStats = { ...(rest as PetStats), happiness: clampStat(stats.happiness - 15) };
    return {
      stats: failed,
      advanced: false,
      completed: false,
      expired: true,
      message: `${def.title} window closed. Drexler missed the call.`,
    };
  }
  const needed = def.steps[record.step]?.kind;
  if (!needed || needed !== trigger) {
    return { stats, advanced: false, completed: false, expired: false };
  }
  const nextStep = record.step + 1;
  if (nextStep >= def.steps.length) {
    const { boss: _drop, ...rest } = stats;
    void _drop;
    const lifetime = typeof stats.lifetimeDeals === "number" ? stats.lifetimeDeals : stats.deals;
    const finished: PetStats = {
      ...(rest as PetStats),
      lifetimeDeals: lifetime + def.reward,
    };
    return {
      stats: finished,
      advanced: true,
      completed: true,
      expired: false,
      message: `${def.title} closed. +${def.reward} lifetime deals. Bonus respect.`,
    };
  }
  const upcoming = def.steps[nextStep]!;
  const advanced: PetStats = {
    ...stats,
    boss: {
      ...record,
      step: nextStep,
      forcedAuditAt:
        upcoming.kind === "audit_response"
          ? Math.min(now + 60_000, Math.max(now, record.deadline - 30_000))
          : record.forcedAuditAt,
    },
  };
  return {
    stats: advanced,
    advanced: true,
    completed: false,
    expired: false,
    message: `${def.title} step ${record.step + 1}/${def.steps.length} done. Next: ${upcoming.description}.`,
  };
}

export function renderBoss(stats: PetStats, now: number = Date.now()): string {
  const record = stats.boss;
  if (!record) return "No active boss encounter.";
  const def = getBossDef(record.id);
  if (!def) return "Boss record corrupt.";
  const remainingMs = Math.max(0, record.deadline - now);
  const mins = Math.ceil(remainingMs / 60_000);
  const lines = [
    `Boss: ${def.title} — step ${record.step + 1}/${def.steps.length}`,
    `  remaining: ~${mins}m`,
  ];
  def.steps.forEach((step, i) => {
    const mark = i < record.step ? "✓" : i === record.step ? "→" : "·";
    lines.push(`  ${mark} ${step.description}`);
  });
  return lines.join("\n");
}
