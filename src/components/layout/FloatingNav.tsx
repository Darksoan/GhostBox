import { ChevronUp, Folder, Heart, UserRound } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../../data";
import type { Page, SteamProfile, UserCollection } from "../../types";
import { useSettings } from "../../context/settings";
import { useAuth } from "../../context/AuthContext";
import { useCachedImageSources, useLoadableImageSource } from "../../hooks/useCachedImageSources";
import { preloadProfileImages } from "../../utils/image";
import { downloadTasksChangedEvent, getActiveDownloadCount } from "../../lib/downloadManager";
import { subscribeScrollIdle } from "../../utils/scrollIdle";
import { primaryNavigation, secondaryNavigation } from "./navigationItems";
import "./FloatingNav.scss";

const FAVORITES_COLLECTION_ID = "__favorites__";

const navigationItems = [...primaryNavigation, ...secondaryNavigation];

interface FloatingNavProps {
  activePage: Page;
  activeCollectionId?: string;
  steamProfile: SteamProfile | null;
  isCloudProfileRestoring?: boolean;
  favoriteGames: GhostBoxGame[];
  userCollections: UserCollection[];
  onNavigate: (page: Page, collectionId?: string) => void;
  onOpenProfile: () => void;
}

export const FloatingNav = memo(function FloatingNav({
  activePage,
  activeCollectionId,
  steamProfile,
  isCloudProfileRestoring = false,
  favoriteGames,
  userCollections,
  onNavigate,
  onOpenProfile,
}: FloatingNavProps) {
  const { t } = useSettings();
  const [isCollectionsOpen, setIsCollectionsOpen] = useState(false);
  const [isScrollHidden, setIsScrollHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [activeDownloadCount, setActiveDownloadCount] = useState(() => getActiveDownloadCount());

  useEffect(() => {
    const refresh = () => setActiveDownloadCount(getActiveDownloadCount());
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, []);

  // Trocar de página já é resposta suficiente: o painel não precisa continuar aberto.
  useEffect(() => {
    setIsCollectionsOpen(false);
  }, [activePage]);

  useEffect(() => {
    const THRESHOLD = 4;
    const scrollTopMap = new WeakMap<Element, number>();

    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const prev = scrollTopMap.get(target) ?? 0;
      const current = target.scrollTop;
      scrollTopMap.set(target, current);

      const delta = current - prev;
      if (delta > THRESHOLD) {
        setIsScrollHidden(true);
      } else if (delta < -THRESHOLD) {
        setIsScrollHidden(false);
      }
    };

    const unsubIdle = subscribeScrollIdle(() => setIsScrollHidden(false));

    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", handleScroll, { capture: true });
      unsubIdle();
    };
  }, []);

  useEffect(() => {
    if (!isCollectionsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCollectionsOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsCollectionsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isCollectionsOpen]);

  const collections = useMemo(
    () => [
      { id: FAVORITES_COLLECTION_ID, name: t("profile.favorites"), count: favoriteGames.length },
      ...userCollections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        count: collection.gameIds.length,
      })),
    ],
    [favoriteGames.length, t, userCollections]
  );

  const handleCollectionClick = useCallback(
    (collectionId: string) => {
      onNavigate(
        "favorites",
        collectionId === FAVORITES_COLLECTION_ID ? "favorites" : collectionId
      );
      setIsCollectionsOpen(false);
    },
    [onNavigate]
  );

  const collectionsLabel = t("sidebar.collections");

  return (
    <div ref={containerRef} className={`floating-nav${isScrollHidden ? " floating-nav--hidden" : ""}`}>
      {isCollectionsOpen && (
        <div className="floating-nav__dropup" role="menu" aria-label={collectionsLabel}>
          <ul className="floating-nav__dropup-list">
            {collections.map((collection) => {
              const isFavorites = collection.id === FAVORITES_COLLECTION_ID;
              const isActive =
                activePage === "favorites" &&
                activeCollectionId === (isFavorites ? "favorites" : collection.id);

              return (
                <li key={collection.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={`floating-nav__dropup-item${
                      isActive ? " floating-nav__dropup-item--active" : ""
                    }`}
                    onClick={() => handleCollectionClick(collection.id)}
                  >
                    {isFavorites ? (
                      <Heart size={16} strokeWidth={2} />
                    ) : (
                      <Folder size={16} strokeWidth={2} />
                    )}
                    <span className="floating-nav__dropup-name">{collection.name}</span>
                    <span className="floating-nav__dropup-count">{collection.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <nav className="floating-nav__card" aria-label="Navegação principal">
        <FloatingNavProfile
          profile={steamProfile}
          isCloudProfileRestoring={isCloudProfileRestoring}
          isActive={activePage === "profile"}
          onOpenProfile={onOpenProfile}
        />


        <ul className="floating-nav__menu">
          {navigationItems.map(({ id, labelKey, icon: Icon }) => {
            const label = t(labelKey);
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`floating-nav__button${
                    activePage === id ? " floating-nav__button--active" : ""
                  }`}
                  onClick={() => onNavigate(id)}
                  aria-label={label}
                  title={label}
                  aria-current={activePage === id ? "page" : undefined}
                >
                  <Icon size={19} strokeWidth={2} />
                  {id === "downloads" && activeDownloadCount > 0 && (
                    <strong className="floating-nav__badge">
                      {activeDownloadCount > 99 ? "99+" : activeDownloadCount}
                    </strong>
                  )}
                </button>
              </li>
            );
          })}
        </ul>


        <button
          type="button"
          className={`floating-nav__button floating-nav__collections${
            isCollectionsOpen ? " floating-nav__button--active" : ""
          }`}
          onClick={() => setIsCollectionsOpen((open) => !open)}
          aria-label={collectionsLabel}
          title={collectionsLabel}
          aria-expanded={isCollectionsOpen}
          aria-haspopup="menu"
        >
          <Folder size={19} strokeWidth={2} />
          <ChevronUp
            size={12}
            strokeWidth={2.4}
            className={`floating-nav__collections-chevron${
              isCollectionsOpen ? " floating-nav__collections-chevron--open" : ""
            }`}
          />
        </button>
      </nav>
    </div>
  );
});

interface FloatingNavProfileProps {
  profile: SteamProfile | null;
  isCloudProfileRestoring: boolean;
  isActive: boolean;
  onOpenProfile: () => void;
}

const FloatingNavProfile = memo(function FloatingNavProfile({
  profile,
  isCloudProfileRestoring,
  isActive,
  onOpenProfile,
}: FloatingNavProfileProps) {
  const { appearance } = useSettings();
  const { account } = useAuth();
  const avatarSources = useCachedImageSources(profile?.avatarUrl ? [profile.avatarUrl] : []);
  const avatarSource = useLoadableImageSource(avatarSources);

  // Enquanto o perfil da nuvem restaura, o avatar antigo da Steam ainda está no
  // ar e trocaria duas vezes: segura no skeleton até a fonte final chegar.
  const shouldHoldSteamAvatar = Boolean(
    isCloudProfileRestoring &&
      profile?.avatarUrl &&
      !profile.avatarUrl.startsWith("data:") &&
      !profile.avatarUrl.includes("/storage/v1/object/public/profile-images/")
  );

  useEffect(() => {
    preloadProfileImages(profile);
  }, [profile?.avatarUrl, profile?.bannerUrl]);

  const displayName =
    profile?.displayName ||
    account?.displayName ||
    account?.username ||
    (appearance.language === "en" ? "Log in" : "Faça login");

  return (
    <button
      type="button"
      className={`floating-nav__profile${isActive ? " floating-nav__profile--active" : ""}`}
      onClick={onOpenProfile}
      onMouseEnter={() => profile && preloadProfileImages(profile)}
      onFocus={() => profile && preloadProfileImages(profile)}
    >
      <span className="floating-nav__avatar" aria-hidden="true">
        {shouldHoldSteamAvatar || (isCloudProfileRestoring && !avatarSource) ? (
          <span className="floating-nav__avatar-skeleton" />
        ) : avatarSource ? (
          <img
            src={avatarSource}
            alt=""
            width={28}
            height={28}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <UserRound size={16} />
        )}
      </span>
      <span className="floating-nav__profile-name">{displayName}</span>
    </button>
  );
});
