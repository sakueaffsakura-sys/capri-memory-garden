-- Cérebro da Capri: reflexão, perfil consolidado e uma busca mais esperta.
-- brain_state: um por conta. O que ela entendeu de vocês depois de refletir sobre as memórias: o perfil da pessoa,
-- como ela quer ser tratada (regras), a relação, o que a Capri aprendeu sobre si e os assuntos em aberto.
-- reflections: o registro de cada reflexão (o que leu, juntou, arquivou e acrescentou).
-- brain_recall passa a ignorar acentos, entende quando ("ontem", "semana passada"...) e dá preferência ao que é sobre a
-- pessoa quando a pergunta é pessoal.

create extension if not exists unaccent with schema extensions;

create or replace function public.brain_fold(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')))
$$;

create table if not exists public.brain_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  perfil text not null default '',
  regras text not null default '',
  relacao text not null default '',
  eu text not null default '',
  pendentes text not null default '',
  reflections integer not null default 0,
  reflected_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint brain_state_tamanhos check (length(perfil) <= 6000 and length(regras) <= 3000 and length(relacao) <= 3000
    and length(eu) <= 3000 and length(pendentes) <= 3000)
);
alter table public.brain_state enable row level security;
drop policy if exists "estado: dono lê" on public.brain_state;
drop policy if exists "estado: dono cria" on public.brain_state;
drop policy if exists "estado: dono edita" on public.brain_state;
create policy "estado: dono lê" on public.brain_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "estado: dono cria" on public.brain_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "estado: dono edita" on public.brain_state for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.brain_state to authenticated;

create or replace function public.brain_state_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists brain_state_touch on public.brain_state;
create trigger brain_state_touch before update on public.brain_state for each row execute function public.brain_state_touch();

create table if not exists public.reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  summary text not null default '',
  seen integer not null default 0,
  added integer not null default 0,
  archived integer not null default 0,
  merged integer not null default 0,
  constraint reflections_resumo check (length(summary) <= 2000)
);
create index if not exists reflections_user_created on public.reflections (user_id, created_at desc);
alter table public.reflections enable row level security;
drop policy if exists "reflexões: dono lê" on public.reflections;
create policy "reflexões: dono lê" on public.reflections for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.reflections to authenticated;

-- Por que uma memória foi arquivada pela reflexão (ficou velha, outra a corrigiu...).
alter table public.memories add column if not exists archived_reason text;
alter table public.memories drop constraint if exists memories_archived_reason_size;
alter table public.memories add constraint memories_archived_reason_size check (archived_reason is null or length(archived_reason) <= 300);

-- O estado do cérebro, já com o que chegou desde a última reflexão.
create or replace function public.brain_state_get(p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'perfil', coalesce(s.perfil, ''), 'regras', coalesce(s.regras, ''), 'relacao', coalesce(s.relacao, ''),
    'eu', coalesce(s.eu, ''), 'pendentes', coalesce(s.pendentes, ''), 'reflections', coalesce(s.reflections, 0),
    'reflected_at', s.reflected_at,
    'new_since', (select count(*) from public.memories m where m.user_id = p_user and not m.archived
                    and m.created_at > coalesce(s.reflected_at, '-infinity'::timestamptz)),
    'memories', (select count(*) from public.memories m where m.user_id = p_user and not m.archived))
  from (select 1) one left join public.brain_state s on s.user_id = p_user
$$;

-- O que a reflexão lê: o estado, o que é novo desde a última e todos os fatos ativos (com id, para arquivar ou juntar).
create or replace function public.brain_reflect_input(p_user uuid, p_new integer default 60, p_facts integer default 140) returns jsonb
language sql stable set search_path = '' as $$
  with st as (select reflected_at from public.brain_state where user_id = p_user)
  select jsonb_build_object(
    'state', public.brain_state_get(p_user),
    'new', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'category', m.category, 'importance', m.importance,
                'title', m.title, 'content', left(m.content, 600), 'when', coalesce(m.happened_at, m.created_at)) order by m.created_at)
              from (select * from public.memories m where m.user_id = p_user and not m.archived
                      and m.created_at > coalesce((select reflected_at from st), '-infinity'::timestamptz)
                    order by m.created_at desc limit greatest(1, least(120, coalesce(p_new, 60)))) m), '[]'::jsonb),
    'facts', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'category', f.category, 'importance', f.importance,
                'title', f.title, 'content', left(f.content, 300), 'updated', f.updated_at) order by f.importance desc, f.updated_at desc)
              from (select * from public.memories f where f.user_id = p_user and not f.archived and f.kind = 'fato'
                    order by f.importance desc, f.updated_at desc limit greatest(1, least(300, coalesce(p_facts, 140)))) f), '[]'::jsonb))
$$;

