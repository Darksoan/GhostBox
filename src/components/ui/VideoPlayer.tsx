import { useRef, useEffect } from "react";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const isHls = videoType === "application/x-mpegURL";

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

  return (
    <video
      ref={videoRef}
      controls={controls}
      className={className}
      poster={poster}
      loop={loop}
      muted={muted}
      autoPlay={autoplay}
      tabIndex={tabIndex}
      playsInline
    >
      {!isHls && <source src={videoSrc} type={videoType || "video/mp4"} />}
      <track kind="captions" />
    </video>
  );
}
