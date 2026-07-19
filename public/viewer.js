// Global variables
let allTickers = [];
let filteredTickers = [];
let currentPage = 1;
const itemsPerPage = 10;
let isLoading = false;
let hasMore = true;

// Helper: Format market cap (e.g. 1.23兆円, 456億円)
function formatMarketCap(val) {
  if (val === null || val === undefined || val === '') return '---';
  const numVal = Number(val);
  const oku = numVal / 100000000;
  if (oku >= 10000) {
    return `${(oku / 10000).toFixed(2)}兆円`;
  }
  return `${Math.round(oku).toLocaleString()}億円`;
}

// Helper: Format IPO date
function formatIpoDate(val) {
  if (!val) return '---';
  return val;
}

// Helper: Escape single quotes for attributes
function escapeQuotes(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'");
}

// Render a batch of ticker cards into the container
function renderTickers(startIndex, limit) {
  const container = document.getElementById('tickerListContainer');
  const loadingIndicator = document.getElementById('loadingIndicator');
  
  if (startIndex === 0) {
    container.innerHTML = '';
  }

  const batch = filteredTickers.slice(startIndex, startIndex + limit);
  
  if (filteredTickers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>該当する銘柄が見つかりませんでした</h3>
        <p>検索キーワードや業種フィルターの条件を変えてお試しください。</p>
      </div>
    `;
    hasMore = false;
    loadingIndicator.style.display = 'none';
    return;
  }

  batch.forEach(t => {
    const cardHtml = `
      <div class="ticker-card" id="ticker-${t.code}">
        <div class="ticker-card-info">
          <div class="left-info">
            <span class="ticker-code-badge">${t.code}</span>
            <h2 class="ticker-name-text" onclick="openDetailModal('${t.code}')">${t.name}</h2>
            <span class="ticker-market-text">${t.market}</span>
          </div>
          <div class="right-info">
            <div class="metadata-item">
              <span class="meta-label">業種:</span>
              <span class="meta-value">${t.sector33 || '---'}</span>
            </div>
            <div class="metadata-item">
              <span class="meta-label">時価総額:</span>
              <span class="meta-value accent-text">${formatMarketCap(t.market_cap)}</span>
            </div>
            <div class="metadata-item">
              <span class="meta-label">PER:</span>
              <span class="meta-value">${t.per !== null && t.per !== undefined ? Number(t.per).toFixed(1) + '倍' : '---'}</span>
            </div>
            <div class="metadata-item">
              <span class="meta-label">PBR:</span>
              <span class="meta-value">${t.pbr !== null && t.pbr !== undefined ? Number(t.pbr).toFixed(2) + '倍' : '---'}</span>
            </div>
            <div class="metadata-item">
              <span class="meta-label">配当利回り:</span>
              <span class="meta-value accent-text">${t.dividend_yield !== null && t.dividend_yield !== undefined ? (Number(t.dividend_yield) * 100).toFixed(2) + '%' : '---'}${t.dividend_rate ? ` (${t.dividend_rate}円)` : ''}</span>
            </div>
            <div class="metadata-item">
              <span class="meta-label">上場日:</span>
              <span class="meta-value">${formatIpoDate(t.ipo_date)}</span>
            </div>
          </div>
        </div>

        <div class="charts-panorama">
          <!-- Monthly Chart -->
          <div class="chart-box">
            <div class="chart-box-header">
              <span class="chart-type type-monthly">月足</span>
              <span class="ma-label">MA 12/24</span>
            </div>
            <div class="image-container" onclick="openLightbox('./charts/monthly/${t.code}.webp', '${escapeQuotes(t.name)} (${t.code}) - 月足')">
              <img 
                src="./charts/monthly/${t.code}.webp" 
                alt="${t.name} 月足" 
                loading="lazy" 
                onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'no-image\\'>チャート画像未生成</div>';" 
              />
            </div>
          </div>

          <!-- Weekly Chart -->
          <div class="chart-box">
            <div class="chart-box-header">
              <span class="chart-type type-weekly">週足</span>
              <span class="ma-label">MA 13/26</span>
            </div>
            <div class="image-container" onclick="openLightbox('./charts/weekly/${t.code}.webp', '${escapeQuotes(t.name)} (${t.code}) - 週足')">
              <img 
                src="./charts/weekly/${t.code}.webp" 
                alt="${t.name} 週足" 
                loading="lazy" 
                onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'no-image\\'>チャート画像未生成</div>';" 
              />
            </div>
          </div>

          <!-- Daily Chart -->
          <div class="chart-box">
            <div class="chart-box-header">
              <span class="chart-type type-daily">日足</span>
              <span class="ma-label">MA 5/25/75</span>
            </div>
            <div class="image-container" onclick="openLightbox('./charts/daily/${t.code}.webp', '${escapeQuotes(t.name)} (${t.code}) - 日足')">
              <img 
                src="./charts/daily/${t.code}.webp" 
                alt="${t.name} 日足" 
                loading="lazy" 
                onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'no-image\\'>チャート画像未生成</div>';" 
              />
            </div>
          </div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', cardHtml);
  });

  if (startIndex + limit >= filteredTickers.length) {
    hasMore = false;
    loadingIndicator.style.display = 'none';
    if (filteredTickers.length > 0) {
      const endMsg = document.createElement('div');
      endMsg.className = 'end-of-list';
      endMsg.textContent = 'すべての銘柄を表示しました';
      container.appendChild(endMsg);
    }
  } else {
    hasMore = true;
  }
}

