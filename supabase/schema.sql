-- Cérebro da Capri: o banco inteiro (Supabase / Postgres). Já está aplicado no projeto wzecozxpipxbalauazub.
-- Serve para recriar o cérebro em outro projeto Supabase: rode este arquivo no SQL Editor e publique
-- supabase/functions/capri-brain com verify_jwt = false.

create extension if not exists pg_trgm with schema extensions;

-- ---------- perfis ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "perfil: ler o seu" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "perfil: mudar o seu" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)), 60))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- memórias (cada bolinha) ----------
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  content text not null check (char_length(content) between 1 and 4000),
  category text not null default 'outros' check (category in ('sobre-voce','gostos','pessoas','conversas','sentimentos','planos','rotina','jogos','leituras','musica','capri','outros')),
  importance smallint not null default 3 check (importance between 1 and 5),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  source text not null default 'capri' check (char_length(source) <= 40),
  happened_at timestamptz,
  mentions int not null default 1,
  recall_count int not null default 0,
  last_recalled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector
);
create unique index memories_user_title on public.memories (user_id, lower(title));
create index memories_user_updated on public.memories (user_id, updated_at desc);
create index memories_search on public.memories using gin (search);
create index memories_title_trgm on public.memories using gin (title extensions.gin_trgm_ops);
create index memories_content_trgm on public.memories using gin (content extensions.gin_trgm_ops);

create or replace function public.memories_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.title, new.content, new.tags) is distinct from (old.title, old.content, old.tags) then
    new.search := setweight(to_tsvector('portuguese', coalesce(new.title, '')), 'A')
               || setweight(to_tsvector('portuguese', coalesce(new.content, '')), 'B')
               || setweight(to_tsvector('portuguese', array_to_string(coalesce(new.tags, '{}'), ' ')), 'C');
  end if;
  if tg_op = 'UPDATE' and (new.title, new.content, new.category, new.importance, new.tags) is distinct from (old.title, old.content, old.category, old.importance, old.tags) then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger memories_touch before insert or update on public.memories for each row execute function public.memories_touch();

alter table public.memories enable row level security;
create policy "memórias: ler as suas" on public.memories for select to authenticated using (user_id = (select auth.uid()));
create policy "memórias: criar as suas" on public.memories for insert to authenticated with check (user_id = (select auth.uid()));
create policy "memórias: mudar as suas" on public.memories for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "memórias: apagar as suas" on public.memories for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- ligações entre bolinhas ----------
create table public.memory_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_id uuid not null references public.memories(id) on delete cascade,
  target_id uuid not null references public.memories(id) on delete cascade,
  relation text not null default 'relacionado' check (char_length(relation) between 1 and 60),
  strength real not null default 0.5,
  auto boolean not null default false,
  created_at timestamptz not null default now(),
  unique (source_id, target_id),
  check (source_id <> target_id)
);
create index memory_links_user on public.memory_links (user_id);
create index memory_links_target on public.memory_links (target_id);
alter table public.memory_links enable row level security;
create policy "ligações: ler as suas" on public.memory_links for select to authenticated using (user_id = (select auth.uid()));
create policy "ligações: criar as suas" on public.memory_links for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.memories m where m.id = source_id and m.user_id = (select auth.uid()))
  and exists (select 1 from public.memories m where m.id = target_id and m.user_id = (select auth.uid())));
create policy "ligações: mudar as suas" on public.memory_links for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "ligações: apagar as suas" on public.memory_links for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- chaves da Capri (só o hash SHA-256 fica guardado) ----------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Capri' check (char_length(name) between 1 and 60),
  key_prefix text not null check (char_length(key_prefix) <= 16),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_user on public.api_keys (user_id);
alter table public.api_keys enable row level security;
create policy "chaves: ler as suas" on public.api_keys for select to authenticated using (user_id = (select auth.uid()));
create policy "chaves: criar as suas" on public.api_keys for insert to authenticated with check (user_id = (select auth.uid()));
create policy "chaves: revogar as suas" on public.api_keys for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "chaves: apagar as suas" on public.api_keys for delete to authenticated using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.memories, public.memory_links;

-- ---------- funções da Capri (só o service_role, usado pela função capri-brain, pode chamar) ----------
create or replace function public.brain_category(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p in ('sobre-voce','gostos','pessoas','conversas','sentimentos','planos','rotina','jogos','leituras','musica','capri','outros') then p else 'outros' end
$$;

create or replace function public.brain_title(p_title text, p_content text) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(coalesce(
    nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), ''),
    case when char_length(p_content) <= 60 then p_content
         else coalesce(nullif(regexp_replace(left(p_content, 61), '\s+\S*$', ''), ''), left(p_content, 60)) end)), 120)
$$;

