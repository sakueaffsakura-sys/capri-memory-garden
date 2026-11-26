// Browser-only: react-force-graph-2d touches `window` at import. Load with React.lazy behind <ClientOnly>.
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { getCategory, VIOLET } from "@/lib/categories";
import { linkEnd, type GData, type GLink, type GNode } from "./graph-types";

type Props = {
  data: GData;
  selectedId?: string | null;
  matchIds?: Set<string> | null;
  focusIds?: string[];
  focusKey?: number;
  onSelect?: (node: GNode | null) => void;
  demo?: boolean;
};

const BG = "#18181b";

export function nodeRadius(n: GNode) {
  if (n.kind === "hub") return 6 + Math.min(10, Math.sqrt(n.degree) * 0.9);
  return 1.8 + n.importance * 0.55 + Math.min(5, Math.sqrt(n.degree) * 0.9);
}

export default function BrainGraph({ data, selectedId, matchIds, focusIds, focusKey, onSelect, demo }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.links) {
      const a = linkEnd(l.source);
      const b = linkEnd(l.target);
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, [data]);

  const activeId = hoverId ?? selectedId ?? null;
  const highlight = useMemo(() => {
    if (activeId) {
      const s = new Set<string>([activeId]);
      neighbors.get(activeId)?.forEach((n) => s.add(n));
      return s;
    }
    if (matchIds && matchIds.size) return matchIds;
    return null;
  }, [activeId, neighbors, matchIds]);

  // Focus / zoom requests from the page (search, linked-memory jumps).
  useEffect(() => {
    const g = fg.current;
    if (!g || !focusIds || !focusIds.length) return;
    if (focusIds.length === 1) {
      const n = data.nodes.find((x) => x.id === focusIds[0]);
      if (n && n.x != null && n.y != null) {
        g.centerAt(n.x, n.y, 600);
        g.zoom(4, 600);
      }
    } else {
      const ids = new Set(focusIds);
      g.zoomToFit(600, 80, (n) => ids.has(n.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Demo: keep the graph gently alive.
  useEffect(() => {
    if (!demo) return;
    const t = setInterval(() => fg.current?.d3ReheatSimulation(), 7000);
    return () => clearInterval(t);
  }, [demo]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force("charge")?.["strength"](demo ? -26 : -32);
    const lf = g.d3Force("link") as unknown as { distance: (fn: (l: GLink) => number) => void } | undefined;
    lf?.distance((l: GLink) => (l.kind === "hub" ? 34 : 22));
  }, [demo, size.w]);

  return (
    <div ref={wrap} className="absolute inset-0">
      {size.w > 0 && (
        <ForceGraph2D<GNode, GLink>
          ref={fg}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor={BG}
          nodeId="id"
          cooldownTicks={demo ? Infinity : 300}
          d3AlphaDecay={demo ? 0.008 : 0.0228}
          d3VelocityDecay={demo ? 0.25 : 0.4}
          enableZoomInteraction={!demo}
          enablePanInteraction={!demo}
          enableNodeDrag={!demo}
          onEngineStop={() => {
            if (!fitted.current && !demo) {
              fitted.current = true;
              fg.current?.zoomToFit(500, 60);
            }
          }}
          onNodeHover={(n) => setHoverId(n ? n.id : null)}
          onNodeClick={(n) => onSelect?.(n)}
          onBackgroundClick={() => onSelect?.(null)}
          linkColor={(l) => {
            const a = linkEnd(l.source);
            const b = linkEnd(l.target);
            if (activeId && (a === activeId || b === activeId)) return VIOLET;
            if (highlight) return "rgba(255,255,255,0.03)";
            return l.kind === "hub" ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.12)";
          }}
          linkWidth={(l) => {
            const a = linkEnd(l.source);
            const b = linkEnd(l.target);
            return activeId && (a === activeId || b === activeId) ? 1.4 : l.kind === "hub" ? 0.4 : 0.7;
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, nodeRadius(n) + 2, 0, 2 * Math.PI);
            ctx.fill();
          }}
          nodeCanvasObject={(n, ctx, scale) => {
            const r = nodeRadius(n);
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const lit = highlight?.has(n.id) ?? false;
            const dim = !!highlight && !lit;
            const isActive = n.id === activeId || n.id === selectedId;
            const cat = getCategory(n.category);
            ctx.globalAlpha = dim ? 0.14 : 1;
            if (isActive) {
              ctx.beginPath();
              ctx.arc(x, y, r + 5, 0, 2 * Math.PI);
              ctx.fillStyle = "rgba(139,92,246,0.18)";
              ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fillStyle = lit && highlight !== matchIds ? VIOLET : lit ? "#c4b5fd" : n.kind === "hub" ? "#e4e4e7" : "#d4d4d8";
            if (isActive) ctx.fillStyle = VIOLET;
            ctx.fill();
            ctx.lineWidth = (n.kind === "hub" ? 2.2 : 1.3) / Math.max(0.6, scale * 0.6);
            ctx.strokeStyle = cat.color;
            ctx.stroke();
            const showLabel = n.kind === "hub" || lit || scale > 1.7;
            if (showLabel && !(dim && n.kind !== "hub")) {
              const fs = (n.kind === "hub" ? 13 : 11) / scale;
              ctx.font = `${n.kind === "hub" ? 600 : 400} ${fs}px "IBM Plex Sans", sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = lit ? "#ede9fe" : n.kind === "hub" ? "#d4d4d8" : "#a1a1aa";
              const label = n.label.length > 42 ? n.label.slice(0, 40) + "…" : n.label;
              ctx.fillText(label, x, y + r + 2 / scale);
            }
            ctx.globalAlpha = 1;
          }}
        />
      )}
    </div>
  );
}
