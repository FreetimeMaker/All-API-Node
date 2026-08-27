-- Table for Wallora Wallpapers
CREATE TABLE public.wallora_wallpapers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT NOT NULL,
    cost DECIMAL(10, 2) DEFAULT 0.00,
    created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for Wallora Purchases (to track which user bought which wallpaper)
CREATE TABLE public.wallora_purchases (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    wallpaper_id UUID REFERENCES public.wallora_wallpapers(id) ON DELETE CASCADE,
    purchased_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, wallpaper_id)
);

-- Enable Row Level Security
ALTER TABLE public.wallora_wallpapers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallora_purchases ENABLE ROW LEVEL SECURITY;

-- Policies for wallora_wallpapers
CREATE POLICY "Allow public read access for wallora_wallpapers"
ON public.wallora_wallpapers FOR SELECT
USING (true);

CREATE POLICY "Allow authenticated insert for wallora_wallpapers"
ON public.wallora_wallpapers FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

-- Policies for wallora_purchases
CREATE POLICY "Allow individual read access for wallora_purchases"
ON public.wallora_purchases FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Allow individual purchase"
ON public.wallora_purchases FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_wallora_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_wallora_wallpapers_updated_at
BEFORE UPDATE ON public.wallora_wallpapers
FOR EACH ROW
EXECUTE PROCEDURE update_wallora_updated_at_column();
