import { Layout } from './Layout.js';

interface ViewerProps {
  tickers?: any[];
  sectors?: string[];
  currentSector?: string;
  currentSort?: string;
  currentSearch?: string;
  currentPage?: number;
  totalPages?: number;
}

export function Viewer({
  tickers = [],
  sectors = [],
  currentSector = '',
  currentSort = 'code_asc',
  currentSearch = '',
  currentPage = 1,
  totalPages = 1,
}: ViewerProps = {}) {
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
        <form method="GET" action="" class="filter-form" id="filterForm">
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
              </div>
            </div>

            {/* Sector */}
            <div class="form-group">
              <label for="sectorSelect">33業種絞り込み</label>
              <select id="sectorSelect" name="sector">
                <option value="">全業種を表示</option>
              </select>
            </div>

            {/* Sort */}
            <div class="form-group">
              <label for="sortSelect">並べ替え順</label>
              <select id="sortSelect" name="sort">
                <option value="code_asc" selected={currentSort === 'code_asc'}>銘柄コード順 (昇順)</option>
                <option value="market_cap_desc" selected={currentSort === 'market_cap_desc'}>時価総額順 (大きい順)</option>
                <option value="market_cap_asc" selected={currentSort === 'market_cap_asc'}>時価総額順 (小さい順)</option>
                <option value="per_asc" selected={currentSort === 'per_asc'}>PER安順 (割安)</option>
                <option value="per_desc" selected={currentSort === 'per_desc'}>PER高順</option>
                <option value="pbr_asc" selected={currentSort === 'pbr_asc'}>PBR安順 (1倍割れ等)</option>
                <option value="pbr_desc" selected={currentSort === 'pbr_desc'}>PBR高順</option>
                <option value="div_yield_desc" selected={currentSort === 'div_yield_desc'}>配当利回り順 (高い順)</option>
                <option value="ipo_date_desc" selected={currentSort === 'ipo_date_desc'}>上場日順 (新しい順)</option>
                <option value="ipo_date_asc" selected={currentSort === 'ipo_date_asc'}>上場日順 (古い順)</option>
              </select>
            </div>
            
            <button type="submit" class="apply-filter-btn">条件を適用</button>
          </div>
        </form>
      </aside>

      <div class="app-container" id="appContainer" data-search={currentSearch} data-sector={currentSector} data-sort={currentSort}>
        <header>
          <div>
            <h1 class="brand-title">AGY Stock Chart Viewer</h1>
            <div class="brand-subtitle">月足・週足・日足を並列でパノラマビュー表示</div>
            
            {/* Active Filters Display (Hydrated by JS) */}
            <div class="active-filters-bar">
              <span class="active-filter-label">現在の条件:</span>
              <span class="filter-badge">🔍 すべて</span>
              <span class="filter-badge">📁 業種: すべて</span>
              <span class="filter-badge accent-badge">↕️ コード順</span>
            </div>
          </div>
          <div class="system-stats">
            <span class="stat-badge">DB Status: Static Data</span>
          </div>
        </header>

        {/* Ticker List (Hydrated dynamically by JS) */}
        <section class="ticker-list" id="tickerListContainer">
          <div class="loading-indicator">
            <div class="spinner"></div>
            <span>株価データを読み込み中...</span>
          </div>
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

      {/* Ticker Detail Info Modal */}
      <div id="detailModal" class="detail-modal-overlay" onclick="closeDetailModal()">
        <div class="detail-modal-card" onclick="event.stopPropagation()">
          <span class="detail-modal-close-btn" onclick="closeDetailModal()">&times;</span>
          <div class="detail-modal-header">
            <h2>
              <span id="modalTickerCode" class="ticker-code-badge"></span>
              <span id="modalTickerName"></span>
            </h2>
            <div id="modalTickerMarket" class="ticker-market-text"></div>
            <div class="detail-modal-price-row">
              <span id="modalTickerPrice" class="detail-modal-price">---</span>
              <span id="modalTickerChange" class="detail-modal-change">---</span>
            </div>
          </div>
          <div class="detail-modal-body">
            <div class="detail-modal-grid-3col">
              {/* Box 1: Trade Data */}
              <div class="detail-modal-sub-card">
                <div class="detail-modal-sub-card-title">株価・取引データ</div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">始値</span>
                  <span id="modalTickerOpen" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">前日終値</span>
                  <span id="modalTickerPrevClose" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">本日高値</span>
                  <span id="modalTickerHigh" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">本日安値</span>
                  <span id="modalTickerLow" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">売買高</span>
                  <span id="modalTickerVolume" class="detail-modal-data-value">---</span>
                </div>
              </div>

              {/* Box 2: Financial Metrics */}
              <div class="detail-modal-sub-card">
                <div class="detail-modal-sub-card-title">詳細財務指標</div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">業種</span>
                  <span id="modalTickerSector" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">時価総額</span>
                  <span id="modalTickerMarketCap" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">実績PER</span>
                  <span id="modalTickerPER" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">PBR</span>
                  <span id="modalTickerPBR" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">配当利回り</span>
                  <span id="modalTickerDivYield" class="detail-modal-data-value">---</span>
                </div>
              </div>

              {/* Box 3: Technical & 52-Week Deviations */}
              <div class="detail-modal-sub-card">
                <div class="detail-modal-sub-card-title">移動平均・52週乖離</div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">50日線乖離</span>
                  <span id="modalTickerMA50" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">200日線乖離</span>
                  <span id="modalTickerMA200" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">52週安値から</span>
                  <span id="modalTickerLow52" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">52週高値から</span>
                  <span id="modalTickerHigh52" class="detail-modal-data-value">---</span>
                </div>
                <div class="detail-modal-data-row">
                  <span class="detail-modal-data-label">上場日</span>
                  <span id="modalTickerIpoDate" class="detail-modal-data-value">---</span>
                </div>
              </div>
            </div>

            <div class="detail-modal-actions">
              <a id="modalYahooLink" href="" target="_blank" rel="noopener noreferrer" class="detail-action-link-btn detail-primary-btn">
                🌐 Yahoo!ファイナンスで詳細を見る
              </a>
              <a id="modalTradingViewLink" href="" target="_blank" rel="noopener noreferrer" class="detail-action-link-btn detail-secondary-btn">
                📈 TradingView で表示
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* CSS Styles Specific to Viewer page */}
      <link rel="stylesheet" href="./public/viewer.css" />

      {/* Lightbox / Modal / Drawer / Infinite Scroll JavaScript */}
      <script src="./public/viewer.js" defer></script>
    </Layout>
  );
}