-- Guarda o que a reflexão concluiu: o estado novo, as memórias que ficaram velhas (arquivadas com o motivo) e o registro.
create or replace function public.brain_reflect_apply(p_user uuid, p_state jsonb, p_archive jsonb, p_summary text,
  p_seen integer, p_added integer, p_merged integer) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_archived int := 0;
  a jsonb;
  v_id uuid;
begin
  if p_user is null then return '{}'::jsonb; end if;
  insert into public.brain_state as s (user_id, perfil, regras, relacao, eu, pendentes, reflections, reflected_at)
  values (p_user, left(coalesce(p_state->>'perfil', ''), 6000), left(coalesce(p_state->>'regras', ''), 3000),
          left(coalesce(p_state->>'relacao', ''), 3000), left(coalesce(p_state->>'eu', ''), 3000),
          left(coalesce(p_state->>'pendentes', ''), 3000), 1, now())
  on conflict (user_id) do update set
    perfil = case when p_state ? 'perfil' then left(coalesce(p_state->>'perfil', ''), 6000) else s.perfil end,
    regras = case when p_state ? 'regras' then left(coalesce(p_state->>'regras', ''), 3000) else s.regras end,
    relacao = case when p_state ? 'relacao' then left(coalesce(p_state->>'relacao', ''), 3000) else s.relacao end,
    eu = case when p_state ? 'eu' then left(coalesce(p_state->>'eu', ''), 3000) else s.eu end,
    pendentes = case when p_state ? 'pendentes' then left(coalesce(p_state->>'pendentes', ''), 3000) else s.pendentes end,
    reflections = s.reflections + 1,
    reflected_at = now();
  if jsonb_typeof(p_archive) = 'array' then
    for a in select * from jsonb_array_elements(p_archive) limit 25 loop
      begin v_id := (a->>'id')::uuid; exception when others then continue; end;
      update public.memories set archived = true, archived_reason = left(nullif(btrim(coalesce(a->>'reason', '')), ''), 300)
      where id = v_id and user_id = p_user and not archived and kind in ('fato', 'episodio');
      if found then v_archived := v_archived + 1; end if;
    end loop;
  end if;
  insert into public.reflections (user_id, summary, seen, added, archived, merged)
  values (p_user, left(coalesce(p_summary, ''), 2000), coalesce(p_seen, 0), coalesce(p_added, 0), v_archived, coalesce(p_merged, 0));
  return jsonb_build_object('archived', v_archived, 'state', public.brain_state_get(p_user));
end $$;

