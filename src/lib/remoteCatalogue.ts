import type { HomeResult } from "../data";
import { ghostboxApi } from "./ghostboxApi";

export function getRemoteHome(): Promise<HomeResult> {
  return ghostboxApi.getHome();
}
