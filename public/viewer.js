// Register Alpine.js Ticker App Component
document.addEventListener('alpine:init', () => {
  Alpine.data('tickerApp', (config) => ({
    allTickers: [],         // Raw stock quotes list
    sectors: [],            // List of unique 33 sectors
    isLoading: true,        // Load overlay
    
    // Filters and sorting state
    searchQuery: config.initialSearch || '',
    selectedSector: config.initialSector || '',
    sortKey: config.initialSort || 'code_asc',
    
    // UI Drawer state
    isDrawerOpen: false,
    
    // Lightbox image state
    isLightboxOpen: false,
    lightboxImg: '',
    lightboxCaption: '',
    
    // Ticker Details popup state
    isDetailOpen: false,
    selectedTicker: null,
    
    // Pagination and rendered sub-list
    filteredTickers: [],
    displayedTickers: [],
    pageSize: 30,
    page: 1,
    hasMore: false,
    
    async init() {
      try {
        const res = await fetch('./public/data.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.allTickers = await res.json();
        
        // Populate sectors list from data
        this.sectors = [...new Set(this.allTickers.map(t => t.sector33).filter(s => s))].sort();
        
        // Initial filter application
        this.applyFiltersAndSort();
      } catch (err) {
        console.error('Failed to load stock data JSON:', err);
      } finally {
        this.isLoading = false;
      }
      
      // Setup infinite scroll
      window.addEventListener('scroll', () => {
        if (this.isLoading || !this.hasMore) return;
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 600) {
          this.loadNextPage();
        }
      });
    },
    
    // Core filter and sorting logic
    applyFiltersAndSort() {
      let result = [...this.allTickers];
      
      // 1. Search Query filtering (case-insensitive)
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase().trim();
        result = result.filter(t => 
          t.code.toLowerCase().includes(q) || 
          t.name.toLowerCase().includes(q)
        );
      }
      
      // 2. Sector filtering
      if (this.selectedSector) {
        result = result.filter(t => t.sector33 === this.selectedSector);
      }
      
      // 3. Sorting
      const key = this.sortKey;
      result.sort((a, b) => {
        // Safe comparator helpers
        const getVal = (x, prop) => x[prop] ?? null;
        
        if (key === 'code_asc') return a.code.localeCompare(b.code);
        
        if (key === 'market_cap_desc' || key === 'market_cap_asc') {
          const valA = getVal(a, 'market_cap');
          const valB = getVal(b, 'market_cap');
          if (valA === null && valB === null) return 0;
          if (valA === null) return 1; // Send nulls to bottom
          if (valB === null) return -1;
          return key === 'market_cap_desc' ? valB - valA : valA - valB;
        }
        
        if (key === 'per_asc' || key === 'per_desc') {
          const valA = getVal(a, 'per');
          const valB = getVal(b, 'per');
          if (valA === null && valB === null) return 0;
          if (valA === null) return 1;
          if (valB === null) return -1;
          return key === 'per_asc' ? valA - valB : valB - valA;
        }
        
        if (key === 'pbr_asc' || key === 'pbr_desc') {
          const valA = getVal(a, 'pbr');
          const valB = getVal(b, 'pbr');
          if (valA === null && valB === null) return 0;
          if (valA === null) return 1;
          if (valB === null) return -1;
          return key === 'pbr_asc' ? valA - valB : valB - valA;
        }
        
        if (key === 'div_yield_desc') {
          const valA = getVal(a, 'dividend_yield');
          const valB = getVal(b, 'dividend_yield');
          if (valA === null && valB === null) return 0;
          if (valA === null) return 1;
          if (valB === null) return -1;
          return valB - valA; // High dividend rate first
        }
        
        if (key === 'ipo_date_desc' || key === 'ipo_date_asc') {
          const valA = getVal(a, 'ipo_date');
          const valB = getVal(b, 'ipo_date');
          if (valA === null && valB === null) return 0;
          if (valA === null) return 1;
          if (valB === null) return -1;
          return key === 'ipo_date_desc' 
            ? valB.localeCompare(valA) 
            : valA.localeCompare(valB);
        }
        
        return 0;
      });
      
      this.filteredTickers = result;
      this.page = 1;
      this.displayedTickers = this.filteredTickers.slice(0, this.pageSize);
      this.hasMore = this.filteredTickers.length > this.pageSize;
    },
    
    // Pagination trigger
    loadNextPage() {
      if (!this.hasMore) return;
      this.page++;
      const end = this.page * this.pageSize;
      this.displayedTickers = this.filteredTickers.slice(0, end);
      this.hasMore = this.filteredTickers.length > end;
    },
    
    // Active label indicator helper
    getSortLabel() {
      const labels = {
        'code_asc': '↕️ コード順',
        'market_cap_desc': '↕️ 時価総額順 (高)',
        'market_cap_asc': '↕️ 時価総額順 (安)',
        'per_asc': '↕️ PER安順',
        'per_desc': '↕️ PER高順',
        'pbr_asc': '↕️ PBR安順',
        'pbr_desc': '↕️ PBR高順',
        'div_yield_desc': '↕️ 配当利回り順',
        'ipo_date_desc': '↕️ 上場日順 (新)',
        'ipo_date_asc': '↕️ 上場日順 (古)'
      };
      return labels[this.sortKey] || '↕️ 整列';
    },
    
    // Lightbox triggers
    openLightbox(src, caption) {
      this.lightboxImg = src;
      this.lightboxCaption = caption;
      this.isLightboxOpen = true;
      document.body.style.overflow = 'hidden';
    },
    
    closeLightbox() {
      this.isLightboxOpen = false;
      if (!this.isDetailOpen) {
        document.body.style.overflow = '';
      }
    },
    
    // Details popup triggers
    openDetail(ticker) {
      this.selectedTicker = ticker;
      this.isDetailOpen = true;
      document.body.style.overflow = 'hidden';
    },
    
    closeDetail() {
      this.isDetailOpen = false;
      if (!this.isLightboxOpen) {
        document.body.style.overflow = '';
      }
    },
    
    // Global close on Escape key (called from page listener)
    closeAllModals() {
      this.isDrawerOpen = false;
      this.closeLightbox();
      this.closeDetail();
    },
    
    // Dynamic hyperlinks builders (cleans regional ticker codes like 1449@S.T -> 1449.S)
    getYahooLink(code) {
      if (!code) return '';
      const cleanCode = code.replace(/@([SFN])\.T$/, '.$1').replace(/@\w+/, '');
      return `https://finance.yahoo.co.jp/quote/${cleanCode}`;
    },
    
    getTradingViewLink(code) {
      if (!code) return '';
      const tradingViewCode = code.replace('.T', '').replace(/@\w+/, '');
      return `https://jp.tradingview.com/symbols/TSE-${tradingViewCode}/`;
    },
    
    // Detailed value formatting helpers
    formatMarketCap(val) {
      if (val === null || val === undefined || val === '') return '---';
      const num = Number(val);
      if (num >= 1000000000000) {
        return `${(num / 1000000000000).toFixed(2)} 兆円`;
      }
      if (num >= 100000000) {
        return `${(num / 100000000).toFixed(0)} 億円`;
      }
      return `${(num / 10000).toFixed(0)} 万円`;
    },
    
    formatVolume(val) {
      if (val === null || val === undefined || val === '') return '---';
      const num = Number(val);
      if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M 株`;
      }
      if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K 株`;
      }
      return `${num} 株`;
    },
    
    formatPercent(val) {
      if (val === null || val === undefined || val === '') return '---';
      const num = Number(val) * 100;
      const sign = num > 0 ? '+' : '';
      return `${sign}${num.toFixed(1)}%`;
    },
    
    formatIpoDate(val) {
      if (!val) return '---';
      return val;
    },
    
    formatPriceDiff(t) {
      if (!t || t.current_price === null || t.prev_close === null) return '';
      const diff = Number(t.current_price) - Number(t.prev_close);
      const sign = diff > 0 ? '+' : '';
      return `${sign}${diff.toLocaleString()}円 `;
    }
  }));
});

// Setup ESC key listener globally once
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Dispatch custom event to close all modals across Alpine state
    const el = document.querySelector('[x-data]');
    el?.__x?.$data?.closeAllModals();
  }
});
