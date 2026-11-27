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

### Do básico ao especialista

Quando você pergunta ou ensina alguma coisa, ela guarda a explicação como **estudo**, com o **assunto** (ex.: Fotossíntese)
e o **nível**: 1 Básico, 2 Elementar, 3 Intermediário, 4 Avançado, 5 Especialista. As memórias de um mesmo assunto viram
uma **trilha**: a mais funda "aprofunda" a de baixo. Na aba **Aprendizado** dá para ver as áreas, os assuntos e quanto ela
já subiu em cada um; no grafo, a vista **Níveis** mostra o que ela sabe de vocês no meio e o conhecimento em anéis.

### Em 3D

O cérebro é uma constelação em 3D (WebGL, sem bibliotecas, em `space.js`): arraste para girar em volta, role (ou faça
pinça) para aproximar, botão direito ou Shift para mover, dois cliques no vazio para ver tudo de novo. Parado, ele gira
sozinho devagar. Cada memória é uma estrela única: a cor da categoria com um tom só dela, tamanho pela importância e
pelas ligações, de 4 a 8 pontas, giro e cintilar tirados do próprio id, anéis no conhecimento avançado e mais brilho nas
mais lembradas; no painel ela tem nome de estrela, classe e brilho. Dois fundos: **Noite** (como o mapa da internet) e
**Claro** (como os grafos em papel branco). Sem WebGL, o site usa o grafo plano de antes.

### O cérebro cresce

O visual muda com o tamanho: **Semente** (até 24 memórias), **Broto** (25+), **Constelação** (100+), **Galáxia** (300+),
**Nebulosa** (1000+) e **Universo** (3000+). Quanto maior, mais estrelas no fundo, mais nuvens coloridas atrás de cada
categoria e mais faíscas correndo pelas ligações; quando ela lembra de algo, a bolinha acende e solta faíscas.

## Cada um com o seu cérebro

Cada conta tem um cérebro só dela. No banco, toda tabela tem segurança por linha (RLS): cada pessoa só lê, cria, muda e
apaga o que é dela; quem não entrou na conta não vê nada; uma ligação só existe entre memórias do mesmo dono e uma
memória não muda de dono. A API da Capri descobre o dono pela chave e só mexe no cérebro dele. No site, as preferências
e o que foi carregado são separados por conta (trocar de conta no mesmo navegador não mostra nada da anterior). Na
Capri, a fila do que ainda vai subir é separada por chave, e trocar de chave esquece na hora o que veio da conta antiga.

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
| `remember` | `content`, `title?`, `category?`, `importance?` (1–5), `level?` (1–5), `topic?`, `tags?`, `source?`, `happened_at?`, `links?` `[{to, relation}]` | `id`, `title`, `category`, `level`, `topic`, `created`, `linked` |
| `remember_many` | `items` (até 100 do formato acima) | `results` |
| `recall` | `query`, `limit?`, `category?` | `memories` com `related` |
| `core` | `limit?` | as memórias de importância 4 e 5 |
| `recent` | `limit?`, `category?` | as mais novas |
| `forget` | `id` ou `title` | `deleted` |
| `link` | `from`, `to`, `relation?` | `linked` |
| `categories` | | contagem por categoria |
| `topics` | `limit?` | assuntos com quantas memórias há em cada nível |

Categorias sobre vocês: `sobre-voce`, `gostos`, `pessoas`, `conversas`, `sentimentos`, `planos`, `rotina`, `jogos`,
`leituras`, `musica`, `capri`, `outros`. Conhecimento: `conhecimento`, `ciencia`, `tecnologia`, `matematica`, `idiomas`,
`historia`, `arte`, `saude`, `habilidades` (o banco também entende sinônimos como `biologia` ou `programacao`).
