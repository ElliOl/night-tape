/** Shared geometry of the pixel window scene (Scene.tsx), for the cat that walks, sits and sleeps on it. */

/** size of one art pixel on screen (CSS px) */
export const SCENE_PIXEL = 4;
/** the windowsill row, as a fraction of the scene height */
export const SILL_ROW = 0.9;
/** the window's middle crossbar row, as a fraction of the scene height */
export const CROSSBAR_ROW = 0.42;

/** art-pixel rows of a scene `heightPx` tall */
export const sceneRows = (heightPx: number): number => Math.max(24, Math.round(heightPx / SCENE_PIXEL));