// Apply inputs from search/filter/sort options, recalculate, and redraw
function applyFiltersAndSort() {
  const searchInput = document.getElementById('searchInput');
  const sectorSelect = document.getElementById('sectorSelect');
  const sortSelect = document.getElementById('sortSelect');

  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const sector = sectorSelect ? sectorSelect.value : '';
  const sort = sortSelect ? sortSelect.value : 'code_asc';

  // 1. Filter
  filteredTickers = allTickers.filter(t => {
    const codeMatch = t.code.toLowerCase().includes(query);
    const nameMatch = t.name.toLowerCase().includes(query);
    const matchSearch = !query || codeMatch || nameMatch;
    
    const matchSector = !sector || t.sector33 === sector;
    
    return matchSearch && matchSector;
  });

  // 2. Sort
  filteredTickers.sort((a, b) => {
    if (sort === 'market_cap_desc') {
      const capA = a.market_cap !== null && a.market_cap !== undefined ? Number(a.market_cap) : -1;
      const capB = b.market_cap !== null && b.market_cap !== undefined ? Number(b.market_cap) : -1;
      return capB - capA;
    }
    if (sort === 'market_cap_asc') {
      const capA = a.market_cap !== null && a.market_cap !== undefined ? Number(a.market_cap) : Infinity;
      const capB = b.market_cap !== null && b.market_cap !== undefined ? Number(b.market_cap) : Infinity;
      return capA - capB;
    }
    if (sort === 'per_asc') {
      const perA = a.per !== null && a.per !== undefined ? Number(a.per) : Infinity;
      const perB = b.per !== null && b.per !== undefined ? Number(b.per) : Infinity;
      return perA - perB;
    }
    if (sort === 'per_desc') {
      const perA = a.per !== null && a.per !== undefined ? Number(a.per) : -1;
      const perB = b.per !== null && b.per !== undefined ? Number(b.per) : -1;
      return perB - perA;
    }
    if (sort === 'pbr_asc') {
      const pbrA = a.pbr !== null && a.pbr !== undefined ? Number(a.pbr) : Infinity;
      const pbrB = b.pbr !== null && b.pbr !== undefined ? Number(b.pbr) : Infinity;
      return pbrA - pbrB;
    }
    if (sort === 'pbr_desc') {
      const pbrA = a.pbr !== null && a.pbr !== undefined ? Number(a.pbr) : -1;
      const pbrB = b.pbr !== null && b.pbr !== undefined ? Number(b.pbr) : -1;
      return pbrB - pbrA;
    }
    if (sort === 'div_yield_desc') {
      const divA = a.dividend_yield !== null && a.dividend_yield !== undefined ? Number(a.dividend_yield) : -1;
      const divB = b.dividend_yield !== null && b.dividend_yield !== undefined ? Number(b.dividend_yield) : -1;
      return divB - divA;
    }
    if (sort === 'ipo_date_desc') {
      const dateA = a.ipo_date || '0000-00-00';
      const dateB = b.ipo_date || '0000-00-00';
      return dateB.localeCompare(dateA);
    }
    if (sort === 'ipo_date_asc') {
      const dateA = a.ipo_date || '9999-12-31';
      const dateB = b.ipo_date || '9999-12-31';
      return dateA.localeCompare(dateB);
    }
    // Default: code_asc
    return a.code.localeCompare(b.code);
  });

  // 3. Reset pagination & render
  currentPage = 1;
  renderTickers(0, itemsPerPage);

  // 4. Update UI labels (Active filters)
  updateActiveFiltersDisplay(query, sector, sort);
}

