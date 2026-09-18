/* Match policy passages by term overlap so a natural, multi-clause tool query
   does not require every generated word to appear in one document. */
create or replace function public.search_it_policy(query text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with tokens as (
    select distinct regexp_replace(lower(token), '[^a-z0-9_-]', '', 'g') as token
    from regexp_split_to_table(query, '\s+') token
    where length(regexp_replace(token, '[^a-z0-9_-]', '', 'g')) >= 4
      and lower(token) not in ('what', 'when', 'where', 'which', 'with', 'from', 'this', 'that', 'company', 'procedure')
  ), scored as (
    select article.policy_code, article.title, article.content, article.version, article.effective_date,
           count(*) filter (where lower(article.title || ' ' || article.content) like '%' || tokens.token || '%')::integer as score
    from public.it_policy_articles article
    cross join tokens
    group by article.id
  ), ranked as (
    select policy_code, title, content, version, effective_date, score
    from scored
    where score > 0
    order by score desc, effective_date desc
    limit 3
  )
  select jsonb_build_object(
    'passages', coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb),
    'retrieval', 'PostgreSQL term-overlap retrieval',
    'source', 'Ashish_Retail.it_policy_articles',
    'synthetic', true
  ) from ranked;
$$;

revoke all on function public.search_it_policy(text) from public;
grant execute on function public.search_it_policy(text) to authenticated;
