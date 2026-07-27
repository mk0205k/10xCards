import type { CardRow } from "@/lib/api/cards";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages.js";

interface CardListItemProps {
  card: CardRow;
  onEditClick: () => void;
  onDeleteClick?: () => void;
}

const SOURCE_BADGES: Record<string, { label: () => string; className: string }> = {
  ai: {
    label: m.deck_card_source_ai,
    className: "bg-purple-500/20 text-purple-100 border-purple-400/30",
  },
  manual: {
    label: m.deck_card_source_manual,
    className: "bg-blue-500/20 text-blue-100 border-blue-400/30",
  },
};

export default function CardListItem({ card, onEditClick, onDeleteClick }: CardListItemProps) {
  const badge = SOURCE_BADGES[card.source] ?? SOURCE_BADGES.manual;
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
          {badge.label()}
        </span>
      </div>
      <CardContent className="text-sm leading-relaxed text-blue-100/70">{card.answer}</CardContent>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onEditClick}
          className="rounded-md border border-blue-400/40 bg-blue-500/10 px-2 py-1 text-xs text-blue-100 hover:bg-blue-500/20"
          aria-label={m.deck_card_edit_aria({ question: card.question })}
        >
          {m.deck_card_edit_button()}
        </button>
        {onDeleteClick && (
          <button
            type="button"
            onClick={onDeleteClick}
            className="rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs text-red-100 hover:bg-red-500/20"
            aria-label={m.deck_card_delete_aria({ question: card.question })}
          >
            {m.deck_card_delete_button()}
          </button>
        )}
      </div>
    </Card>
  );
}
