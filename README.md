# Capri Memory Garden

Build "Cérebro da Capri": an online long-term memory ("brain") for Capri, an AI desktop companion (a Windows app). Every piece of information Capri learns is stored as one memory = one dot (node) in a big interactive graph, like Obsidian's graph view. All UI text in Brazilian Portuguese. Use Lovable Cloud (Supabase) for auth, Postgres database and one edge function.

## Look
Dark, minimal, like Obsidian's "Visualização em gráfico": background #18181b, nodes light gray/white dots with small gray labels, thin translucent gray links (rgba(255,255,255,0.12)). Hovering or selecting a node highlights it, its neighbors and its links in violet #8b5cf6 and dims everything else. Smooth zoom/pan, nodes can be dragged. Each category has a subtle accent color (used for the node ring and legend). Mobile friendly.

## Auth (Portuguese pages)
- /entrar (login with email + password), /registrar (sign up: name, email, password), "Esqueci minha senha" reset flow, logout. Protected app routes redirect to /entrar.
- Logged-out home (/) is a landing page: title "Cérebro da Capri", one-line explanation, buttons "Entrar" and "Criar conta", and behind it a live animated DEMO graph (~120 fake memory nodes around 8 category hubs, clearly labeled "demonstração"). Fake data only here, never in the real app.
- A profiles table (id = auth user id, display_name, created_at) created by trigger on signup.

## Database (Postgres, RLS on every table, each user only sees and changes their own rows)
1. memories: id uuid pk, user_id uuid (auth.users, cascade), title text not null (1..120 chars), content text not null (<= 4000 chars), category text not null default 'outros', importance smallint 1..5 default 3, tags text[] default '{}', source text default 'capri', happened_at timestamptz null, mentions int default 1, recall_count int default 0, last_recalled_at timestamptz, created_at, updated_at (trigger). Full-text search column (tsvector, 'portuguese' config over title + content + tags, kept by trigger) with GIN index; pg_trgm extension and trigram GIN index on title and content. Unique index on (user_id, lower(title), category).
2. memory_links: id, user_id, source_id, target_id (memories, cascade), relation text default 'relacionado', strength real default 0.5, auto boolean default false, created_at; unique (source_id, target_id); check source_id <> target_id.
3. api_keys: id, user_id, name text, key_prefix text (first 12 chars, for display), key_hash text unique (SHA-256 hex of the full key), created_at, last_used_at, revoked_at.
Categories (fixed list, with Portuguese labels and colors): sobre-voce (Sobre você), gostos (Gostos), pessoas (Pessoas), conversas (Conversas), sentimentos (Sentimentos), planos (Planos e promessas), rotina (Rotina), jogos (Jogos), leituras (Leituras), musica (Música), capri (Sobre a Capri), outros (Outros). Unknown category -> outros.
Enable Realtime on memories and memory_links so new dots appear live in the graph while Capri is learning.

## Pages (logged in)
- / "Cérebro" (main): full-screen force-directed graph (use react-force-graph-2d with canvas, must stay smooth with 5,000+ nodes). Each memory is a dot; node size grows with importance and number of links; label drawn when zoomed in or hovered. Optional big hub nodes per category (toggle "Mostrar categorias", on by default) with thin links from each memory to its hub, so the graph forms clusters like a brain. Top bar: search box (typing focuses and highlights matching nodes), category filter chips with counts, total "N memórias · M ligações", buttons "Nova memória", "Organizar com IA", "Exportar". Clicking a node opens a right side panel: title, content, category, tags, importance stars, created/updated/last recalled dates, source, list of linked memories (click to jump), buttons Editar, Excluir, "Ligar a outra memória" (searchable picker + relation text). Legend of categories at the bottom left.
- /memorias: searchable, sortable table of all memories with category filter, inline edit, delete, bulk delete.
- /chaves "Chaves da Capri": list keys (name, prefix, created, last used, status), "Gerar nova chave" -> key format `cap_` + 40 random base62 chars generated with crypto.getRandomValues; store only key_prefix and SHA-256 hash; show the full key ONCE in a dialog with a copy button and the warning "Guarde agora, ela não aparece de novo". Revoke and delete buttons.
- /conectar "Conectar a Capri": step-by-step in Portuguese: generate a key, then in Capri right-click her > Cérebro online > Conectar, paste the key. Show the exact API address (the full edge function URL) with a copy button, and a curl example.
- "Organizar com IA" (button on the graph page): calls the edge function with the logged-in user's JWT (action organize). It uses Lovable AI (google/gemini-2.5-flash) on the user's memories in batches of up to 150: fixes categories, adds up to 5 short lowercase tags per memory, merges clear duplicates (keep the richer content, move links, delete the other), and proposes new links with a short Portuguese relation label between related memories. Apply results and show a summary toast ("12 ligações novas, 3 duplicadas unidas...").
- "Exportar": downloads all memories and links as JSON.

