-- Run against a disposable test database after the migration. All fixtures roll back.
-- This is not proof of permission isolation until executed successfully.
begin;
insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000001','math-rls-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','math-rls-b@example.invalid');
insert into public.math_questions(id,owner_id,source_date,image_path,image_mime,image_bytes,filename) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-10-07','10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/original.png','image/png',100,'fixture-a.png'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','2026-10-07','10000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000002/original.png','image/png',100,'fixture-b.png');
set local role anon;
do $$ begin
  begin perform * from public.math_questions; raise exception 'FAIL: anon can read questions'; exception when insufficient_privilege then null; end;
  begin perform * from public.math_question_analyses; raise exception 'FAIL: anon can read analyses'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare affected integer; begin
  if (select count(*) from public.math_questions where id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')) <> 1 then raise exception 'FAIL: cross-user read'; end if;
  update public.math_questions set source = 'forbidden' where id = '20000000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count; if affected <> 0 then raise exception 'FAIL: cross-user update'; end if;
  update public.math_questions set source = 'own edit' where id = '20000000-0000-4000-8000-000000000001' and revision = 1;
  get diagnostics affected = row_count; if affected <> 1 then raise exception 'FAIL: own update denied'; end if;
  update public.math_questions set source = 'stale edit' where id = '20000000-0000-4000-8000-000000000001' and revision = 1;
  get diagnostics affected = row_count; if affected <> 0 then raise exception 'FAIL: stale update applied'; end if;
  begin
    update public.math_questions set owner_id = '10000000-0000-4000-8000-000000000002' where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: owner changed';
  exception when check_violation or insufficient_privilege then null; end;
  begin
    update public.math_questions set status = 'approved' where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: approved without analysis';
  exception when check_violation then null; end;
  begin
    delete from public.math_questions where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: client can delete originals';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.math_questions(id,owner_id,source_date,image_path,image_mime,image_bytes,filename) values
    ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','2026-10-07','10000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000003/original.png','image/png',100,'spoof.png');
    raise exception 'FAIL: insert for other owner';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
