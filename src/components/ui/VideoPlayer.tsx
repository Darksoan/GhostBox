import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useSettings } from "../../context/settings";

interface VideoPlayerProps {
  videoSrc: string;
  videoType?: string;
  poster?: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  tabIndex?: number;
  className?: string;
}

// Quanto tempo os controles ficam visíveis depois da última interação, antes
// de sumir sozinhos (só enquanto o vídeo está tocando — pausado eles nunca
// somem, não tem por quê).
const CONTROLS_HIDE_DELAY_MS = 2500;
// Passo do atalho de teclado de seek (setas esquerda/direita). Não usa o step
// do range nativo porque o range é contínuo (permite arrastar quadro a
// quadro); o atalho de teclado precisa de um salto perceptível.
const SEEK_STEP_SECONDS = 5;

function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";

  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

// Achado o range de buffer que cobre o instante atual (ou o último range
// conhecido, se o áudio/vídeo já passou de todos eles — acontece ao voltar no
// tempo para um trecho já descartado do buffer).
function getBufferedEnd(video: HTMLVideoElement, time: number) {
  const { buffered } = video;
  for (let index = 0; index < buffered.length; index += 1) {
    if (buffered.start(index) <= time && time <= buffered.end(index)) {
      return buffered.end(index);
    }
  }
  return buffered.length ? buffered.end(buffered.length - 1) : 0;
}

