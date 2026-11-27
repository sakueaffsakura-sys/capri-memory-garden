-- Memória e aprendizado: o cérebro deixa de ser um arquivo de coisas e passa a lembrar, esquecer e aprender.
--  * Tipo de memória (kind): fato (o que ela sabe de vocês), conhecimento (o que estudou), habilidade (como fazer),
--    episodio (o que aconteceu: o diário).
--  * Força (strength, em dias): quanto tempo a memória aguenta firme. Retenção = 0,9 ^ (dias desde fresh_at / força).
--    Lembrar numa conversa, ouvir de novo e revisar deixam a memória mais forte; o tempo enfraquece.
--  * Revisão espaçada (due_at, ease, reviews, lapses): estudos voltam para revisão no dia certo.
--  * Esquecidas (archived): episódios fracos e sem importância saem do céu, mas nada é apagado. Lembrar traz de volta.
--  * Metas de estudo (goals) e o histórico de revisões (reviews), só do dono.

alter table public.memories
  add column if not exists kind text,
  add column if not exists strength real not null default 7,
  add column if not exists ease real not null default 2.5,
  add column if not exists reviews integer not null default 0,
  add column if not exists lapses integer not null default 0,
  add column if not exists last_review_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists fresh_at timestamptz not null default now(),
  add column if not exists question text,
  add column if not exists archived boolean not null default false;

alter table public.memories
  add constraint memories_kind_ok check (kind in ('fato', 'conhecimento', 'habilidade', 'episodio')),
  add constraint memories_strength_ok check (strength > 0 and strength <= 3650),
  add constraint memories_ease_ok check (ease between 1.3 and 3.5),
  add constraint memories_question_ok check (question is null or char_length(question) between 3 and 300);

