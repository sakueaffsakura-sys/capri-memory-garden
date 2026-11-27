/* Cérebro da Capri: o site do cérebro online da Capri. Sem dependências: fala direto com o Supabase (Auth + REST)
   e desenha o grafo num <canvas> com uma simulação de forças própria (Barnes-Hut). */
"use strict";
(() => {
  const CFG = {
    url: "https://wzecozxpipxbalauazub.supabase.co",
    key: "sb_publishable_eSrxXF0IbJhd3eyu0gm7XA_PpAs4trf",
    api: "https://wzecozxpipxbalauazub.supabase.co/functions/v1/capri-brain",
  };
  // Dois grupos: o que ela sabe de vocês (p) e o que ela estuda (k).
  const CATS = [
    { id: "sobre-voce", label: "Sobre você", color: "#f472b6", g: "p" },
    { id: "gostos", label: "Gostos", color: "#fb923c", g: "p" },
    { id: "pessoas", label: "Pessoas", color: "#facc15", g: "p" },
    { id: "conversas", label: "Conversas", color: "#a3e635", g: "p" },
    { id: "sentimentos", label: "Sentimentos", color: "#f87171", g: "p" },
    { id: "planos", label: "Planos e promessas", color: "#34d399", g: "p" },
    { id: "rotina", label: "Rotina", color: "#22d3ee", g: "p" },
    { id: "jogos", label: "Jogos", color: "#60a5fa", g: "p" },
    { id: "leituras", label: "Leituras", color: "#c084fc", g: "p" },
    { id: "musica", label: "Música", color: "#e879f9", g: "p" },
    { id: "capri", label: "Sobre a Capri", color: "#a78bfa", g: "p" },
    { id: "outros", label: "Outros", color: "#a1a1aa", g: "p" },
    { id: "conhecimento", label: "Conhecimento geral", color: "#cbd5e1", g: "k" },
    { id: "ciencia", label: "Ciência e natureza", color: "#4ade80", g: "k" },
    { id: "tecnologia", label: "Tecnologia", color: "#38bdf8", g: "k" },
    { id: "matematica", label: "Matemática e lógica", color: "#818cf8", g: "k" },
    { id: "idiomas", label: "Idiomas", color: "#fda4af", g: "k" },
    { id: "historia", label: "História e mundo", color: "#fbbf24", g: "k" },
    { id: "arte", label: "Arte e cultura", color: "#f0abfc", g: "k" },
    { id: "saude", label: "Corpo e saúde", color: "#5eead4", g: "k" },
    { id: "habilidades", label: "Como fazer", color: "#fdba74", g: "k" },
  ];
  const CAT = new Map(CATS.map((c) => [c.id, c]));
  const catOf = (id) => CAT.get(id) || CAT.get("outros");
  const LEVELS = ["", "Básico", "Elementar", "Intermediário", "Avançado", "Especialista"];
  const LEVEL_COLORS = ["", "#94a3b8", "#5eead4", "#60a5fa", "#a78bfa", "#fbbf24"];
  // Tipos de memória: o que ela sabe (fatos), o que estudou, como fazer e o diário do que aconteceu.
  const KINDS = {
    fato: { label: "Fato", many: "Fatos", line: "O que ela sabe de vocês e de si mesma. Quase não enfraquece.", icon: "◆" },
    conhecimento: { label: "Estudo", many: "Estudos", line: "O que ela estudou, do básico ao especialista. Volta para revisão no dia certo.", icon: "✦" },
    habilidade: { label: "Habilidade", many: "Habilidades", line: "Como fazer as coisas. Revisada como os estudos.", icon: "✚" },
    episodio: { label: "Diário", many: "Diário", line: "O que aconteceu. Vai enfraquecendo e sai do céu quando fica fraco, sem ser apagado.", icon: "◌" },
  };
  const kindOf = (m) => (KINDS[m.kind] ? m.kind : m.level != null || catOf(m.category).g === "k" ? "conhecimento" : "fato");
  const isKnow = (m) => { const k = kindOf(m); return k === "conhecimento" || k === "habilidade"; };
  // Força de uma memória (retenção): 1 = firme como no dia em que aprendeu; cai com o tempo, mais devagar quanto mais
  // ela foi lembrada e revisada. Mesma conta do banco: 0,9 ^ (dias desde a última vez / força em dias).
  const DAY = 86400000;
  const retention = (m, at = Date.now()) => Math.pow(0.9, Math.max(0, (at - Date.parse(m.fresh_at || m.updated_at || m.created_at)) / DAY) / Math.max(0.1, m.strength || 7));
  const retLabel = (r) => (r >= 0.9 ? "firme" : r >= 0.7 ? "boa" : r >= 0.4 ? "fraca" : "quase esquecida");
  const retColor = (r) => (r >= 0.9 ? "#4ade80" : r >= 0.7 ? "#a3e635" : r >= 0.4 ? "#fbbf24" : "#f87171");
  const isDue = (m) => !m.archived && !!m.due_at && Date.parse(m.due_at) <= Date.now();
  const force = (m) => { const r = retention(m); return `<span class="force" title="Força ${Math.round(r * 100)}%: ${retLabel(r)}"><i style="width:${Math.max(4, Math.round(r * 100))}%;background:${retColor(r)}"></i></span>`; };
  const inTime = (d) => (d < 1 / 24 ? Math.max(1, Math.round(d * 1440)) + " min" : d < 1 ? Math.round(d * 24) + " h" : d < 60 ? Math.round(d) + (Math.round(d) === 1 ? " dia" : " dias") : d < 730 ? Math.round(d / 30) + " meses" : Math.round(d / 365) + " anos");
  // Quanto tempo a memória aguenta depois de cada resposta (a mesma conta de brain_review).
  function afterGrade(m, g) {
    let e = m.ease || 2.5, s = m.strength || 1;
    const r = retention(m), gain = (m.reviews || 0) === 0 ? 1 : Math.min(1, Math.max(0.15, (1 - r) / 0.1));
    if (g === 0) return 10 / 1440;
    if (g === 1) s = Math.max(1, s * (1 + 0.2 * gain));
    else if (g === 2) s = Math.max(1, s * (1 + (e - 1) * gain));
    else { e = Math.min(3.5, e + 0.15); s = Math.max(2, s * (1 + (e * 1.3 - 1) * gain)); }
    return Math.min(3650, s);
  }
  // O cérebro muda de cara conforme cresce.
  const STAGES = [
    { min: 0, name: "Semente", line: "As primeiras lembranças começando a brotar." },
    { min: 25, name: "Broto", line: "Os primeiros grupos já aparecem e as ligações começam a se cruzar." },
    { min: 100, name: "Constelação", line: "Cada assunto ganha uma nuvem de luz própria." },
    { min: 300, name: "Galáxia", line: "As ideias giram umas em volta das outras e soltam faíscas o tempo todo." },
    { min: 1000, name: "Nebulosa", line: "Um céu inteiro de lembranças e conhecimento." },
    { min: 3000, name: "Universo", line: "Tudo que ela sabe, do básico ao especialista, brilhando junto." },
  ];
  const stageOf = (n) => { let i = 0; while (i + 1 < STAGES.length && n >= STAGES[i + 1].min) i++; return i; };
  const growthOf = (n) => Math.max(0, Math.min(1, Math.log(1 + n) / Math.log(1 + 3000)));
  const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const MCOLS = "id,title,content,category,importance,level,topic,tags,source,happened_at,mentions,recall_count,last_recalled_at,created_at,updated_at,kind,strength,ease,reviews,lapses,last_review_at,due_at,fresh_at,question,archived";
  const LEARN = "id,kind,strength,ease,reviews,lapses,last_review_at,due_at,fresh_at,archived,recall_count,last_recalled_at";
  const GCOLS = "id,topic,category,target_level,why,status,created_at,updated_at,done_at";
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
  // Preferências separadas por conta: quem entra neste navegador nunca herda nada da conta de outra pessoa.
  const prefs = {};
  let prefsFor = null;
  const prefsKey = (uid) => (uid ? PREFS + "." + uid : PREFS);
  function loadPrefs(uid) {
    for (const k of Object.keys(prefs)) delete prefs[k];
    prefsFor = uid || null;
    try { Object.assign(prefs, JSON.parse(localStorage.getItem(prefsKey(prefsFor))) || {}); } catch {}
  }
  const savePrefs = () => { try { localStorage.setItem(prefsKey(prefsFor), JSON.stringify(prefs)); } catch {} };
  try { localStorage.removeItem(PREFS); } catch {}

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
      // Outra conta entrando: nada da anterior fica na memória da página.
      if (!this.s || !this.s.user || this.s.user.id !== j.user.id) { Store.reset(); loadPrefs(j.user.id); }
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
      Store.reset(); loadPrefs(null);
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
    mems: new Map(), links: new Map(), goals: new Map(), reviews: [], loaded: false, loading: null, lastMem: "", lastLink: "", subs: new Set(), born: new Map(), sparks: new Set(),
    reset() { this.mems.clear(); this.links.clear(); this.goals.clear(); this.reviews = []; this.born.clear(); this.sparks.clear(); this.loaded = false; this.loading = null; this.lastMem = this.lastLink = ""; this.gen = (this.gen || 0) + 1; },
    on(f) { this.subs.add(f); return () => this.subs.delete(f); },
    emit() { for (const f of this.subs) f(); },
    load() {
      if (this.loaded) return Promise.resolve();
      if (!this.loading) this.loading = (async () => {
        const gen = this.gen;
        const since = new Date(Date.now() - 120 * DAY).toISOString();
        const [m, l, g, r] = await Promise.all([pageAll(`memories?select=${MCOLS}&order=created_at.asc`), pageAll(`memory_links?select=${LCOLS}&order=created_at.asc`),
          rest(`goals?select=${GCOLS}&order=created_at.asc`).catch(() => []), pageAll(`reviews?select=memory_id,grade,retention,reviewed_at&reviewed_at=gt.${encodeURIComponent(since)}&order=reviewed_at.asc`).catch(() => [])]);
        if (gen !== this.gen) throw new Error("A conta mudou. Carregue de novo.");
        this.mems = new Map(m.map((x) => [x.id, x]));
        this.links = new Map(l.map((x) => [x.id, x]));
        this.goals = new Map((g || []).map((x) => [x.id, x]));
        this.reviews = r || [];
        this.lastMem = m.reduce((a, x) => (x.updated_at > a ? x.updated_at : a), "1970-01-01T00:00:00+00:00");
        this.lastLink = l.reduce((a, x) => (x.created_at > a ? x.created_at : a), "1970-01-01T00:00:00+00:00");
        this.loaded = true;
        this.emit();
      })().catch((e) => { this.loading = null; throw e; });
      return this.loading;
    },
    putMem(m, fresh) {
      const old = this.mems.get(m.id);
      if (fresh && !old) this.born.set(m.id, performance.now());
      // Nasceu agora, ou a Capri acabou de lembrar disso: a bolinha solta faíscas no grafo.
      if (fresh && (!old || (m.recall_count || 0) > (old.recall_count || 0))) this.sparks.add(m.id);
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
      const gen = this.gen;
      const [m, l] = await Promise.all([
        rest(`memories?select=${MCOLS}&updated_at=gt.${encodeURIComponent(this.lastMem)}&order=updated_at.asc&limit=500`),
        rest(`memory_links?select=${LCOLS}&created_at=gt.${encodeURIComponent(this.lastLink)}&order=created_at.asc&limit=1000`),
      ]);
      if (gen !== this.gen || (!m.length && !l.length)) return;
      for (const x of m) this.putMem(x, true);
      for (const x of l) this.putLink(x);
      this.emit();
    },
    // De vez em quando: o que foi apagado em outro lugar some daqui também.
    async sync() {
      if (!this.loaded) return;
      const gen = this.gen;
      // Junto: a força, as revisões e o que foi esquecido mudam sem mexer no texto, então vêm à parte.
      const [ids, l, g] = await Promise.all([pageAll(`memories?select=${LEARN}&order=id.asc`), pageAll(`memory_links?select=${LCOLS}&order=created_at.asc`), rest(`goals?select=${GCOLS}&order=created_at.asc`).catch(() => null)]);
      if (gen !== this.gen) return;
      const keep = new Set(ids.map((x) => x.id));
      let changed = false;
      for (const id of [...this.mems.keys()]) if (!keep.has(id)) { this.dropMem(id); changed = true; }
      for (const x of ids) {
        const m = this.mems.get(x.id);
        if (m && (m.archived !== x.archived || m.strength !== x.strength || m.due_at !== x.due_at || m.kind !== x.kind || m.recall_count !== x.recall_count)) { Object.assign(m, x); changed = true; }
      }
      if (g) { const before = JSON.stringify([...this.goals.values()]); this.goals = new Map(g.map((x) => [x.id, x])); if (before !== JSON.stringify(g)) changed = true; }
      const before = this.links.size;
      this.links = new Map(l.map((x) => [x.id, x]));
      if (changed || before !== this.links.size) this.emit();
    },
    takeSparks() { const s = [...this.sparks]; this.sparks.clear(); return s; },
    due() { return [...this.mems.values()].filter(isDue).sort((a, b) => retention(a) - retention(b)); },
    topics() {
      const by = new Map();
      for (const m of this.mems.values()) {
        if (!m.topic || m.archived) continue;
        const key = norm(m.topic);
        let t = by.get(key);
        if (!t) by.set(key, (t = { topic: m.topic, key, mems: [], levels: [0, 0, 0, 0, 0, 0], cats: new Map(), updated: "" }));
        t.mems.push(m);
        t.levels[m.level || 0]++;
        t.cats.set(m.category, (t.cats.get(m.category) || 0) + 1);
        if (m.updated_at > t.updated) t.updated = m.updated_at;
      }
      for (const t of by.values()) {
        t.cat = [...t.cats].sort((a, b) => b[1] - a[1])[0][0];
        t.top = t.levels.reduce((a, n, i) => (n ? i : a), 0);
        t.mems.sort((a, b) => (a.level || 0) - (b.level || 0) || a.created_at.localeCompare(b.created_at));
      }
      return [...by.values()].sort((a, b) => b.mems.length - a.mems.length || a.topic.localeCompare(b.topic, "pt-BR"));
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
  // O conhecimento mais avançado fica um pouco maior.
  const radius = (n) => (n.kind === "hub" ? 4.8 + Math.min(10, Math.sqrt(n.deg) * 0.8) : 1.5 + n.imp * 0.32 + (n.level ? n.level * 0.24 : 0) + Math.min(4.5, Math.sqrt(n.deg) * 0.55));
  const rgb = (hex) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const CAT_RGB = new Map(CATS.map((c) => [c.id, rgb(c.color)]));
  const CAT_RGB01 = new Map(CATS.map((c) => [c.id, rgb(c.color).map((v) => v / 255)]));
  const MONO = [212, 212, 216], VIOLET_RGB = [139, 92, 246];
  const lighten = (c, f) => [Math.round(c[0] + (255 - c[0]) * f), Math.round(c[1] + (255 - c[1]) * f), Math.round(c[2] + (255 - c[2]) * f)];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const TRAIL = new Set(["aprofunda", "base para", "mesmo assunto"]);
  const TAU = Math.PI * 2;

  // Um brilho redondo por cor, desenhado uma vez e carimbado em cada bolinha, faísca e nuvem.
  const SPRITES = new Map();
  function glow(c) {
    const key = c.join(",");
    let s = SPRITES.get(key);
    if (!s) {
      s = document.createElement("canvas"); s.width = s.height = 64;
      const g = s.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${key},1)`); gr.addColorStop(0.16, `rgba(${key},0.55)`); gr.addColorStop(0.45, `rgba(${key},0.14)`); gr.addColorStop(1, `rgba(${key},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      SPRITES.set(key, s);
    }
    return s;
  }
  // Céu de fundo: três camadas de estrelas que andam devagar com a câmera e piscam. Quanto maior o cérebro, mais estrelas.
  function makeStars() {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), out = [];
    for (let i = 0; i < 1100; i++) {
      const tint = rnd();
      out.push({ x: rnd(), y: rnd(), d: [0.012, 0.035, 0.07][i % 3], r: rnd() < 0.9 ? 1 : 1.7, a: 0.12 + rnd() * 0.5, ph: rnd() * TAU, sp: 0.0005 + rnd() * 0.0022,
        c: tint < 0.14 ? "#fde68a" : tint < 0.34 ? "#c4b5fd" : tint < 0.5 ? "#a5f3fc" : "#ffffff" });
    }
    return out;
  }

  class Graph {
    constructor(canvas, opt = {}) {
      this.c = canvas; this.ctx = canvas.getContext("2d"); this.demo = !!opt.demo; this.opt = opt;
      this.nodes = []; this.byId = new Map(); this.edges = []; this.near = new Map(); this.adj = new Map();
      this.cam = { x: 0, y: 0, k: 1, r: 0 }; this.alpha = 1; this.target = this.demo ? 0.02 : 0; this.dirty = true;
      this.hover = null; this.selected = null; this.matches = null; this.fitted = false; this.anim = null; this.ptrs = new Map();
      this.colors = opt.colors !== false; this.caption = opt.caption || null; this.cloud = 100; this.off = { x: 0, y: 0 };
      this.mode = opt.mode || "web"; this.g = 0; this.stars = makeStars(); this.pulses = []; this.pAcc = 0; this.clouds = [];
      this.frameNo = 0; this.lastDraw = 0; this.lastT = 0; this.effects = !REDUCED; this.wave = null; this.lay = null;
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
    // A névoa do fundo: manchas violeta e verde-água bem fracas, desenhadas uma vez por tamanho de tela.
    makeNebula() {
      const W = this.W, H = this.H, cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(W)); cv.height = Math.max(1, Math.round(H));
      const g = cv.getContext("2d");
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const blobs = [[0.18, 0.3, "139,92,246", 0.11], [0.78, 0.22, "45,212,191", 0.065], [0.62, 0.78, "139,92,246", 0.09], [0.3, 0.82, "45,212,191", 0.05], [0.5, 0.5, "99,102,241", 0.06], [0.88, 0.62, "236,72,153", 0.035]];
      for (const [x, y, c, a] of blobs) {
        const R = Math.max(W, H) * (0.35 + rnd() * 0.2), gr = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, R);
        gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      return cv;
    }
    setData(nodes, edges, reheat) {
      const old = this.byId, by = new Map(), first = old.size === 0;
      const spread = Math.sqrt(nodes.length + 1) * 14;
      for (const n of nodes) {
        const o = old.get(n.id);
        if (o) { Object.assign(o, { label: n.label, kind: n.kind, cat: n.cat, imp: n.imp, deg: n.deg, level: n.level || 0, know: !!n.know, ret: n.ret, born: n.born || o.born }); by.set(n.id, o); continue; }
        const near = n.near && (old.get(n.near) || by.get(n.near)), hub = near || old.get("hub:" + n.cat) || by.get("hub:" + n.cat);
        const a = Math.random() * TAU, d = 6 + Math.random() * (first ? spread : 24);
        n.x = (hub && !first ? hub.x : 0) + Math.cos(a) * d; n.y = (hub && !first ? hub.y : 0) + Math.sin(a) * d; n.vx = n.vy = 0;
        n.level = n.level || 0; n.know = !!n.know;
        by.set(n.id, n);
      }
      this.byId = by; this.nodes = [...by.values()];
      const count = new Map();
      this.edges = [];
      for (const e of edges) {
        const a = by.get(e.a), b = by.get(e.b);
        if (!a || !b || a === b) continue;
        this.edges.push({ a, b, hub: !!e.hub, trail: !!e.trail });
        count.set(a, (count.get(a) || 0) + 1); count.set(b, (count.get(b) || 0) + 1);
      }
      this.near = new Map(); this.adj = new Map();
      for (const e of this.edges) {
        const ca = count.get(e.a), cb = count.get(e.b), h = hash(e.a.id + "|" + e.b.id);
        e.str = 1 / Math.min(ca, cb); e.bias = ca / (ca + cb); e.len = e.hub ? 26 : e.trail ? 30 : 34;
        // As linhas fazem uma curva suave, para um lado ou para o outro, como fios de verdade.
        e.bend = e.hub ? 0.04 : (h & 1 ? 1 : -1) * (0.07 + (h % 9) * 0.011);
        for (const [p, q] of [[e.a, e.b], [e.b, e.a]]) {
          if (!this.near.has(p)) this.near.set(p, new Set());
          this.near.get(p).add(q);
          if (!this.adj.has(p)) this.adj.set(p, []);
          this.adj.get(p).push(e);
        }
      }
      let mems = 0, personal = 0, knowledge = 0;
      for (const n of this.nodes) {
        n.w = n.kind === "hub" ? 2.5 : 1; n.r = radius(n); n.lone = !count.get(n);
        n.ring = n.kind === "hub" ? -1 : n.know ? Math.max(1, n.level || 1) : 0;
        n.seed = hash(n.id) % 1000 / 1000;
        if (n.kind !== "hub") { mems++; if (n.know) knowledge++; else personal++; }
      }
      // Quanto maior o cérebro, mais forte o brilho, as nuvens e as faíscas.
      this.g = growthOf(this.opt.size ? this.opt.size() : mems);
      // Lembranças de um lado, conhecimento do outro: dois hemisférios, quando há dos dois.
      this.hemis = personal >= 3 && knowledge >= 3 ? Math.sqrt(mems) * 5.2 : 0;
      this.layout(mems);
      // Bem pouca coisa: linhas mais visíveis. Uma rede enorme: mais finas e transparentes, como nos modelos.
      this.density = Math.max(0.55, Math.min(1.5, 30 / Math.sqrt(this.edges.length + 1)));
      if (this.selected && !by.has(this.selected.id)) this.selected = null;
      if (this.hover && !by.has(this.hover.id)) this.hover = null;
      this.alpha = Math.max(this.alpha, reheat == null ? 0.3 : reheat);
      this.dirty = true;
    }
    // Vista em níveis: o que ela sabe de você no meio; o conhecimento em anéis, do básico (perto) ao especialista (longe),
    // cada área numa fatia do círculo.
    layout(mems) {
      const pc = [], kc = [];
      for (const c of CATS) {
        if (!this.nodes.some((n) => n.kind !== "hub" && n.cat === c.id)) continue;
        (this.nodes.some((n) => n.kind !== "hub" && n.cat === c.id && n.know) ? kc : pc).push(c.id);
      }
      // O núcleo cresce com o que ela sabe de vocês; os anéis do conhecimento vêm logo depois dele.
      let mine = 0;
      for (const n of this.nodes) if (n.kind !== "hub" && !n.know) mine++;
      const base = Math.max(46, Math.sqrt(mems + 1) * 7.5), core = Math.max(base * 0.95, Math.sqrt(mine + 1) * 11);
      const R = [core, core + base * 0.85, core + base * 1.5, core + base * 2.15, core + base * 2.8, core + base * 3.45, core + base * 4.2];
      const at = (list, cat) => { const i = Math.max(0, list.indexOf(cat)); return ((i + 0.5) / Math.max(1, list.length)) * TAU - Math.PI / 2; };
      this.lay = { base, R, pc, kc,
        ang: (n) => (n.know || (n.kind === "hub" && kc.includes(n.cat)) ? at(kc, n.cat) : at(pc, n.cat)),
        hw: (n) => Math.min(Math.PI / 2.6, (Math.PI / Math.max(1, n.ring === 0 ? pc.length : kc.length)) * 0.86) };
    }
    setMode(mode) {
      if (mode === this.mode) return;
      this.mode = mode; this.alpha = 1; this.fitted = 1; this.touched = false; this.dirty = true;
      if (mode === "levels") this.fitAll(900);
    }
    tick() {
      const ns = this.nodes, a = this.alpha, levels = this.mode === "levels";
      for (const e of this.edges) {
        if (levels && e.hub) continue;
        const p = e.a, q = e.b;
        let dx = q.x + q.vx - p.x - p.vx, dy = q.y + q.vy - p.y - p.vy, l = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        l = ((l - e.len) / l) * a * e.str * (e.hub ? 0.8 : 0.6) * (levels ? (e.trail ? 0.35 : 0.12) : 1);
        dx *= l; dy *= l;
        q.vx -= dx * e.bias; q.vy -= dy * e.bias; p.vx += dx * (1 - e.bias); p.vy += dy * (1 - e.bias);
      }
      const root = tree(ns), k = (levels ? 16 : 26) * a;
      for (const n of ns) repel(root, n, k);
      let far = 0, linked = 0;
      for (const n of ns) if (!n.lone) { const d = n.x * n.x + n.y * n.y; if (d > far) far = d; linked++; }
      this.cloud = linked ? Math.sqrt(far) : Math.sqrt(ns.length + 1) * 14;
      if (levels) this.placeLevels();
      else {
        // O núcleo fica redondo como uma esfera (ou dois hemisférios); quem não tem nenhuma ligação vai para um anel em volta.
        const ring = this.cloud * 1.14 + 26, g = 0.07 * a, side = this.hemis;
        for (const n of ns) {
          if (n.lone) {
            const r = Math.sqrt(n.x * n.x + n.y * n.y) || 1, f = ((ring - r) / r) * 0.06;
            n.vx += n.x * f; n.vy += n.y * f;
          } else {
            // Tela deitada: um ao lado do outro; tela em pé (celular): um em cima do outro.
            const c0 = side ? (n.know || (n.kind === "hub" && this.lay.kc.includes(n.cat)) ? side : -side) : 0, tall = this.H > this.W * 1.15;
            n.vx -= (n.x - (tall ? 0 : c0)) * g; n.vy -= (n.y - (tall ? c0 : 0)) * g;
          }
        }
      }
      for (const n of ns) {
        if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
        n.vx *= 0.6; n.vy *= 0.6; n.x += n.vx; n.y += n.vy;
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) { n.x = Math.random() * 20 - 10; n.y = Math.random() * 20 - 10; n.vx = n.vy = 0; }
      }
      this.alpha += (this.target - this.alpha) * 0.0228;
    }
    placeLevels() {
      const L = this.lay;
      for (const n of this.nodes) {
        const hub = n.kind === "hub", ring = hub ? (L.kc.includes(n.cat) ? 6 : 0) : n.ring, R = L.R[ring], th = L.ang(n), hw = hub ? 0 : L.hw(n);
        const cr = Math.hypot(n.x, n.y) || 1;
        let d = Math.atan2(n.y, n.x) - th;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const t = th + Math.max(-hw, Math.min(hw, d));
        const r = hub ? R : ring === 0 ? Math.min(cr, R * 0.92) : Math.max(R - L.base * 0.24, Math.min(R + L.base * 0.24, cr));
        const s = hub ? 0.2 : 0.09;
        n.vx += (Math.cos(t) * r - n.x) * s; n.vy += (Math.sin(t) * r - n.y) * s;
      }
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
    fitAll(ms) {
      if (this.mode === "levels" && this.lay) {
        // Sobra espaço para a barra de cima e as etiquetas de baixo.
        const R = this.lay.R[this.lay.kc.length ? 6 : 0] + 50, k = Math.max(0.05, Math.min(2.8, Math.min(this.W - 40, this.H - 150) / (R * 2)));
        this.anim = { from: { ...this.cam }, to: { x: 0, y: 0, k, r: this.cam.r }, t0: performance.now(), ms };
      } else this.fit(null, ms);
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
    // Uma faísca correndo por uma ligação, como uma sinapse.
    spark(e, from, bright) {
      if (this.pulses.length > 120) return;
      this.pulses.push({ e, rev: from === e.b, t0: performance.now(), dur: 700 + Math.random() * 900 + (bright ? 0 : 500), bright: bright ? 1 : 0 });
    }
    // Quando ela lembra de algo (ou aprende algo novo), a bolinha acende e manda faíscas para as vizinhas.
    fire(id) {
      const n = this.byId.get(id);
      if (!n) return;
      n.flash = performance.now();
      if (!this.effects) { this.dirty = true; return; }
      for (const e of (this.adj.get(n) || []).slice(0, 24)) this.spark(e, n, true);
    }
    // Mudou de estágio: uma onda de luz sai do centro e todas as categorias faíscam.
    celebrate() {
      this.wave = { t0: performance.now() };
      for (const n of this.nodes) if (n.kind === "hub" || n.r > 6.5) this.fire(n.id);
    }
    frame(t) {
      if (this.dead) return;
      this.raf = requestAnimationFrame(this.frame);
      if (document.hidden || !this.W) return;
      let move = false;
      if (this.nodes.length && (this.alpha > 0.004 || this.target > 0)) {
        // Num PC rápido, vários passos da simulação por quadro: a rede se arruma logo.
        const until = performance.now() + 7;
        let steps = 0;
        do { this.tick(); steps++; } while (steps < 4 && this.alpha > 0.03 && !this.demo && performance.now() < until);
        move = true;
      }
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
      if (this.fitted === 1 && !this.touched && this.alpha < 0.02 && !this.demo) { this.fitted = 2; this.fitAll(700); }
      if (!this.fitted && this.nodes.length && (this.alpha < 0.12 || this.demo)) {
        this.fitted = 1;
        if (this.demo) {
          const R = Math.sqrt(this.nodes.length + 1) * 14;
          this.cam.k = Math.min(1.6, (Math.min(this.W, this.H) * 0.44) / R);
          // Numa tela larga o título fica à esquerda, então a esfera flutua um pouco para a direita.
          this.off = this.W > 720 ? { x: this.W * 0.21, y: 0 } : { x: 0, y: -this.H * 0.17 };
        } else if (!this.touched) this.fitAll(900);
      }
      // Parado, o céu continua vivo (estrelas piscando, faíscas), mas a uns 30 quadros por segundo para poupar o PC.
      const busy = move || this.dirty || this.pulses.length || this.wave || this.nodes.some((n) => (n.born && t - n.born < 3000) || (n.flash && t - n.flash < 1600));
      if (busy || (this.effects && this.nodes.length && t - this.lastDraw > (this.slow ? 80 : 33))) {
        const t0 = performance.now();
        this.draw(t); this.lastDraw = t; this.dirty = false;
        // PC mais fraco: menos brilho e menos quadros parados, para não pesar.
        this.cost = (this.cost || 0) * 0.9 + (performance.now() - t0) * 0.1;
        this.slow = this.cost > 20;
      }
    }
    drawStars(t) {
      const ctx = this.ctx, W = this.W * 1.2, H = this.H * 1.2, n = Math.floor((120 + this.g * 680) * (this.slow ? 0.5 : 1)), px = this.cam.x * this.cam.k, py = this.cam.y * this.cam.k;
      for (let i = 0; i < n; i++) {
        const s = this.stars[i];
        let x = (s.x * W - px * s.d) % W, y = (s.y * H - py * s.d) % H;
        if (x < 0) x += W;
        if (y < 0) y += H;
        ctx.globalAlpha = s.a * (this.effects ? 0.55 + 0.45 * Math.sin(t * s.sp + s.ph) : 0.8);
        ctx.fillStyle = s.c;
        ctx.fillRect(x - this.W * 0.1, y - this.H * 0.1, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }
    // O centro e o tamanho de cada categoria, para pintar a nuvem colorida atrás dela.
    measureClouds() {
      const acc = new Map();
      for (const n of this.nodes) {
        if (n.lone) continue;
        let s = acc.get(n.cat);
        if (!s) acc.set(n.cat, (s = { x: 0, y: 0, xx: 0, yy: 0, n: 0 }));
        s.x += n.x; s.y += n.y; s.xx += n.x * n.x; s.yy += n.y * n.y; s.n++;
      }
      this.clouds = [...acc].map(([cat, s]) => {
        const x = s.x / s.n, y = s.y / s.n;
        return { cat, x, y, r: Math.sqrt(Math.max(16, s.xx / s.n - x * x + s.yy / s.n - y * y)), n: s.n };
      });
    }
    curve(e) {
      const a = e.a, b = e.b, bend = this.edges.length > 1800 ? 0 : this.mode === "levels" ? e.bend * 0.5 : e.bend;
      return { cx: (a.x + b.x) / 2 - (b.y - a.y) * bend, cy: (a.y + b.y) / 2 + (b.x - a.x) * bend };
    }
    draw(t) {
      const ctx = this.ctx, d = this.dpr, { k, r } = this.cam, W = this.W, H = this.H, cs = Math.cos(r), sn = Math.sin(r), G = this.g;
      const dt = Math.min(80, t - (this.lastT || t)), levels = this.mode === "levels";
      this.lastT = t;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#08080c"; ctx.fillRect(0, 0, W, H);
      if (this.nebula) { ctx.globalAlpha = Math.min(1, 0.75 + G * 0.5); ctx.drawImage(this.nebula, 0, 0, W, H); ctx.globalAlpha = 1; }
      this.drawStars(t);
      const ma = d * k * cs, mb = d * k * sn, mc = -d * k * sn, md = d * k * cs;
      ctx.setTransform(ma, mb, mc, md, d * (W / 2 + this.off.x) - (ma * this.cam.x + mc * this.cam.y), d * (H / 2 + this.off.y) - (mb * this.cam.x + md * this.cam.y));
      const lit = this.lit(), act = this.hover || this.selected, dim = !!lit, color = (n) => (this.colors ? CAT_RGB.get(n.cat) || MONO : MONO);

      // As nuvens de cada categoria: quase nada no começo, nebulosas coloridas quando o cérebro cresce.
      // Pintadas numa tela pequena e esticadas: são só névoa, e assim quase não custam nada.
      if (this.frameNo++ % 12 === 0 || !this.clouds.length) this.measureClouds();
      ctx.globalCompositeOperation = "lighter";
      if (this.clouds.length) {
        const q = 4, cw = Math.ceil(W / q), ch = Math.ceil(H / q);
        if (!this.cloudCv) this.cloudCv = document.createElement("canvas");
        const cv = this.cloudCv;
        if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
        const g2 = cv.getContext("2d");
        g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, cw, ch); g2.globalCompositeOperation = "lighter";
        g2.setTransform(ma / d / q, mb / d / q, mc / d / q, md / d / q, (W / 2 + this.off.x) / q - ((ma * this.cam.x + mc * this.cam.y) / d) / q, (H / 2 + this.off.y) / q - ((mb * this.cam.x + md * this.cam.y) / d) / q);
        for (const cl of this.clouds) {
          if (cl.n < 3) continue;
          const c = this.colors ? CAT_RGB.get(cl.cat) || MONO : VIOLET_RGB, a = (0.03 + 0.15 * G) * Math.min(1, cl.n / 14) * (dim ? 0.35 : 1);
          const R = cl.r * 1.75 + 28, gr = g2.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, R);
          gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`); gr.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.42})`); gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
          g2.fillStyle = gr; g2.beginPath(); g2.arc(cl.x, cl.y, R, 0, TAU); g2.fill();
        }
        ctx.setTransform(d, 0, 0, d, 0, 0);
        ctx.drawImage(cv, 0, 0, W, H);
        ctx.setTransform(ma, mb, mc, md, d * (W / 2 + this.off.x) - (ma * this.cam.x + mc * this.cam.y), d * (H / 2 + this.off.y) - (mb * this.cam.x + md * this.cam.y));
      }

      // Na vista em níveis: os anéis do básico ao especialista e o núcleo com o que ela sabe de vocês.
      if (levels && this.lay) {
        const L = this.lay;
        ctx.globalCompositeOperation = "source-over";
        if (L.pc.length) {
          const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, L.R[0]);
          gr.addColorStop(0, "rgba(244,114,182,0.10)"); gr.addColorStop(1, "rgba(244,114,182,0.02)");
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, L.R[0], 0, TAU); ctx.fill();
        }
        ctx.lineWidth = 1 / k; ctx.setLineDash([4 / k, 6 / k]);
        for (let i = 1; i <= 5; i++) {
          ctx.strokeStyle = `rgba(${rgb(LEVEL_COLORS[i]).join(",")},${dim ? 0.12 : 0.28})`;
          ctx.beginPath(); ctx.arc(0, 0, L.R[i], 0, TAU); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalCompositeOperation = "lighter";
      }

      // As linhas: curvas finas na cor da bolinha de onde saem, somando brilho onde são muitas. As trilhas de um assunto
      // (do básico ao avançado) mais fortes.
      const groups = new Map();
      for (const e of this.edges) {
        if (act && (e.a === act || e.b === act)) continue;
        if (levels && e.hub) continue;
        const key = (this.colors ? (e.hub ? e.b.cat : e.a.cat) : "m") + (e.trail ? "|t" : "");
        let list = groups.get(key);
        if (!list) groups.set(key, (list = []));
        list.push(e);
      }
      const base = (dim ? 0.05 : 0.3) * this.density * (levels ? 0.6 : 1);
      for (const [key, list] of groups) {
        const trail = key.endsWith("|t"), cat = trail ? key.slice(0, -2) : key, c = this.colors ? CAT_RGB.get(cat) || MONO : [170, 170, 190];
        ctx.beginPath();
        for (const e of list) { const q = this.curve(e); ctx.moveTo(e.a.x, e.a.y); ctx.quadraticCurveTo(q.cx, q.cy, e.b.x, e.b.y); }
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(trail ? 0.85 : 0.6, base * (trail ? 2.3 : 1))})`;
        ctx.lineWidth = (trail ? 1.5 : 0.85) / k;
        ctx.stroke();
      }

      // As faíscas: nascem sozinhas de vez em quando (mais quanto maior o cérebro) e em rajada quando ela lembra de algo.
      if (this.effects && this.edges.length) {
        this.pAcc += (dt / 1000) * (0.6 + G * 20) * (this.slow ? 0.4 : 1);
        while (this.pAcc >= 1) {
          this.pAcc -= 1;
          const e = this.edges[Math.floor(Math.random() * this.edges.length)];
          if (!e.hub || Math.random() < 0.25) this.spark(e, Math.random() < 0.5 ? e.a : e.b, false);
        }
      }
      const now = performance.now();
      this.pulses = this.pulses.filter((p) => now - p.t0 < p.dur && this.byId.get(p.e.a.id) === p.e.a);
      for (const p of this.pulses) {
        const f = (now - p.t0) / p.dur, u = p.rev ? 1 - f : f, q = this.curve(p.e), a = p.e.a, b = p.e.b;
        const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * q.cx + u * u * b.x, y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * q.cy + u * u * b.y;
        const c = p.bright ? [196, 181, 253] : lighten(this.colors ? CAT_RGB.get(p.e.hub ? p.e.b.cat : p.e.a.cat) || MONO : MONO, 0.35);
        const s = Math.min((p.bright ? 15 : 9) / k, p.bright ? 18 : 11);
        ctx.globalAlpha = Math.sin(f * Math.PI) * (dim ? 0.4 : 0.9);
        ctx.drawImage(glow(c), x - s / 2, y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;

      // A onda de luz quando o cérebro muda de estágio.
      if (this.wave) {
        const p = (now - this.wave.t0) / 2600;
        if (p >= 1) this.wave = null;
        else {
          const R = (this.cloud * 1.3 + 60) * p;
          ctx.lineWidth = (10 * (1 - p) + 1) / k;
          ctx.strokeStyle = `rgba(167,139,250,${0.6 * (1 - p)})`;
          ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
      if (act) {
        ctx.beginPath();
        for (const e of this.edges) if (e.a === act || e.b === act) { const q = this.curve(e); ctx.moveTo(e.a.x, e.a.y); ctx.quadraticCurveTo(q.cx, q.cy, e.b.x, e.b.y); }
        ctx.strokeStyle = "rgba(139,92,246,0.95)"; ctx.lineWidth = Math.max(1.3 / k, 0.6); ctx.stroke();
      }

      // As bolinhas: primeiro o brilho (somando luz), depois o corpo, um miolo claro nas grandes e anéis no conhecimento avançado.
      const w0 = this.toWorld(-40, -40), w1 = this.toWorld(W + 40, H + 40), w2 = this.toWorld(W + 40, -40), w3 = this.toWorld(-40, H + 40);
      const vx0 = Math.min(w0.x, w1.x, w2.x, w3.x), vx1 = Math.max(w0.x, w1.x, w2.x, w3.x), vy0 = Math.min(w0.y, w1.y, w2.y, w3.y), vy1 = Math.max(w0.y, w1.y, w2.y, w3.y);
      const seen = [];
      for (const n of this.nodes) if (!(n.x + n.r * 4 < vx0 || n.x - n.r * 4 > vx1 || n.y + n.r * 4 < vy0 || n.y - n.r * 4 > vy1)) seen.push(n);
      ctx.globalCompositeOperation = "lighter";
      const many = seen.length > 1600;
      for (const n of seen) {
        const on = lit ? lit.has(n) : true, hub = n.kind === "hub";
        const shine = hub || (!this.slow && (n.imp >= 4 || n.level >= 4 || n.r > 5 || (!many && G > 0.35 && n.imp >= 3 && n.deg > 1)));
        if (!shine && n !== act) continue;
        const c = color(n), breathe = hub && this.effects ? 1 + 0.08 * Math.sin(t / 900 + n.seed * TAU) : 1;
        const s = n.r * (hub ? 7.5 : 5.2) * (0.6 + 0.55 * G) * breathe;
        ctx.globalAlpha = (lit ? (on ? 0.75 : 0.06) : 0.42 + 0.4 * G) * (hub ? 0.9 : 0.75);
        ctx.drawImage(glow(c), n.x - s / 2, n.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      for (const n of seen) {
        const on = lit ? lit.has(n) : true, c = color(n), hub = n.kind === "hub";
        if (n.born && t - n.born < 3000) {
          const p = (t - n.born) / 3000;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2 + 16 * p, 0, TAU);
          ctx.strokeStyle = `rgba(167,139,250,${0.7 * (1 - p)})`; ctx.lineWidth = 1.6 / k; ctx.stroke();
        }
        if (n.flash && t - n.flash < 1600) {
          const p = (t - n.flash) / 1600;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2 + 14 * p, 0, TAU);
          ctx.strokeStyle = `rgba(237,233,254,${0.8 * (1 - p)})`; ctx.lineWidth = 1.5 / k; ctx.stroke();
        }
        if (n === act) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 2.2 + 3, 0, TAU); ctx.fillStyle = "rgba(139,92,246,0.25)"; ctx.fill(); }
        // Memória fraca brilha menos: o tempo apaga, lembrar acende de novo.
        ctx.globalAlpha = hub ? 1 : 0.32 + 0.68 * (n.ret == null ? 1 : n.ret);
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU);
        let body;
        if (!lit) body = c;
        else if (n === act) body = [196, 181, 253];
        else if (on) body = act ? VIOLET_RGB : [196, 181, 253];
        else body = null;
        ctx.fillStyle = body ? `rgb(${body[0]},${body[1]},${body[2]})` : "rgba(113,113,122,0.22)";
        ctx.fill();
        const px = n.r * k;
        if (body && px > 2.6) {
          const hi = lighten(body, 0.6);
          ctx.beginPath(); ctx.arc(n.x - n.r * 0.18, n.y - n.r * 0.18, n.r * (hub ? 0.42 : 0.38), 0, TAU);
          ctx.fillStyle = `rgba(${hi[0]},${hi[1]},${hi[2]},0.85)`; ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (hub && px > 2) {
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.6, 0, TAU);
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${lit && !on ? 0.12 : 0.55})`; ctx.lineWidth = 1 / k; ctx.stroke();
        }
        // Conhecimento: um anel a partir do intermediário, dois no avançado, e uma estrelinha no especialista.
        if (n.level >= 3 && px > 1.4 && (!lit || on)) {
          const lc = rgb(LEVEL_COLORS[n.level]);
          ctx.lineWidth = 0.7 / Math.max(0.6, k);
          for (let i = 0; i < (n.level >= 4 ? 2 : 1); i++) {
            ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 1.4 + i * 1.6, 0, TAU);
            ctx.strokeStyle = `rgba(${lc[0]},${lc[1]},${lc[2]},${0.75 - i * 0.3})`; ctx.stroke();
          }
          if (n.level === 5) {
            const s = n.r * 1.9, a = t / 2400 + n.seed * TAU;
            ctx.beginPath();
            for (let i = 0; i < 4; i++) { const ang = a + (i * Math.PI) / 2; ctx.moveTo(n.x, n.y); ctx.lineTo(n.x + Math.cos(ang) * s * 1.6, n.y + Math.sin(ang) * s * 1.6); }
            ctx.strokeStyle = `rgba(${lc[0]},${lc[1]},${lc[2]},0.55)`; ctx.lineWidth = 0.6 / Math.max(0.6, k); ctx.stroke();
          }
        }
      }

      // "Dia N" no meio da esfera, bem apagado, com o estágio, quantas bolinhas e ligações.
      const cap = this.caption && !levels && this.caption();
      if (cap) {
        ctx.setTransform(d, 0, 0, d, 0, 0);
        const o = this.toScreen({ x: 0, y: 0 }), size = Math.max(26, Math.min(86, this.cloud * k * 0.2));
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = lit ? 0.35 : 1;
        ctx.font = `600 ${size}px "IBM Plex Sans", system-ui, sans-serif`;
        ctx.fillStyle = "rgba(186,230,253,0.3)"; ctx.fillText(cap.big, o.x, o.y - size * 0.15);
        ctx.font = `400 ${Math.max(12, size * 0.24)}px "IBM Plex Sans", system-ui, sans-serif`;
        ctx.fillStyle = "rgba(186,230,253,0.45)"; ctx.fillText(cap.small, o.x, o.y + size * 0.55);
        ctx.globalAlpha = 1;
      }
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (levels && this.lay) {
        const L = this.lay;
        ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.font = `600 11px "IBM Plex Sans", system-ui, sans-serif`;
        if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
        for (let i = 1; i <= 5; i++) {
          const s = this.toScreen({ x: 0, y: -L.R[i] });
          ctx.globalAlpha = lit ? 0.4 : 0.9; ctx.fillStyle = LEVEL_COLORS[i];
          ctx.fillText(LEVELS[i].toUpperCase(), s.x, s.y - 3);
        }
        if (L.pc.length) { const s = this.toScreen({ x: 0, y: 0 }); ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(251,207,232,0.6)"; ctx.fillText("VOCÊS", s.x, s.y); }
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        ctx.globalAlpha = 1;
      }

      // Os nomes: os centros sempre; o resto aparece apagado quando se chega perto, e acende quando ligado ao que se aponta.
      // Um nome que cairia em cima de outro mais importante fica de fora, para a rede não virar um borrão de letras.
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
      const crowd = this.nodes.length > 400 ? 2.1 : this.nodes.length > 120 ? 1.6 : 1.1, wanted = [];
      for (const n of this.nodes) {
        const on = lit ? lit.has(n) : true, isHub = n.kind === "hub", hub = isHub || n.r > 6.5;
        let alpha, rank;
        if (n === act || n === this.hover) { alpha = 1; rank = 4; }
        else if (lit && on) { alpha = act ? 0.95 : 0.85; rank = 3; }
        else if (hub && !this.demo) { alpha = lit ? 0.3 : 0.9; rank = isHub ? 2.5 : 2; }
        else if (hub && this.demo) { alpha = isHub ? 0.7 : 0; rank = 2; }
        else if (k > crowd && !this.demo) { alpha = lit ? 0.16 : 0.42; rank = 1; }
        else alpha = 0;
        if (alpha <= 0) continue;
        const s = this.toScreen(n);
        if (s.x < -120 || s.x > W + 120 || s.y < -30 || s.y > H + 30) continue;
        wanted.push({ n, s, alpha, rank: rank + n.r / 100, on, isHub, hub });
      }
      wanted.sort((a, b) => b.rank - a.rank);
      const taken = [];
      for (const w of wanted) {
        if (taken.length > 420) break;
        const n = w.n, isHub = w.isHub;
        let label = n.label.length > 48 ? n.label.slice(0, 46) + "…" : n.label;
        if (isHub) label = label.toUpperCase();
        const y = w.s.y + n.r * k + (isHub ? 6 : 3), half = label.length * (isHub ? 4.1 : 3.05) + 4, box = [w.s.x - half, y - 1, w.s.x + half, y + (isHub || w.hub ? 15 : 13)];
        if (w.rank < 3.5 && taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
        taken.push(box);
        ctx.font = isHub ? `600 11px "IBM Plex Sans", system-ui, sans-serif` : w.hub ? `600 12px "IBM Plex Sans", system-ui, sans-serif` : `400 11px "IBM Plex Sans", system-ui, sans-serif`;
        if (isHub && "letterSpacing" in ctx) ctx.letterSpacing = "1.6px";
        ctx.globalAlpha = w.alpha;
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,8,12,0.85)";
        ctx.strokeText(label, w.s.x, y);
        const hc = isHub && this.colors ? lighten(CAT_RGB.get(n.cat) || MONO, 0.55) : null;
        ctx.fillStyle = n === act ? "#ffffff" : lit && w.on ? "#ede9fe" : hc ? `rgb(${hc[0]},${hc[1]},${hc[2]})` : w.hub ? "#f4f4f5" : "#a1a1aa";
        ctx.fillText(label, w.s.x, y);
        if (isHub && "letterSpacing" in ctx) ctx.letterSpacing = "0px";
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
  // O cérebro nascendo: começa com poucas bolinhas e vai crescendo até virar uma galáxia de lembranças (de um lado)
  // e conhecimento (do outro), com trilhas do básico ao avançado e faíscas correndo pelas ligações.
  const DEMO = {
    "sobre-voce": ["Mora perto do rio", "Faz aniversário em março", "Estuda à noite", "Café sem açúcar", "Medo de altura", "É canhoto", "Acorda tarde no domingo", "Gosta de chuva"],
    gostos: ["Manhwa de romance", "Prefere chuva a sol", "Gatos pretos", "Detesta coentro", "Pizza de calabresa", "Filmes do Ghibli", "Açaí com granola", "Modo escuro"],
    pessoas: ["Irmã mais nova", "Amigo do trabalho", "Avó do bolo de fubá", "Gata Nina", "Mãe professora", "Primo que joga junto"],
    conversas: ["Falamos do futuro", "Discussão sobre IA", "Ideia de viagem", "Lembrança da infância", "Conversa sobre sonhos", "Noite de risadas"],
    sentimentos: ["Ansioso com a prova", "Feliz com o projeto", "Saudade da praia", "Orgulho do que fez"],
    planos: ["Prometi lembrar da consulta", "Aprender violão", "Viajar em julho", "Ler o capítulo 4 juntos"],
    jogos: ["Stardew Valley", "Hollow Knight", "Roblox com o primo", "Xadrez online"],
    leituras: ["Shoujo novo", "Manhwa de ação", "Parou no capítulo 12", "Personagem favorita"],
    musica: ["Lo-fi para ler", "Playlist da noite", "Música que eu canto"],
    capri: ["Fiquei com ciúmes", "Prometi cantar pra ele", "Gosto quando ele volta"],
  };
  // Assuntos que ela estuda, cada um com seus degraus do básico ao especialista.
  const DEMO_K = {
    ciencia: { "Fotossíntese": ["O que é fotossíntese", "Clorofila e luz", "Fase clara", "Ciclo de Calvin", "Fotorrespiração"], "Sistema solar": ["Os planetas", "Órbitas", "Gravidade", "Leis de Kepler", "Mecânica celeste"] },
    tecnologia: { "C#": ["Variáveis e tipos", "Laços e condições", "Classes e objetos", "Async e await", "Reflection e IL"], "Redes": ["O que é internet", "IP e DNS", "HTTP", "TLS", "Roteamento BGP"] },
    matematica: { "Álgebra": ["Frações", "Equação do 1º grau", "Funções", "Derivadas", "Séries de Fourier"] },
    idiomas: { "Inglês": ["Verbo to be", "Presente simples", "Phrasal verbs", "Conditionals", "Gírias de games"], "Japonês": ["Hiragana", "Katakana", "Partículas", "Keigo", "Kanji N2"] },
    historia: { "Brasil": ["Descobrimento", "Independência", "Era Vargas", "Ditadura militar", "Constituição de 88"] },
    arte: { "Desenho": ["Formas básicas", "Perspectiva", "Anatomia", "Luz e sombra", "Estilo próprio"] },
    saude: { "Sono": ["Por que dormimos", "Ciclos do sono", "Melatonina", "Ritmo circadiano", "Sono e memória"] },
    habilidades: { "Cozinhar": ["Arroz soltinho", "Feijão", "Molho branco", "Massa fresca", "Risoto"] },
  };
  let demoGraph = null;
  function startDemo() {
    if (demoGraph) return;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), pickOf = (list) => list[Math.floor(rnd() * list.length)];
    const all = [], edges = [], leaves = [], kleaves = [], cats = Object.keys(DEMO), kcats = Object.keys(DEMO_K);
    let i = 0;
    for (const cat of cats) all.push({ id: "hub:" + cat, kind: "hub", cat, label: catOf(cat).label, imp: 5, deg: 40 });
    // Lembranças: temas grandes, cada um com um leque de bolinhas pequenas em volta.
    for (let t = 0; t < 16; t++) {
      const cat = cats[t % cats.length], theme = "t" + t, fan = 8 + Math.floor(rnd() * 20);
      all.push({ id: theme, kind: "m", cat, label: pickOf(DEMO[cat]), imp: 5, deg: fan });
      edges.push({ a: theme, b: "hub:" + cat, hub: true });
      for (let f = 0; f < fan; f++) {
        const id = "d" + i++, c2 = rnd() < 0.8 ? cat : pickOf(cats);
        all.push({ id, kind: "m", cat: c2, label: pickOf(DEMO[c2]), imp: 1 + Math.floor(rnd() * 3), deg: 1, near: theme });
        edges.push({ a: id, b: theme });
        leaves.push(id);
      }
    }
    // Conhecimento: cada assunto vira uma trilha de 5 degraus, com bolinhas soltas de estudo em volta.
    for (const cat of kcats) {
      all.push({ id: "hub:" + cat, kind: "hub", cat, label: catOf(cat).label, imp: 5, deg: 30, know: true });
      for (const [topic, steps] of Object.entries(DEMO_K[cat])) {
        let prev = null;
        steps.forEach((label, s) => {
          const id = "k" + i++;
          all.push({ id, kind: "m", cat, label, imp: s === 0 ? 4 : 3, deg: 6, level: s + 1, know: true, near: prev || "hub:" + cat });
          edges.push(prev ? { a: id, b: prev, trail: true } : { a: id, b: "hub:" + cat, hub: true });
          for (let f = 0, fan = 4 + Math.floor(rnd() * 9); f < fan; f++) {
            const leaf = "q" + i++;
            all.push({ id: leaf, kind: "m", cat, label: topic + ": " + pickOf(steps).toLowerCase(), imp: 1 + Math.floor(rnd() * 2), deg: 1, level: Math.min(5, s + 1 + (rnd() < 0.3 ? 1 : 0)), know: true, near: id });
            edges.push({ a: leaf, b: id });
            kleaves.push(leaf);
          }
          prev = id;
        });
      }
    }
    for (let j = 0; j < 380; j++) { const a = pickOf(leaves), b = pickOf(leaves); if (a !== b) edges.push({ a, b }); }
    for (let j = 0; j < 260; j++) { const a = pickOf(kleaves), b = pickOf(kleaves); if (a !== b) edges.push({ a, b }); }
    for (let j = 0; j < 40; j++) edges.push({ a: pickOf(leaves), b: pickOf(kleaves) });
    for (let o = 0; o < 50; o++) { const cat = pickOf(cats); all.push({ id: "o" + o, kind: "m", cat, label: pickOf(DEMO[cat]), imp: 1, deg: 0 }); }
    // Ordem de nascimento: primeiro algumas lembranças, depois tudo vai se misturando.
    const hubs = all.filter((n) => n.kind === "hub"), rest = all.filter((n) => n.kind !== "hub");
    const order = rest.map((n, j) => ({ n, w: (n.know ? 0.25 : 0) + rnd() + (n.id.startsWith("t") ? -0.6 : 0) + (j > rest.length * 0.9 ? 0.4 : 0) })).sort((a, b) => a.w - b.w).map((x) => x.n);
    const shown = [];
    let next = 0, born = 0, extra = 0;
    const want = (cat) => shown.some((n) => n.cat === cat && n.kind !== "hub");
    const sync = (t, heat) => {
      const live = shown.concat(hubs.filter((h) => want(h.cat)));
      demoGraph.setData(live, edges, heat);
    };
    const Engine = window.Space && Space.ok() ? Space : Graph;
    demoGraph = new Engine($("#demoCanvas"), {
      demo: true,
      cats: CATS.map((c) => c.id), color: (cat) => CAT_RGB01.get(cat) || CAT_RGB01.get("outros"),
      size: () => born,
      caption: () => {
        const day = 1 + Math.floor(born / 9), st = STAGES[stageOf(born)].name;
        return { big: "Dia " + day, small: `${st} · ${born} bolinhas · ${demoGraph ? demoGraph.edges.length : 0} ligações` };
      },
      onFrame(t) {
        if (t < next) return;
        if (born < order.length) {
          // Cresce cada vez mais rápido, como quem aprende mais a cada dia.
          const batch = Math.max(1, Math.floor(born / 45));
          for (let j = 0; j < batch && born < order.length; j++) { const n = { ...order[born++] }; n.born = t; shown.push(n); }
          next = t + (born < 30 ? 260 : 110);
          const before = stageOf(born - batch);
          sync(t, 0.2);
          if (stageOf(born) > before && born > 30) demoGraph.celebrate();
          return;
        }
        // Já crescido: de tempos em tempos nasce uma bolinha nova, ou ela lembra de alguma coisa.
        next = t + 1600 + rnd() * 1800;
        if (rnd() < 0.5) { const pick = shown[Math.floor(rnd() * shown.length)]; demoGraph.fire(pick.id); return; }
        const know = rnd() < 0.5, near = know ? pickOf(kleaves) : pickOf(leaves), host = shown.find((n) => n.id === near) || shown[0], id = "n" + extra++;
        shown.push({ id, kind: "m", cat: host.cat, label: host.label, imp: 3, deg: 1, level: host.level, know: host.know, born: t, near: host.id });
        edges.push({ a: id, b: host.id });
        if (extra > 30) { const old = "n" + (extra - 31), at = shown.findIndex((n) => n.id === old); if (at >= 0) shown.splice(at, 1); }
        sync(t, 0.08);
        demoGraph.fire(id);
      },
    });
    for (let j = 0; j < 8; j++) shown.push({ ...order[born++] });
    sync(0, 1);
  }
  function stopDemo() { if (demoGraph) { demoGraph.destroy(); demoGraph = null; } }

  // ---------------- memória: criar e editar ----------------
  const catSelect = $("#mfCat");
  catSelect.innerHTML = `<optgroup label="Sobre vocês">${CATS.filter((c) => c.g === "p").map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</optgroup>`
    + `<optgroup label="Conhecimento">${CATS.filter((c) => c.g === "k").map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</optgroup>`;
  $("#mfLevel").innerHTML = `<option value="">— não é estudo</option>` + LEVELS.slice(1).map((l, i) => `<option value="${i + 1}">${i + 1} · ${l}</option>`).join("");
  $("#mfKind").innerHTML = `<option value="">Automático</option>` + Object.entries(KINDS).map(([id, k]) => `<option value="${id}">${k.icon} ${k.label}</option>`).join("");
  let editing = null;
  function openMemory(mem) {
    editing = mem || null;
    $("#memTitle").textContent = mem ? "Editar memória" : "Nova memória";
    $("#mfTitle").value = mem ? mem.title : "";
    $("#mfContent").value = mem ? mem.content : "";
    $("#mfCat").value = mem ? mem.category : "sobre-voce";
    $("#mfImp").value = String(mem ? mem.importance : 3);
    $("#mfTags").value = mem ? (mem.tags || []).join(", ") : "";
    $("#mfTopic").value = mem ? mem.topic || "" : "";
    $("#mfLevel").value = mem && mem.level ? String(mem.level) : "";
    $("#mfKind").value = mem ? kindOf(mem) : "";
    $("#mfQ").value = mem ? mem.question || "" : "";
    $("#topicList").innerHTML = Store.topics().slice(0, 500).map((t) => `<option value="${esc(t.topic)}"></option>`).join("");
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
      topic: $("#mfTopic").value.trim().replace(/\s+/g, " ").slice(0, 80) || null,
      level: $("#mfLevel").value ? Number($("#mfLevel").value) : null,
      question: $("#mfQ").value.trim().replace(/\s+/g, " ").slice(0, 300) || null,
    };
    if ($("#mfKind").value) body.kind = $("#mfKind").value;
    else if (body.level) body.kind = catOf(body.category).id === "habilidades" ? "habilidade" : "conhecimento";
    if (body.question && body.question.length < 3) body.question = null;
    // O mesmo assunto escrito de outro jeito usa a grafia que já existe.
    if (body.topic) { const same = Store.topics().find((t) => t.key === norm(body.topic)); if (same) body.topic = same.topic; }
    // Estudo sem área escolhida vai para "Conhecimento geral".
    if (body.level && catOf(body.category).g !== "k" && !editing) body.category = "conhecimento";
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

  function levelBadge(level) { return level ? `<span class="lvl" style="--lc:${LEVEL_COLORS[level]}">${level} · ${LEVELS[level]}</span>` : ""; }
  function ladder(levels) { return `<span class="ladder">${[1, 2, 3, 4, 5].map((i) => `<i style="--lc:${LEVEL_COLORS[i]}" class="${levels[i] ? "on" : ""}" title="${LEVELS[i]}: ${levels[i]}"></i>`).join("")}</span>`; }

  // O bloco "memória" de uma memória: quão firme está, quando volta para revisão e o que dá para fazer com ela.
  function memoryBox(m) {
    const r = retention(m), k = kindOf(m), study = k === "conhecimento" || k === "habilidade";
    const next = m.due_at ? (Date.parse(m.due_at) - Date.now()) / DAY : null;
    return `<div class="membox">
      <div class="row" style="justify-content:space-between;align-items:baseline"><b>${m.archived ? "Esquecida" : "Força " + Math.round(r * 100) + "%"}</b><span class="faint" style="font-size:12px">${m.archived ? "fora do céu, guardada" : retLabel(r)}</span></div>
      ${m.archived ? "" : force(m)}
      <div class="faint" style="font-size:12px;margin-top:6px">${study ? (m.due_at ? (next <= 0 ? "Hora de revisar." : "Volta para revisão em " + inTime(next) + ".") : "Ainda sem revisão marcada.") + (m.reviews ? ` Revisada ${m.reviews}×${m.lapses ? `, esqueceu ${m.lapses}×` : ""}.` : "") : k === "episodio" ? "Do diário: enfraquece com o tempo, a não ser que ela lembre disso." : "Fato: quase não enfraquece, e fica mais forte cada vez que ela lembra."}</div>
      <div class="row" style="gap:6px;margin-top:8px">
        ${study && !m.archived ? `<a class="btn small" href="#/revisar?id=${m.id}">Revisar agora</a>` : ""}
        <select class="input small" data-kind aria-label="Tipo">${Object.entries(KINDS).map(([id, x]) => `<option value="${id}"${id === k ? " selected" : ""}>${x.icon} ${x.label}</option>`).join("")}</select>
        ${m.archived ? `<button class="btn small" data-wake>Lembrar de novo</button>` : k === "episodio" ? `<button class="btn small ghost" data-fade>Esquecer</button>` : ""}
      </div></div>`;
  }
  async function patchMemory(m, body, msg) {
    try {
      const rows = await rest(`memories?id=eq.${m.id}`, { method: "PATCH", body, prefer: "return=representation" });
      if (rows && rows[0]) Store.putMem(rows[0], false);
      Store.emit();
      if (msg) toast(msg);
      return rows && rows[0];
    } catch (err) { toast(err.message, true); return null; }
  }
  const wake = (m) => patchMemory(m, { archived: false, fresh_at: new Date().toISOString() }, "Ela lembrou disso de novo.");
  const fade = (m) => patchMemory(m, { archived: true }, "Saiu do céu. Continua guardada no Diário, em Esquecidas.");
  function setKind(m, kind) {
    const body = { kind };
    if ((kind === "conhecimento" || kind === "habilidade") && catOf(m.category).g !== "k") body.category = kind === "habilidade" ? "habilidades" : "conhecimento";
    if (kind === "fato" && catOf(m.category).g === "k") body.category = "outros";
    return patchMemory(m, body, `Agora é ${KINDS[kind].label.toLowerCase()}.`);
  }
  function wireMemoryBox(root, m) {
    const sel = root.querySelector("[data-kind]"), w = root.querySelector("[data-wake]"), f = root.querySelector("[data-fade]");
    if (sel) sel.onchange = () => setKind(m, sel.value);
    if (w) w.onclick = () => wake(m);
    if (f) f.onclick = () => fade(m);
  }

  function viewGraph(el) {
    el.classList.add("full");
    el.innerHTML = `
      <canvas class="graph" aria-label="Grafo das memórias"></canvas>
      <div class="tools">
        <label class="searchbox card"><span class="faint">⌕</span><input id="q" placeholder="Procurar no cérebro" autocomplete="off" aria-label="Procurar"></label>
        <div class="seg card" role="group" aria-label="Vista"><button data-mode="web">Constelação</button><button data-mode="levels">Níveis</button></div>
        <div class="spacer"></div>
        <div class="actions">
          <button class="btn primary" id="add"><span>＋</span><span class="lbl">Nova memória</span></button>
          <button class="btn" id="grow" title="Ver o cérebro crescer desde o primeiro dia"><span>▶</span><span class="lbl">Ver crescer</span></button>
          <button class="btn" id="org" title="Junta as memórias repetidas e liga as parecidas"><span>✦</span><span class="lbl">Organizar</span></button>
          <button class="btn" id="exp" title="Baixar tudo em JSON"><span>⤓</span><span class="lbl">Exportar</span></button>
        </div>
      </div>
      <a class="stage card" id="stage" href="#/aprendizado" title="Ver como o cérebro está crescendo"></a>
      <div class="chips" id="chips"></div>
      <aside class="side card hidden" id="side" aria-live="polite"></aside>
      <div class="empty hidden" id="empty"><div class="card"><h2>O cérebro ainda está vazio</h2><p class="muted">Conecte a Capri com uma chave e tudo que ela aprender aparece aqui como bolinhas. Ou crie a primeira memória você mesmo.</p><div class="row" style="justify-content:center"><a class="btn primary" href="#/conectar">Conectar a Capri</a><button class="btn" id="add2">Nova memória</button></div></div></div>
      <div class="tip hidden" id="tip"></div>
      <div class="hint3d" id="hint3d">Arraste para girar · role para aproximar · botão direito move · dois cliques no vazio mostram tudo</div>`;
    const hiddenCats = new Set(prefs.hidden || []);
    let showHubs = prefs.hubs !== false, colors = prefs.colors !== false, showFaded = !!prefs.faded, query = "", selectedId = null, mode = prefs.mode === "levels" ? "levels" : "web";
    let upto = null, replay = null;
    const replayBorn = new Map();
    const tip = $("#tip", el), side = $("#side", el);
    // 3D quando o navegador consegue (WebGL); senão, o grafo plano de antes.
    const three = prefs.view3d !== "2d" && window.Space && Space.ok(), theme = prefs.theme === "light" ? "light" : "dark";
    el.classList.toggle("light", three && theme === "light");
    const Engine = three ? Space : Graph;
    const g = new Engine($("canvas", el), {
      colors, mode, theme, spin: prefs.spin !== false,
      cats: CATS.map((c) => c.id), color: (cat) => CAT_RGB01.get(cat) || CAT_RGB01.get("outros"),
      levelColors: LEVEL_COLORS.map((h) => (h ? rgb(h).map((v) => v / 255) : null)), levelHex: LEVEL_COLORS, levelNames: LEVELS,
      onLost() { prefs.view3d = "2d"; savePrefs(); toast("O 3D travou neste navegador; voltei para o plano.", true); shownRoute = null; route(); },
      size: () => Store.mems.size,
      caption() {
        if (!Store.mems.size) return null;
        let first = Infinity;
        for (const m of Store.mems.values()) { const t = Date.parse(m.created_at); if (t < first) first = t; }
        if (upto) {
          const n = [...Store.mems.values()].filter((m) => Date.parse(m.created_at) <= upto).length;
          return { big: "Dia " + Math.max(1, Math.floor((upto - first) / 86400000) + 1), small: `${new Date(upto).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${n} ${n === 1 ? "bolinha" : "bolinhas"}` };
        }
        const day = Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1), n = Store.mems.size;
        return { big: "Dia " + day, small: `${STAGES[stageOf(n)].name} · ${n} ${n === 1 ? "bolinha" : "bolinhas"} · ${Store.links.size} ${Store.links.size === 1 ? "ligação" : "ligações"}` };
      },
      onSelect(n) {
        if (!n) { select(null); return; }
        if (n.kind === "hub") { const ids = [...g.near.get(n) || []].map((x) => x.id).concat(n.id); g.fit(ids); return; }
        select(n.id);
      },
      onHover(n, p) {
        if (!n || !p) { tip.classList.add("hidden"); return; }
        const m = Store.mems.get(n.id);
        const st = m && window.Space ? Space.starOf(m.id, m.importance, m.recall_count, m.level) : null;
        tip.innerHTML = n.kind === "hub" ? `<b>${esc(n.label)}</b>${n.deg} ${n.deg === 1 ? "memória" : "memórias"}`
          : `<b>${esc(n.label)}</b>${m ? esc(KINDS[kindOf(m)].label) + " · " : ""}${esc(catOf(n.cat).label)}${m && m.topic ? " · " + esc(m.topic) : ""}${m && m.level ? `<br>${levelBadge(m.level)}` : m ? " · " + stars(m.importance) : ""}${m ? `<div class="starline">${m.archived ? "esquecida" : "força " + Math.round(retention(m) * 100) + "% · " + retLabel(retention(m))}${isDue(m) ? " · hora de revisar" : ""}</div>` : ""}${st ? `<div class="starline">✦ ${esc(st.name)} · classe ${st.cls}</div>` : ""}`;
        tip.style.left = Math.min(p.x + 14, el.clientWidth - 290) + "px";
        tip.style.top = p.y + 14 + "px";
        tip.classList.remove("hidden");
      },
    });
    if (/[?&]debug\b/.test(location.search)) window.__graph = g;
    $("#hint3d", el).classList.toggle("hidden", !three);
    if (three && matchMedia("(pointer: coarse)").matches) $("#hint3d", el).textContent = "Arraste para girar · pinça para aproximar · toque numa estrela";
    const segs = el.querySelectorAll(".seg button");
    const paintSeg = () => segs.forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    paintSeg();

    let shownStage = prefs.stage == null ? -1 : prefs.stage;
    function stageCard() {
      const n = Store.mems.size, i = stageOf(n), st = STAGES[i], nx = STAGES[i + 1];
      const p = nx ? (n - st.min) / (nx.min - st.min) : 1;
      $("#stage", el).innerHTML = `<span class="st-name">${esc(st.name)}</span><span class="st-bar"><i style="width:${Math.round(p * 100)}%"></i></span><span class="st-next">${nx ? `faltam ${nx.min - n} para ${esc(nx.name)}` : "o cérebro está completo"}</span>`;
      // Passou de estágio desde a última vez: festa no grafo.
      if (shownStage >= 0 && i > shownStage) { toast(`O cérebro cresceu: agora é ${i === 1 ? "um" : "uma"} ${st.name}! ✦`); setTimeout(() => g.celebrate(), 400); }
      if (i !== shownStage) { shownStage = i; prefs.stage = i; savePrefs(); }
    }

    function build(reheat) {
      const counts = new Map();
      for (const m of Store.mems.values()) counts.set(m.category, (counts.get(m.category) || 0) + 1);
      const shown = [...Store.mems.values()].filter((m) => !hiddenCats.has(m.category) && (showFaded || !m.archived) && (!upto || Date.parse(m.created_at) <= upto));
      const keep = new Set(shown.map((m) => m.id)), deg = new Map(), edges = [];
      for (const l of Store.links.values()) {
        if (!keep.has(l.source_id) || !keep.has(l.target_id)) continue;
        edges.push({ a: l.source_id, b: l.target_id, trail: TRAIL.has(l.relation) });
        deg.set(l.source_id, (deg.get(l.source_id) || 0) + 1); deg.set(l.target_id, (deg.get(l.target_id) || 0) + 1);
      }
      const nodes = shown.map((m) => ({ id: m.id, kind: "m", cat: m.category, label: m.title, imp: m.importance, level: m.level || 0, know: isKnow(m), recalls: m.recall_count || 0, deg: deg.get(m.id) || 0, ret: m.archived ? 0.15 : retention(m), ep: kindOf(m) === "episodio", born: replayBorn.get(m.id) || Store.born.get(m.id) }));
      if (showHubs) {
        const perCat = new Map();
        for (const m of shown) { perCat.set(m.category, (perCat.get(m.category) || 0) + 1); edges.push({ a: m.id, b: "hub:" + m.category, hub: true }); }
        for (const [cat, n] of perCat) nodes.push({ id: "hub:" + cat, kind: "hub", cat, label: catOf(cat).label, imp: 5, deg: n, know: catOf(cat).g === "k" });
      }
      g.setData(nodes, edges, reheat);
      for (const id of Store.takeSparks()) g.fire(id);
      $("#empty", el).classList.toggle("hidden", Store.mems.size > 0);
      $("#stage", el).classList.toggle("hidden", Store.mems.size === 0);
      const chip = (c) => `<button class="chip${hiddenCats.has(c.id) ? " off" : ""}" data-c="${c.id}" aria-pressed="${!hiddenCats.has(c.id)}"><i class="dot" style="background:${c.color}"></i>${esc(c.label)} <span class="n">${counts.get(c.id)}</span></button>`;
      const mine = CATS.filter((c) => c.g === "p" && counts.get(c.id)), know = CATS.filter((c) => c.g === "k" && counts.get(c.id));
      let faded = 0; for (const m of Store.mems.values()) if (m.archived) faded++;
      $("#chips", el).innerHTML = mine.map(chip).join("") + (know.length ? `<span class="chipsep">Conhecimento</span>` + know.map(chip).join("") : "")
        + `<span class="chipsep">Vista</span>`
        + (window.Space && Space.ok() ? `<button class="chip hubs${three ? "" : " off"}" data-c="__3d" aria-pressed="${three}">3D</button>` : "")
        + (three ? `<button class="chip hubs${theme === "light" ? "" : " off"}" data-c="__light" aria-pressed="${theme === "light"}">Fundo claro</button>`
          + `<button class="chip hubs${prefs.spin !== false ? "" : " off"}" data-c="__spin" aria-pressed="${prefs.spin !== false}">Girar sozinho</button>` : "")
        + `<button class="chip hubs${showHubs ? "" : " off"}" data-c="__hubs" aria-pressed="${showHubs}">Mostrar categorias</button>`
        + `<button class="chip hubs${colors ? "" : " off"}" data-c="__colors" aria-pressed="${colors}">Cores</button>`
        + (faded ? `<button class="chip hubs${showFaded ? "" : " off"}" data-c="__faded" aria-pressed="${showFaded}" title="Episódios do diário que enfraqueceram e saíram do céu">Esquecidas <span class="n">${faded}</span></button>` : "");
      stageCard();
      applySearch();
      if (selectedId) { if (Store.mems.has(selectedId)) renderSide(); else select(null); }
    }
    function applySearch() {
      const q = norm(query.trim());
      if (!q) { g.matches = null; g.dirty = true; return []; }
      const ids = [];
      for (const m of Store.mems.values()) if (!hiddenCats.has(m.category) && (norm(m.title).includes(q) || norm(m.content).includes(q) || norm(m.topic).includes(q) || (m.tags || []).some((t) => norm(t).includes(q)))) ids.push(m.id);
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
      const trail = m.topic ? (Store.topics().find((t) => t.key === norm(m.topic)) || null) : null;
      side.innerHTML = `
        <div class="head"><div class="row" style="justify-content:space-between"><span class="cat"><i style="background:${c.color}"></i>${esc(c.label)}</span><button class="btn ghost small" id="close" aria-label="Fechar">✕</button></div>
          <h3>${esc(m.title)}</h3><div class="row" style="gap:8px;margin-top:6px">${m.level ? levelBadge(m.level) : `<span class="stars" title="Importância ${m.importance} de 5">${stars(m.importance)}</span>`}${m.topic ? `<button class="topic" id="topicGo">${esc(m.topic)}</button>` : ""}</div></div>
        <div class="body">
          <div class="content">${esc(m.content)}</div>
          ${(() => { const st = window.Space ? Space.starOf(m.id, m.importance, m.recall_count, m.level) : null; return st ? `<div class="star" title="Cada memória é uma estrela única do cérebro">✦ Estrela <b>${esc(st.name)}</b> ${esc(st.code)} · classe ${st.cls} · brilho ${String(st.mag).replace(".", ",")} · ${st.points} pontas</div>` : ""; })()}
          ${(m.tags || []).length ? `<div>${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
          ${trail && trail.mems.length > 1 ? `<div><div class="f" style="font-size:13px;color:var(--faint);margin-bottom:8px">Trilha de ${esc(trail.topic)} · do básico ao avançado</div><ol class="trail">${trail.mems.map((x) => `<li class="${x.id === m.id ? "here" : ""}" style="--lc:${LEVEL_COLORS[x.level || 1]}"><button data-go="${x.id}"><span>${esc(x.title)}</span><small>${x.level ? LEVELS[x.level] : "sem nível"}</small></button></li>`).join("")}</ol></div>` : ""}
          ${memoryBox(m)}
          <dl class="meta"><dt>Tipo</dt><dd>${KINDS[kindOf(m)].icon} ${esc(KINDS[kindOf(m)].label)}</dd><dt>Criada</dt><dd>${when(m.created_at)}</dd><dt>Mudou</dt><dd>${when(m.updated_at)}</dd><dt>Lembrada</dt><dd>${m.recall_count ? `${m.recall_count}× · ${ago(m.last_recalled_at)}` : "ainda não"}</dd><dt>Veio de</dt><dd>${esc(m.source || "—")}${m.mentions > 1 ? ` · citada ${m.mentions}×` : ""}</dd></dl>
          <div class="row"><button class="btn small" id="edit">Editar</button><button class="btn small danger" id="del">Excluir</button></div>
          <div><div class="f" style="font-size:13px;color:var(--faint);margin-bottom:8px">Ligada a ${nb.length} ${nb.length === 1 ? "memória" : "memórias"}</div>
            <div class="stack" style="gap:6px">${nb.map((x) => `<div class="nb"><button class="go" data-go="${x.mem.id}">${esc(x.mem.title)}<div class="rel">${esc(x.link.relation || "relacionado")}${x.link.auto ? " · automática" : ""}</div></button><button class="x" data-unlink="${x.link.id}" title="Desligar" aria-label="Desligar">×</button></div>`).join("") || `<span class="faint" style="font-size:13px">Nenhuma ligação ainda.</span>`}</div></div>
          <form class="stack" id="linkForm" style="gap:8px"><label class="f" for="lkTo" style="margin:0">Ligar a outra memória</label>
            <input class="input" id="lkTo" list="lkList" placeholder="Comece a digitar um título" autocomplete="off">
            <datalist id="lkList">${[...Store.mems.values()].filter((x) => x.id !== m.id).slice(0, 2000).map((x) => `<option value="${esc(x.title)}"></option>`).join("")}</datalist>
            <input class="input" id="lkRel" placeholder="Como se ligam (ex.: irmã de, aprofunda, leu junto)" maxlength="60">
            <button class="btn small" type="submit">Ligar</button></form>
        </div>`;
      side.classList.remove("hidden");
      $("#close", side).onclick = () => select(null);
      $("#edit", side).onclick = () => openMemory(m);
      $("#del", side).onclick = async () => { if (await removeMemory(m)) select(null); };
      wireMemoryBox(side, m);
      const tg = $("#topicGo", side);
      if (tg) tg.onclick = () => { const q = $("#q", el); q.value = query = m.topic; const ids = applySearch(); if (ids.length) g.fit(ids); };
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
    segs.forEach((b) => (b.onclick = () => { mode = b.dataset.mode; prefs.mode = mode; savePrefs(); paintSeg(); g.setMode(mode); }));
    $("#chips", el).addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      if (b.dataset.c === "__colors") { colors = !colors; prefs.colors = colors; g.colors = colors; g.dirty = true; savePrefs(); build(0); return; }
      // Trocar 2D/3D monta a vista de novo; fundo e giro mudam na hora.
      if (b.dataset.c === "__3d") { prefs.view3d = three ? "2d" : "3d"; savePrefs(); shownRoute = null; route(); return; }
      if (b.dataset.c === "__light") { prefs.theme = theme === "light" ? "dark" : "light"; savePrefs(); shownRoute = null; route(); return; }
      if (b.dataset.c === "__spin") { prefs.spin = prefs.spin === false; savePrefs(); g.spin = prefs.spin; build(0); return; }
      if (b.dataset.c === "__faded") { showFaded = !showFaded; prefs.faded = showFaded; }
      else if (b.dataset.c === "__hubs") { showHubs = !showHubs; prefs.hubs = showHubs; }
      else { hiddenCats.has(b.dataset.c) ? hiddenCats.delete(b.dataset.c) : hiddenCats.add(b.dataset.c); prefs.hidden = [...hiddenCats]; }
      savePrefs(); build(0.4);
    });
    $("#add", el).onclick = () => openMemory(null);
    $("#add2", el).onclick = () => openMemory(null);
    // Ver crescer: o cérebro volta ao primeiro dia e vai ganhando as estrelas na ordem em que nasceram.
    $("#grow", el).onclick = (e) => {
      const b = e.currentTarget;
      if (replay) { stopReplay(); return; }
      const times = [...Store.mems.values()].map((m) => Date.parse(m.created_at)).sort((a, c) => a - c);
      if (times.length < 2) { toast("Ainda tem pouca coisa para ver crescer."); return; }
      const t0 = times[0], t1 = times[times.length - 1], ms = Math.min(24000, 5000 + times.length * 60), start = performance.now();
      let seen = new Set();
      g.touched = false; g.fitted = 1;
      b.querySelector(".lbl").textContent = "Parar"; b.firstElementChild.textContent = "■";
      replay = setInterval(() => {
        const p = Math.min(1, (performance.now() - start) / ms), ease = p * p * (3 - 2 * p);
        upto = t0 + (t1 - t0) * ease + 1;
        const now = performance.now(), fresh = [];
        for (const m of Store.mems.values()) if (Date.parse(m.created_at) <= upto && !seen.has(m.id)) { seen.add(m.id); replayBorn.set(m.id, now); fresh.push(m.id); }
        if (fresh.length) { build(0.35); fresh.slice(0, 3).forEach((id) => g.fire(id)); }
        else g.dirty = true;
        if (p >= 1) stopReplay(true);
      }, 140);
    };
    function stopReplay(done) {
      clearInterval(replay); replay = null; upto = null;
      const b = $("#grow", el);
      b.querySelector(".lbl").textContent = "Ver crescer"; b.firstElementChild.textContent = "▶";
      build(0.2);
      if (done) g.celebrate();
    }
    $("#exp", el).onclick = exportAll;
    $("#org", el).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const r = await rest("rpc/organize_my_brain", { method: "POST", body: {} });
        await Store.sync();
        const n = (r && r.links) || 0, j = (r && r.merged) || 0, f = (r && r.faded) || 0;
        const parts = [];
        if (f) parts.push(`${f} ${f === 1 ? "episódio fraco saiu" : "episódios fracos saíram"} do céu`);
        if (j) parts.push(`${j} ${j === 1 ? "repetida juntada" : "repetidas juntadas"}`);
        if (n) parts.push(`${n} ${n === 1 ? "ligação nova" : "ligações novas"}`);
        toast(parts.length ? parts.join(" e ") + "." : "Tudo já estava organizado.");
      } catch (err) { toast(err.message, true); }
      finally { b.disabled = false; }
    };
    const keys = (e) => { if (e.key === "Escape" && selectedId && !document.querySelector("dialog[open]")) select(null); };
    document.addEventListener("keydown", keys);
    const off = Store.on(() => build(0.25));
    if (Store.loaded) {
      Store.takeSparks();
      build(1);
      // Veio da aba Aprendizado com um assunto: já abre procurando por ele.
      const asked = new URLSearchParams(location.hash.split("?")[1] || "").get("q");
      if (asked) { $("#q", el).value = query = asked; const ids = applySearch(); if (ids.length) setTimeout(() => g.fit(ids), 1400); }
    }
    return { destroy() { if (replay) clearInterval(replay); off(); g.destroy(); document.removeEventListener("keydown", keys); }, select };
  }

  // ---------------- aprender: metas, revisão e como a memória está ----------------
  // Uma meta e o que o cérebro já tem dela: notas por nível, quão firme está cada nível (domínio) e o próximo passo.
  function goalStats(g) {
    const gk = norm(g.topic);
    const hits = [...Store.mems.values()].filter((m) => !m.archived && isKnow(m) && m.topic && (norm(m.topic) === gk || norm(m.topic).includes(gk) || gk.includes(norm(m.topic))));
    const lv = [0, 0, 0, 0, 0, 0], best = [0, 0, 0, 0, 0, 0];
    for (const m of hits) { const l = m.level || 1; lv[l]++; best[l] = Math.max(best[l], retention(m)); }
    let mastery = 0, next = 0;
    for (let l = 1; l <= g.target_level; l++) { mastery += best[l]; if (!next && !lv[l]) next = l; }
    const weakest = hits.slice().sort((a, b) => retention(a) - retention(b))[0] || null;
    return { hits, lv, mastery: Math.round((100 * mastery) / g.target_level), next, weakest, due: hits.filter(isDue).length };
  }
  // Pedidos de estudo que ele já fez e ainda não viraram meta ("quer que eu aprenda xadrez...").
  function goalHints() {
    const have = [...Store.goals.values()].map((g) => norm(g.topic)), out = new Map();
    for (const m of Store.mems.values()) {
      if (m.archived || kindOf(m) !== "fato") continue;
      const hit = /\bquer (?:que (?:eu|a capri) )?aprend\w*\s+(?:a |o |sobre )?(.+?)(?=[,.;:!?]| d[eo] \d| do b[áa]sico| com | para | at[ée] | e (?:um|uma|guard|salv|prev|que)|$)/i.exec(m.content);
      // O pedido já fala de uma meta que existe (ex.: "multiplicação" dentro do pedido de matemática): não sugere de novo.
      if (!hit || have.some((h) => norm(m.content).includes(h))) continue;
      const words = hit[1].trim().split(/\s+/).slice(0, 4).join(" ").replace(/\s+(?:de|do|da|e)$/i, "");
      const topic = words.charAt(0).toUpperCase() + words.slice(1);
      const key = norm(topic);
      if (topic.length < 3 || have.some((h) => h.includes(key) || key.includes(h)) || out.has(key)) continue;
      out.set(key, { topic, from: m });
    }
    return [...out.values()].slice(0, 6);
  }
  // Dias seguidos com revisão (hoje ou ontem contam para não quebrar a sequência antes da hora).
  function streak() {
    const days = new Set(Store.reviews.map((r) => new Date(r.reviewed_at).toDateString()));
    let n = 0, d = new Date();
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function viewLearn(el) {
    let editingGoal = null;
    const draw = () => {
      const mems = [...Store.mems.values()], n = mems.length, i = stageOf(n), st = STAGES[i], nx = STAGES[i + 1];
      const live = mems.filter((m) => !m.archived), know = live.filter(isKnow), lv = [0, 0, 0, 0, 0, 0];
      for (const m of know) lv[m.level || 0]++;
      const topics = Store.topics(), byCat = new Map();
      for (const m of know) { const c = byCat.get(m.category) || { n: 0, lv: [0, 0, 0, 0, 0, 0] }; c.n++; c.lv[m.level || 0]++; byCat.set(m.category, c); }
      let first = Infinity;
      for (const m of mems) { const t = Date.parse(m.created_at); if (t < first) first = t; }
      const day = n ? Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1) : 0;
      const p = nx ? (n - st.min) / (nx.min - st.min) : 1, totalLv = lv.slice(1).reduce((a, b) => a + b, 0) || 1;
      // hoje
      const due = Store.due(), week = Store.reviews.filter((r) => Date.now() - Date.parse(r.reviewed_at) < 7 * DAY), right = week.filter((r) => r.grade >= 2).length;
      const firm = know.length ? Math.round((100 * know.reduce((a, m) => a + retention(m), 0)) / know.length) : 0;
      const upcoming = know.filter((m) => m.due_at && Date.parse(m.due_at) > Date.now()).sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
      const heat = [];
      for (let k = 55; k >= 0; k--) { const d = new Date(Date.now() - k * DAY).toDateString(); heat.push(Store.reviews.filter((r) => new Date(r.reviewed_at).toDateString() === d).length); }
      // memória por tipo e por força
      const kinds = Object.keys(KINDS).map((k) => { const list = live.filter((m) => kindOf(m) === k); return { k, n: list.length, f: list.length ? Math.round((100 * list.reduce((a, m) => a + retention(m), 0)) / list.length) : 0 }; });
      const bands = [0, 0, 0, 0];
      for (const m of live) { const r = retention(m); bands[r >= 0.9 ? 0 : r >= 0.7 ? 1 : r >= 0.4 ? 2 : 3]++; }
      const faded = mems.length - live.length, goals = [...Store.goals.values()].sort((a, b) => (a.status === "ativa" ? 0 : a.status === "pausada" ? 1 : 2) - (b.status === "ativa" ? 0 : b.status === "pausada" ? 1 : 2) || a.created_at.localeCompare(b.created_at));
      const hints = goalHints();
      el.innerHTML = `<div class="page">
        <h1>Aprender</h1><p class="lead">Aqui o cérebro vira memória de verdade: metas do que a Capri está aprendendo, revisões no dia certo para nada se perder, e quão firme está cada coisa que ela sabe.</p>
        <section class="panel today">
          <div class="today-main"><div><div class="today-n">${due.length}</div><div class="muted">${due.length === 1 ? "estudo para revisar agora" : "estudos para revisar agora"}</div></div>
            ${due.length ? `<a class="btn primary" href="#/revisar">Revisar agora</a>` : `<span class="faint" style="font-size:13px">${upcoming ? "O próximo volta em " + inTime((Date.parse(upcoming.due_at) - Date.now()) / DAY) + "." : "Nada marcado ainda."}</span>`}</div>
          <div class="today-nums"><div><b>${streak()}</b><span>${streak() === 1 ? "dia seguido" : "dias seguidos"}</span></div><div><b>${week.length}</b><span>revisões na semana</span></div><div><b>${week.length ? Math.round((100 * right) / week.length) + "%" : "—"}</b><span>de acerto</span></div><div><b>${know.length ? firm + "%" : "—"}</b><span>firmeza dos estudos</span></div></div>
          <div class="heat" title="Revisões nas últimas 8 semanas">${heat.map((c) => `<i class="h${Math.min(4, c)}"></i>`).join("")}</div>
        </section>

        <div class="sec-row"><h2 class="sec">Metas de estudo</h2><button class="btn small" id="newGoal">＋ Nova meta</button></div>
        <form class="panel goal-form hidden" id="goalForm">
          <div class="grid3"><div><label class="f" for="gTopic">Assunto</label><input class="input" id="gTopic" list="gTopics" maxlength="80" required placeholder="ex.: Inglês, Xadrez, Python"><datalist id="gTopics">${topics.map((t) => `<option value="${esc(t.topic)}"></option>`).join("")}</datalist></div>
            <div><label class="f" for="gCat">Área</label><select class="input" id="gCat">${CATS.filter((c) => c.g === "k").map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select></div>
            <div><label class="f" for="gLevel">Chegar até</label><select class="input" id="gLevel">${LEVELS.slice(1).map((l, k) => `<option value="${k + 1}"${k + 1 === 3 ? " selected" : ""}>${k + 1} · ${l}</option>`).join("")}</select></div></div>
          <div><label class="f" for="gWhy">Por quê, ou o que incluir (opcional)</label><input class="input" id="gWhy" maxlength="400" placeholder="ex.: do básico ao avançado, com exercícios"></div>
          <div class="end"><button class="btn" type="button" id="gCancel">Cancelar</button><button class="btn primary">Salvar meta</button></div>
        </form>
        ${hints.length ? `<div class="hints"><span class="faint">Ele já pediu:</span>${hints.map((h, k) => `<button class="chip" data-hint="${k}" title="${esc(h.from.title)}">＋ ${esc(h.topic)}</button>`).join("")}</div>` : ""}
        ${goals.length ? `<div class="goals">${goals.map((g) => goalCard(g)).join("")}</div>`
          : `<div class="panel"><b>Nenhuma meta ainda.</b><p class="muted" style="margin:6px 0 0">Uma meta diz o que a Capri deve aprender e até que nível. Ela vê as metas dela, sabe qual é o próximo passo e puxa o assunto nas conversas.</p></div>`}

        <h2 class="sec">Como está a memória</h2>
        <div class="kinds">${kinds.map((x) => `<a class="kind" href="${x.k === "episodio" ? "#/diario" : "#/memorias?tipo=" + x.k}"><span class="k-i">${KINDS[x.k].icon}</span><b>${x.n}</b><span>${esc(KINDS[x.k].many)}</span><small>${x.n ? "força média " + x.f + "%" : "nenhum"}</small></a>`).join("")}</div>
        ${live.length ? `<div class="panel"><div class="lvbar">${["#4ade80", "#a3e635", "#fbbf24", "#f87171"].map((c, k) => bands[k] ? `<i style="flex:${bands[k]};--lc:${c}"></i>` : "").join("")}</div>
          <div class="lvlegend">${["firmes", "boas", "fracas", "quase esquecidas"].map((l, k) => `<span><i style="--lc:${["#4ade80", "#a3e635", "#fbbf24", "#f87171"][k]}"></i>${l} <b>${bands[k]}</b></span>`).join("")}${faded ? `<a class="faint" href="#/diario">esquecidas (fora do céu) <b>${faded}</b></a>` : ""}</div>
          <p class="faint" style="font-size:13px;margin:10px 0 0">Toda memória enfraquece com o tempo. Cada vez que a Capri lembra de algo numa conversa, ouve de novo ou revisa, ela fica mais forte e demora mais para enfraquecer. Fatos sobre vocês quase não enfraquecem; o diário vai sumindo sozinho.</p></div>` : ""}

        <h2 class="sec">Crescimento</h2>
        <section class="panel grow">
          <div class="grow-top"><div><div class="faint" style="font-size:13px">${day ? "Dia " + day + " · estágio " + (i + 1) + " de " + STAGES.length : "ainda vazio"}</div><h2 class="grow-name">${esc(st.name)}</h2><p class="muted" style="margin:0">${esc(st.line)}</p></div>
            <div class="grow-nums"><div><b>${n}</b><span>memórias</span></div><div><b>${Store.links.size}</b><span>ligações</span></div><div><b>${know.length}</b><span>estudos</span></div><div><b>${topics.length}</b><span>assuntos</span></div></div></div>
          <div class="st-bar big"><i style="width:${Math.round(p * 100)}%"></i></div>
          <div class="faint" style="font-size:13px;margin-top:6px">${nx ? `Faltam ${nx.min - n} memórias para virar ${esc(nx.name)}.` : "Chegou ao último estágio."}</div>
          <ol class="journey">${STAGES.map((s2, j) => `<li class="${j < i ? "done" : j === i ? "here" : ""}"><i></i><b>${esc(s2.name)}</b><span>${s2.min ? s2.min + "+" : "início"}</span></li>`).join("")}</ol>
        </section>
        <h2 class="sec">Do básico ao especialista</h2>
        ${know.length ? `<div class="panel"><div class="lvbar">${[1, 2, 3, 4, 5].map((l) => lv[l] ? `<i style="flex:${lv[l]};--lc:${LEVEL_COLORS[l]}" title="${LEVELS[l]}: ${lv[l]}"></i>` : "").join("")}</div>
          <div class="lvlegend">${[1, 2, 3, 4, 5].map((l) => `<span><i style="--lc:${LEVEL_COLORS[l]}"></i>${LEVELS[l]} <b>${lv[l]}</b> <small>${Math.round((lv[l] / totalLv) * 100)}%</small></span>`).join("")}${lv[0] ? `<span class="faint">sem nível <b>${lv[0]}</b></span>` : ""}</div></div>
        <h2 class="sec">Áreas</h2>
        <div class="areas">${CATS.filter((c) => c.g === "k" && byCat.get(c.id)).map((c) => { const a = byCat.get(c.id); return `<a class="area" href="#/cerebro?q=" data-cat="${c.id}" style="--cc:${c.color}"><span class="cat"><i style="background:${c.color}"></i>${esc(c.label)}</span><b>${a.n}</b>${ladder(a.lv)}</a>`; }).join("")}</div>
        <h2 class="sec">Assuntos</h2>
        ${topics.length ? `<div class="panel" style="padding:6px 0"><table class="topics"><tbody>${topics.slice(0, 300).map((t) => { const f = t.mems.reduce((a, m) => a + retention(m), 0) / t.mems.length; return `<tr><td><a href="#/cerebro?q=${encodeURIComponent(t.topic)}" class="t">${esc(t.topic)}</a><div class="cat"><i style="background:${catOf(t.cat).color}"></i>${esc(catOf(t.cat).label)}</div></td><td>${ladder(t.levels)}</td><td class="num">${t.top ? levelBadge(t.top) : `<span class="faint">sem nível</span>`}</td><td class="num"><span class="force" title="Força média ${Math.round(f * 100)}%"><i style="width:${Math.round(f * 100)}%;background:${retColor(f)}"></i></span></td><td class="num faint">${t.mems.length} · ${ago(t.updated)}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted">Nenhum assunto com nome ainda.</p>`}`
        : `<div class="panel"><b>Ela ainda não guardou nenhum estudo.</b><p class="muted" style="margin:6px 0 0">Pergunte alguma coisa para a Capri ("o que é fotossíntese?", "me explica async no C#") ou ensine algo para ela. Ela guarda a explicação aqui, com o assunto e o nível, e vai subindo do básico ao avançado conforme vocês conversam. Você também pode criar um estudo em <a href="#/cerebro">Nova memória</a>, escolhendo assunto e nível.</p></div>`}
      </div>`;
      el.querySelectorAll(".area").forEach((a) => (a.onclick = (e) => { e.preventDefault(); prefs.hidden = CATS.filter((c) => c.id !== a.dataset.cat).map((c) => c.id); prefs.mode = "web"; savePrefs(); location.hash = "#/cerebro"; }));
      const form = $("#goalForm", el);
      const openForm = (g, topic) => {
        editingGoal = g || null;
        form.classList.remove("hidden");
        $("#gTopic", el).value = g ? g.topic : topic || "";
        $("#gCat", el).value = g ? g.category : (() => { const t = Store.topics().find((x) => x.key === norm(topic || "")); return t && catOf(t.cat).g === "k" ? t.cat : "conhecimento"; })();
        $("#gLevel", el).value = String(g ? g.target_level : 3);
        $("#gWhy", el).value = g ? g.why || "" : "";
        $("#gTopic", el).focus();
      };
      $("#newGoal", el).onclick = () => openForm(null);
      $("#gCancel", el).onclick = () => { form.classList.add("hidden"); editingGoal = null; };
      el.querySelectorAll("[data-hint]").forEach((b) => (b.onclick = () => { const h = hints[+b.dataset.hint]; openForm(null, h.topic); $("#gWhy", el).value = h.from.content.slice(0, 400); }));
      form.onsubmit = async (e) => {
        e.preventDefault();
        const body = { topic: $("#gTopic", el).value.trim().replace(/\s+/g, " "), category: $("#gCat", el).value, target_level: Number($("#gLevel", el).value), why: $("#gWhy", el).value.trim() || null };
        const same = Store.topics().find((t) => t.key === norm(body.topic));
        if (same) body.topic = same.topic;
        try {
          const rows = editingGoal ? await rest(`goals?id=eq.${editingGoal.id}`, { method: "PATCH", body, prefer: "return=representation" })
            : await rest("goals", { method: "POST", body, prefer: "return=representation" });
          if (rows && rows[0]) Store.goals.set(rows[0].id, rows[0]);
          toast(editingGoal ? "Meta atualizada." : "Meta criada. A Capri vai ver isso na próxima conversa.");
          editingGoal = null; draw();
        } catch (err) { toast(err.code === "23505" ? "Já existe uma meta com esse assunto." : err.message, true); }
      };
      el.querySelectorAll("[data-goal]").forEach((card) => {
        const g = Store.goals.get(card.dataset.goal);
        if (!g) return;
        const act = async (body, msg) => {
          try { const rows = await rest(`goals?id=eq.${g.id}`, { method: "PATCH", body, prefer: "return=representation" }); if (rows && rows[0]) Store.goals.set(g.id, rows[0]); toast(msg); draw(); }
          catch (err) { toast(err.message, true); }
        };
        card.querySelectorAll("[data-ga]").forEach((b) => (b.onclick = async () => {
          const a = b.dataset.ga;
          if (a === "edit") openForm(g);
          else if (a === "pause") act({ status: g.status === "pausada" ? "ativa" : "pausada" }, g.status === "pausada" ? "Meta de volta." : "Meta pausada.");
          else if (a === "done") act({ status: g.status === "concluida" ? "ativa" : "concluida" }, g.status === "concluida" ? "Meta reaberta." : "Meta concluída! ✦");
          else if (a === "copy") copy(b.dataset.ask, "Pedido copiado. Cole na conversa com a Capri.");
          else if (a === "del" && (await ask("Apagar esta meta?", `A meta "${g.topic}" some. Os estudos do assunto continuam no cérebro.`, "Apagar"))) {
            try { await rest(`goals?id=eq.${g.id}`, { method: "DELETE" }); Store.goals.delete(g.id); toast("Meta apagada."); draw(); } catch (err) { toast(err.message, true); }
          }
        }));
      });
    };
    const off = Store.on(draw);
    if (Store.loaded) draw();
    return { destroy: off };
  }
  function goalCard(g) {
    const x = goalStats(g), c = catOf(g.category), T = g.target_level;
    const askFor = x.next ? `Capri, me explica ${g.topic} no nível ${LEVELS[x.next].toLowerCase()}${x.next > 1 ? ", indo além do que você já sabe" : ", do começo"}.` : "";
    const step = g.status === "concluida" ? `Concluída ${g.done_at ? ago(g.done_at) : ""}.`
      : x.next ? `Próximo passo: <b>nível ${x.next} · ${LEVELS[x.next]}</b>. Converse com a Capri sobre ${esc(g.topic)} nesse nível; ela guarda o estudo e a meta avança.`
      : x.weakest && retention(x.weakest) < 0.9 ? `Todos os níveis têm estudo. Para firmar: revisar “${esc(x.weakest.title)}”.`
      : "Todos os níveis da meta têm estudo e estão firmes. Pode concluir ou subir o nível.";
    return `<div class="goal panel${g.status !== "ativa" ? " dim" : ""}" data-goal="${g.id}" style="--cc:${c.color}">
      <div class="g-top"><div><b class="g-name">${esc(g.topic)}</b><span class="cat"><i style="background:${c.color}"></i>${esc(c.label)}</span>${g.status !== "ativa" ? `<span class="g-st">${g.status === "pausada" ? "pausada" : "concluída"}</span>` : ""}</div>
        <div class="g-pct"><b>${x.mastery}%</b><span>domínio</span></div></div>
      <div class="g-steps" style="--n:${T}">${[1, 2, 3, 4, 5].slice(0, T).map((l) => `<div class="g-step${x.lv[l] ? " on" : ""}${l === x.next ? " next" : ""}" style="--lc:${LEVEL_COLORS[l]}"><b>${l}</b><span>${LEVELS[l]}</span><small>${x.lv[l] ? x.lv[l] + (x.lv[l] === 1 ? " nota" : " notas") : l === x.next ? "próximo" : "—"}</small></div>`).join("")}</div>
      <div class="g-bar"><i style="width:${x.mastery}%"></i></div>
      <p class="g-next">${step}</p>
      ${g.why ? `<p class="faint g-why">${esc(g.why)}</p>` : ""}
      <div class="row" style="gap:6px">
        ${x.hits.length ? `<a class="btn small" href="#/cerebro?q=${encodeURIComponent(g.topic)}">Ver no cérebro</a>` : ""}
        ${x.due ? `<a class="btn small primary" href="#/revisar?t=${encodeURIComponent(g.topic)}">Revisar ${x.due}</a>` : ""}
        ${askFor && g.status === "ativa" ? `<button class="btn small" data-ga="copy" data-ask="${esc(askFor)}" title="${esc(askFor)}">Copiar pedido para a Capri</button>` : ""}
        <span class="spacer"></span>
        <button class="btn small ghost" data-ga="edit">Editar</button>
        ${g.status !== "concluida" ? `<button class="btn small ghost" data-ga="pause">${g.status === "pausada" ? "Retomar" : "Pausar"}</button>` : ""}
        <button class="btn small ghost" data-ga="done">${g.status === "concluida" ? "Reabrir" : "Concluir"}</button>
        <button class="btn small ghost danger" data-ga="del" aria-label="Apagar meta">✕</button>
      </div></div>`;
  }

  // ---------------- revisar: cartões com repetição espaçada ----------------
  function viewReview(el) {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const only = params.get("t"), one = params.get("id");
    let queue = [], i = 0, shown = false, results = [], practice = false, again = new Set();
    const fits = (m) => !only || (m.topic && norm(m.topic).includes(norm(only)));
    const fill = () => {
      if (one && Store.mems.get(one)) queue = [Store.mems.get(one)];
      else queue = Store.due().filter(fits);
      i = 0; results = []; shown = false; again.clear();
    };
    const practiceSet = () => [...Store.mems.values()].filter((m) => !m.archived && isKnow(m) && fits(m)).sort((a, b) => retention(a) - retention(b)).slice(0, 12);
    const draw = () => {
      if (i >= queue.length) return drawEnd();
      const m = queue[i], c = catOf(m.category), r = retention(m);
      const q = m.question || `O que a Capri sabe sobre “${m.title}”?`;
      el.innerHTML = `<div class="page review">
        <div class="rv-top"><span class="faint">${only ? esc(only) + " · " : ""}${practice ? "treino · " : ""}${i + 1} de ${queue.length}</span><div class="rv-prog"><i style="width:${Math.round((i / queue.length) * 100)}%"></i></div><a class="btn small ghost" href="#/aprendizado">Sair</a></div>
        <div class="panel rv-card">
          <div class="rv-meta"><span class="cat"><i style="background:${c.color}"></i>${esc(c.label)}</span>${m.topic ? `<span class="faint">${esc(m.topic)}</span>` : ""}${levelBadge(m.level)}<span class="spacer"></span><span class="faint" style="font-size:12px">força ${Math.round(r * 100)}%</span></div>
          <div class="rv-q">${esc(q)}</div>
          ${shown ? `<div class="rv-a">${m.question ? `<div class="rv-title">${esc(m.title)}</div>` : ""}${esc(m.content)}</div>
            <div class="rv-ask">Lembrou?</div>
            <div class="grades">${[["Errei", 0], ["Difícil", 1], ["Lembrei", 2], ["Fácil", 3]].map(([l, g]) => `<button class="grade g${g}" data-g="${g}"><b>${l}</b><small>volta em ${inTime(afterGrade(m, g))}</small><kbd>${g + 1}</kbd></button>`).join("")}</div>`
            : `<p class="faint" style="margin:0 0 14px">Tente lembrar antes de virar. Responder de cabeça é o que fixa.</p><button class="btn primary big" id="show">Mostrar resposta <kbd>espaço</kbd></button>`}
          <div class="rv-foot faint">${m.reviews ? `Revisada ${m.reviews}×` : "Primeira revisão"}${m.lapses ? ` · esqueceu ${m.lapses}×` : ""} · <button class="linkbtn" id="edit">Editar${m.question ? "" : " e criar uma pergunta"}</button></div>
        </div></div>`;
      const sh = $("#show", el);
      if (sh) { sh.onclick = () => { shown = true; draw(); }; sh.focus(); }
      el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => grade(+b.dataset.g)));
      $("#edit", el).onclick = () => openMemory(m);
    };
    let busy = false;
    async function grade(g) {
      if (busy) return;
      busy = true;
      const m = queue[i];
      try {
        const r = await rest("rpc/review_memory", { method: "POST", body: { p_id: m.id, p_grade: g } });
        if (r) {
          Object.assign(m, { strength: r.strength, due_at: r.due_at, fresh_at: new Date().toISOString(), last_review_at: new Date().toISOString(), reviews: (m.reviews || 0) + 1, lapses: (m.lapses || 0) + (g === 0 ? 1 : 0), archived: false, ease: g === 0 ? Math.max(1.3, (m.ease || 2.5) - 0.2) : g === 1 ? Math.max(1.3, (m.ease || 2.5) - 0.15) : g === 3 ? Math.min(3.5, (m.ease || 2.5) + 0.15) : m.ease });
          Store.reviews.push({ memory_id: m.id, grade: g, retention: r.was, reviewed_at: new Date().toISOString() });
        }
        results.push({ m, g });
        // Errou: a mesma volta no fim desta sessão, uma vez.
        if (g === 0 && !again.has(m.id)) { again.add(m.id); queue.push(m); }
        i++; shown = false; draw(); badge();
      } catch (err) { toast(err.message, true); }
      finally { busy = false; }
    }
    function drawEnd() {
      // Uma linha por cartão (o que errou e voltou mostra a última resposta, marcado que errou antes).
      const last = new Map();
      for (const x of results) last.set(x.m.id, { m: x.m, g: x.g, missed: (last.get(x.m.id) || {}).missed || x.g === 0 });
      const ok = [...last.values()].filter((x) => x.g >= 2).length, seen = last.size;
      const left = practiceSet(), next = [...Store.mems.values()].filter((m) => !m.archived && m.due_at && Date.parse(m.due_at) > Date.now()).sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
      el.innerHTML = `<div class="page review">
        ${results.length ? `<div class="panel rv-done"><div class="rv-big">✦</div><h2>Revisão feita</h2><p class="muted">${seen} ${seen === 1 ? "cartão" : "cartões"} · ${ok} ${ok === 1 ? "lembrado" : "lembrados"}${seen - ok ? ` · ${seen - ok} para reforçar` : ""}. Cada um ficou mais forte e volta no dia certo.</p>
          <ul class="rv-list">${[...last.values()].map((x) => `<li><span class="grade-dot g${x.g}"></span>${esc(x.m.title)}${x.missed && x.g ? `<span class="faint" style="margin-left:0">· errou antes</span>` : ""}<span class="faint">volta em ${inTime((Date.parse(x.m.due_at) - Date.now()) / DAY)}</span></li>`).join("")}</ul></div>`
        : `<h1>Revisar</h1><p class="lead">A Capri aprende de verdade quando lembra de novo no momento certo, antes de esquecer. Cada estudo volta aqui no dia em que começa a enfraquecer.</p>
          <div class="panel rv-done"><div class="rv-big">✓</div><h2>Nada para revisar agora</h2><p class="muted">${next ? "O próximo estudo volta em " + inTime((Date.parse(next.due_at) - Date.now()) / DAY) + "." : "Quando ela estudar algo novo, a primeira revisão aparece no dia seguinte."}</p></div>`}
        ${left.length ? `<div class="panel"><b>Quer treinar mesmo assim?</b><p class="muted" style="margin:6px 0 12px">Os ${left.length} estudos mais fracos${only ? " de " + esc(only) : ""}. Revisar antes da hora conta, mas fortalece menos.</p><button class="btn" id="practice">Treinar ${left.length}</button></div>` : ""}
        <div class="panel how"><b>Como funciona</b><ol>
          <li>Leia a pergunta e tente lembrar sozinho.</li>
          <li>Vire o cartão e diga com sinceridade como foi: <b>Errei</b>, <b>Difícil</b>, <b>Lembrei</b> ou <b>Fácil</b>.</li>
          <li>O que você lembrou fácil demora mais para voltar; o que errou volta logo. É a curva do esquecimento trabalhando a favor.</li>
          <li>A Capri também fortalece uma memória toda vez que lembra dela numa conversa, e vê nas metas o que está começando a esquecer.</li></ol></div>
      </div>`;
      const pr = $("#practice", el);
      if (pr) pr.onclick = () => { practice = true; queue = left; i = 0; results = []; again.clear(); draw(); };
    }
    const keys = (e) => {
      if (document.querySelector("dialog[open]") || /input|textarea|select/i.test((e.target && e.target.tagName) || "")) return;
      if (i >= queue.length) return;
      if (!shown && (e.key === " " || e.key === "Enter")) { e.preventDefault(); shown = true; draw(); }
      else if (shown && /^[1-4]$/.test(e.key)) grade(+e.key - 1);
    };
    document.addEventListener("keydown", keys);
    fill(); draw();
    // Editou o cartão: mostra o texto novo sem perder o lugar.
    const off = Store.on(() => { if (i < queue.length) { const m = Store.mems.get(queue[i].id); if (m && m !== queue[i]) queue[i] = m; draw(); } });
    return { destroy() { off(); document.removeEventListener("keydown", keys); } };
  }

  // ---------------- diário: o que aconteceu ----------------
  function viewDiary(el) {
    let showFaded = false;
    const day = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    const draw = () => {
      const all = [...Store.mems.values()].filter((m) => kindOf(m) === "episodio");
      const faded = all.filter((m) => m.archived).length;
      const list = all.filter((m) => showFaded || !m.archived).sort((a, b) => (b.happened_at || b.created_at).localeCompare(a.happened_at || a.created_at));
      const groups = new Map();
      for (const m of list) { const k = new Date(m.happened_at || m.created_at).toDateString(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
      el.innerHTML = `<div class="page"><h1>Diário</h1><p class="lead">O que aconteceu, dia a dia. Episódios vão perdendo força e saem do céu quando ficam fracos, mas nada é apagado. O que valer para sempre, transforme em fato; o que ensinar alguma coisa, em estudo.</p>
        <div class="bar"><label class="check"><input type="checkbox" id="faded" ${showFaded ? "checked" : ""}> Mostrar esquecidas <span class="faint">(${faded})</span></label><span class="spacer"></span><span class="faint" style="font-size:13px">${list.length} ${list.length === 1 ? "episódio" : "episódios"}</span></div>
        ${list.length ? [...groups].map(([k, ms]) => `<h2 class="sec">${esc(day.format(new Date(k)))}</h2><div class="stack" style="gap:10px">${ms.map((m) => `<div class="panel ep${m.archived ? " faded" : ""}" data-id="${m.id}">
            <div class="row" style="justify-content:space-between;align-items:baseline;gap:10px"><b class="t">${esc(m.title)}</b><span class="faint" style="font-size:12px;white-space:nowrap">${new Date(m.happened_at || m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></div>
            ${m.content !== m.title ? `<div class="c">${esc(m.content)}</div>` : ""}
            <div class="row" style="gap:8px;margin-top:10px">${m.archived ? `<span class="faint" style="font-size:12px">esquecida</span>` : force(m)}<span class="spacer"></span>
              <button class="btn small" data-a="fato" title="Vale para sempre: vira algo que ela sabe">É um fato</button><button class="btn small" data-a="estudo" title="Ensinou alguma coisa: vira estudo com assunto e nível">É estudo</button>
              ${m.archived ? `<button class="btn small" data-a="wake">Lembrar de novo</button>` : `<button class="btn small ghost" data-a="fade">Esquecer</button>`}<button class="btn small ghost" data-a="edit">Editar</button></div></div>`).join("")}</div>`).join("")
        : `<div class="panel"><b>${all.length ? "Nada no diário com esse filtro." : "O diário está vazio."}</b><p class="muted" style="margin:6px 0 0">Quando a Capri guarda o que aconteceu numa conversa (e não um fato ou um estudo), aparece aqui.</p></div>`}</div>`;
      $("#faded", el).onchange = (e) => { showFaded = e.target.checked; draw(); };
      el.querySelectorAll(".ep [data-a]").forEach((b) => (b.onclick = async () => {
        const m = Store.mems.get(b.closest(".ep").dataset.id), a = b.dataset.a;
        if (!m) return;
        if (a === "fato") setKind(m, "fato");
        else if (a === "estudo") { const done = await setKind(m, "conhecimento"); if (done) openMemory(done); }
        else if (a === "wake") wake(m);
        else if (a === "fade") fade(m);
        else if (a === "edit") openMemory(m);
      }));
    };
    const off = Store.on(draw);
    if (Store.loaded) draw();
    return { destroy: off };
  }

  // As palavras que importam de uma memória (sem acento, 4 letras ou mais).
  const wordsOf = (m) => new Set(norm(m.title + " " + m.content).split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  const twinKey = (g) => g.map((m) => m.id).sort().join("+");
  // Grupos de memórias que dizem quase a mesma coisa: 70% das palavras da menor estão na outra. Cada grupo gira em
  // volta de uma memória (sem corrente de "parecida da parecida"), com no máximo 6.
  function twinGroups() {
    const mems = [...Store.mems.values()].sort((a, b) => b.content.length - a.content.length);
    if (mems.length > 1500) return [];
    const words = new Map(mems.map((m) => [m.id, wordsOf(m)])), used = new Set(), skip = new Set(prefs.notTwins || []), out = [];
    const close = (a, b) => {
      if (!!a.level !== !!b.level || kindOf(a) !== kindOf(b) || !!a.archived !== !!b.archived) return false;
      const wa = words.get(a.id), wb = words.get(b.id), small = wa.size <= wb.size ? wa : wb, big = small === wa ? wb : wa;
      if (small.size < 4) return false;
      let shared = 0;
      for (const w of small) if (big.has(w)) shared++;
      return shared / small.size >= 0.7;
    };
    for (const a of mems) {
      if (used.has(a.id)) continue;
      const g = [a];
      for (const b of mems) if (b !== a && !used.has(b.id) && g.length < 6 && close(a, b)) g.push(b);
      if (g.length > 1 && !skip.has(twinKey(g))) { g.forEach((m) => used.add(m.id)); out.push(g); }
    }
    return out;
  }

  function viewList(el) {
    el.innerHTML = `<div class="page"><h1>Memórias</h1><p class="lead">Tudo que está no cérebro, em lista. Clique numa linha para editar.</p>
      <div class="bar"><input class="input" id="q" placeholder="Procurar" aria-label="Procurar"><select class="input" id="cat" style="flex:0 1 200px" aria-label="Categoria"><option value="">Todas as categorias</option><option value="__p">Só sobre vocês</option><option value="__k">Só conhecimento</option>${CATS.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select>
      <select class="input" id="kind" style="flex:0 1 170px" aria-label="Tipo"><option value="">Todos os tipos</option>${Object.entries(KINDS).map(([id, k]) => `<option value="${id}">${k.icon} ${esc(k.many)}</option>`).join("")}<option value="__due">Para revisar</option><option value="__faded">Esquecidas</option></select>
      <select class="input" id="sort" style="flex:0 1 190px" aria-label="Ordem"><option value="new">Mais recentes</option><option value="old">Mais antigas</option><option value="imp">Mais importantes</option><option value="rec">Mais lembradas</option><option value="weak">Mais fracas</option><option value="strong">Mais firmes</option><option value="lvl">Nível (avançado primeiro)</option><option value="top">Assunto (A–Z)</option><option value="abc">Título (A–Z)</option></select>
      <button class="btn primary" id="add">Nova memória</button><button class="btn hidden" id="join">Juntar selecionadas</button><button class="btn danger hidden" id="bulk">Apagar selecionadas</button></div>
      <div id="twins"></div>
      <div class="panel" style="padding:0;overflow:hidden"><table class="tstack"><thead><tr><th style="width:36px"><input type="checkbox" id="all" aria-label="Selecionar todas"></th><th>Memória</th><th>Categoria</th><th class="num">Nível ou importância</th><th class="num">Força</th><th class="num">Mudou</th></tr></thead><tbody id="rows"></tbody></table></div>
      <p class="faint" id="foot" style="font-size:13px"></p></div>`;
    const picked = new Set();
    const draw = () => {
      const q = norm($("#q", el).value.trim()), cat = $("#cat", el).value, sort = $("#sort", el).value, kind = $("#kind", el).value;
      const fits = (m) => (!cat || (cat === "__k" ? isKnow(m) : cat === "__p" ? !isKnow(m) : m.category === cat))
        && (kind === "__faded" ? m.archived : kind === "__due" ? isDue(m) : !m.archived && (!kind || kindOf(m) === kind));
      let list = [...Store.mems.values()].filter((m) => fits(m) && (!q || norm(m.title).includes(q) || norm(m.content).includes(q) || norm(m.topic).includes(q) || (m.tags || []).some((t) => norm(t).includes(q))));
      const by = { new: (a, b) => b.updated_at.localeCompare(a.updated_at), old: (a, b) => a.created_at.localeCompare(b.created_at), imp: (a, b) => b.importance - a.importance || b.updated_at.localeCompare(a.updated_at), rec: (a, b) => b.recall_count - a.recall_count,
        weak: (a, b) => retention(a) - retention(b), strong: (a, b) => retention(b) - retention(a),
        lvl: (a, b) => (b.level || 0) - (a.level || 0) || b.updated_at.localeCompare(a.updated_at), top: (a, b) => (a.topic || "\uffff").localeCompare(b.topic || "\uffff", "pt-BR") || (a.level || 0) - (b.level || 0), abc: (a, b) => a.title.localeCompare(b.title, "pt-BR") };
      list.sort(by[sort]);
      const shown = list.slice(0, 600);
      $("#rows", el).innerHTML = shown.map((m) => { const c = catOf(m.category); return `<tr data-id="${m.id}" style="cursor:pointer"><td><input type="checkbox" data-pick="${m.id}" ${picked.has(m.id) ? "checked" : ""} aria-label="Selecionar"></td><td><div class="t">${esc(m.title)}</div><div class="c">${esc(m.content)}</div></td><td><span class="cat"><i style="background:${c.color}"></i>${esc(c.label)}</span><div class="faint" style="font-size:12px;margin-top:3px">${KINDS[kindOf(m)].icon} ${esc(KINDS[kindOf(m)].label)}</div>${m.topic ? `<div class="faint" style="font-size:12px;margin-top:3px">${esc(m.topic)}</div>` : ""}</td><td class="num">${m.level ? levelBadge(m.level) : `<span class="stars">${stars(m.importance)}</span>`}</td><td class="num">${m.archived ? `<span class="faint" style="font-size:12px">esquecida</span>` : force(m)}${isDue(m) ? `<div class="duetag">revisar</div>` : ""}</td><td class="num faint">${ago(m.updated_at)}</td></tr>`; }).join("")
        || `<tr><td colspan="6" class="muted" style="padding:28px;text-align:center">${Store.mems.size ? "Nada com esse filtro." : "Nenhuma memória ainda."}</td></tr>`;
      $("#foot", el).textContent = list.length > shown.length ? `Mostrando ${shown.length} de ${list.length}. Use a busca para achar o resto.` : `${list.length} ${list.length === 1 ? "memória" : "memórias"}.`;
      $("#bulk", el).classList.toggle("hidden", picked.size === 0);
      $("#join", el).classList.toggle("hidden", picked.size < 2);
      $("#join", el).textContent = `Juntar ${picked.size} em uma`;
      drawTwins();
      $("#bulk", el).textContent = `Apagar ${picked.size} ${picked.size === 1 ? "selecionada" : "selecionadas"}`;
    };
    { const t = new URLSearchParams(location.hash.split("?")[1] || "").get("tipo"); if (t) $("#kind", el).value = t; }
    ["input", "change"].forEach((ev) => { $("#q", el).addEventListener(ev, draw); $("#cat", el).addEventListener(ev, draw); $("#sort", el).addEventListener(ev, draw); $("#kind", el).addEventListener(ev, draw); });
    $("#rows", el).addEventListener("click", (e) => {
      const box = e.target.closest("[data-pick]");
      if (box) { box.checked ? picked.add(box.dataset.pick) : picked.delete(box.dataset.pick); draw(); return; }
      const tr = e.target.closest("tr[data-id]");
      if (tr) openMemory(Store.mems.get(tr.dataset.id));
    });
    $("#all", el).onchange = (e) => { picked.clear(); if (e.target.checked) $("#rows", el).querySelectorAll("[data-pick]").forEach((b) => picked.add(b.dataset.pick)); draw(); };
    $("#add", el).onclick = () => openMemory(null);
    // Juntar: fica a mais completa, que herda as ligações, etiquetas e lembranças das outras.
    const join = async (ids) => {
      const mems = ids.map((id) => Store.mems.get(id)).filter(Boolean);
      if (mems.length < 2) return;
      const keep = mems.slice().sort((a, b) => b.content.length - a.content.length)[0];
      try {
        await rest("rpc/merge_my_memories", { method: "POST", body: { p_keep: keep.id, p_drop: mems.filter((m) => m !== keep).map((m) => m.id) } });
        mems.forEach((m) => { if (m !== keep) { Store.dropMem(m.id); picked.delete(m.id); } });
        await Store.sync();
        toast(`Juntadas em “${keep.title.length > 50 ? keep.title.slice(0, 48) + "…" : keep.title}”.`);
      } catch (err) { toast(err.message, true); }
    };
    $("#join", el).onclick = () => join([...picked]);
    // Parecidas: memórias que dizem quase a mesma coisa, para juntar com um clique (ou dizer que não são iguais).
    function drawTwins() {
      const box = $("#twins", el), groups = twinGroups();
      if (!groups.length) { box.innerHTML = ""; return; }
      box.innerHTML = `<div class="panel twins"><div class="row" style="justify-content:space-between;align-items:baseline"><b>Parecidas</b><span class="faint" style="font-size:13px">${groups.length} ${groups.length === 1 ? "grupo diz" : "grupos dizem"} quase a mesma coisa</span></div>
        ${groups.slice(0, 8).map((g, i) => `<div class="twin"><ul>${g.map((m) => `<li><span class="cat"><i style="background:${catOf(m.category).color}"></i></span>${esc(m.title)}</li>`).join("")}</ul>
          <div class="row" style="gap:6px"><button class="btn small" data-join="${i}">Juntar</button><button class="btn small ghost" data-skip="${i}">Não são iguais</button></div></div>`).join("")}</div>`;
      box.querySelectorAll("[data-join]").forEach((b) => (b.onclick = () => join(groups[+b.dataset.join].map((m) => m.id))));
      box.querySelectorAll("[data-skip]").forEach((b) => (b.onclick = () => { prefs.notTwins = (prefs.notTwins || []).concat([twinKey(groups[+b.dataset.skip])]).slice(-300); savePrefs(); drawTwins(); }));
    }
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

  // O que ela entendeu: o perfil que a reflexão dela escreve a partir das memórias (quem você é, como quer ser tratado, a
  // relação, os assuntos em aberto e o que ela aprendeu sobre si), as reflexões e o que ela deixou de lado e por quê.
  const PERFIL = [
    { f: "perfil", t: "Quem você é", d: "O que ela sabe de você, juntando tudo que lembra.", max: 6000 },
    { f: "regras", t: "Como você quer ser tratado", d: "O que você pediu sobre o jeito dela. Ela segue isso sempre.", max: 3000 },
    { f: "relacao", t: "Vocês dois", d: "Como a relação de vocês vem sendo.", max: 3000 },
    { f: "pendentes", t: "Assuntos em aberto", d: "Promessas, planos e coisas para perguntar como foram.", max: 3000 },
    { f: "eu", t: "O que ela aprendeu sobre si", d: "Gostos e jeitos que ela formou com você.", max: 3000 },
  ];
  function viewProfile(el) {
    el.innerHTML = `<div class="page"><h1>O que ela entendeu</h1><p class="lead">De tempos em tempos a Capri reflete sobre tudo que lembra de você: junta o que se repete, deixa de lado o que ficou velho ou errado e escreve o que entendeu. É isso que ela lê antes de falar com você. Você pode corrigir qualquer parte.</p>
      <div id="pf"><div class="panel muted">Carregando…</div></div>
      <h2 class="sec">Reflexões</h2><div id="rf" class="stack" style="gap:10px"><div class="panel muted">Carregando…</div></div>
      <h2 class="sec">Deixadas de lado pela reflexão</h2><div id="ar" class="stack" style="gap:10px"><div class="panel muted">Carregando…</div></div></div>`;
    let row = null;
    const draw = () => {
      const st = row || {};
      $("#pf", el).innerHTML = `${st.reflected_at ? `<p class="faint" style="margin:0 0 12px">Última reflexão ${esc(ago(st.reflected_at))} · ${st.reflections || 0} ${st.reflections === 1 ? "reflexão" : "reflexões"}</p>` : `<div class="panel" style="margin-bottom:14px"><b>Ela ainda não refletiu.</b><p class="muted" style="margin:6px 0 0">A primeira reflexão acontece sozinha quando ela tem algumas memórias e um cérebro na nuvem. No PC, no menu dela: Cérebro online › Refletir agora.</p></div>`}
        <form id="pform" class="stack" style="gap:14px">${PERFIL.map((p) => `<div class="panel"><label class="f" for="pf_${p.f}"><b>${p.t}</b> <span class="faint">${p.d}</span></label>
          <textarea class="input" id="pf_${p.f}" rows="${p.f === "perfil" ? 12 : 6}" maxlength="${p.max}" style="width:100%;font-family:inherit;line-height:1.5">${esc(st[p.f] || "")}</textarea></div>`).join("")}
          <div class="row"><span class="spacer"></span><button class="btn primary">Salvar correções</button></div></form>`;
      $("#pform", el).onsubmit = async (e) => {
        e.preventDefault();
        const body = { user_id: Auth.uid };
        for (const p of PERFIL) body[p.f] = $("#pf_" + p.f, el).value.trim().slice(0, p.max);
        try {
          const saved = await rest("brain_state?on_conflict=user_id", { method: "POST", body, prefer: "resolution=merge-duplicates,return=representation" });
          row = (saved && saved[0]) || { ...row, ...body };
          toast("Salvo. Ela lê isso na próxima conversa.");
          draw();
        } catch (err) { toast(err.message, true); }
      };
    };
    const load = async () => {
      try {
        const [st, rf, ar] = await Promise.all([
          rest("brain_state?select=*&limit=1"),
          rest("reflections?select=id,created_at,summary,seen,added,archived,merged&order=created_at.desc&limit=12"),
          rest("memories?select=id,title,content,archived_reason,updated_at&archived=is.true&archived_reason=not.is.null&order=updated_at.desc&limit=30"),
        ]);
        row = st[0] || null;
        draw();
        $("#rf", el).innerHTML = rf.length ? rf.map((r) => `<div class="panel"><div class="row" style="justify-content:space-between;align-items:baseline;gap:10px"><b>${esc(when(r.created_at))}</b><span class="faint" style="font-size:12px">leu ${r.seen} · juntou ${r.merged} · deixou de lado ${r.archived} · novas ${r.added}</span></div>${r.summary ? `<div class="c" style="margin-top:6px">${esc(r.summary)}</div>` : ""}</div>`).join("")
          : `<div class="panel muted">Nenhuma reflexão ainda.</div>`;
        $("#ar", el).innerHTML = ar.length ? ar.map((m) => `<div class="panel ar" data-id="${m.id}"><div class="row" style="justify-content:space-between;align-items:baseline;gap:10px"><b>${esc(m.title)}</b><button class="btn small" data-a="wake">Lembrar de novo</button></div>
            <div class="faint" style="font-size:13px;margin-top:4px">Motivo: ${esc(m.archived_reason)}</div></div>`).join("")
          : `<div class="panel muted">Nada deixado de lado ainda.</div>`;
        el.querySelectorAll(".ar [data-a=wake]").forEach((b) => (b.onclick = async () => {
          const id = b.closest(".ar").dataset.id;
          try {
            await rest(`memories?id=eq.${id}`, { method: "PATCH", body: { archived: false, archived_reason: null } });
            const m = Store.mems.get(id);
            if (m) { m.archived = false; Store.emit(); }
            b.closest(".ar").remove();
            toast("Ela voltou a lembrar disso.");
          } catch (err) { toast(err.message, true); }
        }));
      } catch (err) { $("#pf", el).innerHTML = `<div class="panel" style="color:var(--bad)">${esc(err.message)}</div>`; }
    };
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
        <div class="panel"><b>O que ela guarda aqui</b><p class="muted" style="margin:6px 0 0">As notas que ela faz sobre você, as memórias que ela tira das conversas, as respostas do "me conhece", o resumo do que vocês leram juntos. E tudo que ela estuda: quando você pergunta ou ensina alguma coisa, ela guarda a explicação com o assunto, o nível (do básico ao especialista) e uma pergunta para revisar, e cada assunto vira uma trilha. O que é fato fica firme; o diário vai enfraquecendo; os estudos voltam para revisão no dia certo, e ela vê as metas de estudo e o que está começando a esquecer. Endereços, números de documento e senhas nunca saem do PC. Antes de responder, ela pergunta ao cérebro o que sabe sobre o assunto.</p></div>
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
  const VIEWS = { cerebro: viewGraph, perfil: viewProfile, aprendizado: viewLearn, revisar: viewReview, diario: viewDiary, memorias: viewList, chaves: viewKeys, conectar: viewConnect, conta: viewAccount };
  // Quantos estudos estão na hora de revisar, na aba.
  function badge() {
    const b = $("#dueBadge");
    if (!b) return;
    const n = Store.loaded ? Store.due().length : 0;
    b.textContent = n > 99 ? "99+" : String(n);
    b.classList.toggle("hidden", !n);
  }
  Store.on(badge);
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
    // Revisar com outro filtro (?t= ou ?id=) monta a sessão de novo.
    if (shownRoute === r && current && r !== "revisar") return;
    if (current) { current.destroy && current.destroy(); current = null; }
    shownRoute = r;
    view.className = "view";
    who();
    if (!Store.loaded && ["cerebro", "memorias", "aprendizado", "revisar", "diario"].includes(r)) {
      loadingState(view);
      try { await Store.load(); } catch (err) { failState(view, err); return; }
      if (shownRoute !== r) return;
    } else if (!Store.loaded) Store.load().catch(() => {});
    view.innerHTML = "";
    current = VIEWS[r](view) || {};
    badge();
    document.title = ({ cerebro: "Cérebro", perfil: "O que ela entendeu", aprendizado: "Aprender", revisar: "Revisar", diario: "Diário", memorias: "Memórias", chaves: "Chaves da Capri", conectar: "Conectar a Capri", conta: "Conta" })[r] + " · Cérebro da Capri";
  }
  window.addEventListener("hashchange", route);
  Auth.load();
  loadPrefs(Auth.uid);
  if (Auth.s && Date.now() / 1000 > Auth.s.expires_at - 90) Auth.refresh().then(route); else route();
})();
