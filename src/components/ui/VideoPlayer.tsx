import { useRef, useEffect } from "react";
import Hls from "hls.js";

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

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });

      hls.loadSource(videoSrc);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoplay) {
          video.play().catch(() => {});
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      });

      return () => {
        hls.destroy();
      };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = videoSrc;
      video.load();

      if (autoplay) {
        video.play().catch(() => {});
      }

      return () => {
        video.src = "";
      };
    }

    return undefined;
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
