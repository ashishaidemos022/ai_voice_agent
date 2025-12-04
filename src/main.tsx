import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { WidgetApp } from './widget/WidgetApp.tsx';

const isWidget = window.location.pathname.startsWith('/widget');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isWidget ? <WidgetApp /> : <App />}
  </StrictMode>
);
