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

  // Get active filters from container's data attributes
  const appContainer = document.getElementById('appContainer');
  const rawSearch = appContainer ? (appContainer.dataset.search || '') : '';
  const rawSector = appContainer ? (appContainer.dataset.sector || '') : '';
  const rawSort = appContainer ? (appContainer.dataset.sort || 'code_asc') : 'code_asc';

  const search = encodeURIComponent(rawSearch);
  const sector = encodeURIComponent(rawSector);
  const sort = encodeURIComponent(rawSort);

  try {
    const url = `/api/tickers/html?search=${search}&sector=${sector}&sort=${sort}&page=${currentPage}`;
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
