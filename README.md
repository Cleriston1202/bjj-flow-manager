# BJJ Flow Manager — Starter

Projeto inicial do SaaS "BJJ Flow Manager" (esqueleto).

O que inclui nesta etapa:
- Esquema SQL para Supabase: `supabase/schema.sql`
- Módulo TypeScript com lógica core de faixas: `src/lib/beltLogic.ts`

Rápido guia de uso

1) Aplicar o schema no Supabase

Na sua dashboard do Supabase, vá em SQL Editor e rode o conteúdo de `supabase/schema.sql`.

2) Configurar variáveis de ambiente

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (use com cuidado)

3) Lógica de faixas

O arquivo `src/lib/beltLogic.ts` contém funções reutilizáveis:
- `evaluateBeltProgress(student, attendances, config)` — retorna estado do aluno e se está pronto para grau/promoção.
- `filterAttendancesSince(dateISO, attendances)` — filtra presenças desde a data `belt_since`.
- `DEFAULT_CLUB_CONFIG` — valores padrão (classes por grau, meses por grau, threshold de alerta).

Próximos passos sugeridos
- Scaffold do front-end (React + Vite + Tailwind + shadcn/ui) e integrações com Supabase Auth.
- Endpoints / funções serverless para QR check-in e validação de presenças.
- UI: Dashboard, CRUD de alunos, tela rápida de presença e tela de pagamentos.

Frontend scaffold adicionado:

- `package.json`, `vite.config.ts`, `tsconfig.json`
- `src/main.tsx`, `src/App.tsx`, rotas: `src/pages/Dashboard.tsx`, `src/pages/Students.tsx`, `src/pages/Attendance.tsx`
- `src/lib/supabaseClient.ts` — cliente Supabase
- `src/lib/beltLogic.ts` — já incluso
- Tailwind config e estilos

Para rodar localmente:

```bash
npm install
# criar .env com as variáveis do Supabase (veja .env.example)
npm run dev
```

Quer que eu implemente agora:

- A: Endpoint / função (serverless) para registrar check-in via QR.
- B: Rotas do frontend com integração real ao Supabase (CRUD de alunos e registro de presenças).

Implementação realizada (exemplo):

- `api/checkin.ts` — função serverless simples que insere em `attendances` (usa `SUPABASE_SERVICE_ROLE_KEY`).
- `src/pages/Attendance.tsx` — botão "Marcar" chama `POST /api/checkin` (envie `studentId`).

Observações de segurança:
- Nunca exponha a `SERVICE_ROLE_KEY` no cliente. Configure-a apenas no ambiente do servidor (Vercel/Netlify).

Para testar localmente com Vite, defina no terminal antes de rodar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` e, se for testar a API serverless localmente, configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente do Node.

Storage (fotos de alunos)

- Crie um bucket no Supabase chamado `avatars` e, se preferir, marque como `public` (ou configure Signed URLs se quiser controlar acesso).
- O formulário de aluno (`src/components/StudentForm.tsx`) faz upload direto para `avatars` e salva a `photo_url` pública no campo `students.photo_url`.
- Regarregue o bucket via Dashboard ou use a CLI do Supabase para criar o bucket.

Exemplo mínimo para criar bucket (Supabase SQL/CLI):

```sql
-- via SQL (não funciona em todas as instâncias):
-- use a dashboard ou supabase CLI to create storage bucket named 'avatars'
```

Lembrete de segurança: o upload é feito do cliente usando a `anon` key; se preferir controlar uploads via backend, você pode trocar o fluxo para enviar o arquivo a uma função server-side que use a `service_role` key e retorne a URL.



Se quiser, prossigo agora criando as rotas iniciais do frontend (Dashboard, Alunos, Presenças) e endpoints simples que usam o schema do Supabase.
