import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

const LOFI_STREAM = 'https://stream.zeno.fm/0r0xa792kwzuv';

const GESTURE_EVENTS = ['click', 'touchstart', 'pointerdown', 'keydown'] as const;

function ensureMusicPlaying(audio: HTMLAudioElement) {
  let cleanedUp = false;
  const listeners: Array<[string, EventListener]> = [];

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const [event, fn] of listeners) {
      document.removeEventListener(event, fn);
    }
    clearInterval(interval);
    window.removeEventListener('pagehide', cleanup);
  };

  const tryPlay = () => {
    if (cleanedUp || window.backgroundMusicMuted) return;
    if (!audio.paused) {
      cleanup();
      return;
    }
    audio.play().catch(() => {});
  };

  // Retry periodically in case autoplay becomes allowed (e.g. history-based media engagement),
  // and stop all retry work as soon as the music is playing.
  const interval = window.setInterval(() => {
    if (cleanedUp) return;
    if (window.backgroundMusicMuted) {
      cleanup();
      return;
    }
    if (!audio.paused) {
      cleanup();
      return;
    }
    if (document.visibilityState === 'visible') {
      audio.play().catch(() => {});
    }
  }, 3000);

  // Try immediately on load (works when autoplay is allowed)
  tryPlay();

  // Fall back to any user gesture anywhere on the page
  if (!cleanedUp && audio.paused) {
    for (const event of GESTURE_EVENTS) {
      const fn = tryPlay as EventListener;
      listeners.push([event, fn]);
      document.addEventListener(event, fn);
    }
    window.addEventListener('pagehide', cleanup);
  }
}

// Initialize audio globally once
export function initBackgroundMusic() {
  const savedMuted = localStorage.getItem('backgroundMusicMuted') === 'true';
  window.backgroundMusicMuted = savedMuted;

  let audio = window.backgroundAudio;
  if (!audio) {
    audio = new Audio();
    audio.loop = true;
    audio.volume = 0.08;
    audio.preload = 'auto';
    audio.src = LOFI_STREAM;
    window.backgroundAudio = audio;
  }

  if (!savedMuted) {
    ensureMusicPlaying(audio);
  }
}

declare global {
  interface Window {
    backgroundAudio: HTMLAudioElement | null;
    backgroundMusicMuted: boolean;
  }
}

// Button component for Home page only
export function MusicToggleButton() {
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('backgroundMusicMuted') === 'true';
  });
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const checkPlaying = () => {
      if (window.backgroundAudio) {
        setIsPlaying(!window.backgroundAudio.paused);
      }
    };
    checkPlaying();
    const interval = setInterval(checkPlaying, 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    localStorage.setItem('backgroundMusicMuted', newMuted.toString());
    window.backgroundMusicMuted = newMuted;
    
    if (window.backgroundAudio) {
      if (newMuted) {
        window.backgroundAudio.pause();
        setIsPlaying(false);
      } else {
        window.backgroundAudio.play()
          .then(() => setIsPlaying(true))
          .catch(() => {});
      }
    }
  };

  return (
    <button
      onClick={toggleMute}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 transition-all duration-200 hover:scale-105 active:scale-95"
      data-testid="button-toggle-music"
    >
      {isMuted ? (
        <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
      ) : (
        <>
          <Volume2 className="h-3.5 w-3.5 text-purple-500" />
          {isPlaying && (
            <span className="flex gap-[2px] items-end h-3">
              <span className="w-[3px] h-full bg-purple-500 rounded-full animate-pulse" />
              <span className="w-[3px] h-2 bg-pink-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-[3px] h-2.5 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
            </span>
          )}
        </>
      )}
    </button>
  );
}
