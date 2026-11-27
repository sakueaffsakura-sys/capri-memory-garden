-- As funções do cérebro passam a entender tipo, força, revisão e esquecidas.

create or replace function public.brain_shape(m public.memories)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'title', m.title, 'content', m.content, 'category', m.category, 'importance', m.importance,
    'level', m.level, 'topic', m.topic, 'tags', to_jsonb(m.tags), 'kind', m.kind,
    'retention', round(public.brain_retention(m.strength, m.fresh_at)::numeric, 2), 'updated_at', m.updated_at)
$$;

drop function if exists public.brain_remember(uuid, text, text, text, integer, text[], text, timestamptz, integer, text);
create or replace function public.brain_remember(p_user uuid, p_content text, p_title text default null, p_category text default null,
  p_importance integer default 3, p_tags text[] default '{}', p_source text default 'capri', p_happened timestamptz default null,
  p_level integer default null, p_topic text default null, p_kind text default null, p_question text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_content text := left(btrim(regexp_replace(coalesce(p_content, ''), '\s+', ' ', 'g')), 4000);
  v_title text;
  v_cat text := public.brain_category(p_category);
  v_imp smallint := greatest(1, least(5, coalesce(p_importance, 3)));
  v_level smallint := case when p_level between 1 and 5 then p_level end;
  v_topic text := nullif(left(btrim(regexp_replace(coalesce(p_topic, ''), '\s+', ' ', 'g')), 80), '');
  v_kind text := case when p_kind in ('fato', 'conhecimento', 'habilidade', 'episodio') then p_kind end;
  v_q text := nullif(left(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g')), 300), '');
  v_known text; v_tags text[]; v_id uuid; v_twin uuid; v_created boolean := false; v_merged boolean := false;
begin
  if v_content = '' then raise exception 'conteúdo vazio'; end if;
  if v_q is not null and char_length(v_q) < 3 then v_q := null; end if;
  v_title := public.brain_title(p_title, v_content);
  if v_topic is not null then
    select m.topic into v_known from public.memories m
    where m.user_id = p_user and public.brain_topic_key(m.topic) = public.brain_topic_key(v_topic)
    order by m.created_at limit 1;
    v_topic := coalesce(v_known, upper(left(v_topic, 1)) || substr(v_topic, 2));
  end if;
  select coalesce(array_agg(t), '{}') into v_tags from (
    select distinct left(lower(btrim(x)), 40) as t from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> '' limit 12) s;
  select m.id into v_id from public.memories m where m.user_id = p_user and lower(m.title) = lower(v_title) limit 1;
  if v_id is null then
    insert into public.memories (user_id, title, content, category, importance, tags, source, happened_at, level, topic, kind, question)
    values (p_user, v_title, v_content, v_cat, v_imp, v_tags, left(coalesce(nullif(btrim(p_source), ''), 'capri'), 40), p_happened, v_level, v_topic, v_kind, v_q)
    returning id into v_id;
    v_created := true;
    v_twin := public.brain_twin(p_user, v_id);
    if v_twin is not null then
      -- Fica a mais completa; a outra entra nela.
      if (select char_length(content) from public.memories where id = v_twin) >= char_length(v_content) then
        perform public.brain_merge(p_user, v_twin, array[v_id]); v_id := v_twin;
      else
        perform public.brain_merge(p_user, v_id, array[v_twin]);
      end if;
      -- Ouvir de novo é lembrar de novo: a memória fica mais forte.
      update public.memories set mentions = mentions + 1, strength = least(3650, strength * 1.5), fresh_at = now(), archived = false where id = v_id;
      v_created := false; v_merged := true;
    end if;
  else
    update public.memories m set
      content = case when char_length(v_content) >= char_length(m.content) then v_content else m.content end,
      importance = greatest(m.importance, v_imp),
      tags = (select coalesce(array_agg(t), '{}') from (select distinct t from unnest(m.tags || v_tags) t limit 12) s),
      mentions = m.mentions + 1,
      happened_at = coalesce(p_happened, m.happened_at),
      level = greatest(m.level, v_level),
      topic = coalesce(m.topic, v_topic),
      question = coalesce(m.question, v_q),
      strength = least(3650, m.strength * 1.5), fresh_at = now(), archived = false
    where m.id = v_id;
  end if;
  return (select jsonb_build_object('id', m.id, 'title', m.title, 'category', m.category, 'level', m.level, 'topic', m.topic, 'kind', m.kind,
      'created', v_created, 'merged', v_merged, 'linked', public.brain_autolink(p_user, v_id))
    from public.memories m where m.id = v_id);
end $$;
revoke all on function public.brain_remember(uuid, text, text, text, integer, text[], text, timestamptz, integer, text, text, text) from public, anon, authenticated;

-- Ao juntar, a que fica herda também a força, as revisões e o histórico.
create or replace function public.brain_merge(p_user uuid, p_keep uuid, p_drop uuid[])
returns integer language plpgsql set search_path = '' as $$
declare v_drop uuid[]; n int;
begin
  select coalesce(array_agg(id), '{}') into v_drop from public.memories
  where user_id = p_user and id = any(p_drop) and id <> p_keep;
  if cardinality(v_drop) = 0 or not exists (select 1 from public.memories where id = p_keep and user_id = p_user) then return 0; end if;
  insert into public.memory_links (user_id, source_id, target_id, relation, strength, auto)
  select distinct on (o) p_user, p_keep, o, l.relation, l.strength, l.auto from (
    select case when l.source_id = any(v_drop) then l.target_id else l.source_id end as o, l.relation, l.strength, l.auto
    from public.memory_links l where l.user_id = p_user and (l.source_id = any(v_drop) or l.target_id = any(v_drop))) l
  where o <> p_keep and not (o = any(v_drop))
    and not exists (select 1 from public.memory_links x where (x.source_id = p_keep and x.target_id = o) or (x.source_id = o and x.target_id = p_keep))
  on conflict do nothing;
  update public.reviews set memory_id = p_keep where user_id = p_user and memory_id = any(v_drop);
  update public.memories k set
    importance = greatest(k.importance, (select max(importance) from public.memories where id = any(v_drop))),
    mentions = k.mentions + (select coalesce(sum(mentions), 0) from public.memories where id = any(v_drop)),
    recall_count = k.recall_count + (select coalesce(sum(recall_count), 0) from public.memories where id = any(v_drop)),
    reviews = k.reviews + (select coalesce(sum(reviews), 0) from public.memories where id = any(v_drop)),
    strength = greatest(k.strength, (select max(strength) from public.memories where id = any(v_drop))),
    fresh_at = greatest(k.fresh_at, (select max(fresh_at) from public.memories where id = any(v_drop))),
    question = coalesce(k.question, (select max(question) from public.memories where id = any(v_drop))),
    archived = k.archived and not exists (select 1 from public.memories where id = any(v_drop) and not archived),
    tags = (select coalesce(array_agg(t), '{}') from (select distinct t from unnest(k.tags || (select coalesce(array_agg(x), '{}') from public.memories d, unnest(d.tags) x where d.id = any(v_drop))) t limit 12) s),
    level = coalesce(greatest(k.level, (select max(level) from public.memories where id = any(v_drop))), k.level),
    topic = coalesce(k.topic, (select max(topic) from public.memories where id = any(v_drop)))
  where k.id = p_keep and k.user_id = p_user;
  delete from public.memories where user_id = p_user and id = any(v_drop);
  get diagnostics n = row_count;
  return n;
end $$;

-- Buscar também é lembrar: o que ela achou fica mais forte, e uma esquecida volta para o céu.
create or replace function public.brain_recall(p_user uuid, p_query text, p_limit integer default 8, p_category text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  q tsquery;
  v_query text := left(btrim(coalesce(p_query, '')), 500);
  v jsonb;
  v_ids uuid[];
begin
  if p_user is null or v_query = '' then return '[]'::jsonb; end if;
  begin
    q := replace(plainto_tsquery('portuguese', v_query)::text, '&', '|')::tsquery;
    if numnode(q) = 0 then q := null; end if;
  exception when others then q := null;
  end;
  with ranked as (
    select m as mem, m.id as id, ((case when q is not null then ts_rank(m.search, q) else 0 end) * 2
             + greatest(extensions.similarity(m.title, v_query), extensions.similarity(m.content, v_query))
             + m.importance * 0.05
             + case when m.kind in ('fato', 'conhecimento', 'habilidade') then 0.06 else 0 end
             + case when m.updated_at > now() - interval '7 days' then 0.05 else 0 end)
             * case when m.archived then 0.6 else 1 end as score
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
             where (l.source_id = r.id or l.target_id = r.id) and l.user_id = p_user and m2.user_id = p_user
             order by l.strength desc limit 5) x)) order by r.score desc), '[]'::jsonb),
         array_agg(r.id)
  into v, v_ids
  from ranked r;
  if v_ids is not null then
    update public.memories set recall_count = recall_count + 1, last_recalled_at = now() where id = any(v_ids) and user_id = p_user;
    perform public.brain_strengthen(p_user, v_ids, 1.3);
  end if;
  return v;