create or replace function public.brain_user_for_key(p_hash text) returns uuid
language plpgsql set search_path = '' as $$
declare v_user uuid; v_id uuid; v_used timestamptz;
begin
  select k.user_id, k.id, k.last_used_at into v_user, v_id, v_used
  from public.api_keys k where k.key_hash = p_hash and k.revoked_at is null limit 1;
  if v_id is not null and (v_used is null or v_used < now() - interval '1 minute') then
    update public.api_keys set last_used_at = now() where id = v_id;
  end if;
  return v_user;
end $$;

create or replace function public.brain_find(p_user uuid, p_ref text) returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid;
begin
  if p_ref is null or btrim(p_ref) = '' then return null; end if;
  if p_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select m.id into v from public.memories m where m.id = p_ref::uuid and m.user_id = p_user;
    if v is not null then return v; end if;
  end if;
  select m.id into v from public.memories m where m.user_id = p_user and lower(m.title) = lower(btrim(p_ref)) limit 1;
  return v;
end $$;

create or replace function public.brain_link(p_user uuid, p_from text, p_to text, p_relation text, p_auto boolean default false) returns boolean
language plpgsql set search_path = '' as $$
declare a uuid := public.brain_find(p_user, p_from); b uuid := public.brain_find(p_user, p_to);
begin
  if a is null or b is null or a = b then return false; end if;
  if exists (select 1 from public.memory_links l where l.source_id = b and l.target_id = a) then
    if not p_auto then update public.memory_links set relation = left(coalesce(nullif(btrim(p_relation), ''), relation), 60), auto = false where source_id = b and target_id = a; end if;
    return true;
  end if;
  insert into public.memory_links (user_id, source_id, target_id, relation, auto)
  values (p_user, a, b, left(coalesce(nullif(btrim(p_relation), ''), 'relacionado'), 60), p_auto)
  on conflict (source_id, target_id) do update set relation = case when p_auto then public.memory_links.relation else excluded.relation end,
    auto = public.memory_links.auto and p_auto;
  return true;
end $$;

-- Guarda uma coisa que ela aprendeu: mesmo título (ou texto quase igual na mesma categoria) atualiza a bolinha que já existe;
-- depois liga sozinha às 3 bolinhas mais parecidas.
create or replace function public.brain_remember(p_user uuid, p_content text, p_title text default null, p_category text default null,
  p_importance int default 3, p_tags text[] default '{}', p_source text default 'capri', p_happened timestamptz default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_content text := left(btrim(regexp_replace(coalesce(p_content, ''), '\s+', ' ', 'g')), 4000);
  v_title text;
  v_cat text := public.brain_category(p_category);
  v_imp smallint := greatest(1, least(5, coalesce(p_importance, 3)));
  v_tags text[];
  v_id uuid;
  v_created boolean := false;
  v_linked int := 0;
begin
  if v_content = '' then raise exception 'conteúdo vazio'; end if;
  v_title := public.brain_title(p_title, v_content);
  select coalesce(array_agg(t), '{}') into v_tags from (
    select distinct left(lower(btrim(x)), 40) as t from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> '' limit 12) s;

  select m.id into v_id from public.memories m where m.user_id = p_user and lower(m.title) = lower(v_title) limit 1;
  if v_id is null then
    select m.id into v_id from public.memories m
    where m.user_id = p_user and m.category = v_cat and extensions.similarity(m.content, v_content) >= 0.8
    order by extensions.similarity(m.content, v_content) desc limit 1;
  end if;

  if v_id is null then
    insert into public.memories (user_id, title, content, category, importance, tags, source, happened_at)
    values (p_user, v_title, v_content, v_cat, v_imp, v_tags, left(coalesce(nullif(btrim(p_source), ''), 'capri'), 40), p_happened)
    returning id into v_id;
    v_created := true;
  else
    update public.memories m set
      content = v_content,
      importance = greatest(m.importance, v_imp),
      tags = (select coalesce(array_agg(t), '{}') from (select distinct t from unnest(m.tags || v_tags) t limit 12) s),
      mentions = m.mentions + 1,
      happened_at = coalesce(p_happened, m.happened_at)
    where m.id = v_id
    returning m.title, m.category into v_title, v_cat;
  end if;

  insert into public.memory_links (user_id, source_id, target_id, relation, strength, auto)
  select p_user, v_id, o.id, 'relacionado', o.score::real, true
  from (
    select m.id, greatest(extensions.similarity(m.content, v_content), extensions.similarity(m.title, v_title),
             case when cardinality(v_tags) > 0 and m.tags && v_tags then 0.35 else 0 end) as score
    from public.memories m
    where m.user_id = p_user and m.id <> v_id
  ) o
  where o.score >= 0.3
    and not exists (select 1 from public.memory_links l where (l.source_id = v_id and l.target_id = o.id) or (l.source_id = o.id and l.target_id = v_id))
  order by o.score desc
  limit 3
  on conflict do nothing;
  get diagnostics v_linked = row_count;

  return jsonb_build_object('id', v_id, 'title', v_title, 'category', v_cat, 'created', v_created, 'linked', v_linked);
end $$;

create or replace function public.brain_shape(m public.memories) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'title', m.title, 'content', m.content, 'category', m.category, 'importance', m.importance,
    'tags', to_jsonb(m.tags), 'updated_at', m.updated_at)
