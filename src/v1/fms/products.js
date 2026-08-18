const router = require('express').Router();

let products = [
    {
        id: 1,
        name: 'First Background',
        description: 'This is my First Background I made',
        price: 1,
        currency: 'USD',
        stock: 10000000,
        category: 'Mobile Background',
        imageUrl: null,
        createdAt: new Date().toISOString()
    }
];

let nextId = 3;

function validateProduct(body, { partial = false } = {}) {
    const errors = [];

    if (!partial || body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim().length === 0) {
            errors.push('name has to be a non-empty String');
        }
    }

    if (!partial || body.price !== undefined) {
        if (typeof body.price !== 'number' || body.price < 0) {
            errors.push('price has to be a number >= 0');
        }
    }

    if (!partial || body.stock !== undefined) {
        if (body.stock !== undefined && (typeof body.stock !== 'number' || body.stock < 0)) {
            errors.push('stock has to be a number >= 0');
        }
    }

    return errors;
}

router.get('/', (req, res) => {
    let result = [...products];
    const { category, minPrice, maxPrice, sort, order = 'asc', search } = req.query;

    if (category) {
        result = result.filter(p => p.category?.toLowerCase() === category.toLowerCase());
    }

    if (search) {
        const q = search.toLowerCase();
        result = result.filter(
            p => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
        );
    }

    if (minPrice !== undefined) {
        result = result.filter(p => p.price >= parseFloat(minPrice));
    }

    if (maxPrice !== undefined) {
        result = result.filter(p => p.price <= parseFloat(maxPrice));
    }

    if (sort && ['price', 'name', 'stock', 'createdAt'].includes(sort)) {
        result.sort((a, b) => {
            if (a[sort] < b[sort]) return order === 'desc' ? 1 : -1;
            if (a[sort] > b[sort]) return order === 'desc' ? -1 : 1;
            return 0;
        });
    }

    res.status(200).json({
        count: result.length,
        products: result
    });
});

router.get('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const product = products.find(p => p.id === id);

    if (!product) {
        return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json(product);
});

router.post('/', (req, res) => {
    const errors = validateProduct(req.body);
    if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation error', details: errors });
    }

    const newProduct = {
        id: nextId++,
        name: req.body.name.trim(),
        description: req.body.description || '',
        price: req.body.price,
        currency: req.body.currency || 'EUR',
        stock: req.body.stock ?? 0,
        category: req.body.category || null,
        imageUrl: req.body.imageUrl || null,
        createdAt: new Date().toISOString()
    };

    products.push(newProduct);
    res.status(201).json(newProduct);
});

router.put('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const index = products.findIndex(p => p.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Product not found' });
    }

    const errors = validateProduct(req.body);
    if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation error', details: errors });
    }

    products[index] = {
        ...products[index],
        name: req.body.name.trim(),
        description: req.body.description || '',
        price: req.body.price,
        currency: req.body.currency || products[index].currency,
        stock: req.body.stock ?? products[index].stock,
        category: req.body.category ?? products[index].category,
        imageUrl: req.body.imageUrl ?? products[index].imageUrl
    };

    res.status(200).json(products[index]);
});

router.patch('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const index = products.findIndex(p => p.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Product not found' });
    }

    const errors = validateProduct(req.body, { partial: true });
    if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation error', details: errors });
    }

    products[index] = { ...products[index], ...req.body };
    res.status(200).json(products[index]);
});

router.delete('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const index = products.findIndex(p => p.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Product not found' });
    }

    const deleted = products.splice(index, 1)[0];
    res.status(200).json({ message: 'Product deleted', product: deleted });
});

module.exports = router;