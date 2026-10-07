-- V0.2 preparation. Apply only after inspecting the selected project.
-- New objects only. No student records, public images, or ChatGPT credentials.
begin;

create table public.math_questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  kind text not null default 'school_original' check (kind = 'school_original'),
  source text not null default '' check (length(source) <= 200),
  source_date date not null,
  image_path text not null,
  image_mime text not null check (image_mime in ('image/jpeg','image/png','image/webp')),
  image_bytes integer not null check (image_bytes > 0 and image_bytes <= 8388608),
  image_ready boolean not null default false,
  filename text not null check (length(filename) between 1 and 200),
  status text not null default 'uploaded' check (status in ('uploaded','needs_clarification','pending_review','approved')),
  analysis jsonb,
  latest_analysis_id uuid,
  reviewed_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (image_path),
  check (image_path in (owner_id::text || '/' || id::text || '/original.jpg', owner_id::text || '/' || id::text || '/original.png', owner_id::text || '/' || id::text || '/original.webp')),
  check (analysis is null or jsonb_typeof(analysis) = 'object'),
  check (status <> 'approved' or coalesce(
    reviewed_at is not null and latest_analysis_id is not null and image_ready
    and jsonb_typeof(analysis->'question') = 'string' and length(btrim(analysis->>'question')) > 0
    and jsonb_typeof(analysis->'answer') = 'string' and length(btrim(analysis->>'answer')) > 0
    and jsonb_typeof(analysis->'firstInsight') = 'string' and length(btrim(analysis->>'firstInsight')) > 0
    and jsonb_typeof(analysis->'steps') = 'array' and jsonb_array_length(analysis->'steps') > 0
    and jsonb_typeof(analysis->'knowledgePoints') = 'array' and jsonb_array_length(analysis->'knowledgePoints') > 0
    and jsonb_typeof(analysis->'mathMethods') = 'array' and jsonb_array_length(analysis->'mathMethods') > 0
    and jsonb_typeof(analysis->'uncertainties') = 'array' and jsonb_array_length(analysis->'uncertainties') = 0
    and analysis->'needsClarification' = 'false'::jsonb, false))
);

-- AI output is append-only. Human edits live on math_questions.analysis.
create table public.math_question_analyses (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null,
  owner_id uuid not null default auth.uid(),
  model text not null check (length(model) between 1 and 120),
  raw_analysis jsonb not null check (jsonb_typeof(raw_analysis) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, question_id, owner_id),
  foreign key (question_id, owner_id) references public.math_questions(id, owner_id)
);
alter table public.math_questions add constraint latest_analysis_belongs_to_question
  foreign key (latest_analysis_id, id, owner_id) references public.math_question_analyses(id, question_id, owner_id);
create index math_questions_owner_date on public.math_questions(owner_id, source_date desc);
create index math_questions_owner_status on public.math_questions(owner_id, status);
create index math_analyses_owner_question on public.math_question_analyses(owner_id, question_id, created_at desc);
create index math_questions_knowledge on public.math_questions using gin ((analysis->'knowledgePoints'));
create index math_questions_methods on public.math_questions using gin ((analysis->'mathMethods'));

create function public.math_question_before_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id or new.kind <> old.kind
    or new.image_path <> old.image_path or new.image_mime <> old.image_mime or new.image_bytes <> old.image_bytes
    or new.filename <> old.filename or new.created_at <> old.created_at then
    raise exception 'Original identity and image are immutable' using errcode = '23514';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  if old.status = 'approved' and (new.analysis is distinct from old.analysis
    or new.latest_analysis_id is distinct from old.latest_analysis_id
    or new.source is distinct from old.source or new.source_date is distinct from old.source_date) then
    new.status := 'pending_review'; new.reviewed_at := null;
  elsif new.status = 'approved' and old.status <> 'approved' then
    new.reviewed_at := now();
  elsif new.status <> 'approved' then
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;
create trigger math_question_update before update on public.math_questions
  for each row execute function public.math_question_before_update();

alter table public.math_questions enable row level security;
alter table public.math_question_analyses enable row level security;
revoke all on public.math_questions, public.math_question_analyses from anon, authenticated;
grant select, insert, update on public.math_questions to authenticated;
grant select, insert on public.math_question_analyses to authenticated;
create policy math_questions_read_own on public.math_questions for select to authenticated using ((select auth.uid()) = owner_id);
create policy math_questions_insert_own on public.math_questions for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy math_questions_update_own on public.math_questions for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy math_analyses_read_own on public.math_question_analyses for select to authenticated using ((select auth.uid()) = owner_id);
create policy math_analyses_insert_own on public.math_question_analyses for insert to authenticated with check ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('math-originals', 'math-originals', false, 8388608, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;
do $$ begin
  if exists (select 1 from storage.buckets where id = 'math-originals' and public) then
    raise exception 'Existing math-originals bucket is public; inspect it before continuing';
  end if;
end $$;
create policy math_originals_read_own on storage.objects for select to authenticated
  using (bucket_id = 'math-originals' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy math_originals_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'math-originals' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Existing permissive Storage policies combine with OR. Restrictive policies
-- protect this bucket even when unrelated project policies are broad.
create policy math_originals_no_anonymous on storage.objects as restrictive for all to anon
  using (bucket_id <> 'math-originals') with check (bucket_id <> 'math-originals');
create policy math_originals_private_read on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'math-originals' or (storage.foldername(name))[1] = (select auth.uid())::text);
create policy math_originals_private_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'math-originals' or (storage.foldername(name))[1] = (select auth.uid())::text);
create policy math_originals_immutable_update on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'math-originals') with check (bucket_id <> 'math-originals');
create policy math_originals_immutable_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'math-originals');
-- No update/delete policy for immutable original photos; do not upload with upsert.
commit;
