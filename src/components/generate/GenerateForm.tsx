import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { StreamState } from "@/components/generate/proposalsReducer";
import { m } from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

interface Props {
  streamState: StreamState;
  onSubmit: (text: string) => void;
  onAbort: () => void;
}

const MAX_CHARS = 10_000;

export default function GenerateForm({ streamState, onSubmit, onAbort }: Props) {
  const [value, setValue] = useState("");
  const streaming = streamState === "streaming";
  const canSubmit = !streaming && value.length > 0 && value.length <= MAX_CHARS;
  const locale = getLocale();

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
      <label htmlFor="source-text" className="text-sm font-medium text-white/80">
        {m.generate_form_label()}
      </label>
      <Textarea
        id="source-text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        maxLength={MAX_CHARS}
        placeholder={m.generate_form_placeholder()}
        rows={8}
        className="min-h-40 border-white/10 bg-black/20 text-white placeholder:text-white/40"
        disabled={streaming}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-white/60">
          {value.length.toLocaleString(locale)} / {MAX_CHARS.toLocaleString(locale)}
        </span>
        <div className="flex gap-2">
          {streaming && (
            <Button type="button" variant="outline" onClick={onAbort}>
              {m.generate_form_stop()}
            </Button>
          )}
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (canSubmit) onSubmit(value);
            }}
            className="gap-2"
          >
            <Sparkles className="size-4" />
            {streaming ? m.generate_form_generating() : m.generate_form_generate()}
          </Button>
        </div>
      </div>
    </div>
  );
}
