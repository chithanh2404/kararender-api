-- KaraRender Supabase Schema - chạy trong SQL Editor của Supabase

-- 1. Bảng users (thay thế folder JSON trên Drive)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  full_name text,
  is_vip boolean default false,
  created_at timestamptz default now(),
  last_login_at timestamptz,
  domain text
);
create index if not exists idx_users_email on public.users(email);

-- 2. Bảng OTP
create table if not exists public.otps (
  email text primary key,
  otp text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- 3. Languages - cache từ Drive
create table if not exists public.languages (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- 4. App data chung (effects, styles metadata)
create table if not exists public.app_data (
  key text primary key,
  content jsonb not null,
  updated_at timestamptz default now()
);

-- 5. Feedbacks
create table if not exists public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  email text,
  message text,
  rating int,
  domain text,
  created_at timestamptz default now()
);

-- 6. Usage stats
create table if not exists public.usage_stats (
  id uuid primary key default gen_random_uuid(),
  data jsonb,
  ip text,
  created_at timestamptz default now()
);

-- 7. Tickets cho secure render (thay CacheService)
create table if not exists public.tickets (
  ticket text primary key,
  origin text,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '10 minutes')
);

-- RLS - tắt RLS cho service_role, bật cho anon nếu cần
alter table public.users enable row level security;
alter table public.otps enable row level security;
alter table public.languages enable row level security;
alter table public.app_data enable row level security;
alter table public.feedbacks enable row level security;
alter table public.usage_stats enable row level security;
alter table public.tickets enable row level security;

-- Policy: service_role có toàn quyền (backend dùng service_role key nên bypass RLS, nhưng tạo policy cho chắc)
create policy "service_role all" on public.users for all using (true) with check (true);
create policy "service_role all" on public.otps for all using (true) with check (true);
create policy "service_role all" on public.languages for all using (true) with check (true);
create policy "service_role all" on public.app_data for all using (true) with check (true);
create policy "service_role all" on public.feedbacks for all using (true) with check (true);
create policy "service_role all" on public.usage_stats for all using (true) with check (true);
create policy "service_role all" on public.tickets for all using (true) with check (true);

-- Storage buckets - tạo bằng tay trong Dashboard hoặc SQL:
-- insert into storage.buckets (id, name, public) values ('fonts','fonts',true) on conflict do nothing;
-- insert into storage.buckets (id, name, public) values ('secure-render','secure-render',false) on conflict do nothing;