-- Só a parte que a Capri escreveu (perfil, regras...) sem contar como reflexão: quando ela aprende uma regra na hora.
create or replace function public.brain_state_set(p_user uuid, p_state jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  if p_user is null then return '{}'::jsonb; end if;
  insert into public.brain_state as s (user_id) values (p_user) on conflict (user_id) do nothing;
  update public.brain_state s set
    perfil = case when p_state ? 'perfil' then left(coalesce(p_state->>'perfil', ''), 6000) else s.perfil end,
    regras = case when p_state ? 'regras' then left(coalesce(p_state->>'regras', ''), 3000) else s.regras end,
    relacao = case when p_state ? 'relacao' then left(coalesce(p_state->>'relacao', ''), 3000) else s.relacao end,
    eu = case when p_state ? 'eu' then left(coalesce(p_state->>'eu', ''), 3000) else s.eu end,
    pendentes = case when p_state ? 'pendentes' then left(coalesce(p_state->>'pendentes', ''), 3000) else s.pendentes end
  where s.user_id = p_user;
  return public.brain_state_get(p_user);
end $$;

-- A busca: palavras (com e sem acento), trechos parecidos, quando aconteceu e se a pergunta é sobre a própria pessoa.
create or replace function public.brain_recall(p_user uuid, p_query text, p_limit integer default 8, p_category text default null)
returns jsonb language plpgsql set search_path to '' as $function$
declare
  q tsquery;
  qf tsquery;
  v_query text := left(btrim(coalesce(p_query, '')), 500);
  v_fold text;
  v jsonb;
  v_ids uuid[];
  v_day timestamp;
  v_from timestamptz;
  v_to timestamptz;
  v_personal boolean;
begin
  if p_user is null or v_query = '' then return '[]'::jsonb; end if;
  v_fold := public.brain_fold(v_query);
  begin
    q := replace(plainto_tsquery('portuguese', v_query)::text, '&', '|')::tsquery;
    if numnode(q) = 0 then q := null; end if;
  exception when others then q := null;
  end;
  begin
    qf := replace(plainto_tsquery('portuguese', v_fold)::text, '&', '|')::tsquery;
    if numnode(qf) = 0 then qf := null; end if;
  exception when others then qf := null;
  end;
  -- Quando: hoje, ontem, anteontem, essa semana, semana passada, mês passado (no fuso do Brasil).
  v_day := date_trunc('day', now() at time zone 'America/Sao_Paulo');
  if v_fold ~ '\manteontem\M' then
    v_from := (v_day - interval '2 days') at time zone 'America/Sao_Paulo'; v_to := (v_day - interval '1 day') at time zone 'America/Sao_Paulo';
  elsif v_fold ~ '\m(ontem|yesterday)\M' then
    v_from := (v_day - interval '1 day') at time zone 'America/Sao_Paulo'; v_to := v_day at time zone 'America/Sao_Paulo';
  elsif v_fold ~ '\m(hoje|today|mais cedo|agora ha pouco|hoje cedo)\M' then
    v_from := v_day at time zone 'America/Sao_Paulo'; v_to := now();
  elsif v_fold ~ '(semana passada|ultima semana|last week|essa semana|esta semana|nessa semana|esses dias|outro dia|recentemente|ultimamente)' then
    v_from := now() - interval '9 days'; v_to := now();
  elsif v_fold ~ '(mes passado|ultimo mes|last month|esse mes|este mes)' then
    v_from := now() - interval '45 days'; v_to := now();
  end if;
  v_personal := v_fold ~ '\m(eu|meu|minha|meus|minhas|mim|comigo|gosto|odeio|prefiro|sou|tenho|lembra|lembras|sabe|voce sabe|me conhece|my|mine|i like|do you remember)\M';
  with ranked as (
    select m as mem, m.id as id, (
             (case when q is not null then ts_rank(m.search, q) else 0 end) * 2
             + (case when qf is not null and qf is distinct from q then ts_rank(m.search, qf) else 0 end)
             + greatest(extensions.similarity(public.brain_fold(m.title), v_fold),
                        extensions.word_similarity(v_fold, public.brain_fold(m.content)) * 0.8)
             + m.importance * 0.05
             + case when m.kind in ('fato', 'conhecimento', 'habilidade') then 0.06 else 0 end
             + case when m.updated_at > now() - interval '7 days' then 0.05 else 0 end
             + case when v_from is not null and coalesce(m.happened_at, m.created_at) between v_from and v_to
                    then case when m.kind = 'episodio' then 0.45 else 0.15 end else 0 end
             + case when v_personal and m.category in ('sobre-voce', 'gostos', 'pessoas', 'rotina', 'planos', 'sentimentos') then 0.1 else 0 end
             + case when 'regra' = any(m.tags) then 0.1 else 0 end
           ) * case when m.archived then 0.5 else 1 end as score
    from public.memories m
    where m.user_id = p_user
      and (p_category is null or m.category = p_category)
      and ((q is not null and m.search @@ q)
           or (qf is not null and m.search @@ qf)
           or extensions.similarity(public.brain_fold(m.title), v_fold) > 0.15
           or extensions.word_similarity(v_fold, public.brain_fold(m.content)) > 0.45
           or (v_from is not null and coalesce(m.happened_at, m.created_at) between v_from and v_to and not m.archived))
    order by score desc
    limit greatest(1, least(30, coalesce(p_limit, 8)))
  )
  select coalesce(jsonb_agg(public.brain_shape(r.mem) || jsonb_build_object('when', coalesce((r.mem).happened_at, (r.mem).created_at), 'related', (
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
end $function$;

-- O essencial: regras dela primeiro (o que ele pediu sobre como ela age), depois o resto dos fatos importantes.
create or replace function public.brain_core(p_user uuid, p_limit integer default 30) returns jsonb
language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(public.brain_shape(c.mem) order by c.rule desc, (c.mem).importance desc, (c.mem).strength desc, (c.mem).updated_at desc), '[]'::jsonb)
  from (select x as mem, ('regra' = any(x.tags)) as rule from public.memories x
        where x.user_id = p_user and not x.archived and x.kind = 'fato' and (x.importance >= 3 or 'regra' = any(x.tags))
        order by ('regra' = any(x.tags)) desc, x.importance desc, x.strength desc, x.updated_at desc
        limit greatest(1, least(60, coalesce(p_limit, 30)))) c
$$;

-- As funções do cérebro só pelo servidor (a função de borda), nunca direto pela internet.
revoke execute on function public.brain_state_get(uuid) from public, anon, authenticated;
revoke execute on function public.brain_reflect_input(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.brain_reflect_apply(uuid, jsonb, jsonb, text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.brain_state_set(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.brain_recall(uuid, text, integer, text) from public, anon, authenticated;
revoke execute on function public.brain_core(uuid, integer) from public, anon, authenticated;
grant execute on function public.brain_state_get(uuid) to service_role;
grant execute on function public.brain_reflect_input(uuid, integer, integer) to service_role;
grant execute on function public.brain_reflect_apply(uuid, jsonb, jsonb, text, integer, integer, integer) to service_role;
grant execute on function public.brain_state_set(uuid, jsonb) to service_role;
grant execute on function public.brain_recall(uuid, text, integer, text) to service_role;
grant execute on function public.brain_core(uuid, integer) to service_role;
