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
            <h2 class="ticker-name-text">${t.name}</h2>
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
              <span class="meta-label">データ上場日:</span>
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
  }
});

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
