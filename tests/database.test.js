import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL migration and cross-user/anonymous RLS assertions run against a Supabase-shaped fixture',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema auth,storage to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create policy existing_broad_policy on storage.objects for all to public using (true) with check (true);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202610070001_question_bank.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/question_access.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select count(*) as n from public.math_questions')).rows[0].n,0);
  await db.exec(`begin;
    insert into auth.users values ('10000000-0000-4000-8000-000000000001','public-test@example.invalid');
    insert into storage.objects(bucket_id,name) values ('math-originals','10000000-0000-4000-8000-000000000001/a/original.png'),('math-originals','10000000-0000-4000-8000-000000000002/b/original.png');
    select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
    set local role authenticated;`);
  assert.equal((await db.query('select count(*) as n from storage.objects')).rows[0].n,1);
  assert.equal((await db.query(`update storage.objects set name='overwritten' where bucket_id='math-originals' returning id`)).rows.length,0);
  assert.equal((await db.query(`delete from storage.objects where bucket_id='math-originals' returning id`)).rows.length,0);
  await assert.rejects(db.query(`insert into storage.objects(bucket_id,name) values ('math-originals','10000000-0000-4000-8000-000000000002/c/original.png')`),{code:'42501'});
  await db.exec('rollback');
  await db.exec(`begin;insert into storage.objects(bucket_id,name) values ('math-originals','10000000-0000-4000-8000-000000000001/a/original.png');set local role anon;`);
  assert.equal((await db.query('select count(*) as n from storage.objects')).rows[0].n,0);
  await db.exec('rollback');
});
