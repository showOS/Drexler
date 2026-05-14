// Barrel re-export. Splits live under ./pet/. Callers should keep importing
// from "./PetPanel.tsx" — this stays stable on purpose so the refactor is
// invisible to consumers.
export {
  CompactPetPanel,
  COMPACT_PET_PANEL_MIN_WIDTH,
  COMPACT_PET_PANEL_ROWS,
  TINY_PET_PANEL_ROWS,
  getPetStatusMessage,
} from "./pet/CompactPetPanel.tsx";
export { PetScene, PET_SCENE_ROWS, PET_SCENE_WIDTH, type Environment } from "./pet/MascotScene.tsx";
export { analogClockLines, buildAsciiClock } from "./pet/AsciiClock.tsx";
