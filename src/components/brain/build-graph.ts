import { CATEGORIES, getCategory, normalizeCategory } from "@/lib/categories";
import type { Memory, MemoryLink } from "@/lib/supabase";
import type { GData, GLink, GNode } from "./graph-types";

/** Builds graph data, reusing node objects from `cache` so positions survive live updates. */
export function buildGraph(
  memories: Pick<Memory, "id" | "title" | "category" | "importance">[],
  links: Pick<MemoryLink, "source_id" | "target_id">[],
  opts: { showHubs: boolean; categories: Set<string> | null },
  cache: Map<string, GNode>,
): GData {
  const visible = memories.filter((m) => !opts.categories || opts.categories.has(normalizeCategory(m.category)));
  const ids = new Set(visible.map((m) => m.id));
  const degree = new Map<string, number>();
  const gl: GLink[] = [];
  for (const l of links) {
    if (!ids.has(l.source_id) || !ids.has(l.target_id)) continue;
    degree.set(l.source_id, (degree.get(l.source_id) ?? 0) + 1);
    degree.set(l.target_id, (degree.get(l.target_id) ?? 0) + 1);
    gl.push({ source: l.source_id, target: l.target_id, kind: "link" });
  }
  const nodes: GNode[] = [];
  const hubCount = new Map<string, number>();
  for (const m of visible) {
    const cat = normalizeCategory(m.category);
    hubCount.set(cat, (hubCount.get(cat) ?? 0) + 1);
    const n = cache.get(m.id) ?? ({ id: m.id } as GNode);
    Object.assign(n, { label: m.title, kind: "memory", category: cat, importance: m.importance, degree: degree.get(m.id) ?? 0 });
    cache.set(m.id, n);
    nodes.push(n);
    if (opts.showHubs) gl.push({ source: m.id, target: `hub:${cat}`, kind: "hub" });
  }
  if (opts.showHubs) {
    for (const c of CATEGORIES) {
      const count = hubCount.get(c.id);
      if (!count) continue;
      const id = `hub:${c.id}`;
      const n = cache.get(id) ?? ({ id } as GNode);
      Object.assign(n, { label: getCategory(c.id).label, kind: "hub", category: c.id, importance: 5, degree: count });
      cache.set(id, n);
      nodes.push(n);
    }
  }
  return { nodes, links: gl };
}
