import { useQuery } from "@tanstack/react-query";
import { getRemoteHome } from "../lib/remoteCatalogue";

export const homeQueryKeys = {
  all: ["home"] as const,
};

export function useHomeQuery() {
  return useQuery({
    queryKey: homeQueryKeys.all,
    queryFn: getRemoteHome,
    retry: false,
  });
}