-- O tipo de uma memória quando ninguém disse: estudo é conhecimento; nota e o que veio do site é fato; o que conta o
-- que aconteceu na tela ou numa tentativa é episódio.
create or replace function public.brain_kind(p_category text, p_level integer, p_source text, p_title text, p_content text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_category = 'habilidades' then 'habilidade'
    when p_level is not null or public.brain_is_knowledge(p_category) or p_source = 'estudo' then 'conhecimento'
    when p_source in ('notas', 'site', 'leituras', 'jogos', 'conhecer', 'destilado') then 'fato'
    when t ~ '(gosta d|adora|odeia|favorit[oa] d|preferid|prefere|quer que (eu|a capri) aprenda|quer aprender|sonha|trabalha (com|em|na|no)|mora (em|na|no)|se chama|anivers[aá]rio|personalidade|meu jeito)' then 'fato'
    when x ~ '(mostrou|mostrava|mostravam|apareceu|aparecia|apareciam|na tela|janela|cliquei|clicou|\mabri\M|abriu|tentativa|captura de tela|etapa [0-9]|limite de uso|mainframe|file explorer|compil|instalar-|n[aã]o consegui|n[aã]o foi executad)' then 'episodio'
    when p_category in ('conversas', 'capri') then 'episodio'
    else 'fato' end
  from (select lower(coalesce(p_title, '')) as t, lower(coalesce(p_title, '') || ' ' || coalesce(p_content, '')) as x) s
$$;

-- Quanto tempo cada tipo aguenta antes de enfraquecer (força inicial, em dias).
create or replace function public.brain_first_strength(p_kind text, p_importance integer)
returns real language sql immutable set search_path = '' as $$
  select (case p_kind
    when 'fato' then 30 * greatest(1, least(5, coalesce(p_importance, 3)))
    when 'episodio' then 2 * greatest(1, least(5, coalesce(p_importance, 3))) + 1
    else 1 end)::real
$$;

-- 1 = firme como no dia em que aprendeu; perto de 0 = quase esquecida.
create or replace function public.brain_retention(p_strength real, p_fresh timestamptz)
returns real language sql stable set search_path = '' as $$
  select power(0.9, greatest(0, extract(epoch from (now() - coalesce(p_fresh, now()))) / 86400.0) / greatest(0.1, coalesce(p_strength, 1)))::real
$$;

-- Preenche tipo, força e a primeira revisão; e muda para conhecimento quando ganha um nível.
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
    if new.kind is distinct from old.kind and new.kind in ('conhecimento', 'habilidade') and new.due_at is null then
      new.due_at := now() + interval '1 day';
      if old.kind = 'episodio' then new.strength := greatest(1, least(new.strength, 3)); end if;
    end if;
    if new.question is not null and new.due_at is null then new.due_at := now() + interval '1 day'; end if;
    if new.kind = 'fato' and old.kind = 'episodio' then
      new.strength := greatest(new.strength, public.brain_first_strength('fato', new.importance));
      new.fresh_at := now(); new.archived := false;
    end if;
  end if;
  if new.kind is null then new.kind := 'fato'; end if;
  return new;
end $$;

drop trigger if exists memories_learning on public.memories;
create trigger memories_learning before insert or update on public.memories
  for each row execute function public.memories_learning();

-- Quem já estava no cérebro ganha tipo e força pelo que diz e por quanto foi lembrado.
update public.memories m set
  kind = public.brain_kind(m.category, m.level, m.source, m.title, m.content),
  fresh_at = greatest(m.created_at, coalesce(m.last_recalled_at, m.created_at), m.updated_at);
update public.memories m set
  strength = least(3650, public.brain_first_strength(m.kind, m.importance) * power(1.3, least(10, m.recall_count + greatest(0, m.mentions - 1))))::real,
  due_at = case when m.kind in ('conhecimento', 'habilidade') then now() else null end;
alter table public.memories alter column kind set not null;

create index if not exists memories_due on public.memories (user_id, due_at) where due_at is not null and not archived;
create index if not exists memories_kind on public.memories (user_id, kind);

-- ---------- metas de estudo ----------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  topic text not null check (char_length(btrim(topic)) between 1 and 80),
  category text not null default 'conhecimento' check (public.brain_is_knowledge(category)),
  target_level smallint not null default 3 check (target_level between 1 and 5),
  why text check (why is null or char_length(why) <= 400),
  status text not null default 'ativa' check (status in ('sugerida', 'ativa', 'pausada', 'concluida')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create unique index if not exists goals_topic_once on public.goals (user_id, public.brain_topic_key(topic));
alter table public.goals enable row level security;
create policy "metas: ler as suas" on public.goals for select to authenticated using (user_id = (select auth.uid()));
create policy "metas: criar as suas" on public.goals for insert to authenticated with check (user_id = (select auth.uid()));
create policy "metas: mudar as suas" on public.goals for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "metas: apagar as suas" on public.goals for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.goals from anon, public;
grant select, insert, delete on public.goals to authenticated;
grant update (topic, category, target_level, why, status, done_at) on public.goals to authenticated;

create or replace function public.goals_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then raise exception 'uma meta não muda de dono' using errcode = '42501'; end if;
  new.topic := btrim(regexp_replace(new.topic, '\s+', ' ', 'g'));
  new.updated_at := now();
  if new.status = 'concluida' and new.done_at is null then new.done_at := now(); end if;
  if new.status <> 'concluida' then new.done_at := null; end if;
  return new;
end $$;
create trigger goals_touch before insert or update on public.goals for each row execute function public.goals_touch();

-- ---------- histórico de revisões ----------
create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  memory_id uuid not null references public.memories (id) on delete cascade,
  grade smallint not null check (grade between 0 and 3),
  retention real,
  strength real,
  by_capri boolean not null default false,
  reviewed_at timestamptz not null default now()
);
create index if not exists reviews_user_time on public.reviews (user_id, reviewed_at desc);
create index if not exists reviews_memory on public.reviews (memory_id);
alter table public.reviews enable row level security;
create policy "revisões: ler as suas" on public.reviews for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.reviews from anon, public, authenticated;
grant select on public.reviews to authenticated;

-- Uma revisão: 0 errei, 1 difícil, 2 lembrei, 3 fácil. Revisar antes da hora fortalece menos (não adianta decorar de
-- uma vez); errar faz a memória voltar logo.
create or replace function public.brain_review(p_user uuid, p_id uuid, p_grade integer, p_capri boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare m public.memories; r real; s real; e real; g int := greatest(0, least(3, coalesce(p_grade, 2))); due timestamptz; gain real;
begin
  select * into m from public.memories where id = p_id and user_id = p_user for update;
  if not found then return null; end if;
  r := public.brain_retention(m.strength, m.fresh_at);
  e := m.ease; s := m.strength;
  -- quanto mais perto de esquecer, mais a revisão rende
  -- a primeira revisão vale inteira: é ela que fixa o que acabou de aprender
  gain := case when m.reviews = 0 then 1 else least(1, greatest(0.15, (1 - r) / 0.1)) end;
  if g = 0 then
    e := greatest(1.3, e - 0.2); s := greatest(0.3, s * 0.35); due := now() + interval '10 minutes';
  elsif g = 1 then
    e := greatest(1.3, e - 0.15); s := greatest(1, s * (1 + 0.2 * gain));
  elsif g = 2 then
    s := greatest(1, s * (1 + (e - 1) * gain));
  else
    e := least(3.5, e + 0.15); s := greatest(2, s * (1 + (e * 1.3 - 1) * gain));
  end if;
  s := least(3650, s);
  due := coalesce(due, now() + make_interval(secs => s * 86400));
  update public.memories set strength = s, ease = e, reviews = reviews + 1, lapses = lapses + case when g = 0 then 1 else 0 end,
    last_review_at = now(), fresh_at = now(), due_at = due, archived = false
  where id = p_id and user_id = p_user;
  insert into public.reviews (user_id, memory_id, grade, retention, strength, by_capri) values (p_user, p_id, g, r, s, coalesce(p_capri, false));
  return jsonb_build_object('id', p_id, 'grade', g, 'was', round(r::numeric, 3), 'strength', round(s::numeric, 2), 'due_at', due);
end $$;

create or replace function public.review_memory(p_id uuid, p_grade integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'entre na sua conta'; end if;
  return public.brain_review(v_user, p_id, p_grade, false);
end $$;

-- O que está na hora de revisar (os mais esquecidos primeiro).
create or replace function public.brain_due(p_user uuid, p_limit integer default 20)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.brain_shape(m) || jsonb_build_object('question', m.question, 'retention', round(public.brain_retention(m.strength, m.fresh_at)::numeric, 3), 'due_at', m.due_at)
           order by public.brain_retention(m.strength, m.fresh_at)), '[]'::jsonb)
  from (select * from public.memories where user_id = p_user and not archived and due_at is not null and due_at <= now()
        order by public.brain_retention(strength, fresh_at) limit greatest(1, least(100, coalesce(p_limit, 20)))) m
$$;

-- Metas com progresso: quanto de cada nível ela já tem e quão firme está (domínio), e o próximo passo.
create or replace function public.brain_goals(p_user uuid, p_all boolean default false)
returns jsonb language sql stable set search_path = '' as $$
  with g as (
    select g.*, public.brain_topic_key(g.topic) as gk from public.goals g
    where g.user_id = p_user and (p_all or g.status = 'ativa')
  ), hit as (
    select g.id as gid, m.id, m.title, m.level, public.brain_retention(m.strength, m.fresh_at) as ret
    from g join public.memories m on m.user_id = p_user and not m.archived and m.kind in ('conhecimento', 'habilidade')
      and m.topic is not null
      and (public.brain_topic_key(m.topic) = g.gk or position(g.gk in public.brain_topic_key(m.topic)) > 0 or position(public.brain_topic_key(m.topic) in g.gk) > 0)
  ), per as (
    select g.id as gid, l, max(h.ret) filter (where h.level = l) as best, count(h.id) filter (where h.level = l) as n
    from g cross join generate_series(1, 5) l left join hit h on h.gid = g.id group by g.id, l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'topic', g.topic, 'category', g.category, 'target_level', g.target_level, 'why', g.why, 'status', g.status,
    'created_at', g.created_at, 'done_at', g.done_at,
    'notes', (select count(*) from hit where hit.gid = g.id),
    'levels', (select jsonb_agg(coalesce(n, 0) order by l) from per where per.gid = g.id),
    'mastery', coalesce((select round(100 * sum(coalesce(best, 0)) / g.target_level) from per where per.gid = g.id and l <= g.target_level), 0),
    'next_level', (select min(l) from per where per.gid = g.id and l <= g.target_level and coalesce(n, 0) = 0),
    'weakest', (select jsonb_build_object('id', h.id, 'title', h.title, 'level', h.level, 'retention', round(h.ret::numeric, 2)) from hit h where h.gid = g.id order by h.ret limit 1)
  ) order by g.status = 'ativa' desc, g.created_at), '[]'::jsonb)
  from g
