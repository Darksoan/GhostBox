import type {
  AccountConnection,
  DiscordConnectionMetadata,
  GhostBoxAccount,
  LoginProvider,
  SteamConnectionMetadata,
} from "./ghostboxApi.types";
import type { SteamProfile } from "../types";

type SidebarAuthStatus = "loading" | "anonymous" | "authenticated";

export type SidebarIdentity = {
  title: string;
  avatarUrl: string;
  loading: boolean;
};

type SidebarIdentityInput = {
  status: SidebarAuthStatus;
  account: GhostBoxAccount | null;
  connections: AccountConnection[];
  authenticatedVia: LoginProvider | null;
  profile: SteamProfile | null;
  anonymousLabel: string;
  loadingLabel: string;
  accountLabel: string;
};

function metadataObject(connection: AccountConnection | undefined) {
  const metadata = connection?.metadata;
  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : null;
}

function metadataText(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function providerIdentity(connection: AccountConnection | undefined) {
  const metadata = metadataObject(connection);
  if (connection?.provider === "discord") {
    const discord = metadata as DiscordConnectionMetadata | null;
    return {
      name:
        discord?.globalName?.trim() ||
        discord?.username?.trim() ||
        "",
      avatarUrl: discord?.avatarUrl?.trim() || "",
    };
  }
  if (connection?.provider === "steam") {
    const steam = metadata as SteamConnectionMetadata | null;
    return {
      name: steam?.displayName?.trim() || "",
      avatarUrl: steam?.avatarUrl?.trim() || "",
    };
  }
  return {
    name: metadataText(metadata, "displayName") || metadataText(metadata, "username"),
    avatarUrl: metadataText(metadata, "avatarUrl"),
  };
}

export function resolveSidebarIdentity(input: SidebarIdentityInput): SidebarIdentity {
  if (input.status === "anonymous") {
    return { title: input.anonymousLabel, avatarUrl: "", loading: false };
  }
  if (input.status === "loading") {
    return { title: input.loadingLabel, avatarUrl: "", loading: true };
  }

  const preferredProvider =
    input.authenticatedVia === "discord" || input.authenticatedVia === "steam"
      ? input.authenticatedVia
      : null;
  const orderedConnections = [...input.connections].sort((left, right) => {
    if (!preferredProvider) return 0;
    if (left.provider === preferredProvider) return -1;
    if (right.provider === preferredProvider) return 1;
    return 0;
  });
  const providerIdentities = orderedConnections.map(providerIdentity);
  const providerName = providerIdentities.find((identity) => identity.name)?.name || "";
  const providerAvatar =
    providerIdentities.find((identity) => identity.avatarUrl)?.avatarUrl || "";

  return {
    title:
      input.profile?.displayName?.trim() ||
      input.account?.displayName?.trim() ||
      providerName ||
      input.account?.username?.trim() ||
      input.accountLabel,
    avatarUrl: input.profile?.avatarUrl?.trim() || providerAvatar,
    loading: false,
  };
}
