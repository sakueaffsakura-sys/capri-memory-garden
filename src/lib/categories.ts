export type Category = { id: string; label: string; color: string };

// Accent colors are canvas colors for the graph (rings, legend dots).
export const CATEGORIES: Category[] = [
  { id: "sobre-voce", label: "Sobre você", color: "#f472b6" },
  { id: "gostos", label: "Gostos", color: "#fb923c" },
  { id: "pessoas", label: "Pessoas", color: "#facc15" },
  { id: "conversas", label: "Conversas", color: "#a3e635" },
  { id: "sentimentos", label: "Sentimentos", color: "#f87171" },
  { id: "planos", label: "Planos e promessas", color: "#34d399" },
  { id: "rotina", label: "Rotina", color: "#22d3ee" },
  { id: "jogos", label: "Jogos", color: "#60a5fa" },
  { id: "leituras", label: "Leituras", color: "#c084fc" },
  { id: "musica", label: "Música", color: "#e879f9" },
  { id: "capri", label: "Sobre a Capri", color: "#a78bfa" },
  { id: "outros", label: "Outros", color: "#a1a1aa" },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function normalizeCategory(id: string | null | undefined): string {
  return id && byId.has(id) ? id : "outros";
}

export function getCategory(id: string | null | undefined): Category {
  return byId.get(normalizeCategory(id))!;
}

export const VIOLET = "#8b5cf6";
