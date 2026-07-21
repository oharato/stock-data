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
    
    // Range Filters state (initialized to default min/max bounds)
    filterPriceMin: 0,
    filterPriceMax: 20000,
    filterChangeMin: -30,
    filterChangeMax: 30,
    filterVolumeMin: 0,
    filterVolumeMax: 10000000,
    filterMarketCapMin: 0,
    filterMarketCapMax: 10000,
    filterPerMin: 0,
    filterPerMax: 100,
    filterPbrMin: 0,
    filterPbrMax: 10,
    filterYieldMin: 0,
    filterYieldMax: 15,
    filterMa50Min: -50,
    filterMa50Max: 50,
    filterMa200Min: -50,
    filterMa200Max: 50,
    filterLow52Min: 0,
    filterLow52Max: 100,
    filterHigh52Min: -100,
    filterHigh52Max: 0,
    filterIpoMin: 1950,
    filterIpoMax: 2026,

    // UI Drawer state
    isDrawerOpen: false,
    
    // Lightbox image state
    isLightboxOpen: false,
    lightboxImg: '',
    lightboxCaption: '',
    
    // Ticker Details popup state
    isDetailOpen: false,
    selectedTicker: null,
    activeDetailTab: 'financial',
    
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

      // 3. Range filtering helper
      const checkRange = (val, min, max, defaultMin, defaultMax, scale = 1, isDateYear = false) => {
        // If sliders are untouched (at default min/max), skip filtering for this property
        if (Number(min) === defaultMin && Number(max) === defaultMax) {
          return true;
        }

        if (val === null || val === undefined || val === '') {
          // If range is customized but value is empty/null, exclude it
          return false;
        }
        
        let compareVal = Number(val);
        if (isDateYear) {
          compareVal = Number(String(val).substring(0, 4));
        }

        if (min !== '') {
          const minNum = Number(min) * scale;
          if (compareVal < minNum) return false;
        }
        if (max !== '') {
          const maxNum = Number(max) * scale;
          if (compareVal > maxNum) return false;
        }
        return true;
      };

      // Apply range filters for all metrics
      result = result.filter(t => {
        return checkRange(t.current_price, this.filterPriceMin, this.filterPriceMax, 0, 20000) &&
               checkRange(t.change_percent, this.filterChangeMin, this.filterChangeMax, -30, 30) &&
               checkRange(t.volume_day, this.filterVolumeMin, this.filterVolumeMax, 0, 10000000) &&
               checkRange(t.market_cap, this.filterMarketCapMin, this.filterMarketCapMax, 0, 10000, 100000000) &&
               checkRange(t.per, this.filterPerMin, this.filterPerMax, 0, 100) &&
               checkRange(t.pbr, this.filterPbrMin, this.filterPbrMax, 0, 10) &&
               checkRange(t.dividend_yield, this.filterYieldMin, this.filterYieldMax, 0, 15, 0.01) &&
               checkRange(t.ma50_diff, this.filterMa50Min, this.filterMa50Max, -50, 50, 0.01) &&
               checkRange(t.ma200_diff, this.filterMa200Min, this.filterMa200Max, -50, 50, 0.01) &&
               checkRange(t.low52_diff, this.filterLow52Min, this.filterLow52Max, 0, 100, 0.01) &&
               checkRange(t.high52_diff, this.filterHigh52Min, this.filterHigh52Max, -100, 0, 0.01) &&
               checkRange(t.ipo_date, this.filterIpoMin, this.filterIpoMax, 1950, 2026, 1, true);
      });
      
      // 4. Generalized Sorting for all metrics
      const key = this.sortKey;
      result.sort((a, b) => {
        const getVal = (x, prop) => x[prop] ?? null;

        // Code and Name sort
        if (key === 'code_asc') return a.code.localeCompare(b.code);
        if (key === 'code_desc') return b.code.localeCompare(a.code);
        if (key === 'name_asc') return a.name.localeCompare(b.name, 'ja');
        if (key === 'name_desc') return b.name.localeCompare(a.name, 'ja');

        // Resolve generic property metrics
        const match = key.match(/^(.+)_(asc|desc)$/);
        if (match) {
          const [, prop, direction] = match;
          const isDesc = direction === 'desc';
          
          let valA = getVal(a, prop);
          let valB = getVal(b, prop);

          // Handle property translation to match DB column names
          if (prop === 'price') { valA = getVal(a, 'current_price'); valB = getVal(b, 'current_price'); }
          if (prop === 'change') { valA = getVal(a, 'change_percent'); valB = getVal(b, 'change_percent'); }
          if (prop === 'volume') { valA = getVal(a, 'volume_day'); valB = getVal(b, 'volume_day'); }
          if (prop === 'yield') { valA = getVal(a, 'dividend_yield'); valB = getVal(b, 'dividend_yield'); }
          if (prop === 'ma50') { valA = getVal(a, 'ma50_diff'); valB = getVal(b, 'ma50_diff'); }
          if (prop === 'ma200') { valA = getVal(a, 'ma200_diff'); valB = getVal(b, 'ma200_diff'); }
          if (prop === 'low52') { valA = getVal(a, 'low52_diff'); valB = getVal(b, 'low52_diff'); }
          if (prop === 'high52') { valA = getVal(a, 'high52_diff'); valB = getVal(b, 'high52_diff'); }
          if (prop === 'ipo') { valA = getVal(a, 'ipo_date'); valB = getVal(b, 'ipo_date'); }

          if (valA === null && valB === null) return 0;
          if (valA === null) return 1; // Always push null values to the bottom
          if (valB === null) return -1;

          if (typeof valA === 'string' && typeof valB === 'string') {
            return isDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
          }
          return isDesc ? Number(valB) - Number(valA) : Number(valA) - Number(valB);
        }
        
        return 0;
      });
      
      this.filteredTickers = result;
      this.page = 1;
      this.displayedTickers = this.filteredTickers.slice(0, this.pageSize);
      this.hasMore = this.filteredTickers.length > this.pageSize;
    },
    
    // Reset all filter options to default boundary values
    resetFilters() {
      this.searchQuery = '';
      this.selectedSector = '';
      this.filterPriceMin = 0;
      this.filterPriceMax = 20000;
      this.filterChangeMin = -30;
      this.filterChangeMax = 30;
      this.filterVolumeMin = 0;
      this.filterVolumeMax = 10000000;
      this.filterMarketCapMin = 0;
      this.filterMarketCapMax = 10000;
      this.filterPerMin = 0;
      this.filterPerMax = 100;
      this.filterPbrMin = 0;
      this.filterPbrMax = 10;
      this.filterYieldMin = 0;
      this.filterYieldMax = 15;
      this.filterMa50Min = -50;
      this.filterMa50Max = 50;
      this.filterMa200Min = -50;
      this.filterMa200Max = 50;
      this.filterLow52Min = 0;
      this.filterLow52Max = 100;
      this.filterHigh52Min = -100;
      this.filterHigh52Max = 0;
      this.filterIpoMin = 1950;
      this.filterIpoMax = 2026;
      this.applyFiltersAndSort();
    },

    // Handle range slider collision (prevent min exceeding max and vice-versa)
    sliderMinChanged(minProp, maxProp) {
      const min = Number(this[minProp]);
      const max = Number(this[maxProp]);
      if (min > max) {
        this[minProp] = max;
      }
      this.applyFiltersAndSort();
    },

    sliderMaxChanged(minProp, maxProp) {
      const min = Number(this[minProp]);
      const max = Number(this[maxProp]);
      if (max < min) {
        this[maxProp] = min;
      }
      this.applyFiltersAndSort();
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
        'code_asc': '↕️ コード順 (昇順)',
        'code_desc': '↕️ コード順 (降順)',
        'name_asc': '↕️ 銘柄名順 (昇順)',
        'name_desc': '↕️ 銘柄名順 (降順)',
        'price_asc': '↕️ 株価安順',
        'price_desc': '↕️ 株価高順',
        'change_asc': '↕️ 騰落率低順',
        'change_desc': '↕️ 騰落率高順',
        'volume_asc': '↕️ 売買高少順',
        'volume_desc': '↕️ 売買高多順',
        'market_cap_asc': '↕️ 時価総額安順',
        'market_cap_desc': '↕️ 時価総額高順',
        'per_asc': '↕️ PER安順 (割安)',
        'per_desc': '↕️ PER高順',
        'pbr_asc': '↕️ PBR安順',
        'pbr_desc': '↕️ PBR高順',
        'yield_asc': '↕️ 利回り低順',
        'yield_desc': '↕️ 利回り高順',
        'ma50_asc': '↕️ 50日線乖離低順',
        'ma50_desc': '↕️ 50日線乖離高順',
        'ma200_asc': '↕️ 200日線乖離低順',
        'ma200_desc': '↕️ 200日線乖離高順',
        'low52_asc': '↕️ 52週安値乖離低順',
        'low52_desc': '↕️ 52週安値乖離高順',
        'high52_asc': '↕️ 52週高値乖離低順',
        'high52_desc': '↕️ 52週高値乖離高順',
        'ipo_asc': '↕️ 上場日古順',
        'ipo_desc': '↕️ 上場日新順'
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
      this.activeDetailTab = 'financial';
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
