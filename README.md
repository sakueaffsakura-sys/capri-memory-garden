# Cérebro da Capri

A memória de longo prazo da Capri, a companheira de desktop. Tudo que ela aprende vira uma bolinha num grafo, ligada às
outras: o que você gosta, as pessoas da sua vida, as conversas, o que vocês leram juntos, as promessas dela.

**Site:** https://sakueaffsakura-sys.github.io/capri-memory-garden/

## Como usar

1. Crie uma conta no site.
2. Em **Chaves da Capri**, gere uma chave (começa com `cap_`). Ela aparece uma vez só.
3. No PC, clique com o botão direito na Capri › **Cérebro online** › **Conectar meu cérebro…** e cole a chave.
4. Clique em **Enviar tudo que ela já sabe** para trazer as memórias antigas dela.

Daí em diante, cada nota que ela faz, cada memória que ela tira das conversas, as respostas do "me conhece" e o resumo
do que vocês leram juntos vão para o cérebro. Antes de responder, ela pergunta ao cérebro o que sabe sobre o assunto.
Endereços, números de documento e senhas nunca saem do PC.

## Como é feito

- `index.html` e `app.js`: o site inteiro, sem dependências nem build. Fala direto com o Supabase (login, tabelas)
  e desenha o grafo num `<canvas>` com uma simulação de forças própria.
- `supabase/schema.sql`: tabelas, segurança por usuário (RLS) e as funções de busca e organização.
- `supabase/functions/capri-brain`: a API que a Capri usa (`x-capri-key`), publicada com `verify_jwt = false`.

### API da Capri

`POST https://wzecozxpipxbalauazub.supabase.co/functions/v1/capri-brain` com o cabeçalho `x-capri-key: cap_...` e um JSON
com `action`:

| action | campos | volta |
|---|---|---|
| `ping` | | nome, e-mail, número de memórias e ligações |
| `remember` | `content`, `title?`, `category?`, `importance?` (1–5), `tags?`, `source?`, `happened_at?`, `links?` `[{to, relation}]` | `id`, `title`, `category`, `created`, `linked` |
| `remember_many` | `items` (até 100 do formato acima) | `results` |
| `recall` | `query`, `limit?`, `category?` | `memories` com `related` |
| `core` | `limit?` | as memórias de importância 4 e 5 |
| `recent` | `limit?`, `category?` | as mais novas |
| `forget` | `id` ou `title` | `deleted` |
| `link` | `from`, `to`, `relation?` | `linked` |
| `categories` | | contagem por categoria |

Categorias: `sobre-voce`, `gostos`, `pessoas`, `conversas`, `sentimentos`, `planos`, `rotina`, `jogos`, `leituras`,
`musica`, `capri`, `outros`.
