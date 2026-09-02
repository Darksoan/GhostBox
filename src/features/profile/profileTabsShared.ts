import { Layers, User, UserPen } from "lucide-react";
import { Cup } from "reicon-react";
import type { ElementType } from "react";

export type ProfileTabId = "overview" | "library" | "achievements" | "editProfile";

export const profileTabLabelKeys: Record<ProfileTabId, string> = {
  overview: "profile.overview",
  library: "profile.library",
  achievements: "achievements.title",
  editProfile: "profile.editProfile",
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
  { id: "editProfile", icon: UserPen },
];

export const defaultProfileTabId: ProfileTabId = "overview";
