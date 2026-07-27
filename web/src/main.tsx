import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// カードデザインのCSSは管理画面と共有している。画面ごとのCSSより先に読む
import './cardFrame.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
