# DropTrend Backend

This backend fetches supplier products from CJdropshipping, validates demand with Google Trends and Amazon, then writes a ranked `products.json` file for the frontend.

## Current architecture

```text
CJdropshipping API
+ Google Trends via SerpApi
+ Amazon data via Rainforest API
↓
DropTrend Score
↓
products.json
```

Meta Ad Library and AliExpress are not used in this version.

## Score formula

```text
DropTrend Score =
40% Google Trends growth
+ 40% Amazon demand
+ 20% CJ supplier availability
```

Each product also gets `trendProof`, so the frontend can show why it is trending:

- Google search growth
- Amazon demand proof
- CJ supplier price, margin, shipping, stock/listing data

## Required GitHub Secrets

Repo → Settings → Secrets and variables → Actions → Secrets

```env
CJ_EMAIL=your_cj_email
CJ_API_KEY=your_cj_api_key
SERPAPI_KEY=your_serpapi_key
RAINFOREST_API_KEY=your_rainforest_api_key
```

## Files generated

- `products.json` — final product feed for frontend
- `products-meta.json` — run metadata
- `google-trends.json` — Google Trends signals
- `amazon-products.json` — Amazon/Rainforest signals
- `cj-sample-product.json` — sample raw CJ response for debugging

## Run manually

```bash
npm install
npm run fetch:all
```

Or in GitHub:

Actions → Fetch DropTrend Products → Run workflow

## Frontend URL

Use the raw GitHub URL for `products.json` in the frontend:

```text
https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/products.json
```

## Important

Do not put API keys in frontend HTML or JavaScript. Keep them only in GitHub Secrets.
