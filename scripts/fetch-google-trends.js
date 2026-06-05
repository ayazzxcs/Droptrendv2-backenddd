import fs from "fs";
import fetch from "node-fetch";

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const GEO = process.env.GOOGLE_TRENDS_GEO || "US";
const DATE_RANGE = process.env.GOOGLE_TRENDS_DATE || "today 1-m";
const LIMIT = Number(process.env.GOOGLE_TRENDS_LIMIT || 40);
const STATIC_KEYWORDS = (process.env.TREND_KEYWORDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (!SERPAPI_KEY) {
  console.error("Missing SERPAPI_KEY secret.");
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const number = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function cleanName(text) {
  return String(text || "")
    .replace(/[\[\]"']/g, " ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordFromProduct(product) {
  const rawName = product?.raw?.productNameEn || product?.name || "";
  const name = cleanName(rawName)
    .split(/\s+/)
    .filter(w => w.length > 2 && !/^(for|and|with|the|new|hot|sale|dropshipping|product)$/i.test(w))
    .slice(0, 5)
    .join(" ");

  const category = cleanName(product?.category || "");
  return name || category;
}

function buildKeywords() {
  const products = fs.existsSync("products.json")
    ? JSON.parse(fs.readFileSync("products.json", "utf-8"))
    : [];

  const fromProducts = products
    .slice(0, Math.max(LIMIT * 3, 100))
    .map(keywordFromProduct)
    .filter(Boolean);

  const keywords = [...STATIC_KEYWORDS, ...fromProducts];
  const seen = new Set();

  return keywords.filter(k => {
    const key = k.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return k.split(/\s+/).length <= 6;
  }).slice(0, LIMIT);
}

async function serpApi(params) {
  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", SERPAPI_KEY);

  const res = await fetch(url);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok || data.error) {
    throw new Error(`SerpApi error ${res.status}: ${JSON.stringify(data).slice(0, 700)}`);
  }

  return data;
}

function avg(values) {
  const nums = values.map(number).filter(n => n > 0);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function parseTrend(keyword, data) {
  const timeline = data?.interest_over_time?.timeline_data || [];
  const values = timeline.map(row => {
    const v = row?.values?.[0];
    return number(v?.extracted_value ?? v?.value);
  }).filter(n => Number.isFinite(n));

  const half = Math.max(1, Math.floor(values.length / 2));
  const firstAvg = avg(values.slice(0, half));
  const lastAvg = avg(values.slice(half));
  const maxValue = values.length ? Math.max(...values) : 0;
  const latestValue = values.length ? values[values.length - 1] : 0;
  const growthPercent = firstAvg > 0 ? Math.round(((lastAvg - firstAvg) / firstAvg) * 100) : Math.round(lastAvg * 2);

  const growthScore = Math.max(0, Math.min(55, growthPercent * 0.45));
  const volumeScore = Math.max(0, Math.min(30, lastAvg * 0.35));
  const momentumScore = latestValue >= lastAvg ? 15 : 6;
  const googleTrendScore = Math.round(Math.max(1, Math.min(100, growthScore + volumeScore + momentumScore)));

  return {
    keyword,
    googleTrendScore,
    growthPercent,
    firstAvg: Math.round(firstAvg),
    lastAvg: Math.round(lastAvg),
    latestValue,
    maxValue,
    timelinePoints: values.length
  };
}

async function main() {
  const keywords = buildKeywords();
  const signals = [];

  for (const keyword of keywords) {
    try {
      console.log(`Fetching Google Trends: ${keyword}`);
      const data = await serpApi({
        engine: "google_trends",
        q: keyword,
        date: DATE_RANGE,
        geo: GEO,
        data_type: "TIMESERIES"
      });
      signals.push(parseTrend(keyword, data));
      await sleep(1200);
    } catch (err) {
      console.warn(`Google Trends failed for "${keyword}": ${err.message}`);
    }
  }

  signals.sort((a, b) => b.googleTrendScore - a.googleTrendScore);

  fs.writeFileSync("google-trends.json", JSON.stringify({
    updatedAt: new Date().toISOString(),
    source: "SerpApi Google Trends",
    geo: GEO,
    dateRange: DATE_RANGE,
    count: signals.length,
    signals
  }, null, 2));

  console.log(`Saved ${signals.length} Google Trends signals.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
