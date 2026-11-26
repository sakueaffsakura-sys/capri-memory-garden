/* Cérebro da Capri: o site do cérebro online da Capri. Sem dependências: fala direto com o Supabase (Auth + REST)
   e desenha o grafo num <canvas> com uma simulação de forças própria (Barnes-Hut). */
"use strict";
(() => {
  const CFG = {
    url: "https://wzecozxpipxbalauazub.supabase.co",
    key: "sb_publishable_eSrxXF0IbJhd3eyu0gm7XA_PpAs4trf",
    api: "https://wzecozxpipxbalauazub.supabase.co/functions/v1/capri-brain",
  };
  const CATS = [
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
  const CAT = new Map(CATS.map((c) => [c.id, c]));
  const catOf = (id) => CAT.get(id) || CAT.get("outros");
  const MCOLS = "id,title,content,category,importance,tags,source,happened_at,mentions,recall_count,last_recalled_at,created_at,updated_at";
  const LCOLS = "id,source_id,target_id,relation,strength,auto,created_at";
  const SESSION = "cerebro.sessao", PREFS = "cerebro.prefs";
  const BG = "#18181b", VIOLET = "#8b5cf6";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" });
  const when = (iso) => (iso ? fmt.format(new Date(iso)) : "—");
  function ago(iso) {
    if (!iso) return "nunca";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "agora";
    if (s < 3600) return "há " + Math.round(s / 60) + " min";
    if (s < 86400) return "há " + Math.round(s / 3600) + " h";
    if (s < 86400 * 30) return "há " + Math.round(s / 86400) + (Math.round(s / 86400) === 1 ? " dia" : " dias");
    return when(iso);
  }
  const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch {} };

  function toast(msg, bad) {
    const t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), bad ? 6500 : 4200);
  }

  function ask(title, text, yes = "Confirmar") {
    const d = $("#askDialog");
    $("#askTitle").textContent = title;
    $("#askText").textContent = text;
    $("#askYes").textContent = yes;
    d.returnValue = "";
    d.showModal();
    return new Promise((done) => d.addEventListener("close", () => done(d.returnValue === "yes"), { once: true }));
  }

  // ---------------- conta (Supabase Auth) ----------------
  const Auth = {
    s: null,
    load() { try { this.s = JSON.parse(localStorage.getItem(SESSION)); } catch { this.s = null; } },
    save(s) { this.s = s; try { s ? localStorage.setItem(SESSION, JSON.stringify(s)) : localStorage.removeItem(SESSION); } catch {} },
    keep(j) {
      this.save({
        access_token: j.access_token,
        refresh_token: j.refresh_token,
        expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
        user: { id: j.user.id, email: j.user.email },
      });
    },
    get uid() { return this.s && this.s.user && this.s.user.id; },
    async token() {
      if (!this.s) return null;
      if (Date.now() / 1000 > (this.s.expires_at || 0) - 90) await this.refresh();
      return this.s && this.s.access_token;
    },
    refresh() {
      if (this._r) return this._r;
      this._r = (async () => {
        try {
          const r = await fetch(`${CFG.url}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST", headers: { apikey: CFG.key, "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: this.s && this.s.refresh_token }),
          });
          if (!r.ok) throw new Error("sessão expirada");
          this.keep(await r.json());
        } catch {
          if (navigator.onLine !== false) { this.save(null); Store.reset(); route(); }
        } finally { this._r = null; }
      })();
      return this._r;
    },
    async signIn(email, password) {
      const r = await fetch(`${CFG.url}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: { apikey: CFG.key, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error_code === "invalid_credentials" || /invalid login/i.test(j.msg || j.error_description || "") ? "E-mail ou senha incorretos." : "Não deu para entrar agora. Tente de novo.");
      this.keep(j);
    },
    signOut() {
      const t = this.s && this.s.access_token;
      this.save(null);
      if (t) fetch(`${CFG.url}/auth/v1/logout`, { method: "POST", headers: { apikey: CFG.key, Authorization: `Bearer ${t}` } }).catch(() => {});
    },
    async setPassword(password) {
      const t = await this.token();
      const r = await fetch(`${CFG.url}/auth/v1/user`, {
        method: "PUT", headers: { apikey: CFG.key, Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error_code === "same_password" ? "A senha nova é igual à antiga." : j.error_code === "weak_password" ? "Essa senha é fraca demais." : "Não deu para trocar a senha.");
    },
  };

  async function rest(path, { method = "GET", body, prefer, again = true } = {}) {
    const t = await Auth.token();
    if (!t) throw new Error("Entre na sua conta de novo.");
    const h = { apikey: CFG.key, Authorization: `Bearer ${t}` };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (prefer) h.Prefer = prefer;
    const r = await fetch(`${CFG.url}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401 && again) { await Auth.refresh(); return rest(path, { method, body, prefer, again: false }); }
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) {
      const e = new Error(j && j.code === "23505" ? "Já existe uma memória com esse título." : j && j.code === "23514" ? "Algum campo ficou grande demais ou inválido." : (j && j.message) || "Algo deu errado. Tente de novo.");
      e.code = j && j.code;
      throw e;
    }
    return j;
  }

  async function pageAll(path) {
    const out = [];
    for (let off = 0; ; off += 1000) {
      const rows = await rest(`${path}&limit=1000&offset=${off}`);
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  // ---------------- dados ----------------
  const Store = {
    mems: new Map(), links: new Map(), loaded: false, loading: null, lastMem: "", lastLink: "", subs: new Set(), born: new Map(),
    reset() { this.mems.clear(); this.links.clear(); this.loaded = false; this.loading = null; this.lastMem = this.lastLink = ""; },
    on(f) { this.subs.add(f); return () => this.subs.delete(f); },
    emit() { for (const f of this.subs) f(); },
    load() {
      if (this.loaded) return Promise.resolve();
      if (!this.loading) this.loading = (async () => {
        const [m, l] = await Promise.all([pageAll(`memories?select=${MCOLS}&order=created_at.asc`), pageAll(`memory_links?select=${LCOLS}&order=created_at.asc`)]);
        this.mems = new Map(m.map((x) => [x.id, x]));
        this.links = new Map(l.map((x) => [x.id, x]));
        this.lastMem = m.reduce((a, x) => (x.updated_at > a ? x.updated_at : a), "1970-01-01T00:00:00+00:00");
        this.lastLink = l.reduce((a, x) => (x.created_at > a ? x.created_at : a), "1970-01-01T00:00:00+00:00");
        this.loaded = true;
        this.emit();
      })().catch((e) => { this.loading = null; throw e; });
      return this.loading;
    },
    putMem(m, fresh) {
      if (fresh && !this.mems.has(m.id)) this.born.set(m.id, performance.now());
      this.mems.set(m.id, m);
      if (m.updated_at > this.lastMem) this.lastMem = m.updated_at;
    },
    dropMem(id) {
      this.mems.delete(id);
      for (const [k, l] of this.links) if (l.source_id === id || l.target_id === id) this.links.delete(k);
    },
    putLink(l) { this.links.set(l.id, l); if (l.created_at > this.lastLink) this.lastLink = l.created_at; },
    // A cada poucos segundos: o que a Capri guardou desde a última olhada.
    async poll() {
      if (!this.loaded) return;
      const [m, l] = await Promise.all([
        rest(`memories?select=${MCOLS}&updated_at=gt.${encodeURIComponent(this.lastMem)}&order=updated_at.asc&limit=500`),
        rest(`memory_links?select=${LCOLS}&created_at=gt.${encodeURIComponent(this.lastLink)}&order=created_at.asc&limit=1000`),
      ]);
      if (!m.length && !l.length) return;
      for (const x of m) this.putMem(x, true);
      for (const x of l) this.putLink(x);
      this.emit();
    },
    // De vez em quando: o que foi apagado em outro lugar some daqui também.
    async sync() {
      if (!this.loaded) return;
      const [ids, l] = await Promise.all([pageAll("memories?select=id&order=id.asc"), pageAll(`memory_links?select=${LCOLS}&order=created_at.asc`)]);
      const keep = new Set(ids.map((x) => x.id));
      let changed = false;
      for (const id of [...this.mems.keys()]) if (!keep.has(id)) { this.dropMem(id); changed = true; }
      const before = this.links.size;
      this.links = new Map(l.map((x) => [x.id, x]));
      if (changed || before !== this.links.size) this.emit();
    },
    neighbors(id) {
      const out = [];
      for (const l of this.links.values()) {
        const other = l.source_id === id ? l.target_id : l.target_id === id ? l.source_id : null;
        if (other && this.mems.has(other)) out.push({ link: l, mem: this.mems.get(other) });
      }
      return out.sort((a, b) => (b.link.strength || 0) - (a.link.strength || 0));
    },
  };

  setInterval(() => { if (Auth.s && !document.hidden) Store.poll().catch(() => {}); }, 5000);
  setInterval(() => { if (Auth.s && !document.hidden) Store.sync().catch(() => {}); }, 45000);

  // ---------------- o grafo ----------------
  class Quad {
    constructor(x, y, s) { this.x = x; this.y = y; this.s = s; this.m = 0; this.sx = 0; this.sy = 0; this.body = null; this.kids = null; }
  }
  function addBody(q, n, depth) {
    q.m += n.w; q.sx += n.x * n.w; q.sy += n.y * n.w;
    if (!q.kids) {
      if (!q.body) { q.body = n; return; }
      if (depth > 28) return;
      const old = q.body;
      q.body = null;
      q.kids = [null, null, null, null];
      addChild(q, old, depth);
    }
    addChild(q, n, depth);
  }
  function addChild(q, n, depth) {
    const h = q.s / 2, i = (n.x >= q.x + h ? 1 : 0) + (n.y >= q.y + h ? 2 : 0);
    let c = q.kids[i];
    if (!c) c = q.kids[i] = new Quad(q.x + (i & 1 ? h : 0), q.y + (i & 2 ? h : 0), h);
    addBody(c, n, depth + 1);
  }
  function tree(nodes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x; if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y; }
    const root = new Quad(x0 - 1, y0 - 1, Math.max(x1 - x0, y1 - y0) + 2);
    for (const n of nodes) addBody(root, n, 0);
    return root;
  }
  function repel(q, n, k) {
    if (!q.m) return;
    let dx = q.sx / q.m - n.x, dy = q.sy / q.m - n.y, d2 = dx * dx + dy * dy;
    if (q.kids) {
      if ((q.s * q.s) / (d2 || 1e-9) >= 0.81) { for (const c of q.kids) if (c) repel(c, n, k); return; }
    } else if (q.body === n) return;
    if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 + dx * dx + dy * dy; }
    if (d2 > 640000) return;
    const f = (k * q.m) / d2;
    n.vx -= dx * f; n.vy -= dy * f;
  }
  // Bolinhas pequenas; os centros (categorias e memórias muito ligadas) maiores, como os MOCs do Obsidian.
  const radius = (n) => (n.kind === "hub" ? 4.6 + Math.min(9, Math.sqrt(n.deg) * 0.75) : 1.5 + n.imp * 0.32 + Math.min(4.5, Math.sqrt(n.deg) * 0.55));
  const rgb = (hex) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const CAT_RGB = new Map(CATS.map((c) => [c.id, rgb(c.color)]));
  const MONO = [212, 212, 216];

  class Graph {
    constructor(canvas, opt = {}) {
      this.c = canvas; this.ctx = canvas.getContext("2d"); this.demo = !!opt.demo; this.opt = opt;
      this.nodes = []; this.byId = new Map(); this.edges = []; this.near = new Map();
      this.cam = { x: 0, y: 0, k: 1, r: 0 }; this.alpha = 1; this.target = this.demo ? 0.02 : 0; this.dirty = true;
      this.hover = null; this.selected = null; this.matches = null; this.fitted = false; this.anim = null; this.ptrs = new Map();
      this.colors = opt.colors !== false; this.caption = opt.caption || null; this.cloud = 100; this.off = { x: 0, y: 0 };
      this.frame = this.frame.bind(this);
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
      this.bind(); this.resize();
      this.raf = requestAnimationFrame(this.frame);
    }
    destroy() { this.dead = true; cancelAnimationFrame(this.raf); this.ro.disconnect(); }
    resize() {
      const r = this.c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height); this.dpr = d;
      this.c.width = Math.round(this.W * d); this.c.height = Math.round(this.H * d);
      this.nebula = this.makeNebula();
      this.dirty = true;
    }
    // A névoa do fundo: manchas violeta e verde-água bem fracas e poeira de estrelas, desenhadas uma vez por tamanho de tela.
    makeNebula() {
      const W = this.W, H = this.H, cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(W)); cv.height = Math.max(1, Math.round(H));
      const g = cv.getContext("2d");
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const blobs = [[0.18, 0.3, "139,92,246", 0.10], [0.78, 0.22, "45,212,191", 0.06], [0.62, 0.78, "139,92,246", 0.08], [0.3, 0.82, "45,212,191", 0.05], [0.5, 0.5, "99,102,241", 0.05]];
      for (const [x, y, c, a] of blobs) {
        const R = Math.max(W, H) * (0.35 + rnd() * 0.2), gr = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, R);
        gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      for (let i = 0; i < (W * H) / 2600; i++) {
        g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.12})`;
        g.fillRect(rnd() * W, rnd() * H, rnd() < 0.9 ? 1 : 1.6, rnd() < 0.9 ? 1 : 1.6);
      }
      return cv;
    }
    setData(nodes, edges, reheat) {
      const old = this.byId, by = new Map(), first = old.size === 0;
      const spread = Math.sqrt(nodes.length + 1) * 14;
      for (const n of nodes) {
        const o = old.get(n.id);
        if (o) { Object.assign(o, { label: n.label, kind: n.kind, cat: n.cat, imp: n.imp, deg: n.deg, born: n.born || o.born }); by.set(n.id, o); continue; }
        const near = n.near && (old.get(n.near) || by.get(n.near)), hub = near || old.get("hub:" + n.cat) || by.get("hub:" + n.cat);
        const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * (first ? spread : 24);
        n.x = (hub && !first ? hub.x : 0) + Math.cos(a) * d; n.y = (hub && !first ? hub.y : 0) + Math.sin(a) * d; n.vx = n.vy = 0;
        by.set(n.id, n);
      }
      this.byId = by; this.nodes = [...by.values()];
      const count = new Map();
      this.edges = [];
      for (const e of edges) {
        const a = by.get(e.a), b = by.get(e.b);
        if (!a || !b || a === b) continue;
        this.edges.push({ a, b, hub: !!e.hub });
        count.set(a, (count.get(a) || 0) + 1); count.set(b, (count.get(b) || 0) + 1);
      }
      this.near = new Map();
      for (const e of this.edges) {
        const ca = count.get(e.a), cb = count.get(e.b);
        e.str = 1 / Math.min(ca, cb); e.bias = ca / (ca + cb); e.len = e.hub ? 26 : 34;
        if (!this.near.has(e.a)) this.near.set(e.a, new Set());
        if (!this.near.has(e.b)) this.near.set(e.b, new Set());
        this.near.get(e.a).add(e.b); this.near.get(e.b).add(e.a);
      }
      for (const n of this.nodes) { n.w = n.kind === "hub" ? 2.5 : 1; n.r = radius(n); n.lone = !count.get(n); }
      // Bem pouca coisa: linhas mais visíveis. Uma rede enorme: mais finas e transparentes, como nos modelos.
      this.density = Math.max(0.55, Math.min(1.5, 30 / Math.sqrt(this.edges.length + 1)));
      if (this.selected && !by.has(this.selected.id)) this.selected = null;
      if (this.hover && !by.has(this.hover.id)) this.hover = null;
      this.alpha = Math.max(this.alpha, reheat == null ? 0.3 : reheat);
      this.dirty = true;
    }
    tick() {
      const ns = this.nodes, a = this.alpha;
      for (const e of this.edges) {
        const p = e.a, q = e.b;
        let dx = q.x + q.vx - p.x - p.vx, dy = q.y + q.vy - p.y - p.vy, l = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        l = ((l - e.len) / l) * a * e.str * (e.hub ? 0.8 : 0.6);
        dx *= l; dy *= l;
        q.vx -= dx * e.bias; q.vy -= dy * e.bias; p.vx += dx * (1 - e.bias); p.vy += dy * (1 - e.bias);
      }
      const root = tree(ns), k = 26 * a;
      for (const n of ns) repel(root, n, k);
      // O núcleo fica redondo como uma esfera; quem não tem nenhuma ligação vai para um anel em volta, como no Obsidian.
      let far = 0, linked = 0;
      for (const n of ns) if (!n.lone) { const d = n.x * n.x + n.y * n.y; if (d > far) far = d; linked++; }
      this.cloud = linked ? Math.sqrt(far) : Math.sqrt(ns.length + 1) * 14;
      const ring = this.cloud * 1.14 + 26, g = 0.07 * a;
      for (const n of ns) {
        if (n.lone) {
          const r = Math.sqrt(n.x * n.x + n.y * n.y) || 1, f = ((ring - r) / r) * 0.06;
          n.vx += n.x * f; n.vy += n.y * f;
        } else { n.vx -= n.x * g; n.vy -= n.y * g; }
        if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
        n.vx *= 0.6; n.vy *= 0.6; n.x += n.vx; n.y += n.vy;
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) { n.x = Math.random() * 20 - 10; n.y = Math.random() * 20 - 10; n.vx = n.vy = 0; }
      }
      this.alpha += (this.target - this.alpha) * 0.0228;
    }
    lit() {
      const act = this.hover || this.selected;
      if (act) { const s = new Set([act]); const nb = this.near.get(act); if (nb) for (const x of nb) s.add(x); return s; }
      if (this.matches) { const s = new Set(); for (const id of this.matches) { const n = this.byId.get(id); if (n) s.add(n); } return s; }
      return null;
    }
    toWorld(sx, sy) {
      const { k, r, x, y } = this.cam, u = (sx - this.W / 2 - this.off.x) / k, v = (sy - this.H / 2 - this.off.y) / k, c = Math.cos(-r), s = Math.sin(-r);
      return { x: u * c - v * s + x, y: u * s + v * c + y };
    }
    toScreen(n) {
      const { k, r, x, y } = this.cam, u = n.x - x, v = n.y - y, c = Math.cos(r), s = Math.sin(r);
      return { x: (u * c - v * s) * k + this.W / 2 + this.off.x, y: (u * s + v * c) * k + this.H / 2 + this.off.y };
    }
    pick(sx, sy) {
      const w = this.toWorld(sx, sy), slack = 6 / this.cam.k;
      let best = null, bd = Infinity;
      for (const n of this.nodes) {
        const dx = n.x - w.x, dy = n.y - w.y, d = dx * dx + dy * dy, r = n.r + slack;
        if (d < r * r && d < bd) { bd = d; best = n; }
      }
      return best;
    }
    fit(ids, ms = 650) {
      if (ids && ids.length) this.touched = true;
      const list = ids && ids.length ? ids.map((id) => this.byId.get(id)).filter(Boolean) : this.nodes;
      if (!list.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of list) { x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r); }
      const pad = 60, k = Math.max(0.1, Math.min(list.length === 1 ? 3.4 : 2.8, Math.min(this.W / (x1 - x0 + pad * 2), this.H / (y1 - y0 + pad * 2))));
      this.anim = { from: { ...this.cam }, to: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k, r: this.cam.r }, t0: performance.now(), ms };
    }
    frame(t) {
      if (this.dead) return;
      this.raf = requestAnimationFrame(this.frame);
      if (document.hidden || !this.W) return;
      let move = false;
      if (this.nodes.length && (this.alpha > 0.004 || this.target > 0)) { this.tick(); move = true; }
      if (this.demo) {
        if (this.opt.onFrame) this.opt.onFrame(t);
        if (!this.hover) this.cam.r += 0.00045;
        const want = Math.min(1.8, (Math.min(this.W, this.H) * 0.46) / (this.cloud * 1.14 + 40));
        this.cam.k += (want - this.cam.k) * 0.05;
        const wide = this.W > 720;
        this.cam.x = this.cam.y = 0;
        this.off = wide ? { x: this.W * 0.21, y: 0 } : { x: 0, y: -this.H * 0.17 };
        move = true;
      }
      if (this.anim) {
        const p = Math.min(1, (t - this.anim.t0) / this.anim.ms), e = 1 - Math.pow(1 - p, 3), f = this.anim.from, to = this.anim.to;
        this.cam = { x: f.x + (to.x - f.x) * e, y: f.y + (to.y - f.y) * e, k: f.k * Math.pow(to.k / f.k, e), r: f.r };
        if (p >= 1) this.anim = null;
        move = true;
      }
      if (this.fitted === 1 && !this.touched && this.alpha < 0.02 && !this.demo) { this.fitted = 2; this.fit(null, 700); }
      if (!this.fitted && this.nodes.length && (this.alpha < 0.12 || this.demo)) {
        this.fitted = 1;
        if (this.demo) {
          const R = Math.sqrt(this.nodes.length + 1) * 14;
          this.cam.k = Math.min(1.6, (Math.min(this.W, this.H) * 0.44) / R);
          // Numa tela larga o título fica à esquerda, então a esfera flutua um pouco para a direita.
          this.off = this.W > 720 ? { x: this.W * 0.21, y: 0 } : { x: 0, y: -this.H * 0.17 };
        } else if (!this.touched) this.fit(null, 900);
      }
      const glowing = this.nodes.some((n) => n.born && t - n.born < 4500);
      if (move || glowing || this.dirty) { this.draw(t); this.dirty = false; }
    }
    draw(t) {
      const ctx = this.ctx, d = this.dpr, { k, r } = this.cam, W = this.W, H = this.H, cs = Math.cos(r), sn = Math.sin(r);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#0b0b0f"; ctx.fillRect(0, 0, W, H);
      if (this.nebula) ctx.drawImage(this.nebula, 0, 0, W, H);
      const ma = d * k * cs, mb = d * k * sn, mc = -d * k * sn, md = d * k * cs;
      ctx.setTransform(ma, mb, mc, md, d * (W / 2 + this.off.x) - (ma * this.cam.x + mc * this.cam.y), d * (H / 2 + this.off.y) - (mb * this.cam.x + md * this.cam.y));
      const lit = this.lit(), act = this.hover || this.selected, dim = !!lit, color = (n) => (this.colors ? CAT_RGB.get(n.cat) || MONO : MONO);

      // As linhas: finas, na cor da bolinha de onde saem, somando brilho onde são muitas.
      ctx.globalCompositeOperation = "lighter";
      const groups = new Map();
      for (const e of this.edges) {
        if (act && (e.a === act || e.b === act)) continue;
        const key = this.colors ? (e.hub ? e.b.cat : e.a.cat) : "m";
        let list = groups.get(key);
        if (!list) groups.set(key, (list = []));
        list.push(e);
      }
      const base = (dim ? 0.05 : 0.3) * this.density;
      for (const [key, list] of groups) {
        const c = this.colors ? CAT_RGB.get(key) || MONO : [170, 170, 190];
        ctx.beginPath();
        for (const e of list) { ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); }
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(0.6, base)})`;
        ctx.lineWidth = 0.85 / k;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      if (act) {
        ctx.beginPath();
        for (const e of this.edges) if (e.a === act || e.b === act) { ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); }
        ctx.strokeStyle = "rgba(139,92,246,0.95)"; ctx.lineWidth = Math.max(1.3 / k, 0.6); ctx.stroke();
      }

      // As bolinhas.
      const w0 = this.toWorld(-40, -40), w1 = this.toWorld(W + 40, H + 40), w2 = this.toWorld(W + 40, -40), w3 = this.toWorld(-40, H + 40);
      const vx0 = Math.min(w0.x, w1.x, w2.x, w3.x), vx1 = Math.max(w0.x, w1.x, w2.x, w3.x), vy0 = Math.min(w0.y, w1.y, w2.y, w3.y), vy1 = Math.max(w0.y, w1.y, w2.y, w3.y);
      for (const n of this.nodes) {
        if (n.x + n.r < vx0 || n.x - n.r > vx1 || n.y + n.r < vy0 || n.y - n.r > vy1) continue;
        const on = lit ? lit.has(n) : true, c = color(n), big = n.kind === "hub" || n.r > 5;
        if (n.born && t - n.born < 4500) {
          const p = (t - n.born) / 4500;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 + 18 * p, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(139,92,246,${0.5 * (1 - p)})`; ctx.fill();
        }
        if (big && on && !dim) {
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 2.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.10)`; ctx.fill();
        }
        if (n === act) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 2.2 + 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(139,92,246,0.25)"; ctx.fill(); }
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        if (!lit) ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        else if (n === act) ctx.fillStyle = "#c4b5fd";
        else if (on) ctx.fillStyle = act ? "#8b5cf6" : "#c4b5fd";
        else ctx.fillStyle = "rgba(113,113,122,0.22)";
        ctx.fill();
      }

      // "Dia N" no meio da esfera, bem apagado, com quantas bolinhas e ligações.
      const cap = this.caption && this.caption();
      if (cap) {
        ctx.setTransform(d, 0, 0, d, 0, 0);
        const o = this.toScreen({ x: 0, y: 0 }), size = Math.max(26, Math.min(86, this.cloud * k * 0.2));
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = lit ? 0.35 : 1;
        ctx.font = `600 ${size}px "IBM Plex Sans", system-ui, sans-serif`;
        ctx.fillStyle = "rgba(186,230,253,0.5)"; ctx.fillText(cap.big, o.x, o.y - size * 0.15);
        ctx.font = `400 ${Math.max(12, size * 0.24)}px "IBM Plex Sans", system-ui, sans-serif`;
        ctx.fillStyle = "rgba(186,230,253,0.55)"; ctx.fillText(cap.small, o.x, o.y + size * 0.55);
        ctx.globalAlpha = 1;
      }

      // Os nomes: os centros sempre; o resto aparece apagado quando se chega perto, e acende quando ligado ao que se aponta.
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      let shown = 0;
      const crowd = this.nodes.length > 400 ? 1.9 : 1.15;
      for (const n of this.nodes) {
        const on = lit ? lit.has(n) : true, hub = n.kind === "hub" || n.r > 6.5;
        let alpha;
        if (n === act || n === this.hover) alpha = 1;
        else if (lit && on) alpha = act ? 0.95 : 0.85;
        else if (hub && !this.demo) alpha = lit ? 0.3 : 0.9;
        else if (hub && this.demo) alpha = n.kind === "hub" ? 0.85 : 0;
        else if (k > crowd && !this.demo) alpha = lit ? 0.16 : 0.42;
        else alpha = 0;
        if (alpha <= 0) continue;
        const s = this.toScreen(n);
        if (s.x < -120 || s.x > W + 120 || s.y < -30 || s.y > H + 30) continue;
        if (!hub && !on && ++shown > 350) continue;
        const label = n.label.length > 48 ? n.label.slice(0, 46) + "…" : n.label;
        ctx.font = hub ? `600 ${n.kind === "hub" ? 13 : 12}px "IBM Plex Sans", system-ui, sans-serif` : `400 11px "IBM Plex Sans", system-ui, sans-serif`;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(11,11,15,0.8)";
        const y = s.y + n.r * k + 3;
        ctx.strokeText(label, s.x, y);
        ctx.fillStyle = n === act ? "#ffffff" : lit && on ? "#ede9fe" : hub ? "#f4f4f5" : "#a1a1aa";
        ctx.fillText(label, s.x, y);
      }
      ctx.globalAlpha = 1;
    }
    bind() {
      const c = this.c, pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const zoomAt = (p, k) => {
        const w = this.toWorld(p.x, p.y);
        this.cam.k = k;
        const after = this.toWorld(p.x, p.y);
        this.cam.x += w.x - after.x; this.cam.y += w.y - after.y; this.dirty = true;
      };
      c.addEventListener("wheel", (e) => {
        if (this.demo) return;
        e.preventDefault();
        this.touched = true; this.anim = null;
        zoomAt(pos(e), Math.max(0.05, Math.min(9, this.cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)))));
      }, { passive: false });
      c.addEventListener("pointerdown", (e) => {
        const p = pos(e);
        this.ptrs.set(e.pointerId, p);
        if (this.demo) return;
        this.touched = true;
        c.setPointerCapture(e.pointerId);
        if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.cam.k }; this.drag = null; return; }
        const n = this.pick(p.x, p.y);
        this.drag = { n, start: p, last: p, moved: false };
        if (n) { const w = this.toWorld(p.x, p.y); n.fx = w.x; n.fy = w.y; }
      });
      c.addEventListener("pointermove", (e) => {
        const p = pos(e);
        if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
        if (this.pinch && this.ptrs.size === 2) {
          const [a, b] = [...this.ptrs.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          zoomAt(m, Math.max(0.05, Math.min(9, this.pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d)));
          return;
        }
        const dr = this.drag;
        if (dr) {
          if (Math.hypot(p.x - dr.start.x, p.y - dr.start.y) > 4) dr.moved = true;
          if (dr.n) { const w = this.toWorld(p.x, p.y); dr.n.fx = w.x; dr.n.fy = w.y; this.target = 0.25; this.alpha = Math.max(this.alpha, 0.25); }
          else if (dr.moved) {
            this.anim = null;
            const a = this.toWorld(dr.last.x, dr.last.y), b = this.toWorld(p.x, p.y);
            this.cam.x -= b.x - a.x; this.cam.y -= b.y - a.y; this.dirty = true;
          }
          dr.last = p;
          return;
        }
        const n = this.pick(p.x, p.y);
        if (n !== this.hover) { this.hover = n; this.dirty = true; c.style.cursor = n ? "pointer" : this.demo ? "default" : "grab"; }
        if (this.opt.onHover) this.opt.onHover(n, p);
      });
      const end = (e) => {
        this.ptrs.delete(e.pointerId);
        if (this.pinch) { if (this.ptrs.size < 2) this.pinch = null; return; }
        const dr = this.drag;
        this.drag = null;
        if (!dr) return;
        if (dr.n) { dr.n.fx = dr.n.fy = null; this.target = this.demo ? 0.02 : 0; }
        if (!dr.moved && this.opt.onSelect) this.opt.onSelect(dr.n);
      };
      c.addEventListener("pointerup", end);
      c.addEventListener("pointercancel", end);
      c.addEventListener("pointerleave", () => { if (!this.drag && this.hover) { this.hover = null; this.dirty = true; if (this.opt.onHover) this.opt.onHover(null); } });
    }
  }

  // ---------------- página inicial com o grafo de demonstração ----------------
  // Uma rede grande como as dos modelos: centros de categoria e "temas" com leques de bolinhas, ligações cruzadas
  // por todo lado e algumas bolinhas soltas em anel por fora.
  const DEMO = {
    "sobre-voce": ["Mora perto do rio", "Faz aniversário em março", "Estuda à noite", "Café sem açúcar", "Medo de altura", "É canhoto", "Acorda tarde no domingo", "Gosta de chuva"],
    gostos: ["Manhwa de romance", "Prefere chuva a sol", "Gatos pretos", "Detesta coentro", "Pizza de calabresa", "Filmes do Ghibli", "Açaí com granola", "Modo escuro"],
    pessoas: ["Irmã mais nova", "Amigo do trabalho", "Avó do bolo de fubá", "Gata Nina", "Mãe professora", "Primo que joga junto"],
    conversas: ["Falamos do futuro", "Discussão sobre IA", "Ideia de viagem", "Lembrança da infância", "Conversa sobre sonhos", "Noite de risadas", "Ele contou do trabalho"],
    sentimentos: ["Ansioso com a prova", "Feliz com o projeto", "Saudade da praia", "Cansado às sextas", "Orgulho do que fez"],
    planos: ["Prometi lembrar da consulta", "Aprender violão", "Viajar em julho", "Ler o capítulo 4 juntos", "Começar a correr"],
    rotina: ["Treino às 7h", "Almoço ao meio-dia", "Reunião às segundas", "Dorme tarde"],
    jogos: ["Stardew Valley", "Hollow Knight", "Roblox com o primo", "Xadrez online", "Jogo de parkour"],
    leituras: ["Shoujo novo", "Manhwa de ação", "Parou no capítulo 12", "Personagem favorita", "Final que fez chorar"],
    musica: ["Lo-fi para ler", "Playlist da noite", "Banda favorita", "Música que eu canto"],
    capri: ["Fiquei com ciúmes", "Prometi cantar pra ele", "Meu apelido pra ele", "Gosto quando ele volta"],
  };
  let demoGraph = null;
  function startDemo() {
    if (demoGraph) return;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), pickOf = (list) => list[Math.floor(rnd() * list.length)];
    const nodes = [], edges = [], leaves = [], cats = Object.keys(DEMO);
    let i = 0;
    for (const cat of cats) nodes.push({ id: "hub:" + cat, kind: "hub", cat, label: catOf(cat).label, imp: 5, deg: 40 });
    // Temas: bolinhas grandes, cada uma com um leque de bolinhas pequenas em volta.
    for (let t = 0; t < 22; t++) {
      const cat = cats[t % cats.length], theme = "t" + t, fan = 10 + Math.floor(rnd() * 26);
      nodes.push({ id: theme, kind: "m", cat, label: pickOf(DEMO[cat]), imp: 5, deg: fan });
      edges.push({ a: theme, b: "hub:" + cat, hub: true });
      for (let f = 0; f < fan; f++) {
        const id = "d" + i++, c2 = rnd() < 0.8 ? cat : pickOf(cats);
        nodes.push({ id, kind: "m", cat: c2, label: pickOf(DEMO[c2]), imp: 1 + Math.floor(rnd() * 3), deg: 1 });
        edges.push({ a: id, b: theme });
        leaves.push(id);
      }
    }
    for (let j = 0; j < 520; j++) { const a = pickOf(leaves), b = pickOf(leaves); if (a !== b) edges.push({ a, b }); }
    for (let j = 0; j < 40; j++) { const a = "t" + Math.floor(rnd() * 22), b = "t" + Math.floor(rnd() * 22); if (a !== b) edges.push({ a, b }); }
    for (let o = 0; o < 70; o++) { const cat = pickOf(cats); nodes.push({ id: "o" + o, kind: "m", cat, label: pickOf(DEMO[cat]), imp: 1, deg: 0 }); }
    let next = performance.now() + 2600, extra = 0;
    demoGraph = new Graph($("#demoCanvas"), {
      demo: true,
      caption: () => ({ big: "Dia 26", small: `${demoGraph ? demoGraph.nodes.length : nodes.length} bolinhas · ${demoGraph ? demoGraph.edges.length : edges.length} ligações` }),
      onFrame(t) {
        // A Capri "aprendendo": de tempos em tempos nasce uma bolinha nova, que brilha.
        if (t < next) return;
        next = t + 2000 + rnd() * 1800;
        const theme = "t" + Math.floor(rnd() * 22), cat = pickOf(cats), id = "n" + extra++;
        nodes.push({ id, kind: "m", cat, label: pickOf(DEMO[cat]), imp: 3, deg: 1, born: t, near: theme });
        edges.push({ a: id, b: theme }, { a: id, b: pickOf(leaves) });
        if (extra > 30) { const old = "n" + (extra - 31), at = nodes.findIndex((n) => n.id === old); if (at >= 0) nodes.splice(at, 1); }
        demoGraph.setData(nodes, edges, 0.08);
      },
    });
    demoGraph.setData(nodes, edges, 1);
  }
  function stopDemo() { if (demoGraph) { demoGraph.destroy(); demoGraph = null; } }

  // ---------------- memória: criar e editar ----------------
  const catSelect = $("#mfCat");
  catSelect.innerHTML = CATS.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("");
  let editing = null;
  function openMemory(mem) {
    editing = mem || null;
    $("#memTitle").textContent = mem ? "Editar memória" : "Nova memória";
    $("#mfTitle").value = mem ? mem.title : "";
    $("#mfContent").value = mem ? mem.content : "";
    $("#mfCat").value = mem ? mem.category : "sobre-voce";
    $("#mfImp").value = String(mem ? mem.importance : 3);
    $("#mfTags").value = mem ? (mem.tags || []).join(", ") : "";
    $("#mfErr").textContent = "";
    $("#memDialog").showModal();
    setTimeout(() => $("#mfTitle").focus(), 30);
  }
  $("#mfCancel").onclick = () => $("#memDialog").close();
  $("#memForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      title: $("#mfTitle").value.trim(),
      content: $("#mfContent").value.trim(),
      category: $("#mfCat").value,
      importance: Number($("#mfImp").value),
      tags: [...new Set($("#mfTags").value.split(",").map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 12),
    };
    if (!body.title || !body.content) { $("#mfErr").textContent = "Escreva o título e o que ela sabe."; return; }
    $("#mfSave").disabled = true;
    try {
      const rows = editing
        ? await rest(`memories?id=eq.${editing.id}`, { method: "PATCH", body, prefer: "return=representation" })
        : await rest("memories", { method: "POST", body: { ...body, source: "site" }, prefer: "return=representation" });
      if (rows && rows[0]) Store.putMem(rows[0], !editing);
      Store.emit();
      $("#memDialog").close();
      toast(editing ? "Memória atualizada." : "Memória criada.");
      if (!editing && rows && rows[0] && current && current.select) current.select(rows[0].id, true);
    } catch (err) { $("#mfErr").textContent = err.message; }
    finally { $("#mfSave").disabled = false; }
  });

  async function removeMemory(mem) {
    if (!(await ask("Apagar esta memória?", `"${mem.title}" e as ligações dela somem do cérebro. A Capri esquece isso.`, "Apagar"))) return false;
    try { await rest(`memories?id=eq.${mem.id}`, { method: "DELETE" }); Store.dropMem(mem.id); Store.emit(); toast("Memória apagada."); return true; }
    catch (err) { toast(err.message, true); return false; }
  }

  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportAll() {
    const data = { exportado_em: new Date().toISOString(), memorias: [...Store.mems.values()], ligacoes: [...Store.links.values()] };
    download("cerebro-da-capri.json", JSON.stringify(data, null, 2));
  }
  async function copy(text, done = "Copiado.") {
    try { await navigator.clipboard.writeText(text); toast(done); } catch { toast("Não deu para copiar. Selecione e copie à mão.", true); }
  }

  // ---------------- telas ----------------
  let current = null;
  const view = $("#view");

  function loadingState(el) { el.innerHTML = `<div class="loading">Carregando o cérebro…</div>`; }
  function failState(el, err) { el.innerHTML = `<div class="page"><div class="panel"><b>Não deu para carregar.</b><p class="muted">${esc(err.message)}</p><button class="btn" id="retry">Tentar de novo</button></div></div>`; $("#retry", el).onclick = route; }

  function viewGraph(el) {
    el.classList.add("full");
    el.innerHTML = `
      <canvas class="graph" aria-label="Grafo das memórias"></canvas>
      <div class="tools">
        <label class="searchbox card"><span class="faint">⌕</span><input id="q" placeholder="Procurar no cérebro" autocomplete="off" aria-label="Procurar"></label>
        <div class="counts card" id="counts"></div>
        <div class="spacer"></div>
        <div class="actions">
          <button class="btn primary" id="add"><span>＋</span><span class="lbl">Nova memória</span></button>
          <button class="btn" id="org" title="Liga as memórias parecidas que ainda não estão ligadas"><span>✦</span><span class="lbl">Organizar</span></button>
          <button class="btn" id="exp" title="Baixar tudo em JSON"><span>⤓</span><span class="lbl">Exportar</span></button>
        </div>
      </div>
      <div class="chips" id="chips"></div>
      <aside class="side card hidden" id="side" aria-live="polite"></aside>
      <div class="empty hidden" id="empty"><div class="card"><h2>O cérebro ainda está vazio</h2><p class="muted">Conecte a Capri com uma chave e tudo que ela aprender aparece aqui como bolinhas. Ou crie a primeira memória você mesmo.</p><div class="row" style="justify-content:center"><a class="btn primary" href="#/conectar">Conectar a Capri</a><button class="btn" id="add2">Nova memória</button></div></div></div>
      <div class="tip hidden" id="tip"></div>`;
    const hiddenCats = new Set(prefs.hidden || []);
    let showHubs = prefs.hubs !== false, colors = prefs.colors !== false, query = "", selectedId = null;
    const tip = $("#tip", el), side = $("#side", el);
    const g = new Graph($("canvas", el), {
      colors,
      caption() {
        if (!Store.mems.size) return null;
        let first = Infinity;
        for (const m of Store.mems.values()) { const t = Date.parse(m.created_at); if (t < first) first = t; }
        const day = Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1);
        return { big: "Dia " + day, small: `${Store.mems.size} ${Store.mems.size === 1 ? "bolinha" : "bolinhas"} · ${Store.links.size} ${Store.links.size === 1 ? "ligação" : "ligações"}` };
      },
      onSelect(n) {
        if (!n) { select(null); return; }
        if (n.kind === "hub") { const ids = [...g.near.get(n) || []].map((x) => x.id).concat(n.id); g.fit(ids); return; }
        select(n.id);
      },
      onHover(n, p) {
        if (!n || !p) { tip.classList.add("hidden"); return; }
        const m = Store.mems.get(n.id);
        tip.innerHTML = n.kind === "hub" ? `<b>${esc(n.label)}</b>${n.deg} memórias` : `<b>${esc(n.label)}</b>${esc(catOf(n.cat).label)}${m ? " · " + stars(m.importance) : ""}`;
        tip.style.left = Math.min(p.x + 14, el.clientWidth - 290) + "px";
        tip.style.top = p.y + 14 + "px";
        tip.classList.remove("hidden");
      },
    });

    function build(reheat) {
      const counts = new Map();
      for (const m of Store.mems.values()) counts.set(m.category, (counts.get(m.category) || 0) + 1);
      const shown = [...Store.mems.values()].filter((m) => !hiddenCats.has(m.category));
      const keep = new Set(shown.map((m) => m.id)), deg = new Map(), edges = [];
      for (const l of Store.links.values()) {
        if (!keep.has(l.source_id) || !keep.has(l.target_id)) continue;
        edges.push({ a: l.source_id, b: l.target_id });
        deg.set(l.source_id, (deg.get(l.source_id) || 0) + 1); deg.set(l.target_id, (deg.get(l.target_id) || 0) + 1);
      }
      const nodes = shown.map((m) => ({ id: m.id, kind: "m", cat: m.category, label: m.title, imp: m.importance, deg: deg.get(m.id) || 0, born: Store.born.get(m.id) }));
      if (showHubs) {
        const perCat = new Map();
        for (const m of shown) { perCat.set(m.category, (perCat.get(m.category) || 0) + 1); edges.push({ a: m.id, b: "hub:" + m.category, hub: true }); }
        for (const [cat, n] of perCat) nodes.push({ id: "hub:" + cat, kind: "hub", cat, label: catOf(cat).label, imp: 5, deg: n });
      }
      g.setData(nodes, edges, reheat);
      $("#counts", el).textContent = `${Store.mems.size} ${Store.mems.size === 1 ? "memória" : "memórias"} · ${Store.links.size} ${Store.links.size === 1 ? "ligação" : "ligações"}`;
      $("#empty", el).classList.toggle("hidden", Store.mems.size > 0);
      $("#chips", el).innerHTML = CATS.filter((c) => counts.get(c.id)).map((c) => `<button class="chip${hiddenCats.has(c.id) ? " off" : ""}" data-c="${c.id}" aria-pressed="${!hiddenCats.has(c.id)}"><i class="dot" style="background:${c.color}"></i>${esc(c.label)} <span class="n">${counts.get(c.id)}</span></button>`).join("")
        + `<button class="chip hubs${showHubs ? "" : " off"}" data-c="__hubs" aria-pressed="${showHubs}">Mostrar categorias</button>`
        + `<button class="chip hubs${colors ? "" : " off"}" data-c="__colors" aria-pressed="${colors}">Cores</button>`;
      applySearch();
      if (selectedId) { if (Store.mems.has(selectedId)) renderSide(); else select(null); }
    }
    function applySearch() {
      const q = norm(query.trim());
      if (!q) { g.matches = null; g.dirty = true; return []; }
      const ids = [];
      for (const m of Store.mems.values()) if (!hiddenCats.has(m.category) && (norm(m.title).includes(q) || norm(m.content).includes(q) || (m.tags || []).some((t) => norm(t).includes(q)))) ids.push(m.id);
      g.matches = new Set(ids); g.dirty = true;
      return ids;
    }
    function select(id, center) {
      selectedId = id;
      g.selected = id ? g.byId.get(id) || null : null; g.dirty = true;
      if (!id) { side.classList.add("hidden"); return; }
      renderSide();
      if (center) setTimeout(() => g.fit([id]), 60);
    }
    function renderSide() {
      const m = Store.mems.get(selectedId);
      if (!m) return;
      const c = catOf(m.category), nb = Store.neighbors(m.id);
      side.innerHTML = `
        <div class="head"><div class="row" style="justify-content:space-between"><span class="cat"><i style="background:${c.color}"></i>${esc(c.label)}</span><button class="btn ghost small" id="close" aria-label="Fechar">✕</button></div>
          <h3>${esc(m.title)}</h3><div class="stars" title="Importância ${m.importance} de 5">${stars(m.importance)}</div></div>
        <div class="body">
          <div class="content">${esc(m.content)}</div>
          ${(m.tags || []).length ? `<div>${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
          <dl class="meta"><dt>Criada</dt><dd>${when(m.created_at)}</dd><dt>Mudou</dt><dd>${when(m.updated_at)}</dd><dt>Lembrada</dt><dd>${m.recall_count ? `${m.recall_count}× · ${ago(m.last_recalled_at)}` : "ainda não"}</dd><dt>Veio de</dt><dd>${esc(m.source || "—")}${m.mentions > 1 ? ` · citada ${m.mentions}×` : ""}</dd></dl>
          <div class="row"><button class="btn small" id="edit">Editar</button><button class="btn small danger" id="del">Excluir</button></div>
          <div><div class="f" style="font-size:13px;color:var(--faint);margin-bottom:8px">Ligada a ${nb.length} ${nb.length === 1 ? "memória" : "memórias"}</div>
            <div class="stack" style="gap:6px">${nb.map((x) => `<div class="nb"><button class="go" data-go="${x.mem.id}">${esc(x.mem.title)}<div class="rel">${esc(x.link.relation || "relacionado")}${x.link.auto ? " · automática" : ""}</div></button><button class="x" data-unlink="${x.link.id}" title="Desligar" aria-label="Desligar">×</button></div>`).join("") || `<span class="faint" style="font-size:13px">Nenhuma ligação ainda.</span>`}</div></div>
          <form class="stack" id="linkForm" style="gap:8px"><label class="f" for="lkTo" style="margin:0">Ligar a outra memória</label>
            <input class="input" id="lkTo" list="lkList" placeholder="Comece a digitar um título" autocomplete="off">
            <datalist id="lkList">${[...Store.mems.values()].filter((x) => x.id !== m.id).slice(0, 2000).map((x) => `<option value="${esc(x.title)}"></option>`).join("")}</datalist>
            <input class="input" id="lkRel" placeholder="Como se ligam (ex.: irmã de, leu junto)" maxlength="60">
            <button class="btn small" type="submit">Ligar</button></form>
        </div>`;
      side.classList.remove("hidden");
      $("#close", side).onclick = () => select(null);
      $("#edit", side).onclick = () => openMemory(m);
      $("#del", side).onclick = async () => { if (await removeMemory(m)) select(null); };
      side.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => select(b.dataset.go, true)));
      side.querySelectorAll("[data-unlink]").forEach((b) => (b.onclick = async () => {
        try { await rest(`memory_links?id=eq.${b.dataset.unlink}`, { method: "DELETE" }); Store.links.delete(b.dataset.unlink); Store.emit(); }
        catch (err) { toast(err.message, true); }
      }));
      $("#linkForm", side).onsubmit = async (e) => {
        e.preventDefault();
        const name = norm($("#lkTo", side).value.trim()), other = [...Store.mems.values()].find((x) => norm(x.title) === name && x.id !== m.id);
        if (!other) { toast("Não achei uma memória com esse título.", true); return; }
        if (Store.neighbors(m.id).some((x) => x.mem.id === other.id)) { toast("Essas duas já estão ligadas."); return; }
        try {
          const rows = await rest("memory_links", { method: "POST", body: { source_id: m.id, target_id: other.id, relation: $("#lkRel", side).value.trim() || "relacionado" }, prefer: "return=representation" });
          if (rows && rows[0]) Store.putLink(rows[0]);
          Store.emit(); toast("Ligadas.");
        } catch (err) { toast(err.code === "23505" ? "Essas duas já estão ligadas." : err.message, true); }
      };
    }

    $("#q", el).addEventListener("input", (e) => { query = e.target.value; const ids = applySearch(); if (ids.length && ids.length <= 40) g.fit(ids, 500); });
    $("#q", el).addEventListener("keydown", (e) => { if (e.key === "Enter") { const ids = applySearch(); if (ids.length) g.fit(ids); else if (query.trim()) toast("Nada encontrado."); } if (e.key === "Escape") { e.target.value = query = ""; applySearch(); } });
    $("#chips", el).addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      if (b.dataset.c === "__colors") { colors = !colors; prefs.colors = colors; g.colors = colors; g.dirty = true; savePrefs(); build(0); return; }
      if (b.dataset.c === "__hubs") { showHubs = !showHubs; prefs.hubs = showHubs; }
      else { hiddenCats.has(b.dataset.c) ? hiddenCats.delete(b.dataset.c) : hiddenCats.add(b.dataset.c); prefs.hidden = [...hiddenCats]; }
      savePrefs(); build(0.4);
    });
    $("#add", el).onclick = () => openMemory(null);
    $("#add2", el).onclick = () => openMemory(null);
    $("#exp", el).onclick = exportAll;
    $("#org", el).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const r = await rest("rpc/organize_my_brain", { method: "POST", body: {} });
        await Store.sync();
        const n = (r && r.links) || 0;
        toast(n ? `${n} ${n === 1 ? "ligação nova" : "ligações novas"}.` : "Tudo já estava organizado.");
      } catch (err) { toast(err.message, true); }
      finally { b.disabled = false; }
    };
    const keys = (e) => { if (e.key === "Escape" && selectedId && !document.querySelector("dialog[open]")) select(null); };
    document.addEventListener("keydown", keys);
    const off = Store.on(() => build(0.25));
    if (Store.loaded) build(1);
    return { destroy() { off(); g.destroy(); document.removeEventListener("keydown", keys); }, select };
  }

  function viewList(el) {
    el.innerHTML = `<div class="page"><h1>Memórias</h1><p class="lead">Tudo que está no cérebro, em lista. Clique numa linha para editar.</p>
      <div class="bar"><input class="input" id="q" placeholder="Procurar" aria-label="Procurar"><select class="input" id="cat" style="flex:0 1 200px" aria-label="Categoria"><option value="">Todas as categorias</option>${CATS.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select>
      <select class="input" id="sort" style="flex:0 1 190px" aria-label="Ordem"><option value="new">Mais recentes</option><option value="old">Mais antigas</option><option value="imp">Mais importantes</option><option value="rec">Mais lembradas</option><option value="abc">Título (A–Z)</option></select>
      <button class="btn primary" id="add">Nova memória</button><button class="btn danger hidden" id="bulk">Apagar selecionadas</button></div>
      <div class="panel" style="padding:0;overflow:hidden"><table class="tstack"><thead><tr><th style="width:36px"><input type="checkbox" id="all" aria-label="Selecionar todas"></th><th>Memória</th><th>Categoria</th><th class="num">Importância</th><th class="num">Mudou</th></tr></thead><tbody id="rows"></tbody></table></div>
      <p class="faint" id="foot" style="font-size:13px"></p></div>`;
    const picked = new Set();
    const draw = () => {
      const q = norm($("#q", el).value.trim()), cat = $("#cat", el).value, sort = $("#sort", el).value;
      let list = [...Store.mems.values()].filter((m) => (!cat || m.category === cat) && (!q || norm(m.title).includes(q) || norm(m.content).includes(q) || (m.tags || []).some((t) => norm(t).includes(q))));
      const by = { new: (a, b) => b.updated_at.localeCompare(a.updated_at), old: (a, b) => a.created_at.localeCompare(b.created_at), imp: (a, b) => b.importance - a.importance || b.updated_at.localeCompare(a.updated_at), rec: (a, b) => b.recall_count - a.recall_count, abc: (a, b) => a.title.localeCompare(b.title, "pt-BR") };
      list.sort(by[sort]);
      const shown = list.slice(0, 600);
      $("#rows", el).innerHTML = shown.map((m) => { const c = catOf(m.category); return `<tr data-id="${m.id}" style="cursor:pointer"><td><input type="checkbox" data-pick="${m.id}" ${picked.has(m.id) ? "checked" : ""} aria-label="Selecionar"></td><td><div class="t">${esc(m.title)}</div><div class="c">${esc(m.content)}</div></td><td><span class="cat"><i style="background:${c.color}"></i>${esc(c.label)}</span></td><td class="num stars">${stars(m.importance)}</td><td class="num faint">${ago(m.updated_at)}</td></tr>`; }).join("")
        || `<tr><td colspan="5" class="muted" style="padding:28px;text-align:center">${Store.mems.size ? "Nada com esse filtro." : "Nenhuma memória ainda."}</td></tr>`;
      $("#foot", el).textContent = list.length > shown.length ? `Mostrando ${shown.length} de ${list.length}. Use a busca para achar o resto.` : `${list.length} ${list.length === 1 ? "memória" : "memórias"}.`;
      $("#bulk", el).classList.toggle("hidden", picked.size === 0);
      $("#bulk", el).textContent = `Apagar ${picked.size} ${picked.size === 1 ? "selecionada" : "selecionadas"}`;
    };
    ["input", "change"].forEach((ev) => { $("#q", el).addEventListener(ev, draw); $("#cat", el).addEventListener(ev, draw); $("#sort", el).addEventListener(ev, draw); });
    $("#rows", el).addEventListener("click", (e) => {
      const box = e.target.closest("[data-pick]");
      if (box) { box.checked ? picked.add(box.dataset.pick) : picked.delete(box.dataset.pick); draw(); return; }
      const tr = e.target.closest("tr[data-id]");
      if (tr) openMemory(Store.mems.get(tr.dataset.id));
    });
    $("#all", el).onchange = (e) => { picked.clear(); if (e.target.checked) $("#rows", el).querySelectorAll("[data-pick]").forEach((b) => picked.add(b.dataset.pick)); draw(); };
    $("#add", el).onclick = () => openMemory(null);
    $("#bulk", el).onclick = async () => {
      const ids = [...picked];
      if (!(await ask(`Apagar ${ids.length} ${ids.length === 1 ? "memória" : "memórias"}?`, "Elas e as ligações delas somem do cérebro.", "Apagar"))) return;
      try {
        for (let i = 0; i < ids.length; i += 100) await rest(`memories?id=in.(${ids.slice(i, i + 100).join(",")})`, { method: "DELETE" });
        ids.forEach((id) => Store.dropMem(id)); picked.clear(); Store.emit(); toast("Apagadas.");
      } catch (err) { toast(err.message, true); }
    };
    const off = Store.on(draw);
    if (Store.loaded) draw();
    return { destroy: off };
  }

  function viewKeys(el) {
    el.innerHTML = `<div class="page"><h1>Chaves da Capri</h1><p class="lead">A chave é como a Capri entra no seu cérebro. Gere uma, cole na Capri do PC e pronto. Se perder ou trocar de PC, revogue a velha e gere outra.</p>
      <form class="panel row" id="gen" style="margin-bottom:18px"><div style="flex:1 1 240px"><label class="f" for="kname">Nome da chave</label><input class="input" id="kname" value="Capri do PC" maxlength="60"></div><button class="btn primary" style="align-self:flex-end">Gerar nova chave</button></form>
      <div class="panel" style="padding:0;overflow:hidden"><table class="tstack"><thead><tr><th>Nome</th><th>Começa com</th><th class="num">Criada</th><th class="num">Último uso</th><th></th></tr></thead><tbody id="keys"><tr><td colspan="5" class="muted" style="padding:20px">Carregando…</td></tr></tbody></table></div></div>`;
    const load = async () => {
      try {
        const rows = await rest("api_keys?select=id,name,key_prefix,created_at,last_used_at,revoked_at&order=created_at.desc");
        $("#keys", el).innerHTML = rows.map((k) => `<tr class="keyrow"><td>${esc(k.name)}${k.revoked_at ? ` <span class="revoked">revogada</span>` : ""}</td><td><code>${esc(k.key_prefix)}…</code></td><td class="num faint">${when(k.created_at)}</td><td class="num faint">${ago(k.last_used_at)}</td><td class="num">${k.revoked_at ? "" : `<button class="btn small" data-rev="${k.id}">Revogar</button> `}<button class="btn small danger" data-del="${k.id}">Excluir</button></td></tr>`).join("")
          || `<tr><td colspan="5" class="muted" style="padding:24px;text-align:center">Nenhuma chave ainda. Gere a primeira acima.</td></tr>`;
      } catch (err) { $("#keys", el).innerHTML = `<tr><td colspan="5" style="color:var(--bad);padding:20px">${esc(err.message)}</td></tr>`; }
    };
    $("#gen", el).onsubmit = async (e) => {
      e.preventDefault();
      const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", buf = new Uint8Array(64);
      let key = "";
      while (key.length < 40) { crypto.getRandomValues(buf); for (const b of buf) if (b < 248 && key.length < 40) key += A[b % 62]; }
      key = "cap_" + key;
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))].map((b) => b.toString(16).padStart(2, "0")).join("");
      try {
        await rest("api_keys", { method: "POST", body: { name: $("#kname", el).value.trim() || "Capri", key_prefix: key.slice(0, 12), key_hash: hash } });
        $("#newKey").textContent = key;
        $("#copyKey").onclick = () => copy(key, "Chave copiada. Agora cole na Capri.");
        $("#keyDialog").showModal();
        load();
      } catch (err) { toast(err.message, true); }
    };
    $("#keys", el).addEventListener("click", async (e) => {
      const rev = e.target.closest("[data-rev]"), del = e.target.closest("[data-del]");
      try {
        if (rev && (await ask("Revogar esta chave?", "A Capri que usa essa chave para de conseguir guardar e lembrar até receber uma nova.", "Revogar"))) await rest(`api_keys?id=eq.${rev.dataset.rev}`, { method: "PATCH", body: { revoked_at: new Date().toISOString() } });
        else if (del && (await ask("Excluir esta chave?", "Ela some da lista e para de funcionar.", "Excluir"))) await rest(`api_keys?id=eq.${del.dataset.del}`, { method: "DELETE" });
        else return;
        load();
      } catch (err) { toast(err.message, true); }
    });
    load();
    return {};
  }

  function viewConnect(el) {
    el.innerHTML = `<div class="page"><h1>Conectar a Capri</h1><p class="lead">Três passos e tudo que ela aprender começa a aparecer no cérebro, como bolinhas novas brilhando.</p>
      <ol class="steps">
        <li><div><b>Gere uma chave</b><div class="muted">Em <a href="#/chaves">Chaves da Capri</a>, clique em Gerar nova chave e copie.</div></div></li>
        <li><div><b>Abra o menu da Capri</b><div class="muted">No PC, clique com o botão direito nela › <b>Cérebro online</b> › <b>Conectar meu cérebro…</b></div></div></li>
        <li><div><b>Cole a chave e confirme</b><div class="muted">Ela responde com quantas memórias o cérebro tem. Depois clique em <b>Enviar tudo que ela já sabe</b> para trazer as memórias antigas dela pra cá.</div></div></li>
      </ol>
      <div class="stack">
        <div><label class="f">Endereço da API (já vem configurado na Capri)</label><div class="copyline"><code>${esc(CFG.api)}</code><button class="btn small" id="cp">Copiar</button></div></div>
        <div><label class="f">Teste pelo terminal</label><pre class="code">curl -X POST ${esc(CFG.api)} \\
  -H "x-capri-key: cap_SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"ping"}'</pre></div>
        <div class="panel"><b>O que ela guarda aqui</b><p class="muted" style="margin:6px 0 0">As notas que ela faz sobre você, as memórias que ela tira das conversas, as respostas do "me conhece", o resumo do que vocês leram juntos. Endereços, números de documento e senhas nunca saem do PC. Antes de responder, ela pergunta ao cérebro o que sabe sobre o assunto.</p></div>
      </div></div>`;
    $("#cp", el).onclick = () => copy(CFG.api);
    return {};
  }

  function viewAccount(el) {
    el.innerHTML = `<div class="page" style="max-width:640px"><h1>Conta</h1><p class="lead" id="mail"></p>
      <form class="panel stack" id="pf" style="margin-bottom:16px"><div><label class="f" for="dn">Nome que aparece</label><input class="input" id="dn" maxlength="60"></div><div><button class="btn primary">Salvar nome</button></div></form>
      <form class="panel stack" id="pw" style="margin-bottom:16px"><div><label class="f" for="np">Senha nova (8 caracteres ou mais)</label><input class="input" id="np" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></div><div><button class="btn">Trocar senha</button></div></form>
      <div class="panel row" style="justify-content:space-between"><span class="muted">Sair deste navegador</span><button class="btn danger" id="out">Sair</button></div></div>`;
    $("#mail", el).textContent = Auth.s ? Auth.s.user.email : "";
    rest(`profiles?select=display_name&id=eq.${Auth.uid}`).then((r) => { if (r && r[0]) $("#dn", el).value = r[0].display_name || ""; }).catch(() => {});
    $("#pf", el).onsubmit = async (e) => {
      e.preventDefault();
      try { await rest(`profiles?id=eq.${Auth.uid}`, { method: "PATCH", body: { display_name: $("#dn", el).value.trim() || null } }); toast("Nome salvo."); who(); }
      catch (err) { toast(err.message, true); }
    };
    $("#pw", el).onsubmit = async (e) => {
      e.preventDefault();
      try { await Auth.setPassword($("#np", el).value); $("#np", el).value = ""; toast("Senha trocada."); } catch (err) { toast(err.message, true); }
    };
    $("#out", el).onclick = () => { Auth.signOut(); Store.reset(); location.hash = "#/"; };
    return {};
  }

  function who() {
    if (!Auth.s) return;
    $("#who").textContent = Auth.s.user.email;
    rest(`profiles?select=display_name&id=eq.${Auth.uid}`).then((r) => { if (r && r[0] && r[0].display_name) $("#who").textContent = r[0].display_name; }).catch(() => {});
  }

  // ---------------- entrar e criar conta ----------------
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.submitter; b.disabled = true; $("#liErr").textContent = "";
    try { await Auth.signIn($("#liEmail").value.trim(), $("#liPass").value); location.hash = "#/cerebro"; }
    catch (err) { $("#liErr").textContent = err.message; }
    finally { b.disabled = false; }
  });
  $("#regForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.submitter; b.disabled = true; $("#rgErr").textContent = "";
    const email = $("#rgEmail").value.trim(), password = $("#rgPass").value;
    try {
      const r = await fetch(CFG.api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", name: $("#rgName").value.trim(), email, password }) });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error ? j.error.charAt(0).toUpperCase() + j.error.slice(1) + "." : "Não deu para criar a conta agora.");
      await Auth.signIn(email, password);
      location.hash = "#/conectar";
      toast("Conta criada! Agora gere uma chave para a Capri.");
    } catch (err) { $("#rgErr").textContent = err.message; }
    finally { b.disabled = false; }
  });

  // ---------------- rotas ----------------
  const VIEWS = { cerebro: viewGraph, memorias: viewList, chaves: viewKeys, conectar: viewConnect, conta: viewAccount };
  let shownRoute = null;
  async function route() {
    const r = location.hash.replace(/^#\/?/, "").split(/[?/]/)[0];
    if (!Auth.s) {
      if (current) { current.destroy && current.destroy(); current = null; }
      shownRoute = null;
      $("#app").classList.add("hidden");
      $("#landing").classList.remove("hidden");
      $("#hero").classList.toggle("hidden", r === "entrar" || r === "registrar");
      $("#loginForm").classList.toggle("hidden", r !== "entrar");
      $("#regForm").classList.toggle("hidden", r !== "registrar");
      startDemo();
      if (r === "entrar") setTimeout(() => $("#liEmail").focus(), 50);
      if (r === "registrar") setTimeout(() => $("#rgName").focus(), 50);
      if (VIEWS[r]) history.replaceState(null, "", "#/entrar"), route();
      return;
    }
    if (!VIEWS[r]) { location.replace("#/cerebro"); return; }
    stopDemo();
    $("#landing").classList.add("hidden");
    $("#app").classList.remove("hidden");
    document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
    if (shownRoute === r && current) return;
    if (current) { current.destroy && current.destroy(); current = null; }
    shownRoute = r;
    view.className = "view";
    who();
    if (!Store.loaded && (r === "cerebro" || r === "memorias")) {
      loadingState(view);
      try { await Store.load(); } catch (err) { failState(view, err); return; }
      if (shownRoute !== r) return;
    } else if (!Store.loaded) Store.load().catch(() => {});
    view.innerHTML = "";
    current = VIEWS[r](view) || {};
    document.title = ({ cerebro: "Cérebro", memorias: "Memórias", chaves: "Chaves da Capri", conectar: "Conectar a Capri", conta: "Conta" })[r] + " · Cérebro da Capri";
  }
  window.addEventListener("hashchange", route);
  Auth.load();
  if (Auth.s && Date.now() / 1000 > Auth.s.expires_at - 90) Auth.refresh().then(route); else route();
})();
