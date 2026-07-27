import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installGlobalErrorLog } from './log';
// カードデザインのCSSはゲームと共有している（見た目がずれないように）。管理画面のCSSより先に読む
import '../../web/src/cardFrame.css';
import './admin.css';

installGlobalErrorLog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
