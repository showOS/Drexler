import { renderBoss } from "./boss.ts";
import { listDeals } from "./deals.ts";
import type {
  PetActionKey,
  PetAgendaItem,
  PetAgendaItemKind,
  PetAgendaRecord,
  PetStats,
} from "./petState.ts";
import { localDateStamp } from "./trade.ts";
import { renderWorldEvent } from "./world.ts";

function weekStamp(now: number): string {
  const d = new Date(localDateStamp(now) + "T12:00:00");
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function isWeekday(now: number): boolean {
  const day = new Date(now).getDay();
  return day >= 1 && day <= 5;
}

function isRth(now: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function item(kind: PetAgendaItemKind, label: string, target: number): PetAgendaItem {
  return { id: `${kind}_${target}`, kind, label, target, progress: 0, rewarded: false };
}

function dailyPool(stats: PetStats, now: number): PetAgendaItem[] {
  const pool = [
    item("feed", "Feed Drexler once", 1),
    item("work", "Run the pipeline twice", 2),
    item("play", "Take one morale lap", 1),
    item("rest", "Bank one rest cycle", 1),
    item("close_deal", "Close one active deal", 1),
  ];
  if (isRth(now)) pool.push(item("win_trade", "Win one RTH trade", 1));
  if (stats.boss) pool.push(item("boss_step", "Advance the boss encounter", 1));
  return pool;
}

function chooseThree(pool: PetAgendaItem[], rng: () => number): PetAgendaItem[] {
  const copy = [...pool];
  const out: PetAgendaItem[] = [];
  while (copy.length > 0 && out.length < 3) {
    const idx = Math.min(copy.length - 1, Math.floor(rng() * copy.length));
    out.push(copy.splice(idx, 1)[0]!);
  }
  return out;
}

export function generateAgenda(
  stats: PetStats,
  now: number = Date.now(),
  rng: () => number = Math.random,
): PetAgendaRecord {
  const dailyDate = localDateStamp(now);
  const weeklyDate = weekStamp(now);
  const pool = dailyPool(stats, now);
  const daily = chooseThree(pool, rng);
  while (daily.length < 3) daily.push(item("work", "Run the pipeline twice", 2));
  const weekly = isWeekday(now)
    ? item("close_deal", "Close five deals this week", 5)
    : item("work", "Run ten pipeline actions this week", 10);
  return { dailyDate, daily, weeklyDate, weekly };
}

export function ensureAgenda(
  stats: PetStats,
  now: number = Date.now(),
  rng: () => number = Math.random,
): { stats: PetStats; dailyFresh: boolean; weeklyFresh: boolean } {
  const today = localDateStamp(now);
  const week = weekStamp(now);
  const existing = stats.agenda;
  if (existing?.dailyDate === today && existing.weeklyDate === week) {
    return { stats, dailyFresh: false, weeklyFresh: false };
  }
  const fresh = generateAgenda(stats, now, rng);
  const agenda: PetAgendaRecord = {
    dailyDate: today,
    daily: existing?.dailyDate === today ? existing.daily : fresh.daily,
    weeklyDate: week,
    weekly: existing?.weeklyDate === week ? existing.weekly : fresh.weekly,
  };
  return {
    stats: { ...stats, agenda },
    dailyFresh: existing?.dailyDate !== today,
    weeklyFresh: existing?.weeklyDate !== week,
  };
}

function rewardAgenda(stats: PetStats, item: PetAgendaItem, weekly: boolean): PetStats {
  if (!item.rewarded) return stats;
  const lifetime = typeof stats.lifetimeDeals === "number" ? stats.lifetimeDeals : stats.deals;
  return {
    ...stats,
    deals: Math.min(100, stats.deals + (weekly ? 20 : 10)),
    lifetimeDeals: lifetime + (weekly ? 25 : 5),
  };
}

export function bumpAgenda(
  stats: PetStats,
  kind: PetAgendaItemKind,
  amount: number = 1,
  now: number = Date.now(),
): { stats: PetStats; completed: PetAgendaItem[] } {
  const ensured = ensureAgenda(stats, now).stats;
  const agenda = ensured.agenda;
  if (!agenda) return { stats: ensured, completed: [] };
  const completed: PetAgendaItem[] = [];
  const bump = (agendaItem: PetAgendaItem, weekly: boolean): PetAgendaItem => {
    if (agendaItem.kind !== kind || agendaItem.rewarded) return agendaItem;
    const progress = Math.min(agendaItem.target, agendaItem.progress + amount);
    const rewarded = progress >= agendaItem.target;
    const next = { ...agendaItem, progress, rewarded };
    if (rewarded && !agendaItem.rewarded) completed.push(next);
    if (rewarded && !agendaItem.rewarded) {
      Object.assign(ensured, rewardAgenda(ensured, next, weekly));
    }
    return next;
  };
  const daily = agenda.daily.map((i) => bump(i, false));
  const weekly = bump(agenda.weekly, true);
  return { stats: { ...ensured, agenda: { ...agenda, daily, weekly } }, completed };
}

export function bumpAgendaForAction(stats: PetStats, action: PetActionKey, now = Date.now()) {
  const kind =
    action === "feed" || action === "play" || action === "work" || action === "rest"
      ? action
      : null;
  return kind ? bumpAgenda(stats, kind, 1, now) : { stats, completed: [] };
}

export function renderAgenda(stats: PetStats, now: number = Date.now()): string {
  const agenda = ensureAgenda(stats, now).stats.agenda;
  if (!agenda) return "No agenda available.";
  const fmt = (i: PetAgendaItem) =>
    `${i.rewarded ? "✓" : i.progress >= i.target ? "!" : "·"} ${i.label} (${i.progress}/${i.target})`;
  const deals = listDeals(stats, now);
  const next =
    agenda.daily.find((i) => !i.rewarded && i.progress < i.target) ??
    (!agenda.weekly.rewarded ? agenda.weekly : null);
  return [
    `Agenda (${agenda.dailyDate})`,
    "Daily mandates:",
    ...agenda.daily.map((i) => `  ${fmt(i)}`),
    `Weekly mandate (${agenda.weeklyDate}):`,
    `  ${fmt(agenda.weekly)}`,
    "Active deals:",
    ...(deals.length > 0
      ? deals.map((d) => `  ${d}`)
      : ["  Pipeline empty. /work can seed a deal."]),
    renderBoss(stats, now),
    renderWorldEvent(stats, now),
    `Next: ${next ? next.label : "Agenda clear. Maintain stats above 25%."}`,
  ].join("\n");
}

export function renderDailyAgenda(stats: PetStats, now: number = Date.now()): string {
  const agenda = ensureAgenda(stats, now).stats.agenda;
  if (!agenda) return "No daily agenda yet. Toggle /pet on to roll one.";
  return [
    "Daily agenda:",
    ...agenda.daily.map(
      (i) => `  ${i.label}: ${i.progress}/${i.target}${i.rewarded ? " rewarded" : ""}`,
    ),
  ].join("\n");
}

export function agendaHint(stats: PetStats, now: number = Date.now()): string {
  const agenda = ensureAgenda(stats, now).stats.agenda;
  const next = agenda?.daily.find((i) => !i.rewarded && i.progress < i.target);
  return next
    ? `agenda ${next.label.toLowerCase()} ${next.progress}/${next.target}`
    : "agenda clear";
}
