import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  messageKey: "config_supabase_missing";
  docsUrl?: string;
  docsLabelKey?: "config_supabase_docs_label";
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    messageKey: "config_supabase_missing",
    docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
    docsLabelKey: "config_supabase_docs_label",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