// Update the breadcrumb badges displaying active filters
function updateActiveFiltersDisplay(query, sector, sort) {
  const activeFiltersBar = document.querySelector('.active-filters-bar');
  if (!activeFiltersBar) return;

  const sortLabels = {
    code_asc: 'コード順',
    market_cap_desc: '時価総額大順',
    market_cap_asc: '時価総額小順',
    per_asc: 'PER安順',
    per_desc: 'PER高順',
    pbr_asc: 'PBR安順',
    pbr_desc: 'PBR高順',
    div_yield_desc: '配当利回り順',
    ipo_date_desc: '上場日新順',
    ipo_date_asc: '上場日古順'
  };

  activeFiltersBar.innerHTML = `
    <span class="active-filter-label">現在の条件:</span>
    <span class="filter-badge">🔍 ${query ? `検索: "${query}"` : 'すべて'}</span>
    <span class="filter-badge">📁 業種: ${sector || 'すべて'}</span>
    <span class="filter-badge accent-badge">↕️ ${sortLabels[sort] || 'コード順'}</span>
  `;
}

// Load next page of tickers for infinite scroll
async function loadNextPage() {
  if (isLoading || !hasMore) return;
  
  isLoading = true;
  const loadingIndicator = document.getElementById('loadingIndicator');
  loadingIndicator.style.display = 'flex';

  // Introduce small timeout to avoid thrashing scroll events
  setTimeout(() => {
    const startIndex = currentPage * itemsPerPage;
    renderTickers(startIndex, itemsPerPage);
    currentPage++;
    isLoading = false;
    if (hasMore) {
      loadingIndicator.style.display = 'none';
    }
  }, 100);
}

// Lightbox
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
  if (lightbox) {
    lightbox.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Drawer Overlay filter toggle
function toggleDrawer(show) {
  const drawer = document.getElementById('filterDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const trigger = document.getElementById('menuTrigger');
  if (!drawer || !overlay || !trigger) return;

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
    closeDetailModal();
  }
});

// Helper: Format large volumes (e.g. 1.2M, 450K)
function formatVolume(val) {
  if (val === null || val === undefined || val === '') return '---';
  const num = Number(val);
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M 株`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K 株`;
  }
  return `${num} 株`;
}

// Helper: Format deviation percentage (e.g. +4.2%, -1.2%)
function formatPercent(val) {
  if (val === null || val === undefined || val === '') return '---';
  const num = Number(val) * 100;
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
}

