-- 0017_expose_api_schema.sql
-- The front end calls api.* only, but PostgREST serves "public, graphql_public"
-- by default, so every api.* RPC returned 404 until this was set. The dashboard
-- equivalent is Settings → API → Exposed schemas; doing it here keeps a fresh
-- environment working without a manual step.

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, api';
notify pgrst, 'reload config';
