// Cérebro da Capri: a porta por onde a Capri (app de PC) guarda e busca o que aprendeu.
// Toda chamada é POST com JSON {"action": ...}. A Capri se identifica com o cabeçalho x-capri-key (chave cap_...).
// Conhecimento: remember aceita "level" (1 básico .. 5 especialista) e "topic" (o assunto); memórias do mesmo assunto
// viram uma trilha (a mais funda "aprofunda" a de baixo). "topics" lista os assuntos e quantas há em cada nível.
// Uma memória quase igual a outra que já existe vira uma só (fica a mais completa); "organize" faz isso no cérebro todo.
// Memória e aprendizado: cada memória tem um tipo (fato, conhecimento, habilidade, episodio) e uma força que o tempo
// enfraquece e que lembrar, ouvir de novo e revisar aumentam. "due" lista o que está na hora de revisar e "review"
// registra uma revisão (0 errei, 1 difícil, 2 lembrei, 3 fácil). "goals" e "goal" cuidam das metas de estudo e "next"
// diz o próximo passo de cada uma. "diary" é o diário (os episódios). "core" leva junto as metas e o que revisar.
// Reflexão: "reflect_input" entrega o que mudou desde a última reflexão e os fatos ativos; a Capri pensa sobre isso com o
// cérebro dela e manda "reflect_apply" com o perfil novo (quem a pessoa é, como quer ser tratada, a relação, o que ela
// aprendeu sobre si, os assuntos em aberto), as memórias que ficaram velhas, as repetidas para juntar e o que concluiu.
// "state" e "state_set" leem e mudam esse perfil. "core" já traz o perfil junto.
// Toda ação mexe só no cérebro do dono da chave.
// A ação "register" (cadastro pelo site) não precisa de chave: cria a conta já confirmada.
// Publicada com verify_jwt = false (a própria função confere a chave).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-capri-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_USERS = 50;
const CATS = new Set([
  "sobre-voce", "gostos", "pessoas", "conversas", "sentimentos", "planos", "rotina", "jogos", "leituras", "musica", "capri", "outros",
  "conhecimento", "ciencia", "tecnologia", "matematica", "idiomas", "historia", "arte", "saude", "habilidades",
]);

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
const fail = (status: number, error: string) => reply(status, { ok: false, error });

async function sha256(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, def: number, lo: number, hi: number) => {
  const n = typeof v === "number" ? Math.round(v) : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};
const tagsOf = (v: unknown) =>
  Array.isArray(v)
    ? v.filter((t) => typeof t === "string").map((t) => (t as string).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 12)
    : [];
const cat = (v: unknown) => {
  const c = str(v, 20).toLowerCase();
  return CATS.has(c) ? c : null;
};
// Para guardar, o banco entende sinônimos ("biologia" vira ciencia), então vai o nome como veio.
const catLoose = (v: unknown) => str(v, 30) || null;
const levelOf = (v: unknown) => {
  const n = int(v, 0, 0, 5);
  return n >= 1 ? n : null;
};
const KINDS = new Set(["fato", "conhecimento", "habilidade", "episodio"]);
const kindOf = (v: unknown) => { const k = str(v, 20).toLowerCase(); return KINDS.has(k) ? k : null; };
const LEVELS = ["", "Básico", "Elementar", "Intermediário", "Avançado", "Especialista"];
const KNOW = new Set(["conhecimento", "ciencia", "tecnologia", "matematica", "idiomas", "historia", "arte", "saude", "habilidades"]);
const dateOf = (v: unknown) => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

// deno-lint-ignore no-explicit-any
async function remember(user: string, item: any) {
  const content = str(item?.content, 4000);
  if (!content) throw new Error("conteúdo vazio");
  const r = await rpc("brain_remember", {
    p_user: user,
    p_content: content,
    p_title: str(item?.title, 120) || null,
    p_category: catLoose(item?.category),
    p_importance: int(item?.importance, 3, 1, 5),
    p_tags: tagsOf(item?.tags),
    p_source: str(item?.source, 40) || "capri",
    p_happened: dateOf(item?.happened_at),
    p_level: levelOf(item?.level),
    p_topic: str(item?.topic, 80) || null,
    p_kind: kindOf(item?.kind),
    p_question: str(item?.question, 300) || null,
  });
  let linked = Number(r?.linked ?? 0);
  if (Array.isArray(item?.links)) {
    for (const l of item.links.slice(0, 10)) {
      const to = str(l?.to, 120);
      if (!to) continue;
      if (await rpc("brain_link", { p_user: user, p_from: r.id, p_to: to, p_relation: str(l?.relation, 60) || "relacionado", p_auto: false })) linked++;
    }
  }
  return { id: r.id, title: r.title, category: r.category, kind: r.kind, level: r.level ?? null, topic: r.topic ?? null, created: r.created, merged: !!r.merged, linked };
}

