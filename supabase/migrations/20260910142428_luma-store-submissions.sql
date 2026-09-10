create table luma_submissions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  name text not null,
  description text,
  category text,
  status text default 'Pending',
  submitted_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table luma_submissions enable row level security;

-- Policy: Users can see only their own submissions
create policy "Users can view own submissions" on luma_submissions
  for select using (auth.uid() = user_id);

-- Policy: Users can insert their own submissions
create policy "Users can insert own submissions" on luma_submissions
  for insert with check (auth.uid() = user_id);