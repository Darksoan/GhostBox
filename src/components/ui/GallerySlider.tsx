import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { SteamMovie } from "../../data";
import { useSettings } from "../../context/settings";
import { VideoPlayer } from "./VideoPlayer";

interface MediaItem {
  id: string;
  type: "video" | "image";
  src?: string;
  poster?: string;
  videoSrc?: string;
  videoType?: string;
  alt: string;
}

function getMovieSource(movie: SteamMovie, quality: "high" | "low") {
  const sourceOptions = quality === "low"
    ? [
        { src: movie.mp4?.["480"], type: "video/mp4" },
        { src: movie.webm?.["480"], type: "video/webm" },
        { src: movie.webm?.max, type: "video/webm" },
        { src: movie.mp4?.max, type: "video/mp4" },
      ]
    : [
        { src: movie.hls_h264, type: "application/x-mpegURL" },
        { src: movie.mp4?.max, type: "video/mp4" },
        { src: movie.mp4?.["480"], type: "video/mp4" },
        { src: movie.webm?.max, type: "video/webm" },
        { src: movie.webm?.["480"], type: "video/webm" },
        { src: movie.dash_h264, type: "application/dash+xml" },
        { src: movie.dash_av1, type: "application/dash+xml" },
      ];

  const source = sourceOptions.find((option) => option.src?.trim());
  if (!source?.src) return null;

  return {
    videoSrc: source.src.startsWith("http://")
      ? source.src.replace("http://", "https://")
      : source.src,
    videoType: source.type,
  };
}

interface GallerySliderProps {
  screenshots: string[];
  movies?: SteamMovie[];
  gameTitle: string;
  language: string;
}

export function GallerySlider({
  screenshots,
  movies,
  gameTitle,
  language,
}: GallerySliderProps) {
  const { appearance } = useSettings();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const mediaItems = useMemo(() => {
    const items: MediaItem[] = [];

    if (movies) {
      movies.forEach((movie, index) => {
        const source = getMovieSource(movie, appearance.trailerQuality);
        if (source) {
          items.push({
            id: `movie-${movie.id}`,
            type: "video",
            poster: movie.thumbnail,
            videoSrc: source.videoSrc,
            videoType: source.videoType,
            alt: movie.name || (language === "en" ? `Trailer ${index + 1}` : `Trailer ${index + 1}`),
          });
        }
      });
    }

    screenshots.forEach((src, index) => {
      items.push({
        id: `screenshot-${index}`,
        type: "image",
        src,
        alt: language === "en"
          ? `Screenshot ${index + 1} of ${gameTitle}`
          : `Screenshot ${index + 1} de ${gameTitle}`,
      });
    });

    return items;
  }, [screenshots, movies, gameTitle, language, appearance.trailerQuality]);

  const scrollPrev = useCallback(() => {
    setSelectedIndex((prev) =>
      prev === 0 ? mediaItems.length - 1 : prev - 1
    );
  }, [mediaItems.length]);

  const scrollNext = useCallback(() => {
    setSelectedIndex((prev) =>
      prev === mediaItems.length - 1 ? 0 : prev + 1
    );
  }, [mediaItems.length]);

  const scrollTo = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const scrollToPreview = useCallback(
    (index: number, event: React.MouseEvent<HTMLButtonElement>) => {
      scrollTo(index);

      const button = event.currentTarget;
      const previewContainer = button.parentElement;

      if (previewContainer) {
        const containerRect = previewContainer.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();

        const isOffScreenLeft = buttonRect.left < containerRect.left;
        const isOffScreenRight = buttonRect.right > containerRect.right;

        if (isOffScreenLeft || isOffScreenRight) {
          button.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
          });
        }
      }
    },
    [scrollTo]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        scrollPrev();
      } else if (event.key === "ArrowRight") {
        scrollNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [scrollPrev, scrollNext]);

  if (!mediaItems.length) {
    return null;
  }

  return (
    <div className="gallery-slider__container">
      <div className="gallery-slider__viewport" ref={viewportRef}>
        <div className="gallery-slider__container-inner">
          {mediaItems.map((item, index) => (
            <div
              key={item.id}
              className={`gallery-slider__slide ${index === selectedIndex ? "gallery-slider__slide--active" : ""}`}
            >
              {item.type === "video" ? (
                <VideoPlayer
                  videoSrc={item.videoSrc!}
                  videoType={item.videoType}
                  poster={item.poster}
                  autoplay={index === selectedIndex && appearance.trailerAutoplay}
                  loop
                  muted
                  controls
                  className="gallery-slider__media"
                  tabIndex={-1}
                />
              ) : (
                <img
                  className="gallery-slider__media"
                  src={item.src}
                  alt={item.alt}
                  loading={index === selectedIndex ? "eager" : "lazy"}
                  decoding="async"
                />
              )}
            </div>
          ))}
        </div>

        {mediaItems.length > 1 && (
          <>
            <button
              onClick={scrollPrev}
              type="button"
              className="gallery-slider__button gallery-slider__button--left"
              aria-label={
                language === "en"
                  ? "Previous media"
                  : "Mídia anterior"
              }
              tabIndex={0}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={scrollNext}
              type="button"
              className="gallery-slider__button gallery-slider__button--right"
              aria-label={
                language === "en" ? "Next media" : "Próxima mídia"
              }
              tabIndex={0}
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      {mediaItems.length > 1 && (
        <div className="gallery-slider__preview" ref={previewContainerRef}>
          {mediaItems.map((item, index) => (
            <button
              key={`preview-${item.id}`}
              type="button"
              className={`gallery-slider__preview-button ${
                selectedIndex === index
                  ? "gallery-slider__preview-button--active"
                  : ""
              }`}
              onClick={(e) => scrollToPreview(index, e)}
              aria-label={
                item.type === "video"
                  ? language === "en"
                    ? `Play ${item.alt}`
                    : `Reproduzir ${item.alt}`
                  : item.alt
              }
            >
              <img
                src={item.poster || item.src}
                className="gallery-slider__preview-image"
                alt={item.alt}
                loading="lazy"
                decoding="async"
              />
              {item.type === "video" && (
                <div className="gallery-slider__play-overlay">
                  <Play size={20} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