// deno-lint-ignore no-explicit-any
type Goal = any;
// Uma frase por meta: quão firme está e qual o próximo passo.
function goalLine(g: Goal) {
  const has = (g.levels || []).reduce((a: number, n: number, i: number) => (n ? i + 1 : a), 0);
  const parts = [`${g.topic}: quero chegar ao nível ${g.target_level} (${LEVELS[g.target_level]})`];
  parts.push(has ? `já tenho até o nível ${has}, domínio ${g.mastery}%` : "ainda não comecei");
  if (g.next_level) parts.push(`próximo passo: nível ${g.next_level} (${LEVELS[g.next_level]})`);
  else if (g.weakest && g.weakest.retention < 0.9) parts.push(`revisar "${g.weakest.title}"`);
  else parts.push("todos os níveis da meta já têm estudo");
  return parts.join("; ");
}

// Sugestões do que estudar ou revisar agora, das metas e do que está esquecendo.
// deno-lint-ignore no-explicit-any
async function nextSteps(user: string, limit: number): Promise<any[]> {
  const goals: Goal[] = (await rpc("brain_goals", { p_user: user, p_all: false })) || [];
  // deno-lint-ignore no-explicit-any
  const due: any[] = (await rpc("brain_due", { p_user: user, p_limit: limit })) || [];
  const out = [];
  for (const g of goals) {
    if (g.next_level) out.push({ type: "estudar", topic: g.topic, level: g.next_level, text: `Estudar ${g.topic}, nível ${g.next_level} (${LEVELS[g.next_level]})`, goal: g.id });
  }
  for (const m of due) out.push({ type: "revisar", id: m.id, topic: m.topic, level: m.level, retention: m.retention, text: `Revisar "${m.title}"${m.topic ? " (" + m.topic + ")" : ""}` });
  return out.slice(0, limit);
}

