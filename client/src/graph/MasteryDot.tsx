import type { Mastery } from "@nodestorm/shared";
import { useT, type MessageKey } from "../i18n";
import { daysAgo, masteryLevel, type MasteryLevel } from "../lib/quiz";
import "./mastery.css";

const LEVEL: Record<MasteryLevel, MessageKey> = { weak: "mastery.weak", fair: "mastery.fair", strong: "mastery.strong" };

/** A small dot after a concept's name: how well it is known now, from "Quiz me" (fades until reviewed again). */
export function MasteryDot({ mastery, name }: { mastery: Mastery; name: string }) {
  const t = useT();
  const now = Date.now();
  const level = masteryLevel(mastery, now);
  const days = daysAgo(mastery, now);
  const label = t("mastery.label", {
    level: t(LEVEL[level]),
    score: Math.round(mastery.score * 100),
    n: mastery.reviews,
    when: days ? t("mastery.daysAgo", { n: days }) : t("mastery.today"),
  });
  return <span className={`mastery mastery--${level}`} role="img" aria-label={label} title={label} data-testid={`mastery-${name}`} />;
}