$$;

-- O que ela sabe sobre o que ele acabou de dizer: busca por palavras (português, OU entre as palavras) + parecença do texto
-- + importância + um empurrãozinho para o que é recente.
create or replace function public.brain_recall(p_user uuid, p_query text, p_limit int default 8, p_category text default null) returns jsonb
language plpgsql set search_path = '' as $$
declare
  q tsquery;
  v_query text := left(btrim(coalesce(p_query, '')), 500);
  v jsonb;
  v_ids uuid[];
begin
  if v_query = '' then return '[]'::jsonb; end if;
  begin
    q := replace(plainto_tsquery('portuguese', v_query)::text, '&', '|')::tsquery;
    if numnode(q) = 0 then q := null; end if;
  exception when others then q := null;
  end;
  with ranked as (
    select m as mem, m.id as id, (case when q is not null then ts_rank(m.search, q) else 0 end) * 2
             + greatest(extensions.similarity(m.title, v_query), extensions.similarity(m.content, v_query))
             + m.importance * 0.05
             + case when m.updated_at > now() - interval '7 days' then 0.05 else 0 end as score
    from public.memories m
    where m.user_id = p_user
      and (p_category is null or m.category = p_category)
      and ((q is not null and m.search @@ q) or extensions.similarity(m.title, v_query) > 0.12 or extensions.similarity(m.content, v_query) > 0.12)
    order by score desc
    limit greatest(1, least(30, coalesce(p_limit, 8)))
  )
  select coalesce(jsonb_agg(public.brain_shape(r.mem) || jsonb_build_object('related', (
           select coalesce(jsonb_agg(x.title), '[]'::jsonb) from (
             select m2.title from public.memory_links l
             join public.memories m2 on m2.id = case when l.source_id = r.id then l.target_id else l.source_id end
             where l.source_id = r.id or l.target_id = r.id
             order by l.strength desc limit 5) x)) order by r.score desc), '[]'::jsonb),
         array_agg(r.id)
  into v, v_ids
  from ranked r;
  if v_ids is not null then
    update public.memories set recall_count = recall_count + 1, last_recalled_at = now() where id = any(v_ids);
  end if;
  return v;
end $$;

create or replace function public.brain_core(p_user uuid, p_limit int default 30) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.brain_shape(m) order by m.importance desc, m.updated_at desc), '[]'::jsonb)
  from (select * from public.memories where user_id = p_user and importance >= 4
        order by importance desc, updated_at desc limit greatest(1, least(60, coalesce(p_limit, 30)))) m
$$;

create or replace function public.brain_recent(p_user uuid, p_limit int default 20, p_category text default null) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.brain_shape(m) order by m.updated_at desc), '[]'::jsonb)
  from (select * from public.memories where user_id = p_user and (p_category is null or category = p_category)
        order by updated_at desc limit greatest(1, least(100, coalesce(p_limit, 20)))) m
$$;

create or replace function public.brain_forget(p_user uuid, p_ref text) returns int
language plpgsql set search_path = '' as $$
declare v uuid := public.brain_find(p_user, p_ref); n int;
begin
  if v is null then return 0; end if;
  delete from public.memories where id = v and user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.brain_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', (select display_name from public.profiles where id = p_user),
    'email', (select email from auth.users where id = p_user),
    'memories', (select count(*) from public.memories where user_id = p_user),
    'links', (select count(*) from public.memory_links where user_id = p_user))
$$;

