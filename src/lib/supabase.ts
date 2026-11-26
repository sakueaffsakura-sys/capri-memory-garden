import { createClient } from "@supabase/supabase-js";

// Public URL and publishable key of the user's own backend (safe in the browser).
export const SUPABASE_URL = "https://wzecozxpipxbalauazub.supabase.co";
export const SUPABASE_KEY = "sb_publishable_eSrxXF0IbJhd3eyu0gm7XA_PpAs4trf";
export const BRAIN_API = "https://wzecozxpipxbalauazub.supabase.co/functions/v1/capri-brain";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type Memory = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  tags: string[];
  source: string | null;
  happened_at: string | null;
  mentions: number;
  recall_count: number;
  last_recalled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MemoryLink = {
  id: string;
  user_id: string;
  source_id: string;
  target_id: string;
  relation: string | null;
  strength: number;
  auto: boolean;
  created_at: string;
};

export function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err?.code === "23505") return "Já existe uma memória com esse título.";
  if (err?.message?.includes("Invalid login")) return "E-mail ou senha incorretos.";
  return err?.message || "Algo deu errado. Tente de novo.";
}