// deno-lint-ignore no-explicit-any
async function register(body: any) {
  const email = str(body?.email, 200).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  const name = str(body?.name, 60);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "e-mail inválido");
  if (password.length < 8 || password.length > 72) return fail(400, "a senha precisa ter de 8 a 72 caracteres");
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_USERS) return fail(403, "cadastro fechado");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name || email.split("@")[0] },
  });
  if (error) return fail(400, /already|registered|exists/i.test(error.message) ? "esse e-mail já tem conta" : "não deu para criar a conta");
  return reply(200, { ok: true, id: data.user?.id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "use POST");
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, "JSON inválido");
  }
  const action = str(body?.action, 30);
  try {
    if (action === "register") return await register(body);
    const key = (req.headers.get("x-capri-key") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")).trim();
    if (!/^cap_[A-Za-z0-9]{20,80}$/.test(key)) return fail(401, "chave inválida");
    const user = (await rpc("brain_user_for_key", { p_hash: await sha256(key) })) as string | null;
    if (!user) return fail(401, "chave inválida");
    switch (action) {
      case "ping":
        return reply(200, { ok: true, ...(await rpc("brain_stats", { p_user: user })) });
      case "remember":
        return reply(200, { ok: true, ...(await remember(user, body)) });
      case "remember_many": {
        const items = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
        const results = [];
        for (const item of items) {
          try {
            results.push(await remember(user, item));
          } catch (e) {
            results.push({ error: (e as Error).message });
          }
        }
        return reply(200, { ok: true, results });
      }
      case "recall": {
        const query = str(body?.query, 500);
        if (!query) return fail(400, "query vazia");
        return reply(200, { ok: true, memories: await rpc("brain_recall", { p_user: user, p_query: query, p_limit: int(body?.limit, 8, 1, 30), p_category: cat(body?.category) }) });
      }
      case "core": {
        // O que ela sabe de vocês, mais as metas de estudo e o que está começando a esquecer.
        await rpc("brain_maintain", { p_user: user }).catch(() => 0);
        // deno-lint-ignore no-explicit-any
        const memories: any[] = (await rpc("brain_core", { p_user: user, p_limit: int(body?.limit, 30, 1, 60) })) || [];
        const goals: Goal[] = (await rpc("brain_goals", { p_user: user, p_all: false })) || [];
        // deno-lint-ignore no-explicit-any
        const due: any[] = (await rpc("brain_due", { p_user: user, p_limit: 5 })) || [];
        if (goals.length) memories.push({ id: "metas", kind: "meta", title: "Minhas metas de estudo", content: goals.map(goalLine).join(". ") + "." });
        if (due.length) {
          memories.push({ id: "revisar", kind: "revisao", title: "Estou começando a esquecer",
            content: due.map((m) => `${m.title}${m.topic ? " (" + m.topic + ", nível " + (m.level ?? "?") + ")" : ""}`).join("; ")
              + ". Quando couber na conversa, posso puxar um desses assuntos ou perguntar sobre ele para fixar." });
        }
        const state = await rpc("brain_state_get", { p_user: user }).catch(() => null);
        const topics = body?.topics === false ? [] : await rpc("brain_topics", { p_user: user, p_limit: int(body?.topics_limit, 25, 1, 60) }).catch(() => []);
        return reply(200, { ok: true, memories, goals: goals.length, due: due.length, state, topics });
      }
      case "state":
        return reply(200, { ok: true, state: await rpc("brain_state_get", { p_user: user }) });
      case "state_set": {
        const patch: Record<string, string> = {};
        for (const [f, max] of [["perfil", 6000], ["regras", 3000], ["relacao", 3000], ["eu", 3000], ["pendentes", 3000]] as const) {
          if (typeof body?.[f] === "string") patch[f] = str(body[f], max);
        }
        if (!Object.keys(patch).length) return fail(400, "nada para mudar");
        return reply(200, { ok: true, state: await rpc("brain_state_set", { p_user: user, p_state: patch }) });
      }
      case "reflect_input":
        return reply(200, { ok: true, ...(await rpc("brain_reflect_input", { p_user: user, p_new: int(body?.new, 60, 1, 120), p_facts: int(body?.facts, 140, 1, 300) })) });
      case "reflect_apply": {
        // O que a reflexão concluiu. Juntar e acrescentar passam pelas mesmas portas de sempre; o resto vai de uma vez.
        const state: Record<string, string> = {};
        for (const [f, max] of [["perfil", 6000], ["regras", 3000], ["relacao", 3000], ["eu", 3000], ["pendentes", 3000]] as const) {
          if (typeof body?.[f] === "string") state[f] = str(body[f], max);
        }
        const isId = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
        let merged = 0, added = 0;
        const gone = new Set<string>();
        for (const g of (Array.isArray(body?.merge) ? body.merge : []).slice(0, 12)) {
          const keep = g?.keep, drop = Array.isArray(g?.drop) ? g.drop.filter((d: unknown) => isId(d) && d !== keep && !gone.has(d as string)).slice(0, 10) : [];
          if (!isId(keep) || gone.has(keep) || !drop.length) continue;
          try {
            const n = Number(await rpc("brain_merge", { p_user: user, p_keep: keep, p_drop: drop })) || 0;
            merged += n;
            drop.forEach((d: string) => gone.add(d));
          } catch (_) { /* uma junção que não deu não para a reflexão */ }
        }
        for (const item of (Array.isArray(body?.add) ? body.add : []).slice(0, 8)) {
          try { await remember(user, { ...item, source: "reflexao", kind: kindOf(item?.kind) || "fato" }); added++; } catch (_) { /* idem */ }
        }
        const archive = (Array.isArray(body?.archive) ? body.archive : []).filter((a: { id?: unknown }) => isId(a?.id) && !gone.has(a.id as string)).slice(0, 25)
          .map((a: { id: string; reason?: unknown }) => ({ id: a.id, reason: str(a.reason, 300) }));
        const done = await rpc("brain_reflect_apply", { p_user: user, p_state: state, p_archive: archive, p_summary: str(body?.summary, 2000),
          p_seen: int(body?.seen, 0, 0, 100000), p_added: added, p_merged: merged });
        return reply(200, { ok: true, merged, added, ...done });
      }
      case "due":
        return reply(200, { ok: true, memories: await rpc("brain_due", { p_user: user, p_limit: int(body?.limit, 20, 1, 100) }) });
      case "review": {
        const id = str(body?.id, 60);
        if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "diga o id");
        const done = await rpc("brain_review", { p_user: user, p_id: id, p_grade: int(body?.grade, 2, 0, 3), p_capri: body?.by_capri !== false });
        return done ? reply(200, { ok: true, ...done }) : fail(404, "memória não encontrada");
      }
      case "goals":
        return reply(200, { ok: true, goals: await rpc("brain_goals", { p_user: user, p_all: body?.all === true }) });
      case "goal": {
        const topic = str(body?.topic, 80).replace(/\s+/g, " ");
        if (!topic) return fail(400, "diga o assunto (topic)");
        const c = str(body?.category, 30).toLowerCase();
        const status = ["ativa", "pausada", "concluida", "sugerida"].includes(str(body?.status, 20)) ? str(body?.status, 20) : "ativa";
        const row = { user_id: user, topic, category: KNOW.has(c) ? c : "conhecimento", target_level: int(body?.level, 3, 1, 5), why: str(body?.why, 400) || null, status };
        const { data: found } = await admin.from("goals").select("id,topic").eq("user_id", user);
        const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        const same = (found || []).find((g) => fold(g.topic) === fold(topic));
        const { error } = same
          ? await admin.from("goals").update({ target_level: row.target_level, status, ...(row.why ? { why: row.why } : {}) }).eq("id", same.id).eq("user_id", user)
          : await admin.from("goals").insert(row);
        if (error) throw new Error(error.message);
        return reply(200, { ok: true, created: !same, goals: await rpc("brain_goals", { p_user: user, p_all: false }) });
      }
      case "next":
        return reply(200, { ok: true, next: await nextSteps(user, int(body?.limit, 8, 1, 30)) });
      case "diary": {
        const days = int(body?.days, 7, 1, 90);
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const { data, error } = await admin.from("memories").select("id,title,content,category,importance,happened_at,created_at,archived")
          .eq("user_id", user).eq("kind", "episodio").gte("created_at", since).order("created_at", { ascending: false }).limit(200);
        if (error) throw new Error(error.message);
        return reply(200, { ok: true, days, episodes: data });
      }
      case "recent":
        return reply(200, { ok: true, memories: await rpc("brain_recent", { p_user: user, p_limit: int(body?.limit, 20, 1, 100), p_category: cat(body?.category) }) });
      case "forget": {
        const ref = str(body?.id, 60) || str(body?.title, 120);
        if (!ref) return fail(400, "diga o id ou o título");
        return reply(200, { ok: true, deleted: await rpc("brain_forget", { p_user: user, p_ref: ref }) });
      }
      case "link": {
        const from = str(body?.from, 120), to = str(body?.to, 120);
        if (!from || !to) return fail(400, "diga from e to");
        return reply(200, { ok: true, linked: await rpc("brain_link", { p_user: user, p_from: from, p_to: to, p_relation: str(body?.relation, 60) || "relacionado", p_auto: false }) });
      }
      case "categories":
        return reply(200, { ok: true, categories: await rpc("brain_categories", { p_user: user }) });
      case "organize": {
        // Junta as memórias repetidas e liga as parecidas, só neste cérebro.
        const merged = await rpc("brain_consolidate", { p_user: user });
        const faded = await rpc("brain_maintain", { p_user: user });
        return reply(200, { ok: true, merged, faded });
      }
      case "merge": {
        const keep = str(body?.keep, 60), drop = Array.isArray(body?.drop) ? body.drop.map((d: unknown) => str(d, 60)).filter((d: string) => /^[0-9a-f-]{36}$/i.test(d)).slice(0, 50) : [];
        if (!/^[0-9a-f-]{36}$/i.test(keep) || !drop.length) return fail(400, "diga keep e drop (ids)");
        return reply(200, { ok: true, merged: await rpc("brain_merge", { p_user: user, p_keep: keep, p_drop: drop }) });
      }
      case "topics":
        return reply(200, { ok: true, topics: await rpc("brain_topics", { p_user: user, p_limit: int(body?.limit, 60, 1, 200) }) });
      default:
        return fail(400, "ação desconhecida");
    }
  } catch (e) {
    console.error("capri-brain", action, (e as Error).message);
    return fail(500, "erro no cérebro");
  }
});
