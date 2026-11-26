import { useCallback, useEffect, useState } from "react";
import { supabase, type Memory, type MemoryLink } from "@/lib/supabase";

async function fetchAll<T>(table: string): Promise<T[]> {
  const page = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return rows;
}

/** Loads the user's memories + links and keeps them live via Realtime. */
export function useBrain(userId: string | undefined) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [links, setLinks] = useState<MemoryLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const upsertMemory = useCallback((m: Memory) => {
    setMemories((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return [...prev, m];
      const next = prev.slice();
      next[i] = m;
      return next;
    });
  }, []);
  const removeMemory = useCallback((id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    setLinks((prev) => prev.filter((l) => l.source_id !== id && l.target_id !== id));
  }, []);
  const upsertLink = useCallback((l: MemoryLink) => {
    setLinks((prev) => (prev.some((x) => x.id === l.id) ? prev.map((x) => (x.id === l.id ? l : x)) : [...prev, l]));
  }, []);
  const removeLink = useCallback((id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const reload = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([fetchAll<Memory>("memories"), fetchAll<MemoryLink>("memory_links")]);
      setMemories(m);
      setLinks(l);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void reload();
    const channel = supabase
      .channel(`brain-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "memories", filter: `user_id=eq.${userId}` },
        (p) => {
          if (p.eventType === "DELETE") removeMemory((p.old as { id: string }).id);
          else upsertMemory(p.new as Memory);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "memory_links", filter: `user_id=eq.${userId}` },
        (p) => {
          if (p.eventType === "DELETE") removeLink((p.old as { id: string }).id);
          else upsertLink(p.new as MemoryLink);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, reload, upsertMemory, removeMemory, upsertLink, removeLink]);

  return { memories, links, loading, error, reload, upsertMemory, removeMemory, upsertLink, removeLink };
}
