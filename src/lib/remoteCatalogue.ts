import type { HomeResult } from "../data";
import { pirateboxApi } from "./pirateboxApi";

export function getRemoteHome(): Promise<HomeResult> {
  return pirateboxApi.getHome();
}
