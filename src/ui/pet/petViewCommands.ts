// V67 — view-only pet-mode slash handlers extracted from `App.tsx`.
// Each handler is pure side-effects (read pet state, emit transcript
// + notification lines). Stateful handlers (`/respond`, `/trade`,
// `/perk`, etc.) stay in `App.tsx` because they need direct access to
// the `setPetStats`/`petStatsRef` plumbing.
//
// `handlePetViewSlash` returns `true` if the slash command was
// recognized + handled. Callers fall through to the next handler when
// it returns `false`.

import {
  isAchievementUnlocked,
  renderAchievements,
  unlockAchievement,
} from "../../pet/achievements.ts";
import { renderAgenda, renderDailyAgenda } from "../../pet/agenda.ts";
import { renderBoss } from "../../pet/boss.ts";
import { listDeals } from "../../pet/deals.ts";
import { loadGraveyard, renderGraveyard } from "../../pet/graveyard.ts";
import { formatNotificationLog } from "../../pet/notificationLog.ts";
import { renderPerks } from "../../pet/perks.ts";
import { buildReviewSnapshot, formatReview } from "../../pet/review.ts";
import { renderChallenge, renderStreak } from "../../pet/streaks.ts";
import type { PetStats } from "../../pet/petState.ts";

export interface PetViewContext {
  stats: PetStats;
  now: number;
  addItem: (role: "system", content: string) => void;
}

export function handlePetViewSlash(slashCommand: string, ctx: PetViewContext): boolean {
  switch (slashCommand) {
    case "/achievements":
      ctx.addItem("system", renderAchievements());
      return true;

    case "/perks":
      ctx.addItem("system", renderPerks(ctx.stats));
      return true;

    case "/streak":
      ctx.addItem("system", renderStreak(ctx.stats));
      return true;

    case "/agenda":
      ctx.addItem("system", renderAgenda(ctx.stats, ctx.now));
      return true;

    case "/challenge":
      ctx.addItem(
        "system",
        ctx.stats.agenda ? renderDailyAgenda(ctx.stats, ctx.now) : renderChallenge(ctx.stats),
      );
      return true;

    case "/boss":
      ctx.addItem("system", renderBoss(ctx.stats, ctx.now));
      return true;

    case "/log":
      ctx.addItem("system", formatNotificationLog());
      return true;

    case "/review": {
      const snap = buildReviewSnapshot({ stats: ctx.stats, now: ctx.now });
      ctx.addItem("system", formatReview(snap));
      return true;
    }

    case "/graveyard": {
      ctx.addItem("system", renderGraveyard());
      if (!isAchievementUnlocked("cohort_2") && loadGraveyard().length >= 2) {
        const a = unlockAchievement("cohort_2", ctx.now);
        if (a.ok) ctx.addItem("system", `Badge unlocked: ${a.def.title}.`);
      }
      return true;
    }

    case "/deals": {
      const lines = listDeals(ctx.stats);
      if (lines.length === 0) {
        ctx.addItem("system", "Drexler's pipeline is empty. Run /work to seed a deal.");
      } else {
        ctx.addItem("system", ["Active deals:", ...lines.map((l) => `  ${l}`)].join("\n"));
      }
      return true;
    }

    default:
      return false;
  }
}
