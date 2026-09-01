-- Drop existing objects to allow clean re-run
DROP TRIGGER IF EXISTS update_fport_apps_updated_at ON public.fport_apps;
DROP TABLE IF EXISTS public.fport_likes;
DROP TABLE IF EXISTS public.fport_apps;

-- Table for FPort Apps
CREATE TABLE public.fport_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    developer TEXT,
    platform TEXT,
    url TEXT,
    icon_url TEXT,
    created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for FPort Likes
CREATE TABLE public.fport_likes (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    app_id UUID REFERENCES public.fport_apps(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, app_id)
);

-- Enable Row Level Security
ALTER TABLE public.fport_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fport_likes ENABLE ROW LEVEL SECURITY;

-- Policies for fport_apps
CREATE POLICY "Allow public read access for fport_apps"
ON public.fport_apps FOR SELECT
USING (true);

CREATE POLICY "Allow authenticated insert for fport_apps"
ON public.fport_apps FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Allow creators to update their apps"
ON public.fport_apps FOR UPDATE
TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "Allow creators to delete their apps"
ON public.fport_apps FOR DELETE
TO authenticated
USING (auth.uid() = created_by);

-- Policies for fport_likes
CREATE POLICY "Allow public read access for fport_likes"
ON public.fport_likes FOR SELECT
USING (true);

CREATE POLICY "Allow individual insert for fport_likes"
ON public.fport_likes FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual delete for fport_likes"
ON public.fport_likes FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Trigger for updated_at on fport_apps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_fport_apps_updated_at
BEFORE UPDATE ON public.fport_apps
FOR EACH ROW
EXECUTE PROCEDURE update_updated_at_column();
