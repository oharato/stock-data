import sharp from 'sharp';
import { StockPriceRow } from '../shared/repository/duckdb.js';

export interface ChartOptions {
  width?: number;
  height?: number;
  title: string;
  ticker: string;
  type: 'daily' | 'weekly' | 'monthly';
}

export async function generateChartWebp(
  data: StockPriceRow[],
  options: ChartOptions
): Promise<Buffer> {
  const width = options.width ?? 1200;
  const height = options.height ?? 800;

  const top = 55;
  const right = 75;
  const bottom = 45;
  const left = 45;

  const chartWidth = width - left - right;
  const mainHeight = 520;
  const volumeHeight = 120;
  const volumeTop = top + mainHeight + 20;

  if (data.length === 0) {
    throw new Error('No data available to generate chart');
  }

  // Calculate scales
  let maxPrice = -Infinity;
  let minPrice = Infinity;
  let maxVolume = -Infinity;

  for (const row of data) {
    if (row.high > maxPrice) maxPrice = row.high;
    if (row.low < minPrice) minPrice = row.low;
    if (row.volume > maxVolume) maxVolume = row.volume;

    // Consider moving averages in price scale if they exist
    if (row.ma1 !== null && row.ma1 > maxPrice) maxPrice = row.ma1;
    if (row.ma1 !== null && row.ma1 < minPrice) minPrice = row.ma1;
    if (row.ma2 !== null && row.ma2 > maxPrice) maxPrice = row.ma2;
    if (row.ma2 !== null && row.ma2 < minPrice) minPrice = row.ma2;
    if (row.ma3 !== null && row.ma3 > maxPrice) maxPrice = row.ma3;
    if (row.ma3 !== null && row.ma3 < minPrice) minPrice = row.ma3;
  }

  // Add 5% padding to price scale
  const priceRange = maxPrice - minPrice;
  maxPrice += priceRange * 0.05;
  minPrice -= priceRange * 0.05;
  if (minPrice < 0) minPrice = 0;

  // Coordinate helper functions
  const getX = (index: number) => left + (index + 0.5) * (chartWidth / data.length);
  const getY = (price: number) => top + mainHeight - ((price - minPrice) / (maxPrice - minPrice)) * mainHeight;
  const getVolY = (vol: number) => volumeTop + volumeHeight - (vol / (maxVolume || 1)) * volumeHeight;

  // Build SVG content
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #0b0f19; font-family: 'Noto Sans CJK JP', 'Noto Sans JP', 'IPAGothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">`;

  // Defs for gradients & shadows
  svg += `
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="100%" stop-color="#020617" />
      </linearGradient>
      <linearGradient id="upCandleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#f43f5e" />
        <stop offset="100%" stop-color="#be123c" />
      </linearGradient>
      <linearGradient id="downCandleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#06b6d4" />
        <stop offset="100%" stop-color="#0e7490" />
      </linearGradient>
    </defs>
  `;

  // Background rect
  svg += `<rect width="${width}" height="${height}" fill="url(#bgGrad)" />`;

  // Draw Grid Lines (Horizontal for Prices)
  const gridCount = 6;
  for (let i = 0; i <= gridCount; i++) {
    const price = minPrice + (maxPrice - minPrice) * (i / gridCount);
    const y = getY(price);
    if (y >= top && y <= top + mainHeight) {
      // Grid line
      svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#1e293b" stroke-width="1" stroke-dasharray="4,4" />`;
      // Y label
      svg += `<text x="${width - right + 10}" y="${y + 5}" fill="#94a3b8" font-size="13" font-weight="500" text-anchor="start">${Math.round(price).toLocaleString()}</text>`;
    }
  }

  // Draw Grid Lines (Vertical for Dates - select 5 points)
  const step = Math.max(1, Math.floor(data.length / 5));
  for (let i = 0; i < data.length; i += step) {
    const x = getX(i);
    svg += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + mainHeight}" stroke="#1e293b" stroke-dasharray="4,4" />`;
    svg += `<line x1="${x}" y1="${volumeTop}" x2="${x}" y2="${volumeTop + volumeHeight}" stroke="#1e293b" stroke-dasharray="4,4" />`;
    
    // X label (date)
    const dateStr = data[i].date;
    svg += `<text x="${x}" y="${volumeTop + volumeHeight + 18}" fill="#94a3b8" font-size="13" font-weight="500" text-anchor="middle">${dateStr}</text>`;
  }

  // Draw Moving Averages (MA)
  const drawMA = (maValues: (number | null)[], color: string) => {
    let points = '';
    for (let i = 0; i < data.length; i++) {
      const val = maValues[i];
      if (val !== null && val !== undefined) {
        points += `${getX(i)},${getY(val)} `;
      }
    }
    if (points) {
      svg += `<polyline points="${points.trim()}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
    }
  };

  // Assign colors to MA based on type
  if (options.type === 'daily') {
    drawMA(data.map(d => d.ma1), '#f59e0b');  // Amber (5)
    drawMA(data.map(d => d.ma2), '#3b82f6');  // Blue (25)
    drawMA(data.map(d => d.ma3), '#ec4899');  // Pink (75)
  } else {
    drawMA(data.map(d => d.ma1), '#f59e0b');  // 12/13
    drawMA(data.map(d => d.ma2), '#3b82f6');  // 24/26
  }

  // Draw Candlesticks & Volumes
  const barWidth = Math.max(1.5, (chartWidth / data.length) * 0.7);

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const x = getX(i);
    const isUp = row.close >= row.open;
    const color = isUp ? '#f43f5e' : '#06b6d4'; // Red for Up, Cyan for Down
    const candleFill = isUp ? 'url(#upCandleGrad)' : 'url(#downCandleGrad)';

    // 1. Draw Volume bar
    const volY = getVolY(row.volume);
    const volH = volumeTop + volumeHeight - volY;
    svg += `<rect x="${x - barWidth / 2}" y="${volY}" width="${barWidth}" height="${volH}" fill="${color}" opacity="0.4" rx="1" />`;

    // 2. Draw Candlestick Wick (High-Low line)
    const yHigh = getY(row.high);
    const yLow = getY(row.low);
    svg += `<line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1.5" />`;

    // 3. Draw Candlestick Body (Open-Close rect)
    const yOpen = getY(row.open);
    const yClose = getY(row.close);
    const bodyY = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yOpen - yClose));
    
    svg += `<rect x="${x - barWidth / 2}" y="${bodyY}" width="${barWidth}" height="${bodyH}" fill="${candleFill}" stroke="${color}" stroke-width="0.5" rx="1" />`;
  }

  // Draw Latest Price Label Banner (right side)
  const lastRow = data[data.length - 1];
  const lastY = getY(lastRow.close);
  const lastColor = lastRow.close >= lastRow.open ? '#f43f5e' : '#06b6d4';
  svg += `
    <g transform="translate(${width - right}, ${lastY - 12})">
      <path d="M 0 12 L 8 4 L 85 4 L 85 20 L 8 20 Z" fill="${lastColor}" />
      <text x="12" y="16" fill="#ffffff" font-size="11" font-weight="bold">${lastRow.close.toLocaleString(undefined, { maximumFractionDigits: 1 })}</text>
    </g>
  `;

  // Draw Header / Title
  const latestDate = lastRow.date;
  const startDate = data[0].date;
  const formattedPeriod = `${startDate} ~ ${latestDate}`;
  const displayType = options.type === 'daily' ? '日足' : options.type === 'weekly' ? '週足' : '月足';

  svg += `
    <text x="${left}" y="${top - 33}" fill="#ffffff" font-size="24" font-weight="bold">${options.title} (${options.ticker})</text>
    <text x="${left}" y="${top - 12}" fill="#38bdf8" font-size="15" font-weight="600" letter-spacing="1">${displayType} チャート</text>
    <text x="${width - right}" y="${top - 15}" fill="#64748b" font-size="14" font-weight="500" text-anchor="end">${formattedPeriod}</text>
  `;

  // Draw Legend (MA descriptions)
  svg += `<g transform="translate(${left + 170}, ${top - 15})">`;
  if (options.type === 'daily') {
    svg += `
      <circle cx="10" cy="-5" r="4.5" fill="#f59e0b" />
      <text x="20" y="0" fill="#94a3b8" font-size="13" font-weight="500">5日線</text>
      <circle cx="85" cy="-5" r="4.5" fill="#3b82f6" />
      <text x="95" y="0" fill="#94a3b8" font-size="13" font-weight="500">25日線</text>
      <circle cx="160" cy="-5" r="4.5" fill="#ec4899" />
      <text x="170" y="0" fill="#94a3b8" font-size="13" font-weight="500">75日線</text>
    `;
  } else if (options.type === 'weekly') {
    svg += `
      <circle cx="10" cy="-5" r="4.5" fill="#f59e0b" />
      <text x="20" y="0" fill="#94a3b8" font-size="13" font-weight="500">13週線</text>
      <circle cx="95" cy="-5" r="4.5" fill="#3b82f6" />
      <text x="105" y="0" fill="#94a3b8" font-size="13" font-weight="500">26週線</text>
    `;
  } else {
    svg += `
      <circle cx="10" cy="-5" r="4.5" fill="#f59e0b" />
      <text x="20" y="0" fill="#94a3b8" font-size="13" font-weight="500">12ヶ月線</text>
      <circle cx="95" cy="-5" r="4.5" fill="#3b82f6" />
      <text x="105" y="0" fill="#94a3b8" font-size="13" font-weight="500">24ヶ月線</text>
    `;
  }
  svg += `</g>`;

  // Draw Border/Axes lines
  svg += `<rect x="${left}" y="${top}" width="${chartWidth}" height="${mainHeight}" fill="none" stroke="#334155" stroke-width="1" />`;
  svg += `<rect x="${left}" y="${volumeTop}" width="${chartWidth}" height="${volumeHeight}" fill="none" stroke="#334155" stroke-width="1" />`;

  svg += '</svg>';

  // Render SVG to WebP using sharp
  return sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
}
