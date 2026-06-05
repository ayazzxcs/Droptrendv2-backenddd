import fs from "fs";

const number = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function clean(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text) {
  return clean(text).split(/\s+/).filter(w => w.length > 2 && !/^(for|and|with|the|new|hot|sale|men|women)$/i.test(w));
}

function productText(product) {
  return clean([
    product.name,
    product.raw?.productNameEn,
    product.category,
    product.supplier,
    ...(product.tags || [])
  ].join(" "));
}

function scoreMatch(product, signal) {
  const pText = productText(product);
  const kWords = words(signal.keyword);
  if (!kWords.length) return 0;
  let hits = 0;
  for (const w of kWords) if (pText.includes(w)) hits++;
  return hits / kWords.length;
}

function bestSignal(product, signals, scoreField, minMatch = 0.35) {
  let best = null;
  let bestMatch = 0;

  for (const signal of signals) {
    const match = scoreMatch(product, signal);
    const weighted = match * (number(signal[scoreField]) / 100);
    if (weighted > bestMatch) {
      best = signal;
      bestMatch = weighted;
    }
  }

  if (!best || bestMatch < minMatch * 0.25) return { signal: null, match: 0 };
  return { signal: best, match: Number(Math.min(1, bestMatch * 2).toFixed(2)) };
}

function cjSupplierScore(product) {
  const hasImage = /^https?:\/\//i.test(product.image || "");
  const hasSupplier = /^https?:\/\//i.test(product.supplierUrl || "");
  const margin = number(product.margin);
  const cost = number(product.cost);
  const sell = number(product.sell);
  const shipping = number(product.shipping);
  const listed = number(product.listedCount);
  const inventory = number(product.inventory);

  const imageScore = hasImage ? 15 : 0;
  const supplierScore = hasSupplier ? 10 : 0;
  const priceScore = cost > 0 && sell > cost ? 20 : 0;
  const marginScore = Math.max(0, Math.min(20, (margin - 25) * 0.6));
  const shippingScore = shipping <= cost * 0.8 ? 10 : 4;
  const listedScore = Math.min(15, Math.log10(listed + 1) * 6);
  const stockScore = inventory > 0 ? 10 : 5;

  return Math.round(Math.max(1, Math.min(100, imageScore + supplierScore + priceScore + marginScore + shippingScore + listedScore + stockScore)));
}

function confidence(googleScore, amazonScore, cjScore) {
  const strong = [googleScore, amazonScore, cjScore].filter(s => s >= 55).length;
  if (strong >= 3) return "High";
  if (strong >= 2) return "Medium";
  return "Low";
}

function main() {
  if (!fs.existsSync("products.json")) throw new Error("products.json not found");

  const products = JSON.parse(fs.readFileSync("products.json", "utf-8"));
  const google = fs.existsSync("google-trends.json")
    ? JSON.parse(fs.readFileSync("google-trends.json", "utf-8"))
    : { signals: [] };
  const amazon = fs.existsSync("amazon-products.json")
    ? JSON.parse(fs.readFileSync("amazon-products.json", "utf-8"))
    : { signals: [] };

  const googleSignals = Array.isArray(google.signals) ? google.signals : [];
  const amazonSignals = Array.isArray(amazon.signals) ? amazon.signals : [];

  const enhanced = products.map(product => {
    const googleMatch = bestSignal(product, googleSignals, "googleTrendScore");
    const amazonMatch = bestSignal(product, amazonSignals, "amazonDemandScore");

    const googleScore = googleMatch.signal ? Math.round(number(googleMatch.signal.googleTrendScore) * googleMatch.match) : 0;
    const amazonScore = amazonMatch.signal ? Math.round(number(amazonMatch.signal.amazonDemandScore) * amazonMatch.match) : 0;
    const cjScore = cjSupplierScore(product);

    const dropTrendScore = Math.round(
      (googleScore * 0.4) +
      (amazonScore * 0.4) +
      (cjScore * 0.2)
    );

    const profitBoost = Math.min(12, Math.log10(number(product.profit) + 1) * 5);
    const marginBoost = Math.min(10, Math.max(0, number(product.margin) - 35) * 0.25);

    return {
      ...product,
      trend: Math.max(1, Math.min(100, dropTrendScore)),
      dropTrendScore: Math.max(1, Math.min(100, dropTrendScore)),
      winningScore: Math.round(dropTrendScore + profitBoost + marginBoost),
      trendProof: {
        confidence: confidence(googleScore, amazonScore, cjScore),
        googleTrends: googleMatch.signal ? {
          keyword: googleMatch.signal.keyword,
          score: googleScore,
          rawScore: googleMatch.signal.googleTrendScore,
          growthPercent: googleMatch.signal.growthPercent,
          lastAvg: googleMatch.signal.lastAvg,
          match: googleMatch.match
        } : null,
        amazon: amazonMatch.signal ? {
          keyword: amazonMatch.signal.keyword,
          score: amazonScore,
          rawScore: amazonMatch.signal.amazonDemandScore,
          bestTitle: amazonMatch.signal.bestTitle,
          bestRating: amazonMatch.signal.bestRating,
          bestRatingsTotal: amazonMatch.signal.bestRatingsTotal,
          bestPrice: amazonMatch.signal.bestPrice,
          match: amazonMatch.match
        } : null,
        cjSupplier: {
          score: cjScore,
          price: product.cost,
          shipping: product.shipping,
          margin: product.margin,
          listedCount: product.listedCount,
          inventory: product.inventory
        }
      },
      tags: Array.from(new Set([
        ...(product.tags || []),
        googleMatch.signal ? "Google Trends validated" : null,
        amazonMatch.signal ? "Amazon validated" : null,
        "CJ supplier"
      ].filter(Boolean)))
    };
  });

  enhanced.sort((a, b) => number(b.dropTrendScore) - number(a.dropTrendScore) || number(b.winningScore) - number(a.winningScore));

  fs.writeFileSync("products.json", JSON.stringify(enhanced, null, 2));

  const oldMeta = fs.existsSync("products-meta.json")
    ? JSON.parse(fs.readFileSync("products-meta.json", "utf-8"))
    : {};

  fs.writeFileSync("products-meta.json", JSON.stringify({
    ...oldMeta,
    trendEnhancedAt: new Date().toISOString(),
    trendModel: "DropTrend v2: 40% Google Trends + 40% Amazon/Rainforest + 20% CJ supplier score",
    sources: {
      cj: "CJdropshipping API",
      google: google.source || "SerpApi Google Trends",
      amazon: amazon.source || "Rainforest Amazon API"
    },
    googleSignals: googleSignals.length,
    amazonSignals: amazonSignals.length,
    removedSources: ["Meta Ad Library", "AliExpress"]
  }, null, 2));

  console.log(`Merged ${googleSignals.length} Google signals and ${amazonSignals.length} Amazon signals into ${enhanced.length} products.`);
}

main();