end $$;

-- O essencial para ela ter sempre em mente: o que ela sabe de vocês (fatos), os mais importantes e firmes primeiro.
create or replace function public.brain_core(p_user uuid, p_limit integer default 30)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.brain_shape(m) order by m.importance desc, m.strength desc, m.updated_at desc), '[]'::jsonb)
  from (select * from public.memories where user_id = p_user and not archived and kind = 'fato' and importance >= 3
        order by importance desc, strength desc, updated_at desc limit greatest(1, least(60, coalesce(p_limit, 30)))) m
$$;

create or replace function public.brain_stats(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', (select display_name from public.profiles where id = p_user),
    'email', (select email from auth.users where id = p_user),
    'memories', (select count(*) from public.memories where user_id = p_user),
    'links', (select count(*) from public.memory_links where user_id = p_user),
    'knowledge', (select count(*) from public.memories where user_id = p_user and kind in ('conhecimento', 'habilidade')),
    'facts', (select count(*) from public.memories where user_id = p_user and kind = 'fato'),
    'episodes', (select count(*) from public.memories where user_id = p_user and kind = 'episodio' and not archived),
    'forgotten', (select count(*) from public.memories where user_id = p_user and archived),
    'due', (select count(*) from public.memories where user_id = p_user and not archived and due_at <= now()),
    'goals', (select count(*) from public.goals where user_id = p_user and status = 'ativa'),
    'topics', (select count(distinct public.brain_topic_key(topic)) from public.memories where user_id = p_user and topic is not null))
