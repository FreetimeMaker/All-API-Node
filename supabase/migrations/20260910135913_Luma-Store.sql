-- SQL Schema for Cross-Platform App Store (Optimized: No Likes)

-- Categories table
CREATE TABLE IF NOT EXISTS store_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Apps table
CREATE TABLE IF NOT EXISTS store_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    developer_name TEXT,
    developer_id UUID REFERENCES auth.users(id),
    category_id UUID REFERENCES store_categories(id),
    icon_url TEXT,
    version TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- App Platforms (Many-to-Many relationship between Apps and Platforms)
CREATE TABLE IF NOT EXISTS store_app_platforms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES store_apps(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, -- 'Android', 'iOS', 'Windows', 'Web', 'Linux', 'macOS'
    download_url TEXT NOT NULL,
    file_size_mb FLOAT,
    UNIQUE(app_id, platform)
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_store_apps_updated_at
    BEFORE UPDATE ON store_apps
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
