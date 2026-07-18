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

      {/* CSS Styles Specific to Viewer page */}
      <link rel="stylesheet" href="./public/viewer.css" />

      {/* Lightbox / Modal / Drawer / Infinite Scroll JavaScript */}
      <script src="./public/viewer.js" defer></script>
    </Layout>
  );
}