// Open Ticker Detail Modal with dashboard layout
function openDetailModal(code) {
  const t = allTickers.find(x => x.code === code);
  if (!t) return;
  
  // Header
  document.getElementById('modalTickerCode').textContent = t.code;
  document.getElementById('modalTickerName').textContent = t.name;
  document.getElementById('modalTickerMarket').textContent = t.market || '---';
  
  // Price and Change
  const price = t.current_price !== null && t.current_price !== undefined ? Number(t.current_price).toLocaleString() + ' 円' : '---';
  document.getElementById('modalTickerPrice').textContent = price;
  
  const changeEl = document.getElementById('modalTickerChange');
  if (t.change_percent !== null && t.change_percent !== undefined) {
    const changeVal = Number(t.change_percent); // Already a percentage (e.g. -0.22 means -0.22%), do not multiply by 100
    const sign = changeVal > 0 ? '+' : '';
    
    // Calculate price change amplitude (price difference)
    let diffStr = '';
    if (t.current_price !== null && t.prev_close !== null) {
      const diff = Number(t.current_price) - Number(t.prev_close);
      const diffSign = diff > 0 ? '+' : '';
      diffStr = `${diffSign}${diff.toLocaleString()}円 `;
    }
    
    changeEl.textContent = `前日比: ${diffStr}(${sign}${changeVal.toFixed(2)}%)`;
    changeEl.className = 'detail-modal-change ' + (changeVal >= 0 ? 'change-up' : 'change-down');
  } else {
    changeEl.textContent = '---';
    changeEl.className = 'detail-modal-change';
  }

  // Card 1: Trade Data
  document.getElementById('modalTickerOpen').textContent = t.open_price !== null ? Number(t.open_price).toLocaleString() + ' 円' : '---';
  document.getElementById('modalTickerPrevClose').textContent = t.prev_close !== null ? Number(t.prev_close).toLocaleString() + ' 円' : '---';
  document.getElementById('modalTickerHigh').textContent = t.high_price !== null ? Number(t.high_price).toLocaleString() + ' 円' : '---';
  document.getElementById('modalTickerLow').textContent = t.low_price !== null ? Number(t.low_price).toLocaleString() + ' 円' : '---';
  document.getElementById('modalTickerVolume').textContent = formatVolume(t.volume_day);

  // Card 2: Financial Metrics
  document.getElementById('modalTickerSector').textContent = t.sector33 || '---';
  document.getElementById('modalTickerMarketCap').textContent = formatMarketCap(t.market_cap);
  document.getElementById('modalTickerPER').textContent = t.per !== null && t.per !== undefined ? Number(t.per).toFixed(1) + ' 倍' : '---';
  document.getElementById('modalTickerPBR').textContent = t.pbr !== null && t.pbr !== undefined ? Number(t.pbr).toFixed(2) + ' 倍' : '---';
  document.getElementById('modalTickerDivYield').textContent = t.dividend_yield !== null && t.dividend_yield !== undefined ? (Number(t.dividend_yield) * 100).toFixed(2) + '%' : '---';

  // Card 3: Technical & 52-Week Deviations
  document.getElementById('modalTickerMA50').textContent = formatPercent(t.ma50_diff);
  document.getElementById('modalTickerMA200').textContent = formatPercent(t.ma200_diff);
  document.getElementById('modalTickerLow52').textContent = formatPercent(t.low52_diff);
  document.getElementById('modalTickerHigh52').textContent = formatPercent(t.high52_diff);
  document.getElementById('modalTickerIpoDate').textContent = formatIpoDate(t.ipo_date);
  
  // Link generation (Handling regional tickers e.g. 1449@S.T -> 1449.S)
  const cleanCode = t.code.replace(/@([SFN])\.T$/, '.$1').replace(/@\w+/, '');
  document.getElementById('modalYahooLink').href = `https://finance.yahoo.co.jp/quote/${cleanCode}`;
  
  const tradingViewCode = t.code.replace('.T', '').replace(/@\w+/, '');
  document.getElementById('modalTradingViewLink').href = `https://jp.tradingview.com/symbols/TSE-${tradingViewCode}/`;

  const modal = document.getElementById('detailModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

// Close Ticker Detail Modal
function closeDetailModal() {
  const modal = document.getElementById('detailModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Infinite Scroll window event listener
window.addEventListener('scroll', () => {
  if (isLoading || !hasMore) return;
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 600) {
    loadNextPage();
  }
});

// Setup Form listeners to filter locally instead of posting to server
function setupFormListeners() {
  const form = document.getElementById('filterForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      applyFiltersAndSort();
      toggleDrawer(false);
    });
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    // Live search as user types
    searchInput.addEventListener('input', () => {
      applyFiltersAndSort();
    });
  }

  const sectorSelect = document.getElementById('sectorSelect');
  if (sectorSelect) {
    sectorSelect.addEventListener('change', () => {
      applyFiltersAndSort();
    });
  }

  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      applyFiltersAndSort();
    });
  }
}

// Initializer: Fetch data and load UI
document.addEventListener('DOMContentLoaded', async () => {
  setupFormListeners();
  
  const loadingIndicator = document.getElementById('loadingIndicator');
  if (loadingIndicator) loadingIndicator.style.display = 'flex';

  try {
    const res = await fetch('./public/data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allTickers = await res.json();
    
    // Dynamically populate sectors dropdown from data
    const sectors = [...new Set(allTickers.map(t => t.sector33).filter(s => s))].sort();
    const sectorSelect = document.getElementById('sectorSelect');
    if (sectorSelect) {
      sectorSelect.innerHTML = '<option value="">全業種を表示</option>' + 
        sectors.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    applyFiltersAndSort();
  } catch (err) {
    console.error('Failed to load stock data JSON:', err);
    const container = document.getElementById('tickerListContainer');
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="border-color: var(--danger);">
          <div class="empty-icon">❌</div>
          <h3>データの読み込みに失敗しました</h3>
          <p>${err.message}</p>
        </div>
      `;
    }
  } finally {
    if (loadingIndicator) loadingIndicator.style.display = 'none';
  }
});
