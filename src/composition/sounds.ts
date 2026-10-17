/** Human-readable names of the instrument patches (for the deck display and tracklist). */
import type { BassPatchId, KeysPatchId, KitId, LeadPatchId, PadPatchId, SoundPalette } from '@shared/index';

export const PATCH_LABELS: {
  keys: Record<KeysPatchId, string>;
  pad: Record<PadPatchId, string>;
  bass: Record<BassPatchId, string>;
  melody: Record<LeadPatchId, string>;
  drums: Record<KitId, string>;
} = {
  keys: { rhodes: 'Rhodes', wurli: 'Wurlitzer', felt: 'felt piano', organ: 'organ', vibes: 'vibraphone keys', dusty: 'dusty upright' },
  pad: { warm: 'warm pad', strings: 'tape strings', glass: 'glass pad', hollow: 'hollow pad', tape: 'wobbly strings' },
  bass: { round: 'sub bass', upright: 'upright bass', muted: 'muted bass', square: 'square bass', fingered: 'finger bass' },
  melody: { flute: 'flute', kalimba: 'kalimba', vibes: 'vibes', trumpet: 'muted trumpet', whistle: 'whistle', guitar: 'jazz guitar', synth: 'soft synth' },
  drums: { dusty: 'dusty kit', brushes: 'brush kit', tight: 'tight kit', crunchy: 'crunchy SP kit', jazz: 'jazz kit', soft: 'soft kit' },
};

/** "Rhodes · upright bass · kalimba · crunchy SP kit" */
export function paletteSummary(p: SoundPalette): string {
  return [PATCH_LABELS.keys[p.keys], PATCH_LABELS.bass[p.bass], PATCH_LABELS.melody[p.melody], PATCH_LABELS.drums[p.drums]].join(' · ');
}