create or replace function public.brain_categories(p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  with labels(id, label, ord) as (values
    ('sobre-voce','Sobre você',1),('gostos','Gostos',2),('pessoas','Pessoas',3),('conversas','Conversas',4),('sentimentos','Sentimentos',5),
    ('planos','Planos e promessas',6),('rotina','Rotina',7),('jogos','Jogos',8),('leituras','Leituras',9),('musica','Música',10),
    ('capri','Sobre a Capri',11),('outros','Outros',12))
  select jsonb_agg(jsonb_build_object('id', l.id, 'label', l.label, 'count',
    (select count(*) from public.memories m where m.user_id = p_user and m.category = l.id)) order by l.ord)
  from labels l
$$;

-- "Organizar" no site: liga as bolinhas parecidas que ainda não estão ligadas (só as do próprio usuário, pelo RLS).
create or replace function public.organize_my_brain() returns jsonb
language plpgsql set search_path = '' as $$
declare v_user uuid := auth.uid(); v_links int := 0;
begin
  if v_user is null then raise exception 'entre na sua conta'; end if;
  perform set_config('pg_trgm.similarity_threshold', '0.3', true);
  insert into public.memory_links (user_id, source_id, target_id, relation, strength, auto)
  select distinct on (least(a.id, b.id), greatest(a.id, b.id)) v_user, least(a.id, b.id), greatest(a.id, b.id), 'relacionado', b.s::real, true
  from public.memories a
  cross join lateral (
    select m.id, greatest(extensions.similarity(m.content, a.content), extensions.similarity(m.title, a.title)) as s
    from public.memories m
    where m.user_id = v_user and m.id <> a.id
      and (m.content operator(extensions.%) a.content or m.title operator(extensions.%) a.title or (cardinality(a.tags) > 0 and m.tags && a.tags))
    order by s desc limit 3) b
  where a.user_id = v_user
    and not exists (select 1 from public.memory_links l where (l.source_id = a.id and l.target_id = b.id) or (l.source_id = b.id and l.target_id = a.id))
  on conflict do nothing;
  get diagnostics v_links = row_count;
  return jsonb_build_object('links', v_links);
end $$;

revoke execute on function public.brain_user_for_key(text), public.brain_find(uuid, text), public.brain_link(uuid, text, text, text, boolean),
  public.brain_remember(uuid, text, text, text, int, text[], text, timestamptz), public.brain_recall(uuid, text, int, text),
  public.brain_core(uuid, int), public.brain_recent(uuid, int, text), public.brain_forget(uuid, text), public.brain_stats(uuid),
  public.brain_categories(uuid), public.brain_shape(public.memories), public.brain_title(text, text)
  from public, anon, authenticated;
grant execute on function public.brain_user_for_key(text), public.brain_find(uuid, text), public.brain_link(uuid, text, text, text, boolean),
  public.brain_remember(uuid, text, text, text, int, text[], text, timestamptz), public.brain_recall(uuid, text, int, text),
  public.brain_core(uuid, int), public.brain_recent(uuid, int, text), public.brain_forget(uuid, text), public.brain_stats(uuid),
  public.brain_categories(uuid), public.brain_shape(public.memories), public.brain_title(text, text)
  to service_role;
revoke execute on function public.organize_my_brain() from public, anon;
grant execute on function public.organize_my_brain() to authenticated;
revoke execute on function public.handle_new_user(), public.memories_touch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 26/11: conhecimento do básico ao especialista (migrações "conhecimento_niveis_assuntos" e "assunto_sem_acento",
-- guardadas no histórico de migrações do projeto). Resumo do que mudou:
--   memories.level  smallint 1..5 (1 Básico, 2 Elementar, 3 Intermediário, 4 Avançado, 5 Especialista), nulo = não é estudo
--   memories.topic  text até 80 (o assunto); índice (user_id, brain_topic_key(topic))
--   categorias novas: conhecimento, ciencia, tecnologia, matematica, idiomas, historia, arte, saude, habilidades;
--     brain_category() entende sinônimos ("biologia" -> ciencia, "programacao" -> tecnologia...)
--   brain_topic_key(): assunto sem acento e sem maiúsculas, para "fotossintese" e "Fotossíntese" serem o mesmo
--   memories_topiclink() (security definer, gatilhos memories_topic_new / memories_topic_change): cada memória de um
--     assunto se liga ao degrau de baixo ("aprofunda"), ao de cima ("base para") e a até duas do mesmo nível
--     ("mesmo assunto")
--   brain_remember(..., p_level, p_topic): junta o assunto com a grafia que já existe; brain_shape devolve level e topic
--   brain_core: só o que é sobre vocês (o conhecimento não entra em toda conversa)
--   brain_topics(p_user, p_limit): assuntos com a contagem por nível; brain_stats ganhou knowledge e topics
--   memories_touch: o assunto entra na busca; grant execute em brain_words para authenticated (criar e editar pelo
--     site falhava com "permission denied for function brain_words")

-- 26/11 (noite): isolamento por usuário (migração "isolamento_por_usuario"). Cada conta tem o seu cérebro:
--   anon sem acesso a tabela nenhuma; authenticated sem truncate/references/trigger; o que for criado no futuro já
--   nasce sem permissão para anon/authenticated (default privileges);
--   pelo site só dá para mudar: api_keys (name, revoked_at), memory_links (relation, strength), profiles (display_name);
--   memory_links_guard: ligação só entre duas memórias do mesmo dono da ligação (vale para site, API e gatilhos);
--   memories_owner_fixed: uma memória não muda de dono;
--   brain_recall: os títulos ligados também filtrados pelo dono; organize_my_brain sem acesso para anon.