$$;
revoke all on function public.brain_stats(uuid) from public, anon, authenticated;

create or replace function public.organize_my_brain()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_links int := 0; v_merged int; v_faded int; r record;
begin
  if v_user is null then raise exception 'entre na sua conta'; end if;
  v_merged := public.brain_consolidate(v_user);
  for r in select id from public.memories where user_id = v_user order by created_at loop
    v_links := v_links + public.brain_autolink(v_user, r.id);
  end loop;
  v_faded := public.brain_maintain(v_user);
  return jsonb_build_object('links', v_links, 'merged', v_merged, 'faded', v_faded);
end $$;

-- Só junta memórias do mesmo tipo: um fato limpo não some dentro do episódio de onde saiu.
create or replace function public.brain_twin(p_user uuid, p_id uuid)
returns uuid language sql stable set search_path = '' as $$
  select o.id from public.memories me, public.memories o
  where me.id = p_id and me.user_id = p_user and o.user_id = p_user and o.id <> me.id
    and (o.level is null) = (me.level is null)
    and o.kind = me.kind and o.archived = me.archived
    and (public.brain_overlap(me.words, o.words) >= 0.8 or extensions.similarity(me.content, o.content) >= 0.7)
  order by greatest(public.brain_overlap(me.words, o.words), extensions.similarity(me.content, o.content)) desc, char_length(o.content) desc
  limit 1
$$;

-- Trocar o tipo de uma memória recomeça a força do jeito daquele tipo: virou estudo, começa a ser revisada do zero;
-- virou fato, fica firme; virou diário, volta a enfraquecer como episódio.
create or replace function public.memories_learning()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.kind := coalesce(new.kind, public.brain_kind(new.category, new.level, new.source, new.title, new.content));
    if new.strength = 7 then new.strength := public.brain_first_strength(new.kind, new.importance); end if;
    new.fresh_at := coalesce(new.fresh_at, now());
    if new.kind in ('conhecimento', 'habilidade') or new.question is not null then
      new.due_at := coalesce(new.due_at, now() + interval '1 day');
    end if;
  else
    if new.level is not null and old.level is null and new.kind is not distinct from old.kind and old.kind not in ('conhecimento', 'habilidade') then
      new.kind := 'conhecimento';
    end if;
    if new.kind is distinct from old.kind then
      if new.kind in ('conhecimento', 'habilidade') and old.kind not in ('conhecimento', 'habilidade') then
        new.strength := 1; new.ease := 2.5; new.reviews := 0; new.lapses := 0; new.due_at := now() + interval '1 day';
        new.fresh_at := now(); new.archived := false;
      elsif new.kind = 'fato' then
        new.strength := greatest(new.strength, public.brain_first_strength('fato', new.importance));
        new.fresh_at := now(); new.archived := false;
        if new.question is null then new.due_at := null; end if;
      elsif new.kind = 'episodio' then
        new.strength := public.brain_first_strength('episodio', new.importance); new.due_at := null; new.fresh_at := now();
      end if;
    end if;
    if new.question is not null and new.due_at is null then new.due_at := now() + interval '1 day'; end if;
  end if;
  if new.kind is null then new.kind := 'fato'; end if;
  return new;
end $$;
revoke all on function public.memories_learning() from public, anon, authenticated;
