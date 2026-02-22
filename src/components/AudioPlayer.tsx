import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { cn } from '../utils/cn';

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface AudioPlayerProps {
  src: string;
  compact?: boolean;
}

export default function AudioPlayer({ src, compact = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
      setLoading(false);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setPlaying(false);
    const onCanPlay = () => setLoading(false);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('canplay', onCanPlay);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  }, [playing]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = fraction * duration;
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <audio ref={audioRef} src={src} preload="metadata" />
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePlay(); }}
          disabled={loading}
          className={cn(
            'flex items-center justify-center h-7 w-7 rounded-full transition-colors shrink-0',
            loading
              ? 'bg-gray-100 text-gray-300'
              : playing
                ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
        </button>
        <div
          className="flex-1 h-1.5 bg-gray-200 rounded-full cursor-pointer min-w-[60px]"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); seek(e); }}
        >
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-gray-400 tabular-nums shrink-0">
          {formatTime(currentTime)}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={loading}
          className={cn(
            'flex items-center justify-center h-10 w-10 rounded-full transition-colors shrink-0',
            loading
              ? 'bg-gray-200 text-gray-400'
              : playing
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
          )}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>

        <div className="flex-1 space-y-1">
          <div
            className="h-2 bg-gray-200 rounded-full cursor-pointer group"
            onClick={seek}
          >
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-150 relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 bg-indigo-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" />
            </div>
          </div>
          <div className="flex justify-between text-xs text-gray-400 tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button
          onClick={() => {
            if (audioRef.current) audioRef.current.muted = !muted;
            setMuted(!muted);
          }}
          className="text-gray-400 hover:text-gray-600 shrink-0"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
