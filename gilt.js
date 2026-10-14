// UK gilt maths with no dependencies: accrued interest, the gross redemption yield the UK Debt
// Management Office (DMO) quotes, the price for a given yield, coupon dates and ex-dividend dates.
// Conventional (fixed-coupon) gilts; index-linked gilts are priced in real terms and not handled.
//
//   node gilt.js <clean price> <coupon %> <maturity YYYY-MM-DD> [settlement YYYY-MM-DD]
//   node gilt.js 97.25 4 2031-10-22 2026-08-03
//   node gilt.js --selftest
//
// Conventions (the DMO's): prices are clean, per £100 nominal; coupons are paid half-yearly on
// the maturity date's day and month and six months either side; accrued interest is actual days
// over the actual days in the coupon period; a gilt goes ex-dividend 7 business days before each
// coupon, and a buyer settling in that window receives no coupon and is paid negative accrued
// interest; the yield compounds half-yearly. Settlement is the next business day.
//
// Business days skip weekends. Pass UK bank holidays (ISO dates) as `holidays` where a date
// matters to the day; without them, a bank holiday is treated as a working day.
const DAY = 864e5;
const d = s => new Date(s + 'T00:00:00Z');
const iso = dt => dt.toISOString().slice(0, 10);

// "0 1/8% TREASURY GILT 31/01/28" -> 0.125. Null for an index-linked gilt or a name that does not parse.
function couponOf(name) {
    const m = /^(\d+)(?:\s+(\d+)\/(\d+))?%/.exec(String(name || '').trim());
    if (!m || /INDEX/i.test(name)) return null;
    return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

// The coupon date k half-years before maturity, its day clamped to the month (31 Apr is 30 Apr).
function couponDate(maturity, k) {
    const m = d(maturity);
    const x = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 6 * k, 1));
    const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    x.setUTCDate(Math.min(m.getUTCDate(), last));
    return iso(x);
}

const isBusinessDay = (day, holidays = []) => d(day).getUTCDay() % 6 !== 0 && !holidays.includes(day);
const addBusinessDays = (day, n, holidays = []) => {
    let x = d(day);
    for (let moved = 0; moved < Math.abs(n);) {
        x = new Date(x.getTime() + Math.sign(n) * DAY);
        if (isBusinessDay(iso(x), holidays)) moved++;
    }
    return iso(x);
};

// Gilts settle on the next business day after the trade.
const settlementDate = (trade, holidays) => addBusinessDays(trade, 1, holidays);

// A gilt goes ex-dividend 7 business days before the coupon is paid.
const exDividendDate = (coupon, holidays) => addBusinessDays(coupon, -7, holidays);

// Where `settle` sits in the coupon schedule: the coupon dates either side, how many coupons are
// left (including the next), and whether the next one is already ex-dividend.
function schedule(maturity, settle, holidays) {
    if (!(settle < maturity)) throw new Error(`settlement ${settle} is not before maturity ${maturity}`);
    let k = 0;
    while (couponDate(maturity, k + 1) > settle) k++;
    const next = couponDate(maturity, k), prev = couponDate(maturity, k + 1);
    return { prev, next, remaining: k + 1, exDividend: settle >= exDividendDate(next, holidays) };
}

// Accrued interest per £100 nominal. Negative in the ex-dividend window: the seller keeps the
// coupon, so the buyer is compensated for the days left until it is paid.
function accruedInterest(coupon, maturity, settle, { holidays = [] } = {}) {
    const s = schedule(maturity, settle, holidays);
    const period = (d(s.next) - d(s.prev)) / DAY;
    const half = coupon / 2;
    return s.exDividend ? -half * ((d(s.next) - d(settle)) / DAY) / period
        : half * ((d(settle) - d(s.prev)) / DAY) / period;
}

// The dirty price (per £100) at gross redemption yield `y`: every remaining cash flow discounted
// half-yearly, the first by the fraction of the current period still to run.
function dirtyFromYield(y, coupon, maturity, settle, holidays = []) {
    const s = schedule(maturity, settle, holidays);
    const f = (d(s.next) - d(settle)) / (d(s.next) - d(s.prev));
    const v = 1 / (1 + y / 2);
    let pv = 100 * v ** (s.remaining - 1 + f);
    for (let k = s.exDividend ? 1 : 0; k < s.remaining; k++) pv += (coupon / 2) * v ** (k + f);
    return pv;
}

const cleanPriceFromYield = (y, coupon, maturity, settle, { holidays = [] } = {}) =>
    dirtyFromYield(y, coupon, maturity, settle, holidays) - accruedInterest(coupon, maturity, settle, { holidays });

// The gross redemption yield for a clean price, as a fraction (0.0504 = 5.04%), by bisection.
function grossRedemptionYield(clean, coupon, maturity, settle, { holidays = [] } = {}) {
    const dirty = clean + accruedInterest(coupon, maturity, settle, { holidays });
    let lo = -0.5, hi = 2;
    for (let i = 0; i < 100; i++) {
        const y = (lo + hi) / 2;
        if (dirtyFromYield(y, coupon, maturity, settle, holidays) > dirty) lo = y; else hi = y;
    }
    return (lo + hi) / 2;
}

