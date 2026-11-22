import type { SpindleAPI } from "lumiverse-spindle-types";
import { createBackend } from "./backend/controller.js";

declare const spindle: SpindleAPI | undefined;

export { createBackend, type BackendController } from "./backend/controller.js";
export {
  extractDurationMs,
  extractFinishReason,
  extractLorebookEntryNames,
  extractMacroNames,
  extractStopDetails,
  extractStopSequence,
} from "./backend/extractors.js";
export { BackendStore } from "./backend/store.js";

if (typeof spindle !== "undefined") {
  createBackend(spindle);
}
