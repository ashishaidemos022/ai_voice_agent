import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { WidgetApp } from './widget/WidgetApp.tsx';
import { ChatEmbedApp } from './embed/ChatEmbedApp.tsx';
import { VoiceEmbedApp } from './embed/VoiceEmbedApp.tsx';

const path = window.location.pathname;
const isWidget = path.startsWith('/widget');
const isChatEmbed = path.startsWith('/embed/agent/');
const isVoiceEmbed = path.startsWith('/embed/voice/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isWidget ? (
      <WidgetApp />
    ) : isVoiceEmbed ? (
      <VoiceEmbedApp />
    ) : isChatEmbed ? (
      <ChatEmbedApp />
    ) : (
      <App />
    )}
  </StrictMode>
);
