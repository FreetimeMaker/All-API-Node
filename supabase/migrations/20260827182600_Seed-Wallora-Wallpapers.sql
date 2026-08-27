-- Seed initial wallpapers for Wallora
INSERT INTO public.wallora_wallpapers (name, description, category, image_url, cost)
VALUES
    ('Optimus Prime', 'Optimus Prime from Transformers', 'Transformers', '/assets/TF.jpg', 0.99),
    ('Bumblebee', 'Classic Bumblebee', 'Transformers', '/assets/Bee.jpg', 0.99),
    ('Optimus Prime Alt', 'Another look at Optimus Prime', 'Transformers', '/assets/TF1.jpg', 0.99),
    ('Bumblebee Alt', 'Another look at Bumblebee', 'Transformers', '/assets/Bee1.jpg', 0.00),
    ('Bumblebee Stealth', 'Stealth mode Bumblebee', 'Transformers', '/assets/Bee2.jpg', 0.99),
    ('Optimus ROTF', 'Revenge of the Fallen Optimus Prime', 'Transformers', '/assets/TF-ROTF.jpg', 1.50),
    ('Bumblebee ROTF', 'Revenge of the Fallen Bumblebee', 'Transformers', '/assets/Bee-ROTF.jpg', 1.50),
    (' First Background', 'The first official Freetime Maker wallpaper', 'Abstract', '/assets/first.png', 2.00),
    ('Black Cat', 'A black cat', 'Cats', '/assets/black_cat.jpg', 0.99)
ON CONFLICT (id) DO NOTHING;
