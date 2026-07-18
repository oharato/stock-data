import { JSX } from 'hono/jsx';

interface LayoutProps {
  title: string;
  children: JSX.Element;
}

export function Layout({ title, children }: LayoutProps) {
  return (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {/* Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet" />
        <style>{`
          :root {
            --bg-base: #080c14;
            --bg-surface: #0f172a;
            --bg-card: #1e293b;
            --border: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent: #38bdf8;
            --accent-glow: rgba(56, 189, 248, 0.15);
            --success: #f43f5e; /* Candle Up */
            --danger: #06b6d4;  /* Candle Down */
          }

          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          body {
            background-color: var(--bg-base);
            color: var(--text-primary);
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
            padding: 24px;
            min-height: 100vh;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
          }

          header {
            max-width: 1800px;
            margin: 0 auto 24px auto;
            display: flex;
            flex-direction: column;
            gap: 16px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 20px;
          }

          @media (min-width: 768px) {
            header {
              flex-direction: row;
              justify-content: space-between;
              align-items: center;
            }
          }

          .brand-title {
            font-size: 26px;
            font-weight: 800;
            background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
          }

          .brand-subtitle {
            font-size: 13px;
            color: var(--text-secondary);
            font-weight: 500;
            margin-top: 4px;
          }

          main {
            max-width: 1800px;
            margin: 0 auto;
          }
        `}</style>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
