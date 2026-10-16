-- After creating your own confirmed user in Supabase Authentication > Users,
-- replace only the email below, then execute once in the SQL editor.
-- Never share your password or a service_role key with the website.
do $$
declare target uuid;
begin
 select id into target from auth.users where lower(email)=lower('REMPLACER_PAR_VOTRE_EMAIL') and email_confirmed_at is not null;
 if target is null then raise exception 'Créez et confirmez d’abord votre utilisateur, puis renseignez son email.'; end if;
 insert into public.guide_members(user_id,role) values(target,'admin')
 on conflict(user_id) do update set role='admin';
end; $$;