$$;

-- O tempo passa: episódios fracos e pouco importantes saem do céu (ficam guardados como esquecidos).
create or replace function public.brain_maintain(p_user uuid)
returns integer language plpgsql set search_path = '' as $$
declare n int;
begin
  update public.memories set archived = true
  where user_id = p_user and not archived and kind = 'episodio' and importance <= 3
    and public.brain_retention(strength, fresh_at) < 0.3;
  get diagnostics n = row_count;
  return n;
end $$;

-- Lembrar numa conversa é um treino: a memória fica mais forte e uma esquecida volta.
create or replace function public.brain_strengthen(p_user uuid, p_ids uuid[], p_factor real default 1.3)
returns void language sql set search_path = '' as $$
  update public.memories set strength = least(3650, strength * p_factor + 0.5), fresh_at = now(), archived = false,
    due_at = case when due_at is not null then greatest(due_at, now() + interval '1 day') end
  where user_id = p_user and id = any(p_ids)
$$;

-- Funções internas: só o servidor (a função capri-brain) usa.
revoke all on function public.brain_review(uuid, uuid, integer, boolean), public.brain_due(uuid, integer), public.brain_goals(uuid, boolean),
  public.brain_maintain(uuid), public.brain_strengthen(uuid, uuid[], real) from public, anon, authenticated;
revoke all on function public.review_memory(uuid, integer) from public, anon;
grant execute on function public.review_memory(uuid, integer) to authenticated;
revoke all on function public.brain_kind(text, integer, text, text, text), public.brain_first_strength(text, integer), public.brain_retention(real, timestamptz) from public, anon;
grant execute on function public.brain_kind(text, integer, text, text, text), public.brain_first_strength(text, integer), public.brain_retention(real, timestamptz) to authenticated;
revoke all on function public.memories_learning(), public.goals_touch() from public, anon, authenticated;
-- O gatilho roda como quem grava (o site): precisa poder usar estas funções puras.
grant execute on function public.brain_is_knowledge(text) to authenticated;
