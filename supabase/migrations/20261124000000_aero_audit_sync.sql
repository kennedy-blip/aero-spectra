-- Private destination for optional, user-initiated audit queue sync.
-- The Python function uses SUPABASE_SERVICE_ROLE_KEY server-side; never expose it to the browser.
create table if not exists public.aero_audit_events (
  id uuid primary key,
  store_name text not null check (store_name in (
    'mie_aerosol_scans',
    'hvac_balometer_logs',
    'cadr_clearance_plans',
    'fanger_psychrometric_audits',
    'cohb_alarm_events'
  )),
  created_at timestamptz not null,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  received_at timestamptz not null default now()
);

create index if not exists aero_audit_events_store_created_idx
  on public.aero_audit_events (store_name, created_at desc);

alter table public.aero_audit_events enable row level security;
revoke all on table public.aero_audit_events from anon, authenticated;
grant all on table public.aero_audit_events to service_role;
