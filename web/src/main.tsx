import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RecoveryPreview } from './online/RecoveryPreview';
// カードデザインのCSSは管理画面と共有している。画面ごとのCSSより先に読む
import './cardFrame.css';
import './styles.css';
import './online.css';

const previewMode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('__recovery_preview')
  : null;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {previewMode === 'offer' || previewMode === 'playing'
      ? <RecoveryPreview mode={previewMode} />
      : <App />}
  </React.StrictMode>,
);
