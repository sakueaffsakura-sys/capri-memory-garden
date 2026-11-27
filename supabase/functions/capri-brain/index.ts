// Cérebro da Capri: a porta por onde a Capri (app de PC) guarda e busca o que aprendeu.
// Toda chamada é POST com JSON {"action": ...}. A Capri se identifica com o cabeçalho x-capri-key (chave cap_...).
// Conhecimento: remember aceita "level" (1 básico .. 5 especialista) e "topic" (o assunto); memórias do mesmo assunto
// viram uma trilha (a mais funda "aprofunda" a de baixo). "topics" lista os assuntos e quantas há em cada nível.
// Uma memória quase igual a outra que já existe vira uma só (fica a mais completa); "organize" faz isso no cérebro todo.
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
  });
  let linked = Number(r?.linked ?? 0);
  if (Array.isArray(item?.links)) {
    for (const l of item.links.slice(0, 10)) {
      const to = str(l?.to, 120);
      if (!to) continue;
      if (await rpc("brain_link", { p_user: user, p_from: r.id, p_to: to, p_relation: str(l?.relation, 60) || "relacionado", p_auto: false })) linked++;
    }
  }
  return { id: r.id, title: r.title, category: r.category, level: r.level ?? null, topic: r.topic ?? null, created: r.created, merged: !!r.merged, linked };
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
      case "core":
        return reply(200, { ok: true, memories: await rpc("brain_core", { p_user: user, p_limit: int(body?.limit, 30, 1, 60) }) });
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
        return reply(200, { ok: true, merged });
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
