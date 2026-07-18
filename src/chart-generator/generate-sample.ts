import { writeFileSync, mkdirSync, existsSync, copyFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import {
  fetchDailyPrices,
  fetchWeeklyPrices,
  fetchMonthlyPrices,
} from '../shared/repository/duckdb.js';
import { generateChartWebp } from './generator.js';

const TARGET_TICKERS = [
  { ticker: '7203.T', name: 'トヨタ自動車' },
  { ticker: '6758.T', name: 'ソニーグループ' },
  { ticker: '9984.T', name: 'ソフトバンクグループ' },
  { ticker: '8306.T', name: '三菱UFJフィナンシャルG' }
];

async function main() {
  // Local output directory
  const outDir = './data/charts';
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Artifacts directory if specified via env
  const artifactDir = process.env.ARTIFACT_DIR || '';
  if (artifactDir && !existsSync(artifactDir)) {
    mkdirSync(artifactDir, { recursive: true });
  }

  // Workaround for DB Lock conflict: Create a temporary copy of the DB file
  const originalDb = resolve('stock.duckdb');
  const tempDb = resolve('stock.duckdb.tmp-run');
  console.log(`Copying DB to avoid lock conflicts...`);
  copyFileSync(originalDb, tempDb);

  try {
    for (const target of TARGET_TICKERS) {
      const { ticker, name } = target;
      console.log(`Generating charts for ${name} (${ticker})...`);

      // 1. Daily (120 trading days)
      const dailyData = await fetchDailyPrices(ticker, 120, tempDb);
      console.log(`  Daily: ${dailyData.length} rows`);
      const dailyWebp = await generateChartWebp(dailyData, {
        title: name,
        ticker: ticker,
        type: 'daily',
      });
      writeFileSync(join(outDir, `${ticker}-daily.webp`), dailyWebp);
      if (artifactDir) {
        writeFileSync(join(artifactDir, `${ticker}-daily.webp`), dailyWebp);
      }

      // 2. Weekly (100 weeks)
      const weeklyData = await fetchWeeklyPrices(ticker, 100, tempDb);
      console.log(`  Weekly: ${weeklyData.length} rows`);
      const weeklyWebp = await generateChartWebp(weeklyData, {
        title: name,
        ticker: ticker,
        type: 'weekly',
      });
      writeFileSync(join(outDir, `${ticker}-weekly.webp`), weeklyWebp);
      if (artifactDir) {
        writeFileSync(join(artifactDir, `${ticker}-weekly.webp`), weeklyWebp);
      }

      // 3. Monthly (120 months)
      const monthlyData = await fetchMonthlyPrices(ticker, 120, tempDb);
      console.log(`  Monthly: ${monthlyData.length} rows`);
      const monthlyWebp = await generateChartWebp(monthlyData, {
        title: name,
        ticker: ticker,
        type: 'monthly',
      });
      writeFileSync(join(outDir, `${ticker}-monthly.webp`), monthlyWebp);
      if (artifactDir) {
        writeFileSync(join(artifactDir, `${ticker}-monthly.webp`), monthlyWebp);
      }
    }

    // Generate Dynamic preview.html content
    const chartSectionsHtml = TARGET_TICKERS.map(t => `
    <section class="ticker-section">
      <div class="ticker-header">
        <span class="ticker-name">${t.name}</span>
        <span class="ticker-badge">${t.ticker}</span>
      </div>
      <div class="charts-grid">
        <!-- Monthly Chart (Left) -->
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-type-tag type-monthly">月足 (10年)</span>
            <span class="chart-ma-desc">MA12/24</span>
          </div>
          <div class="chart-wrapper" onclick="openModal('./${t.ticker}-monthly.webp', '${t.name} (${t.ticker}) - 月足チャート')">
            <img class="chart-img" src="./${t.ticker}-monthly.webp" alt="${t.name} 月足">
          </div>
        </div>

        <!-- Weekly Chart (Center) -->
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-type-tag type-weekly">週足 (2年)</span>
            <span class="chart-ma-desc">MA13/26</span>
          </div>
          <div class="chart-wrapper" onclick="openModal('./${t.ticker}-weekly.webp', '${t.name} (${t.ticker}) - 週足チャート')">
            <img class="chart-img" src="./${t.ticker}-weekly.webp" alt="${t.name} 週足">
          </div>
        </div>

        <!-- Daily Chart (Right) -->
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-type-tag type-daily">日足 (半年)</span>
            <span class="chart-ma-desc">MA5/25/75</span>
          </div>
          <div class="chart-wrapper" onclick="openModal('./${t.ticker}-daily.webp', '${t.name} (${t.ticker}) - 日足チャート')">
            <img class="chart-img" src="./${t.ticker}-daily.webp" alt="${t.name} 日足">
          </div>
        </div>
      </div>
    </section>
    `).join('\n');

    const previewHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>株価チャート プロトタイプ プレビュー</title>
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #0b0f19;
      --card-bg: #111827;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #38bdf8;
      --border-color: #1f2937;
      --shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.5);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      padding: 1rem 0.75rem;
    }

    .container {
      max-width: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    header {
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 2.5rem;
      font-weight: 800;
      background: linear-gradient(to right, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.05em;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
    }

    /* Ticker Section Layout */
    .ticker-section {
      background-color: var(--card-bg);
      border-radius: 16px;
      border: 1px solid var(--border-color);
      padding: 1.25rem;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .ticker-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 0.75rem;
    }

    .ticker-name {
      font-size: 1.35rem;
      font-weight: 700;
      font-family: 'Outfit', sans-serif;
      color: #ffffff;
    }

    .ticker-badge {
      background-color: rgba(56, 189, 248, 0.1);
      color: var(--accent);
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 0.8rem;
      border: 1px solid rgba(56, 189, 248, 0.2);
    }

    /* Charts Grid - Monthly, Weekly, Daily */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }

    @media (max-width: 1024px) {
      .charts-grid {
        grid-template-columns: 1fr;
      }
    }

    .chart-card {
      background-color: rgba(255, 255, 255, 0.01);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }



    .chart-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .chart-type-tag {
      font-size: 0.8rem;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      letter-spacing: 0.05em;
    }

    .type-monthly { background-color: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .type-weekly { background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; }
    .type-daily { background-color: rgba(236, 72, 153, 0.15); color: #f472b6; }

    .chart-ma-desc {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .chart-wrapper {
      width: 100%;
      aspect-ratio: 1200 / 800;
      background-color: #0b0f19;
      border-radius: 10px;
      overflow: hidden;
      cursor: zoom-in;
      border: 1px solid rgba(255, 255, 255, 0.05);
      position: relative;
    }

    .chart-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      transition: transform 0.3s ease;
    }



    /* Modal / Lightbox */
    .modal {
      display: none;
      position: fixed;
      z-index: 1000;
      padding-top: 3rem;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      overflow: auto;
      background-color: rgba(3, 7, 18, 0.95);
      backdrop-filter: blur(10px);
    }

    .modal-content {
      margin: auto;
      display: block;
      width: 92%;
      max-width: 1300px;
      border-radius: 16px;
      border: 1px solid #1f2937;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
      animation: zoom 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes zoom {
      from { transform: scale(0.96); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .close {
      position: absolute;
      top: 1.5rem;
      right: 2rem;
      color: #9ca3af;
      font-size: 2.5rem;
      font-weight: 300;
      transition: color 0.2s;
      cursor: pointer;
      line-height: 1;
    }

    .close:hover {
      color: #ffffff;
    }

    #caption {
      margin: auto;
      display: block;
      width: 80%;
      text-align: center;
      color: var(--text-main);
      padding: 1.5rem 0;
      font-size: 1.25rem;
      font-weight: 600;
      font-family: 'Outfit', sans-serif;
    }

    footer {
      text-align: center;
      padding: 2rem 0;
      color: var(--text-muted);
      font-size: 0.85rem;
      border-top: 1px solid var(--border-color);
      margin-top: 2rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    footer code {
      background-color: rgba(255, 255, 255, 0.05);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>株価マルチチャート プレビュー</h1>
      <p class="subtitle">左から月足、週足、日足の順に並べて表示。クリックで拡大できます。</p>
    </header>

    ${chartSectionsHtml}

    <footer>
      <p>このプレビューはローカルで生成された画像を表示しています。</p>
      <p>再生成するには、リポジトリルートで <code>npm run generate-sample</code> を実行してください。</p>
    </footer>
  </div>

  <!-- Image Lightbox Modal -->
  <div id="imageModal" class="modal" onclick="closeModal()">
    <span class="close" onclick="closeModal()">&times;</span>
    <img class="modal-content" id="modalImg">
    <div id="caption"></div>
  </div>

  <script>
    function openModal(src, captionText) {
      const modal = document.getElementById("imageModal");
      const modalImg = document.getElementById("modalImg");
      const caption = document.getElementById("caption");
      modal.style.display = "block";
      modalImg.src = src;
      caption.innerHTML = captionText;
      document.body.style.overflow = "hidden"; // Prevent scrolling
    }

    function closeModal() {
      const modal = document.getElementById("imageModal");
      modal.style.display = "none";
      document.body.style.overflow = "auto"; // Re-enable scrolling
    }

    // Close on escape key
    document.addEventListener('keydown', function(event) {
      if (event.key === "Escape") {
        closeModal();
      }
    });
  </script>
</body>
</html>
`;

    // Write preview_multi.html
    writeFileSync(join(outDir, 'preview_multi.html'), previewHtml);
    console.log(`Created preview page: ${join(outDir, 'preview_multi.html')}`);

    // Generate preview_multi.md content with relative image paths for local markdown viewing
    const markdownContent = `# 複数銘柄チャートプレビュー（月足・週足・日足横並び）

各銘柄ごとに「月足 ➔ 週足 ➔ 日足」の順で横並びに配置したマークダウンです。

---

## 📈 銘柄別チャート一覧
${TARGET_TICKERS.map((t, idx) => `
### ${idx + 1}. ${t.name} (${t.ticker})
| 月足 (120ヶ月/MA12,24) | 週足 (100週/MA13,26) | 日足 (120日/MA5,25,75) |
| :---: | :---: | :---: |
| ![月足](./${t.ticker}-monthly.webp) | ![週足](./${t.ticker}-weekly.webp) | ![日足](./${t.ticker}-daily.webp) |
`).join('\n---\n')}
`;

    writeFileSync(join(outDir, 'preview_multi.md'), markdownContent);
    console.log(`Created preview markdown: ${join(outDir, 'preview_multi.md')}`);

    if (artifactDir) {
      writeFileSync(join(artifactDir, 'preview_multi.html'), previewHtml);
    }

    console.log('All charts generated successfully!');
  } finally {
    // Clean up temporary DB copy
    if (existsSync(tempDb)) {
      console.log(`Cleaning up temporary DB copy...`);
      unlinkSync(tempDb);
    }
  }
}

main().catch(err => {
  console.error('Error generating charts:', err);
  process.exit(1);
});
