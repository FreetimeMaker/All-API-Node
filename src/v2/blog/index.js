const express = require('express');
const axios = require('axios');

const router = express.Router();

const GITHUB_API = 'https://api.github.com/repos/FreetimeMaker/MD-Blog/contents/public/blogs';
const RAW_BASE = 'https://raw.githubusercontent.com/FreetimeMaker/MD-Blog/main/public/blogs';

const githubHeaders = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'All-API-Node'
};

function parsePost(slug, markdown) {
    const title = (markdown.match(/^# (.+)$/m) || [])[1]
        || slug.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());

    const timestampMatch = markdown.match(/Released on[\s\S]*?<t:(\d+)(?::[tTdDfFR])?>/i);
    let releaseTimestamp = 0;

    if (timestampMatch) {
        releaseTimestamp = Number(timestampMatch[1]);
    } else {
        const dateMatch = markdown.match(/Released on\s+(\d{2})\.(\d{2})\.(\d{4})(?:\s+at)?\s+(\d{2}):(\d{2})/i);
        if (dateMatch) {
            const [, day, month, year, hour, minute] = dateMatch;
            releaseTimestamp = Math.floor(new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`).getTime() / 1000);
        }
    }

    const categoryMatch = markdown.match(/Categories:\s*(.+)/i);
    const categories = categoryMatch
        ? categoryMatch[1].split(',').map(c => c.replace(/\*/g, '').trim()).filter(Boolean)
        : [];

    return { slug, title, releaseTimestamp, categories };
}

async function listMarkdownFiles() {
    const { data } = await axios.get(GITHUB_API, { headers: githubHeaders, timeout: 10000 });
    return data.filter(file => file.type === 'file' && file.name.endsWith('.md'));
}

async function loadMarkdown(slug) {
    if (!/^[a-zA-Z0-9._-]+$/.test(slug)) return null;
    try {
        const { data } = await axios.get(`${RAW_BASE}/${encodeURIComponent(slug)}.md`, {
            responseType: 'text',
            timeout: 10000
        });
        return data;
    } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
    }
}

router.get('/posts', async (req, res) => {
    try {
        const files = await listMarkdownFiles();
        const posts = await Promise.all(files.map(async file => {
            const slug = file.name.slice(0, -3);
            const markdown = await loadMarkdown(slug);
            return markdown == null ? null : parsePost(slug, markdown);
        }));

        let result = posts.filter(Boolean).sort((a, b) => b.releaseTimestamp - a.releaseTimestamp);
        const categories = String(req.query.category || '')
            .split(',').map(c => c.trim()).filter(Boolean);

        if (categories.length) {
            result = result.filter(post => categories.every(filter =>
                post.categories.some(category => category.toLowerCase() === filter.toLowerCase())
            ));
        }

        res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
        res.json({ posts: result });
    } catch (error) {
        console.error('[blog/posts]', error.message);
        res.status(502).json({ error: 'Could not load blog posts' });
    }
});

router.get('/posts/:slug', async (req, res) => {
    try {
        const markdown = await loadMarkdown(req.params.slug);
        if (markdown == null) return res.status(404).json({ error: 'Post not found' });

        res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
        res.json({ ...parsePost(req.params.slug, markdown), markdown });
    } catch (error) {
        console.error('[blog/posts/:slug]', error.message);
        res.status(502).json({ error: 'Could not load blog post' });
    }
});

router.get('/categories', async (req, res) => {
    try {
        const files = await listMarkdownFiles();
        const posts = await Promise.all(files.map(async file => {
            const slug = file.name.slice(0, -3);
            const markdown = await loadMarkdown(slug);
            return markdown == null ? null : parsePost(slug, markdown);
        }));
        const categories = [...new Set(posts.filter(Boolean).flatMap(post => post.categories))]
            .sort((a, b) => a.localeCompare(b));

        res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
        res.json({ categories });
    } catch (error) {
        console.error('[blog/categories]', error.message);
        res.status(502).json({ error: 'Could not load blog categories' });
    }
});

module.exports = router;
