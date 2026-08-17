import express from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();
app.use(express.json());

// Fake Webserver für Kinetic Hosting
app.get("/shop", (req, res) => res.send("Shop API running"));

// Digitale Produkte (Demo)
const products = [
    { id: 1, name: "Premium Script", price: 10, file: "premium.zip" },
    { id: 2, name: "API Key", price: 5, file: "apikey.txt" }
];

// Bestellungen (Demo-Datenbank)
let orders = [];

// OxaPay Config
const OXAPAY_API = "https://api.oxapay.com/v1";
const OXAPAY_API_KEY = "DEIN_OXAPAY_API_KEY";
const CALLBACK_SECRET = "DEIN_CALLBACK_SECRET"; // eigener Secret für Sicherheit

// 1️⃣ Produkte abrufen
app.get("/products", (req, res) => {
    res.json(products);
});

// 2️⃣ Checkout → OxaPay Payment erstellen
app.post("/checkout", async (req, res) => {
    const { productId, email } = req.body;

    const product = products.find(p => p.id === productId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    // Bestellung anlegen
    const orderId = crypto.randomUUID();
    orders.push({
        orderId,
        email,
        productId,
        paid: false,
        downloadReady: false
    });

    // OxaPay Payment erstellen
    const payment = await axios.post(`${OXAPAY_API}/create-order`, {
        merchant_key: OXAPAY_API_KEY,
        price_amount: product.price,
        price_currency: "USD",
        pay_currency: "USDT",
        order_id: orderId,
        callback_url: "https:///oxapay/callback"
    });

    res.json({
        orderId,
        payUrl: payment.data.pay_url
    });
});

// 3️⃣ OxaPay Callback → Zahlung bestätigen
app.post("/oxapay/callback", (req, res) => {
    const data = req.body;

    // Sicherheit: Callback verifizieren
    const signature = req.headers["x-oxapay-signature"];
    const check = crypto
        .createHmac("sha256", CALLBACK_SECRET)
        .update(JSON.stringify(req.body))
        .digest("hex");

    if (signature !== check) {
        return res.status(403).json({ error: "Invalid Signature" });
    }

    // Bestellung finden
    const order = orders.find(o => o.orderId === data.order_id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Zahlung erfolgreich?
    if (data.status === "paid") {
        order.paid = true;
        order.downloadReady = true;
    }

    res.json({ ok: true });
});

// 4️⃣ Download freischalten
app.get("/download/:orderId", (req, res) => {
    const order = orders.find(o => o.orderId === req.params.orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (!order.paid) return res.status(403).json({ error: "Not paid" });

    const product = products.find(p => p.id === order.productId);

    res.json({
        message: "Download ready",
        file: product.file
    });
});

// Server starten
app.listen(3000, () => {
    console.log("Shop API runs on Port 3000");
});
