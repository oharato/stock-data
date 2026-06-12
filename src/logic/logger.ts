// src/logic/logger.ts
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOG_DIR = 'logs';

export interface Logger {
  log: (msg: string) => void;
  error: (msg: string) => void;
  progress: (msg: string) => void;
  done: () => void;
  logFile: string;
}

export function createLogger(name: string): Logger {
  mkdirSync(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
  const logFile = join(LOG_DIR, `${name}-${ts}.log`);

  let lastProgressWasInline = false;

  function writeLine(level: string, msg: string): void {
    if (lastProgressWasInline) {
      process.stdout.write('\n');
      lastProgressWasInline = false;
    }
    const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
    console.log(line);
    appendFileSync(logFile, line + '\n');
  }

  return {
    log: (msg) => writeLine('INFO', msg),
    error: (msg) => writeLine('ERROR', msg),
    // progress: stdout上書き + ファイルには書かない（高頻度のため）
    // 100件ごとの進捗はfileにも書かれる（呼び出し元でlogを使う）
    progress: (msg) => {
      process.stdout.write(`\r  ${msg}`);
      lastProgressWasInline = true;
    },
    done: () => {
      if (lastProgressWasInline) {
        process.stdout.write('\n');
        lastProgressWasInline = false;
      }
    },
    logFile,
  };
}
