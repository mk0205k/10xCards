import type { CardRow } from "@/lib/api/cards";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CardListItemProps {
  card: CardRow;
}

const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  ai: {
    label: "AI",
    className: "bg-purple-500/20 text-purple-100 border-purple-400/30",
  },
  manual: {
    label: "manual",
    className: "bg-blue-500/20 text-blue-100 border-blue-400/30",
  },
};

export default function CardListItem({ card }: CardListItemProps) {
  const badge = SOURCE_LABELS[card.source] ?? SOURCE_LABELS.manual;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="flex-1 text-base leading-snug font-medium text-white">{card.question}</p>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium tracking-wide uppercase",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </div>
      <CardContent className="text-sm leading-relaxed text-blue-100/70">{card.answer}</CardContent>
    </Card>
  );
}
