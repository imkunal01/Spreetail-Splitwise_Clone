const { Router } = require("express");

const router = Router();

// ─── Config ───────────────────────────────────────────────────────────────────

const FRANKFURTER_BASE =
    (process.env.CURRENCY_API_URL || "https://api.frankfurter.dev").replace(/\/$/, "") + "/v2";

// Currencies supported by Splitmate's schema (Currency enum)
const SUPPORTED = ["INR", "USD", "EUR", "GBP"];

// ─── In-memory cache (avoids hammering Frankfurter on every CSV import row) ───
// Rates are updated once a business day by Frankfurter, so a 1-hour TTL is safe.

const cache = {
    rates: null,         // { USD: number, EUR: number, GBP: number }  (base = INR)
    fetchedAt: null,     // Date
    TTL_MS: 60 * 60 * 1000, // 1 hour
};

function isCacheValid() {
    return cache.rates && cache.fetchedAt && Date.now() - cache.fetchedAt < cache.TTL_MS;
}

// ─── Internal helper: fetch rates with INR as base ────────────────────────────

async function fetchRatesFromINR() {
    // Frankfurter v2 doesn't support INR as a base (ECB sourced), so we:
    //   1. Fetch EUR→{USD,GBP,INR} from the v2 /rates endpoint
    //   2. v2 returns an array of { date, base, quote, rate } objects
    //   3. Use EUR→INR as a pivot to compute INR→X for every supported currency
    const quotes = SUPPORTED.join(","); // USD,GBP,EUR,INR
    const url = `${FRANKFURTER_BASE}/rates?base=EUR&quotes=${quotes}`;

    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Frankfurter error ${res.status}: ${text}`);
    }

    // v2 returns an array: [{ date, base, quote, rate }, ...]
    const rows = await res.json();
    const byQuote = {};
    let date = new Date().toISOString().split("T")[0];
    for (const row of rows) {
        byQuote[row.quote] = row.rate;
        date = row.date;
    }

    const eurToInr = byQuote["INR"];
    if (!eurToInr) {
        throw new Error("Frankfurter response missing INR rate");
    }

    // INR→X = (EUR→X) / (EUR→INR)
    const ratesFromINR = { INR: 1 };
    for (const [currency, eurRate] of Object.entries(byQuote)) {
        if (currency !== "INR") {
            ratesFromINR[currency] = Math.round((eurRate / eurToInr) * 1e6) / 1e6;
        }
    }

    return { rates: ratesFromINR, date };
}

// ─── GET /api/currency/rates ──────────────────────────────────────────────────
// Returns latest exchange rates for all Splitmate-supported currencies (base=INR).
// Cached for 1 hour.
//
// Response: { base: "INR", date: "YYYY-MM-DD", rates: { USD, EUR, GBP, INR } }

router.get("/rates", async (_req, res) => {
    try {
        if (!isCacheValid()) {
            const { rates, date } = await fetchRatesFromINR();
            cache.rates = rates;
            cache.rates._date = date;
            cache.fetchedAt = Date.now();
        }

        const { _date, ...rates } = cache.rates;

        return res.status(200).json({
            base: "INR",
            date: _date || new Date().toISOString().split("T")[0],
            rates,
            cachedAt: new Date(cache.fetchedAt).toISOString(),
        });
    } catch (err) {
        console.error("[GET /api/currency/rates]", err.message);
        return res.status(502).json({
            error: "Failed to fetch exchange rates from Frankfurter",
            detail: err.message,
        });
    }
});

// ─── GET /api/currency/convert ────────────────────────────────────────────────
// Converts an amount from a given currency to INR.
// Query params:  amount (number), from (currency code)
//
// Example: /api/currency/convert?amount=100&from=USD
// Response: { from, amount, amountInr, rate, date }

router.get("/convert", async (req, res) => {
    try {
        const from = (req.query.from || "").toUpperCase();
        const amount = parseFloat(req.query.amount);

        if (!from || !SUPPORTED.includes(from)) {
            return res.status(400).json({
                error: `Unsupported currency. Supported: ${SUPPORTED.join(", ")}`,
            });
        }
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: "amount must be a positive number" });
        }

        if (from === "INR") {
            return res.status(200).json({
                from: "INR",
                amount,
                amountInr: amount,
                rate: 1,
                date: new Date().toISOString().split("T")[0],
            });
        }

        if (!isCacheValid()) {
            const { rates, date } = await fetchRatesFromINR();
            cache.rates = rates;
            cache.rates._date = date;
            cache.fetchedAt = Date.now();
        }

        // INR→from rate, so to convert from→INR we invert it
        const inrToFrom = cache.rates[from];
        if (!inrToFrom) {
            return res.status(400).json({ error: `No rate available for ${from}` });
        }

        const fromToInr = Math.round((1 / inrToFrom) * 1e6) / 1e6;
        const amountInr = Math.round(amount * fromToInr * 100) / 100;

        return res.status(200).json({
            from,
            amount,
            amountInr,
            rate: fromToInr,
            date: cache.rates._date || new Date().toISOString().split("T")[0],
        });
    } catch (err) {
        console.error("[GET /api/currency/convert]", err.message);
        return res.status(502).json({
            error: "Failed to fetch exchange rates from Frankfurter",
            detail: err.message,
        });
    }
});

module.exports = router;
