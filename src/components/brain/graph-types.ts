export type GNode = {
  id: string;
  label: string;
  kind: "memory" | "hub";
  category: string;
  importance: number;
  degree: number;
  x?: number;
  y?: number;
};
export type GLink = { source: string | GNode; target: string | GNode; kind: "link" | "hub" };
export type GData = { nodes: GNode[]; links: GLink[] };

export const linkEnd = (v: string | GNode) => (typeof v === "object" ? v.id : v);
