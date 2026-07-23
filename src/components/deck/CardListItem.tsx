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
    <div
      role="button"
      tabIndex={0}
      onClick={onEditClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEditClick();
        }
      }}
      className="block w-full cursor-pointer rounded-xl text-left focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:outline-none"
      aria-label={m.deck_card_edit_aria({ question: card.question })}
    >
      <Card className="transition-colors hover:bg-white/10">
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
        {onDeleteClick && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteClick();
              }}
              className="rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs text-red-100 hover:bg-red-500/20"
              aria-label={m.deck_card_delete_aria({ question: card.question })}
            >
              {m.deck_card_delete_button()}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
