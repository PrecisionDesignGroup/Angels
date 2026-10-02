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
4. **♡ keep** saves a listing in your browser; *refresh stock* re-checks kept etsy listings.

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