function cli([price, coupon, maturity, settle]) {
    if (!price || !coupon || !maturity) {
        console.log('usage: node gilt.js <clean price> <coupon %> <maturity YYYY-MM-DD> [settlement YYYY-MM-DD]');
        process.exitCode = 1;
        return;
    }
    const clean = Number(price), c = Number(coupon);
    const settleDay = settle || settlementDate(iso(new Date()));
    const s = schedule(maturity, settleDay);
    const ai = accruedInterest(c, maturity, settleDay);
    const pct = v => (v * 100).toFixed(3) + '%';
    const rows = [
        ['Settlement', settleDay + (settle ? '' : ' (next business day)')],
        ['Next coupon', `${s.next}, ex-dividend ${exDividendDate(s.next)}${s.exDividend ? ' (already ex: this buyer does not receive it)' : ''}`],
        ['Accrued interest', `${ai.toFixed(4)} per £100 (${(ai * 10).toFixed(2)} per £1,000 nominal)`],
        ['Dirty price', (clean + ai).toFixed(4)],
        ['Gross redemption yield', pct(grossRedemptionYield(clean, c, maturity, settleDay))],
        ['Running yield', pct(c / clean)],
        ['Coupons to receive', String(s.remaining - (s.exDividend ? 1 : 0))],
    ];
    for (const [k, v] of rows) console.log(k.padEnd(24) + v);
}

function selftest() {
    const assert = require('assert');
    const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

    assert.strictEqual(couponOf('0 1/8% TREASURY GILT 31/01/28'), 0.125);
    assert.strictEqual(couponOf('4% TREASURY GILT 22/10/31'), 4);
    assert.strictEqual(couponOf('4 1/4% TREASURY GILT 07/12/27'), 4.25);
    assert.strictEqual(couponOf('0 1/8% INDEX-LINKED TREASURY GILT 22/03/29'), null);
    assert.strictEqual(couponOf('nonsense'), null);

    assert.strictEqual(couponDate('2031-10-22', 1), '2031-04-22');
    assert.strictEqual(couponDate('2030-10-31', 1), '2030-04-30', 'the day is clamped to the month');
    assert.strictEqual(settlementDate('2026-10-09'), '2026-10-12', 'Friday settles Monday');
    assert.strictEqual(settlementDate('2026-12-24', ['2026-12-25', '2026-12-28']), '2026-12-29', 'bank holidays skipped');
    assert.strictEqual(exDividendDate('2026-10-22'), '2026-10-13', '7 business days before the coupon');

    // Accrued interest on 4% Treasury 2031 settling 3 Aug 2026: 103 of the 183 days since the
    // 22 Apr coupon, so 2 x 103/183 per £100.
    near(accruedInterest(4, '2031-10-22', '2026-08-03'), 2 * 103 / 183, 1e-12, 'accrued');
    near(accruedInterest(4, '2031-10-22', '2026-04-22'), 0, 1e-12, 'nothing accrued on a coupon date');
    // Settling inside the ex-dividend window: negative accrued for the 7 days to the coupon.
    near(accruedInterest(4, '2031-10-22', '2026-10-15'), -2 * 7 / 183, 1e-12, 'negative accrued when ex-dividend');
    near(accruedInterest(4, '2031-10-22', '2026-10-12'), 2 * 173 / 183, 1e-12, 'the day before ex-dividend is still cum');

    // Yield checks with known answers.
    near(grossRedemptionYield(100, 4, '2030-06-07', '2026-06-07'), 0.04, 1e-9, 'at par on a coupon date, the coupon');
    near(grossRedemptionYield(96, 0, '2027-06-07', '2026-06-07'), 2 * (1 / Math.sqrt(0.96) - 1), 1e-9, 'zero coupon, closed form');
    near(grossRedemptionYield(100, 4, '2030-06-07', '2026-09-07'), 0.04, 1e-4, 'mid-period at par: about the coupon, with accrued included');

    // Price and yield invert each other, in and out of the ex-dividend window.
    for (const settle of ['2026-08-03', '2026-10-15', '2027-02-01']) {
        for (const y of [0.01, 0.0504, 0.09]) {
            const p = cleanPriceFromYield(y, 4, '2031-10-22', settle);
            near(grossRedemptionYield(p, 4, '2031-10-22', settle), y, 1e-10, `round trip ${settle} ${y}`);
        }
    }
    // The ex-dividend buyer pays less, because the next coupon goes to the seller.
    assert.ok(cleanPriceFromYield(0.05, 4, '2031-10-22', '2026-10-13') < cleanPriceFromYield(0.05, 4, '2031-10-22', '2026-10-12') + 0.01);
    assert.throws(() => accruedInterest(4, '2031-10-22', '2031-10-22'), /not before maturity/);
    console.log('selftest ok');
}

if (require.main === module) process.argv.includes('--selftest') ? selftest() : cli(process.argv.slice(2));
module.exports = { couponOf, couponDate, settlementDate, exDividendDate, accruedInterest, grossRedemptionYield,
    cleanPriceFromYield, dirtyFromYield, schedule };
