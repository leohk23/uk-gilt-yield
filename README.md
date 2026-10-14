# uk-gilt-yield

UK gilt maths in one file with no dependencies: the **gross redemption yield** the UK Debt
Management Office quotes, the **clean price for a yield**, **accrued interest** (including the
negative accrued interest of the ex-dividend period), and **coupon and ex-dividend dates**.

You bring the price: your broker's quote, the London Stock Exchange's page, or a contract note.

```
$ node gilt.js 97.25 4 2031-10-22 2026-08-03
Settlement              2026-08-03
Next coupon             2026-10-22, ex-dividend 2026-10-13
Accrued interest        1.1257 per £100 (11.26 per £1,000 nominal)
Dirty price             98.3757
Gross redemption yield  4.597%
Running yield           4.113%
Coupons to receive      11
```

Arguments: clean price per £100 nominal, coupon in percent, maturity date, and optionally the
settlement date (default: the next business day). Figures above are illustrative.

## As a library

```js
const g = require('./gilt.js');

g.grossRedemptionYield(97.25, 4, '2031-10-22', '2026-08-03');   // 0.04597 (a fraction)
g.cleanPriceFromYield(0.045, 4, '2031-10-22', '2026-08-03');    // the price at a 4.5% yield
g.accruedInterest(4, '2031-10-22', '2026-08-03');               // 1.1257 per £100
g.exDividendDate('2026-10-22');                                 // '2026-10-13'
g.settlementDate('2026-10-09');                                 // '2026-10-12' (Friday -> Monday)
g.couponOf('4 1/4% TREASURY GILT 07/12/27');                    // 4.25, from an exchange name
```

The date functions take an optional list of UK bank holidays as ISO dates
(`{ holidays: ['2026-12-25', ...] }` for the pricing functions, a second argument for
`settlementDate` and `exDividendDate`). Without it, only weekends are skipped, which can put an
ex-dividend or settlement date a day out around a bank holiday.

## Conventions

The DMO's, for conventional (fixed-coupon) gilts:

- Prices are **clean**, per £100 nominal. What you pay is the dirty price: clean plus accrued.
- Coupons are paid **half-yearly**, on the maturity date's day and month and six months either
  side. A 31st falls back to the month's last day.
- **Accrued interest** is actual days since the last coupon over actual days in the coupon period,
  times half the annual coupon.
- A gilt goes **ex-dividend 7 business days** before each coupon. A buyer settling on or after
  that date does not receive the coupon, so accrued interest turns **negative**: the buyer is
  compensated for the days left until a coupon that goes to the seller. The yield calculation
  drops that coupon from the buyer's cash flows.
- The **gross redemption yield** compounds half-yearly, with the first period discounted by the
  fraction of it still to run. It is gross of tax. Gilt coupons are taxable as income in the UK,
  and gains on gilts are exempt from capital gains tax, so a low-coupon gilt bought below par can
  be worth more after tax than its gross yield suggests.
- Settlement is **T+1**.

## Not covered

- **Index-linked gilts.** They are priced in real terms against the RPI, with an indexation lag;
  `couponOf` returns `null` for them rather than a misleading number.
- Gilts with an odd first coupon period, and the handful of undated or double-dated old issues.

## Test

```sh
node gilt.js --selftest
```

Covers coupon parsing, date rolling, accrued interest on both sides of the ex-dividend date,
yields with closed-form answers (par on a coupon date, a zero-coupon bond), and price-to-yield
round trips inside and outside the ex-dividend window.

## Licence

MIT. See [LICENSE](LICENSE). Not financial advice; check any figure you rely on against the DMO
or your broker.
