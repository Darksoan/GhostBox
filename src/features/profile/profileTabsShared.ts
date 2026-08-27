import { Layers, User } from "lucide-react";
import { Cup } from "reicon-react";
import type { ElementType } from "react";

export type ProfileTabId = "overview" | "library" | "achievements";

export const profileTabLabelKeys: Record<ProfileTabId, string> = {
  overview: "profile.overview",
  library: "profile.library",
  achievements: "achievements.title",
};

type ProfileNavigationTab = {
  id: ProfileTabId;
  icon: ElementType<{ size?: number | string; strokeWidth?: number | string }>;
};

/** Abas do perfil — vivem na sidebar (mesmo painel/animação dos ajustes). */
export const profileNavigationTabs: ProfileNavigationTab[] = [
  { id: "overview", icon: User },
  { id: "library", icon: Layers },
  { id: "achievements", icon: Cup },
];

export const defaultProfileTabId: ProfileTabId = "overview";
