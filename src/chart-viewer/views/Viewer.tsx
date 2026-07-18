import { Layout } from './Layout.js';

export interface TickerData {
  code: string;
  name: string;
  market: string;
  sector33: string | null;
  market_cap: number | null;
  ipo_date: string | null;
}

export interface TickerCardProps {
  t: TickerData;
  formatMarketCap: (val: any) => string;
  formatIpoDate: (val: string | null) => string;
}

export function TickerCard({ t, formatMarketCap, formatIpoDate }: TickerCardProps) {
  return (
    <div class="ticker-card" id={`ticker-${t.code}`}>
      {/* Card Header info */}
      <div class="ticker-card-info">
        <div class="left-info">
          <span class="ticker-code-badge">{t.code}</span>
          <h2 class="ticker-name-text">{t.name}</h2>
          <span class="ticker-market-text">{t.market}</span>
        </div>
        <div class="right-info">
          <div class="metadata-item">
            <span class="meta-label">業種:</span>
            <span class="meta-value">{t.sector33 || '---'}</span>
          </div>
          <div class="metadata-item">
            <span class="meta-label">時価総額:</span>
            <span class="meta-value accent-text">{formatMarketCap(t.market_cap)}</span>
          </div>
          <div class="metadata-item">
            <span class="meta-label">データ上場日:</span>
            <span class="meta-value">{formatIpoDate(t.ipo_date)}</span>
          </div>
        </div>
      </div>

      {/* Panorama Charts Grid */}
      <div class="charts-panorama">
        {/* Monthly Chart */}
        <div class="chart-box">
          <div class="chart-box-header">
            <span class="chart-type type-monthly">月足</span>
            <span class="ma-label">MA 12/24</span>
          </div>
          <div class="image-container" onclick={`openLightbox('/charts/monthly/${t.code}.webp', '${t.name.replace(/'/g, "\\'")} (${t.code}) - 月足')`}>
            <img 
              src={`/charts/monthly/${t.code}.webp`} 
              alt={`${t.name} 月足`} 
              loading="lazy" 
              onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\'no-image\'>チャート画像未生成</div>';" 
            />
          </div>
        </div>

        {/* Weekly Chart */}
        <div class="chart-box">
          <div class="chart-box-header">
            <span class="chart-type type-weekly">週足</span>
            <span class="ma-label">MA 13/26</span>
          </div>
          <div class="image-container" onclick={`openLightbox('/charts/weekly/${t.code}.webp', '${t.name.replace(/'/g, "\\'")} (${t.code}) - 週足')`}>
            <img 
              src={`/charts/weekly/${t.code}.webp`} 
              alt={`${t.name} 週足`} 
              loading="lazy" 
              onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\'no-image\'>チャート画像未生成</div>';" 
            />
          </div>
        </div>

        {/* Daily Chart */}
        <div class="chart-box">
          <div class="chart-box-header">
            <span class="chart-type type-daily">日足</span>
            <span class="ma-label">MA 5/25/75</span>
          </div>
          <div class="image-container" onclick={`openLightbox('/charts/daily/${t.code}.webp', '${t.name.replace(/'/g, "\\'")} (${t.code}) - 日足')`}>
            <img 
              src={`/charts/daily/${t.code}.webp`} 
              alt={`${t.name} 日足`} 
              loading="lazy" 
              onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\'no-image\'>チャート画像未生成</div>';" 
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ViewerProps {
  tickers: TickerData[];
  sectors: string[];
  currentSector: string;
  currentSort: string;
  currentSearch: string;
  currentPage: number;
  totalPages: number;
}

export function Viewer({
  tickers,
  sectors,
  currentSector,
  currentSort,
  currentSearch,
  currentPage,
  totalPages,
}: ViewerProps) {
  // Format market cap helper
  const formatMarketCap = (val: any) => {
    if (val === null || val === undefined) return '---';
    const numVal = Number(val);
    const oku = numVal / 100000000;
    if (oku >= 10000) {
      return `${(oku / 10000).toFixed(2)}兆円`;
    }
    return `${Math.round(oku).toLocaleString()}億円`;
  };

  // Format IPO date helper
  const formatIpoDate = (val: string | null) => {
    if (!val) return '---';
    return val;
  };

  return (
    <Layout title="株価チャート・マルチビューア">
      {/* Drawer Overlay */}
      <div id="drawerOverlay" class="drawer-overlay" onclick="toggleDrawer(false)"></div>

      {/* Hamburger Trigger Button */}
      <button id="menuTrigger" class="menu-trigger" onclick="toggleDrawer()" title="フィルターを開く">
        <span></span>
        <span></span>
        <span></span>
      </button>

      {/* Slide-out Drawer */}
      <aside id="filterDrawer" class="filter-drawer">
        <div class="drawer-header">
          <h2>📊 フィルター & ソート</h2>
          <span class="close-drawer-btn" onclick="toggleDrawer(false)">&times;</span>
        </div>
        <form method="GET" action="/" class="filter-form" id="filterForm">
          <div class="form-grid-vertical">
            {/* Search */}
            <div class="form-group search-group">
              <label for="searchInput">コード・銘柄名検索</label>
              <div class="search-input-wrapper">
                <input
                  type="text"
                  id="searchInput"
                  name="search"
                  placeholder="例: トヨタ、7203"
                  value={currentSearch}
                />
                {currentSearch && (
                  <button type="button" class="clear-btn" onclick="document.getElementById('searchInput').value=''; document.getElementById('filterForm').submit();">×</button>
                )}
              </div>
            </div>

            {/* Sector */}
            <div class="form-group">
              <label for="sectorSelect">33業種絞り込み</label>
              <select id="sectorSelect" name="sector" onchange="this.form.submit()">
                <option value="">全業種を表示</option>
                {sectors.map(s => (
                  <option value={s} selected={s === currentSector}>{s}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div class="form-group">
              <label for="sortSelect">並べ替え順</label>
              <select id="sortSelect" name="sort" onchange="this.form.submit()">
                <option value="code_asc" selected={currentSort === 'code_asc'}>銘柄コード順 (昇順)</option>
                <option value="market_cap_desc" selected={currentSort === 'market_cap_desc'}>時価総額順 (大きい順)</option>
                <option value="market_cap_asc" selected={currentSort === 'market_cap_asc'}>時価総額順 (小さい順)</option>
                <option value="ipo_date_desc" selected={currentSort === 'ipo_date_desc'}>上場日順 (新しい順)</option>
                <option value="ipo_date_asc" selected={currentSort === 'ipo_date_asc'}>上場日順 (古い順)</option>
              </select>
            </div>
            
            <button type="submit" class="apply-filter-btn">条件を適用</button>
          </div>
          
          {/* hidden page input to reset page when filters change */}
          <input type="hidden" name="page" value="1" id="pageInput" />
        </form>
      </aside>

      <div class="app-container" id="appContainer" data-search={currentSearch} data-sector={currentSector} data-sort={currentSort}>
        <header>
          <div>
            <h1 class="brand-title">AGY Stock Chart Viewer</h1>
            <div class="brand-subtitle">月足・週足・日足を並列でパノラマビュー表示</div>
            
            {/* Active Filters Display */}
            <div class="active-filters-bar">
              <span class="active-filter-label">現在の条件:</span>
              <span class="filter-badge">
                🔍 {currentSearch ? `検索: "${currentSearch}"` : 'すべて'}
              </span>
              <span class="filter-badge">
                📁 業種: {currentSector || 'すべて'}
              </span>
              <span class="filter-badge accent-badge">
                ↕️ {currentSort === 'code_asc' ? 'コード順' : 
                    currentSort === 'market_cap_desc' ? '時価総額大順' :
                    currentSort === 'market_cap_asc' ? '時価総額小順' :
                    currentSort === 'ipo_date_desc' ? '上場日新順' : '上場日古順'}
              </span>
            </div>
          </div>
          <div class="system-stats">
            <span class="stat-badge">DB Status: Online</span>
          </div>
        </header>

        {/* Ticker List */}
        <section class="ticker-list" id="tickerListContainer">
          {tickers.length === 0 ? (
            <div class="empty-state">
              <div class="empty-icon">🔍</div>
              <h3>該当する銘柄が見つかりませんでした</h3>
              <p>検索キーワードや業種フィルターの条件を変えてお試しください。</p>
            </div>
          ) : (
            tickers.map(t => (
              <TickerCard t={t} formatMarketCap={formatMarketCap} formatIpoDate={formatIpoDate} />
            ))
          )}
        </section>

        {/* Loading Indicator for Infinite Scroll */}
        <div id="loadingIndicator" class="loading-indicator" style="display: none;">
          <div class="spinner"></div>
          <span>さらに読み込み中...</span>
        </div>
      </div>

      {/* Lightbox / Modal */}
      <div id="lightbox" class="lightbox" onclick="closeLightbox()">
        <span class="lightbox-close">&times;</span>
        <div class="lightbox-content" onclick="event.stopPropagation()">
          <img id="lightboxImg" src="" alt="拡大画像" />
          <div id="lightboxCaption" class="lightbox-caption"></div>
        </div>
      </div>

      {/* CSS Styles Specific to Viewer page */}
      <link rel="stylesheet" href="/public/viewer.css" />

      {/* Lightbox / Modal / Drawer / Infinite Scroll JavaScript */}
      <script src="/public/viewer.js" defer></script>
    </Layout>
  );
}
