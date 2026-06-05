import fs from "fs";
import fetch from "node-fetch";

const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY || process.env.RAINFOREST_KEY;
const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || "amazon.com";
const LIMIT = Number(process.env.AMAZON_KEYWORD_LIMIT || 25);
const RESULTS_PER_KEYWORD = Number(process.env.AMAZON_RESULTS_PER_KEYWORD || 5);

if (!RAINFOREST_API_KEY) {
  console.error("Missing RAINFOREST_API_KEY secret.");
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const number = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function keywordsFromGoogle() {
  if (!fs.existsSync("google-trends.json")) return [];
  const data = JSON.parse(fs.readFileSync("google-trends.json", "utf-8"));
  return (data.signals || [])
    .sort((a, b) => number(b.googleTrendScore) - number(a.googleTrendScore))
    .map(s => s.keyword)
    .filter(Boolean)
    .slice(0, LIMIT);
}

async function rainforest(params) {
  const url = new URL("https://api.rainforestapi.com/request");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", RAINFOREST_API_KEY);

  const res = await fetch(url);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok || data.request_info?.success === false || data.error) {
    throw new Error(`Rainforest error ${res.status}: ${JSON.stringify(data).slice(0, 700)}`);
  }

  return data;
}

function getPrice(item) {
  return number(item?.price?.value ?? item?.prices?.[0]?.value ?? item?.raw_price ?? item?.price);
}

function demandScore(item, index) {
  const rankScore = Math.max(0, 35 - index * 4);
  const reviews = Math.min(35, Math.log10(number(item.ratings_total || item.reviews_total) + 1) * 14);
  const rating = Math.min(20, number(item.rating) * 4);
  const price = getPrice(item);
  const dropshipPriceFit = price > 8 && price < 90 ? 10 : 4;
  return Math.round(Math.max(1, Math.min(100, rankScore + reviews + rating + dropshipPriceFit)));
}

function normalizeItem(keyword, item, index) {
  return {
    keyword,
    asin: item.asin || "",
    title: item.title || "",
    link: item.link || item.url || "",
    image: item.image || item.thumbnail || "",
    price: getPrice(item),
    rating: number(item.rating),
    ratingsTotal: number(item.ratings_total || item.reviews_total),
    position: number(item.position || index + 1),
    isPrime: Boolean(item.is_prime),
    amazonDemandScore: demandScore(item, index)
  };
}

async function main() {
  const keywords = keywordsFromGoogle();
  const products = [];
  const byKeyword = [];

  for (const keyword of keywords) {
    try {
      console.log(`Fetching Amazon/Rainforest: ${keyword}`);
      const data = await rainforest({
        type: "search",
        amazon_domain: AMAZON_DOMAIN,
        search_term: keyword,
        sort_by: "bestseller_rankings",
        exclude_sponsored: "true",
        number_of_results: String(RESULTS_PER_KEYWORD)
      });

      const results = Array.isArray(data.search_results) ? data.search_results : [];
      const normalized = results.slice(0, RESULTS_PER_KEYWORD).map((item, index) => normalizeItem(keyword, item, index));
      products.push(...normalized);

      const best = normalized.sort((a, b) => b.amazonDemandScore - a.amazonDemandScore)[0];
      byKeyword.push({
        keyword,
        amazonDemandScore: best?.amazonDemandScore || 0,
        bestTitle: best?.title || "",
        bestAsin: best?.asin || "",
        bestRating: best?.rating || 0,
        bestRatingsTotal: best?.ratingsTotal || 0,
        bestPrice: best?.price || 0,
        resultCount: normalized.length,
        topResults: normalized.slice(0, 3)
      });

      await sleep(1200);
    } catch (err) {
      console.warn(`Amazon/Rainforest failed for "${keyword}": ${err.message}`);
    }
  }

  byKeyword.sort((a, b) => b.amazonDemandScore - a.amazonDemandScore);

  fs.writeFileSync("amazon-products.json", JSON.stringify({
    updatedAt: new Date().toISOString(),
    source: "Rainforest Amazon API",
    amazonDomain: AMAZON_DOMAIN,
    keywordCount: keywords.length,
    productCount: products.length,
    signals: byKeyword,
    products
  }, null, 2));

  console.log(`Saved ${products.length} Amazon products for ${byKeyword.length} keywords.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
