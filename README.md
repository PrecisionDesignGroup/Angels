# angels·

a small, quiet tool for restocking jewelry. drop in a photo of a piece you sell and it looks across
etsy and the rest of the web for the same or similar items at your price or less — with an
approximate stock count, and a list of the other shops selling it.

## run it

```sh
cp .env.example .env   # optional — without keys it runs in demo mode
npm start              # → http://localhost:3000
```

needs node 21.7+. no dependencies.

## how it works

1. **photo → google lens** (via serpapi). finds visual matches anywhere on the web, with prices
   and in/out of stock when google knows them.
2. **etsy open api.** every etsy listing lens finds is looked up for its live price and
   `quantity` — that's the "≈ n left" number. it also runs an etsy keyword search (your words, or
   words taken from the best match) capped at your price, to catch similar listings lens missed.
3. **results** are sorted cheapest first and split into *etsy*, *elsewhere*, and *also sold at*
   (shops grouped with their lowest price). "only same price or cheaper" hides anything above
   your price.
4. **profit** on every result: what you'd make selling at your price after etsy fees
   (6.5% transaction, 3% + $0.25 processing, $0.20 listing). sort by cheapest, most profit,
   most in stock or best match; show only items at your price or less, or only profitable ones.

## restock tools

- **my pieces.** after a search, press *save as my piece*. each piece keeps its photo, your
  price, how many you have on hand (− / + as you sell and restock) and a reorder point. pieces at
  or under the reorder point get a *reorder* tag and are counted at the top.
- **suppliers.** ♡ on a result saves it as a supplier for the piece you're searching. each piece
  shows its suppliers, the cheapest one with your profit, and how many are available in total.
  *search again* re-runs the search for a piece.
- **stock history.** saved etsy suppliers are re-checked on *refresh stock*, and automatically
  when you open the site if the last check is over 6 hours old. cards show how many sold since
  you saved them, a rough "out in ~n days" guess, and price drops.
- **copy for spreadsheet** copies pieces and suppliers as a table you can paste into google
  sheets or excel.

pieces and suppliers are saved in your browser, so they stay on that device.

## keys

| key | what for |
| --- | --- |
| `SERPAPI_KEY` | image search across the web (google lens) |
| `ETSY_API_KEY`, `ETSY_SHARED_SECRET` | etsy stock counts + etsy search |
| `PUBLIC_URL` *or* `IMGBB_API_KEY` | lets google lens fetch an uploaded photo. not needed if you paste an image link instead |

## good to know

- stock is approximate. etsy's quantity is what the seller set, and some sellers set it high.
  other shops only report in stock / sold out.
- etsy's api has no image search, so etsy coverage = what lens finds + a keyword sweep. adding a
  few words ("gold herringbone necklace") sharpens it.
- prices are compared as plain numbers — mixed currencies aren't converted.
