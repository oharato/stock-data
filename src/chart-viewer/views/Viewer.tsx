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

      <div class="app-container">
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
      <style>{`
        .app-container {
          max-width: 100%;
        }

        .system-stats {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .stat-badge {
          display: inline-block;
          padding: 4px 10px;
          background-color: rgba(6, 182, 212, 0.1);
          color: var(--danger);
          border: 1px solid rgba(6, 182, 212, 0.2);
          border-radius: 99px;
          font-weight: 600;
        }

        /* Active Filters Display bar */
        .active-filters-bar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
          font-size: 13px;
        }

        .active-filter-label {
          color: var(--text-secondary);
          font-weight: 600;
          margin-right: 4px;
        }

        .filter-badge {
          background-color: var(--bg-surface);
          border: 1px solid var(--border);
          color: var(--text-primary);
          padding: 3px 10px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 12px;
        }

        .filter-badge.accent-badge {
          border-color: var(--accent);
          color: var(--accent);
          background-color: var(--accent-glow);
        }

        /* Floating Hamburger Trigger Button */
        .menu-trigger {
          position: fixed;
          top: 24px;
          right: 24px;
          width: 48px;
          height: 48px;
          background-color: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 50%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 5px;
          cursor: pointer;
          z-index: 150;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
        }

        .menu-trigger:hover {
          border-color: var(--accent);
          box-shadow: 0 0 15px var(--accent-glow);
          transform: scale(1.05);
        }

        .menu-trigger span {
          width: 20px;
          height: 2px;
          background-color: var(--text-primary);
          transition: transform 0.3s, opacity 0.3s;
        }

        .menu-trigger.active span:nth-child(1) {
          transform: translateY(7px) rotate(45deg);
        }

        .menu-trigger.active span:nth-child(2) {
          opacity: 0;
        }

        .menu-trigger.active span:nth-child(3) {
          transform: translateY(-7px) rotate(-45deg);
        }

        /* Slide-out Filter Drawer */
        .filter-drawer {
          position: fixed;
          top: 0;
          right: -360px;
          width: 340px;
          height: 100vh;
          background-color: var(--bg-surface);
          border-left: 1px solid var(--border);
          box-shadow: -15px 0 35px rgba(0, 0, 0, 0.6);
          z-index: 140;
          padding: 80px 24px 24px 24px;
          transition: right 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex;
          flex-direction: column;
          gap: 24px;
          backdrop-filter: blur(10px);
        }

        .filter-drawer.open {
          right: 0;
        }

        .drawer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border);
          padding-bottom: 16px;
        }

        .drawer-header h2 {
          font-size: 18px;
          font-weight: 700;
        }

        .close-drawer-btn {
          font-size: 28px;
          color: var(--text-secondary);
          cursor: pointer;
          transition: color 0.2s;
          line-height: 1;
        }

        .close-drawer-btn:hover {
          color: var(--accent);
        }

        .drawer-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background-color: rgba(8, 12, 20, 0.65);
          backdrop-filter: blur(5px);
          z-index: 130;
          display: none;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .drawer-overlay.show {
          display: block;
          opacity: 1;
        }

        .form-grid-vertical {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .apply-filter-btn {
          background: linear-gradient(135deg, #38bdf8 0%, #3b82f6 100%);
          color: #ffffff;
          border: none;
          border-radius: 8px;
          padding: 12px;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.2s;
          margin-top: 10px;
        }

        .apply-filter-btn:hover {
          opacity: 0.9;
          transform: translateY(-1px);
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .search-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .form-group input, .form-group select {
          width: 100%;
          background-color: var(--bg-base);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px 14px;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .form-group input:focus, .form-group select:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }

        .clear-btn {
          position: absolute;
          right: 10px;
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: 18px;
          cursor: pointer;
          padding: 0 4px;
        }

        /* Ticker Card */
        .ticker-card {
          background-color: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 24px;
          box-shadow: 0 4px 10px -3px rgba(0, 0, 0, 0.3);
        }

        .ticker-card-info {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          border-bottom: 1px solid var(--border);
          padding-bottom: 12px;
          margin-bottom: 16px;
          gap: 12px;
        }

        @media (min-width: 768px) {
          .ticker-card-info {
            flex-direction: row;
            align-items: flex-start;
          }
        }

        .left-info {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .ticker-code-badge {
          background: linear-gradient(135deg, #38bdf8 0%, #3b82f6 100%);
          color: #ffffff;
          font-weight: 700;
          font-size: 14px;
          padding: 4px 10px;
          border-radius: 6px;
        }

        .ticker-name-text {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .ticker-market-text {
          font-size: 12px;
          color: var(--text-secondary);
          background-color: var(--bg-base);
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid var(--border);
        }

        .right-info {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
        }

        .metadata-item {
          display: flex;
          flex-direction: column;
        }

        .meta-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
        }

        .meta-value {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .accent-text {
          color: var(--accent);
          font-weight: 700;
        }

        /* Charts Panorama Grid */
        .charts-panorama {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        @media (min-width: 992px) {
          .charts-panorama {
            grid-template-columns: 1fr 1fr 1fr;
          }
        }

        .chart-box {
          background-color: var(--bg-base);
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .chart-box-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 12px;
          background-color: rgba(30, 41, 59, 0.5);
          border-bottom: 1px solid var(--border);
        }

        .chart-type {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 4px;
          color: #ffffff;
        }

        .type-daily { background-color: var(--success); }
        .type-weekly { background-color: var(--accent); }
        .type-monthly { background-color: #818cf8; }

        .ma-label {
          font-size: 11px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .image-container {
          position: relative;
          cursor: zoom-in;
          overflow: hidden;
          background-color: #0b0f19;
          display: flex;
          justify-content: center;
          align-items: center;
          aspect-ratio: 1200 / 800;
        }

        .image-container img {
          width: 100%;
          height: auto;
          display: block;
        }

        .no-image {
          padding: 40px;
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 500;
        }

        /* Empty state */
        .empty-state {
          text-align: center;
          padding: 80px 20px;
          background-color: var(--bg-surface);
          border: 1px dashed var(--border);
          border-radius: 12px;
          max-width: 600px;
          margin: 40px auto;
        }

        .empty-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }

        .empty-state h3 {
          font-size: 18px;
          margin-bottom: 8px;
          color: var(--text-primary);
        }

        .empty-state p {
          color: var(--text-secondary);
          font-size: 14px;
        }

        /* Pagination */
        .pagination-nav {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid var(--border);
        }

        @media (min-width: 768px) {
          .pagination-nav {
            flex-direction: row;
            justify-content: space-between;
          }
        }

        .pagination-info {
          font-size: 14px;
          color: var(--text-secondary);
        }

        .pagination-info strong {
          color: var(--text-primary);
        }

        .pagination-buttons {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .page-btn {
          display: inline-block;
          background-color: var(--bg-surface);
          border: 1px solid var(--border);
          color: var(--text-primary);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          transition: background-color 0.2s, border-color 0.2s;
        }

        .page-btn:hover:not(.disabled) {
          background-color: var(--bg-card);
          border-color: var(--accent);
        }

        .page-btn.disabled {
          color: var(--text-secondary);
          opacity: 0.5;
          cursor: not-allowed;
        }

        .page-numbers {
          display: flex;
          gap: 6px;
        }

        .page-num {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 38px;
          height: 38px;
          background-color: var(--bg-base);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          border-radius: 8px;
          text-decoration: none;
          font-weight: 600;
          font-size: 14px;
          transition: background-color 0.2s, color 0.2s, border-color 0.2s;
        }

        .page-num:hover {
          background-color: var(--bg-card);
          color: var(--text-primary);
          border-color: var(--accent);
        }

        .page-num.active {
          background-color: var(--accent);
          color: #ffffff;
          border-color: var(--accent);
        }

        /* Lightbox / Modal */
        .lightbox {
          display: none;
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(8, 12, 20, 0.95);
          backdrop-filter: blur(10px);
          justify-content: center;
          align-items: center;
        }

        .lightbox-close {
          position: absolute;
          top: 20px;
          right: 30px;
          color: #ffffff;
          font-size: 40px;
          font-weight: bold;
          cursor: pointer;
          transition: color 0.2s;
        }

        .lightbox-close:hover {
          color: var(--accent);
        }

        .lightbox-content {
          position: relative;
          max-width: 90%;
          max-height: 85%;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .lightbox-content img {
          max-width: 100%;
          max-height: 80vh;
          border: 2px solid var(--border);
          border-radius: 12px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        .lightbox-caption {
          margin-top: 16px;
          color: #ffffff;
          font-size: 18px;
          font-weight: 700;
          text-align: center;
        }

        /* Infinite Scroll Loading Indicator & Spinner */
        .loading-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 30px;
          color: var(--text-secondary);
          font-weight: 600;
          font-size: 15px;
        }

        .spinner {
          width: 24px;
          height: 24px;
          border: 3px solid rgba(56, 189, 248, 0.2);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .end-of-list {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 600;
          border-top: 1px dashed var(--border);
          margin-top: 30px;
          margin-bottom: 50px;
        }
      `}</style>

      {/* Lightbox / Modal / Drawer / Infinite Scroll JavaScript */}
      <script dangerouslySetInnerHTML={{ __html: `
        function openLightbox(src, caption) {
          const lightbox = document.getElementById('lightbox');
          const lightboxImg = document.getElementById('lightboxImg');
          const lightboxCaption = document.getElementById('lightboxCaption');
          
          lightboxImg.src = src;
          lightboxCaption.textContent = caption;
          lightbox.style.display = 'flex';
          document.body.style.overflow = 'hidden';
        }

        function closeLightbox() {
          const lightbox = document.getElementById('lightbox');
          lightbox.style.display = 'none';
          document.body.style.overflow = '';
        }

        function toggleDrawer(show) {
          const drawer = document.getElementById('filterDrawer');
          const overlay = document.getElementById('drawerOverlay');
          const trigger = document.getElementById('menuTrigger');
          
          const isVisible = drawer.classList.contains('open');
          const shouldShow = show !== undefined ? show : !isVisible;
          
          if (shouldShow) {
            drawer.classList.add('open');
            trigger.classList.add('active');
            overlay.classList.add('show');
            document.body.style.overflow = 'hidden';
          } else {
            drawer.classList.remove('open');
            trigger.classList.remove('active');
            overlay.classList.remove('show');
            document.body.style.overflow = '';
          }
        }

        // Close on ESC key
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') {
            closeLightbox();
            toggleDrawer(false);
          }
        });

        // Infinite Scroll Logic
        let currentPage = 1;
        let isLoading = false;
        let hasMore = true;

        window.addEventListener('scroll', () => {
          if (isLoading || !hasMore) return;
          
          // Trigger when scroll hits bottom 400px threshold
          if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 400) {
            loadNextPage();
          }
        });

        async function loadNextPage() {
          isLoading = true;
          const loadingIndicator = document.getElementById('loadingIndicator');
          const container = document.getElementById('tickerListContainer');
          
          loadingIndicator.style.display = 'flex';
          currentPage++;

          const search = encodeURIComponent('${currentSearch}');
          const sector = encodeURIComponent('${currentSector}');
          const sort = '${currentSort}';

          try {
            const url = \`/api/tickers/html?search=\${search}&sector=\${sector}&sort=\${sort}&page=\${currentPage}\`;
            const response = await fetch(url);
            const html = await response.text();

            if (html.trim() === '') {
              hasMore = false;
              loadingIndicator.style.display = 'none';
              
              const endMsg = document.createElement('div');
              endMsg.className = 'end-of-list';
              endMsg.textContent = 'すべての銘柄を表示しました';
              container.appendChild(endMsg);
              return;
            }

            container.insertAdjacentHTML('beforeend', html);
          } catch (err) {
            console.error('Failed to fetch next page:', err);
            currentPage--; // rollback
          } finally {
            isLoading = false;
            if (hasMore) {
              loadingIndicator.style.display = 'none';
            }
          }
        }
      ` }} />
    </Layout>
  );
}