export function VideoPlayer({
  videoSrc,
  videoType,
  poster,
  autoplay = false,
  muted = true,
  loop = false,
  controls = true,
  tabIndex = -1,
  className,
}: Readonly<VideoPlayerProps>) {
  const { t } = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideControlsTimeoutRef = useRef<number | null>(null);
  const isHls = videoType === "application/x-mpegURL";

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isMuted, setIsMuted] = useState(muted);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [areControlsVisible, setAreControlsVisible] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    if (!isHls) {
      return undefined;
    }

    let destroyed = false;
    let hlsInstance: import("hls.js").default | null = null;

    void import("hls.js").then(({ default: Hls }) => {
      if (destroyed || !videoRef.current) return;

      if (Hls.isSupported()) {
        hlsInstance = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        });

        hlsInstance.loadSource(videoSrc);
        hlsInstance.attachMedia(videoRef.current);

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (autoplay) {
            videoRef.current?.play().catch(() => {});
          }
        });

        hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
          if (!hlsInstance) return;
          if (!data.fatal) return;

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hlsInstance.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hlsInstance.recoverMediaError();
              break;
            default:
              hlsInstance.destroy();
              break;
          }
        });
        return;
      }

      if (videoRef.current?.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current.src = videoSrc;
        videoRef.current.load();
        if (autoplay) {
          videoRef.current.play().catch(() => {});
        }
      }
    });

    return () => {
      destroyed = true;
      hlsInstance?.destroy();
      if (videoRef.current?.src === videoSrc) {
        videoRef.current.src = "";
      }
    };
  }, [autoplay, isHls, videoSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = muted;
    video.loop = loop;
  }, [loop, muted]);

  // Um vídeo novo reseta a leitura de progresso e o estado de player — sem
  // isso, trocar de trailer numa galeria com mais de um vídeo mostraria por
  // um instante o tempo/duração do vídeo anterior.
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setIsBuffering(Boolean(autoplay));
  }, [videoSrc, autoplay]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      if (hideControlsTimeoutRef.current !== null) {
        window.clearTimeout(hideControlsTimeoutRef.current);
      }
    };
  }, []);

  function scheduleControlsHide() {
    if (hideControlsTimeoutRef.current !== null) {
      window.clearTimeout(hideControlsTimeoutRef.current);
      hideControlsTimeoutRef.current = null;
    }
    // Pausado: os controles nunca somem sozinhos, só no hover/foco eles já
    // fazem sentido continuar visíveis.
    if (!videoRef.current || videoRef.current.paused) return;

    hideControlsTimeoutRef.current = window.setTimeout(() => {
      setAreControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }

  function revealControls() {
    setAreControlsVisible(true);
    scheduleControlsHide();
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !(video.muted || video.volume === 0);
    video.muted = nextMuted;
    if (!nextMuted && video.volume === 0) {
      video.volume = 1;
      setVolume(1);
    }
    setIsMuted(nextMuted);
  }

  function handleSeekChange(event: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;

    const nextTime = Number(event.target.value);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function seekBy(deltaSeconds: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;

    video.currentTime = Math.min(
      Math.max(video.currentTime + deltaSeconds, 0),
      video.duration
    );
  }

  function handleVolumeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;

    const nextVolume = Number(event.target.value);
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
  }

  async function toggleFullscreen() {
    const container = containerRef.current;
    if (!container || typeof document === "undefined") return;

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
    } catch {
      // Alguns hosts (webview embutido, permissão negada) rejeitam a troca de
      // tela cheia — o player continua funcional sem ela, não há o que tratar.
    }
  }

  function handleContainerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as Node;
    // Clique na mídia ou no fundo do player leva o foco para o container, que
    // é quem responde a Espaço/Enter — clicar num botão/slider já foca o
    // próprio controle nativamente.
    if (target === videoRef.current || target === containerRef.current) {
      containerRef.current?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const isRangeInput =
      target instanceof HTMLInputElement && target.type === "range";

    if (
      (event.key === " " || event.key === "Enter") &&
      target === containerRef.current
    ) {
      event.preventDefault();
      event.stopPropagation();
      togglePlay();
      revealControls();
      return;
    }

    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !isRangeInput) {
      event.preventDefault();
      event.stopPropagation();
      seekBy(event.key === "ArrowLeft" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS);
      revealControls();
    }
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    const nextFocusTarget = event.relatedTarget as Node | null;
    if (!containerRef.current?.contains(nextFocusTarget)) {
      scheduleControlsHide();
    }
  }

  const isEffectivelyMuted = isMuted || volume === 0;
  const playedPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (bufferedEnd / duration) * 100 : 0;
  const volumeLevel = isEffectivelyMuted ? 0 : volume;

  return (
    <div
      ref={containerRef}
      className={`video-player ${className ?? ""}`.trim()}
      tabIndex={controls ? 0 : -1}
      role={controls ? "group" : undefined}
      aria-label={controls ? t("video.player") : undefined}
      data-controls-visible={
        controls && (areControlsVisible || !isPlaying) ? "true" : "false"
      }
      onPointerDown={controls ? handleContainerPointerDown : undefined}
      onPointerMove={controls ? revealControls : undefined}
      onPointerLeave={
        controls
          ? () => {
              if (isPlaying) setAreControlsVisible(false);
            }
          : undefined
      }
      onFocus={controls ? revealControls : undefined}
      onBlur={controls ? handleBlur : undefined}
      onKeyDown={controls ? handleKeyDown : undefined}
    >
      <video
        ref={videoRef}
        className="video-player__media"
        poster={poster}
        loop={loop}
        muted={muted}
        autoPlay={autoplay}
        tabIndex={tabIndex}
        playsInline
        onClick={controls ? togglePlay : undefined}
        onPlay={() => {
          setIsPlaying(true);
          scheduleControlsHide();
        }}
        onPause={() => {
          setIsPlaying(false);
          setAreControlsVisible(true);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setAreControlsVisible(true);
        }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          setCurrentTime(video.currentTime);
          setBufferedEnd(getBufferedEnd(video, video.currentTime));
        }}
        onProgress={(event) => {
          const video = event.currentTarget;
          setBufferedEnd(getBufferedEnd(video, video.currentTime));
        }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onVolumeChange={(event) => {
          const video = event.currentTarget;
          setVolume(video.volume);
          setIsMuted(video.muted);
        }}
        onWaiting={() => setIsBuffering(true)}
        onLoadStart={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
      >
        {!isHls && <source src={videoSrc} type={videoType || "video/mp4"} />}
        <track kind="captions" />
      </video>

      {isBuffering && (
        <div
          className="video-player__buffering"
          role="status"
          aria-label={t("video.buffering")}
        >
          <Loader2
            className="video-player__buffering-icon"
            size={32}
            aria-hidden="true"
          />
        </div>
      )}

      {controls && (
        <div className="video-player__controls">
          <button
            type="button"
            className="video-player__button"
            onClick={togglePlay}
            aria-label={isPlaying ? t("video.pause") : t("video.play")}
          >
            {isPlaying ? (
              <Pause size={16} aria-hidden="true" />
            ) : (
              <Play size={16} aria-hidden="true" />
            )}
          </button>

          <span className="video-player__time" aria-hidden="true">
            {formatTime(currentTime)}
          </span>

          <div
            className="video-player__seek-track"
            style={
              {
                "--video-player-buffered": `${bufferedPercent}%`,
              } as React.CSSProperties
            }
          >
            <input
              type="range"
              className="video-player__seek"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={handleSeekChange}
              disabled={!duration}
              aria-label={t("video.progress")}
              style={
                {
                  "--video-player-played": `${playedPercent}%`,
                } as React.CSSProperties
              }
            />
          </div>

          <span className="video-player__time" aria-hidden="true">
            {formatTime(duration)}
          </span>

          <button
            type="button"
            className="video-player__button"
            onClick={toggleMute}
            aria-label={isEffectivelyMuted ? t("video.unmute") : t("video.mute")}
          >
            {isEffectivelyMuted ? (
              <VolumeX size={16} aria-hidden="true" />
            ) : volume < 0.5 ? (
              <Volume1 size={16} aria-hidden="true" />
            ) : (
              <Volume2 size={16} aria-hidden="true" />
            )}
          </button>

          <input
            type="range"
            className="video-player__volume"
            min={0}
            max={1}
            step={0.05}
            value={volumeLevel}
            onChange={handleVolumeChange}
            aria-label={t("video.volume")}
            style={
              {
                "--video-player-volume": `${volumeLevel * 100}%`,
              } as React.CSSProperties
            }
          />

          <button
            type="button"
            className="video-player__button"
            onClick={toggleFullscreen}
            aria-label={
              isFullscreen ? t("video.fullscreenExit") : t("video.fullscreenEnter")
            }
          >
            {isFullscreen ? (
              <Minimize size={16} aria-hidden="true" />
            ) : (
              <Maximize size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