## Edge function `capri-brain` (this is how the Capri desktop app talks to the brain)
- verify_jwt = false for this function in supabase/config.toml (Capri sends its own key). CORS open.
- Every request: POST, JSON body {"action": "...", ...}. Auth for Capri: header `x-capri-key: cap_...` (also accept `Authorization: Bearer cap_...`). Hash with SHA-256, find a non-revoked api_keys row -> user_id, update last_used_at (at most once per minute). Use the service role client and ALWAYS filter by that user_id. Action `organize` instead authenticates with the website user's Supabase JWT (Authorization: Bearer <jwt>).
- Responses are JSON: {"ok": true, ...} or {"ok": false, "error": "mensagem"} with 400/401/404/500. Bad or revoked key -> 401 {"ok":false,"error":"chave inválida"}.
- Actions (exact names and fields, the desktop app is coded against them):
  - ping -> {ok, name, email, memories (count), links (count)}
  - remember {content (required), title?, category?, importance? (1-5, default 3), tags? string[], source? (default "capri"), happened_at? ISO date, links? [{to: title or id, relation?}]} -> trim; title defaults to the first 60 chars of content. If a memory of this user with the same lower(title) exists (any category), or one in the same category whose content trigram similarity >= 0.8: update it (content = new content, importance = greatest, tags merged, mentions + 1, updated_at now). Else insert. Then auto-link: up to 3 other memories of the user with similarity(content) >= 0.3 or sharing a tag -> insert link (relation 'relacionado', auto true) if not existing either direction. Then explicit links (resolve `to` by id or case-insensitive title, skip unknown). Returns {ok, id, title, category, created (bool), linked (number)}.
  - remember_many {items: [same as remember, max 100]} -> {ok, results: [{id, title, created} or {error}]}
  - recall {query, limit? (default 8, max 30), category?} -> rank memories by: ts_rank of an OR-query built from the query's words (e.g. replace(plainto_tsquery('portuguese', q)::text, '&', '|')::tsquery, so long chat sentences still match) + trigram similarity of title/content to the query + importance * 0.05 + a small recency bonus. Only rows that match the tsquery or have similarity > 0.12. Put the ranking in a SQL function (rpc) for speed. For each result include `related`: up to 5 titles of linked memories. Increment recall_count and set last_recalled_at for returned rows. -> {ok, memories: [{id, title, content, category, importance, tags, updated_at, related}]}
  - core {limit? default 30, max 60} -> memories with importance >= 4, ordered importance desc, updated_at desc, same shape (no related needed).
  - recent {limit? default 20, max 100, category?} -> newest by updated_at.
  - forget {id? , title?} -> delete matching memory of this user -> {ok, deleted: n}
  - link {from, to, relation?} (each id or title) -> {ok, linked: bool}
  - categories -> {ok, categories: [{id, label, count}]}
- Validate types and lengths (content <= 4000, title <= 120, tags <= 12 of <= 40 chars, relation <= 60), ignore unknown fields, never return other users' data, never log keys.

Test the edge function yourself (bad key -> 401, ping, remember, recall in Portuguese, forget) and make sure the graph renders smoothly. Seed nothing in the real database.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bc4dcbb4-7fde-40eb-8a38-c7e5b44ac3d3).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
