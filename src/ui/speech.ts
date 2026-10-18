/**
 * Everything the cat and the mouse say, in Japanese (kanji where Japanese would use them). Speech bubbles use the
 * BUBBLE_FONT, which covers kanji and kana.
 */
import type { LayerId, MoodId } from '@shared/index';

/** speech bubble font: a rounded Japanese hand, with system Japanese fonts as fallback */
export const BUBBLE_FONT = '15px "Yusei Magic", "Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif';

/** the layers, as the cat and mouse call them */
export const LAYER_JA: Record<LayerId, string> = {
  keys: '鍵盤',
  pad: '和音',
  bass: '低音',
  melody: '旋律',
  drums: '太鼓',
  texture: '環境音',
};

/** the stations */
export const MOOD_JA: Record<MoodId, string> = {
  study: '深夜の勉強',
  rainy: '雨の窓',
  sunday: '日曜の朝',
  drift: '漂流',
};

export const SAY = {
  // ---- the cat
  myTurn: '出番だ！',
  yawn: '欠伸…',
  turnHint: '↑↓で回す',
  swat: '猫パンチ！',
  pressed: '押した！',
  layersOff: (layers: readonly LayerId[]): string => `${layers.map((l) => LAYER_JA[l]).join('と')}、停止！`,
  backIn: '復活！',
  napOn: '眠…',
  napOff: (layer: LayerId): string => `欠伸… ${LAYER_JA[layer]}復活`,
  acid: '酸性！',
  station: (mood: MoodId): string => `→ ${MOOD_JA[mood]}`,
  spotted: '鼠！',
  missed: ['惜しい…', '次こそ。', 'ふん。', '…見逃してやる'] as const,
  quakeGroove: '律動、揺れた！',
  quakeTape: '歪んだ！',
  quakeFilter: '唸れ！',
  quakeMixer: '混乱！',
  quakeNewTape: '新曲！',

  // ---- the mouse
  nom: '美味！',
  cheese: '乾酪発見！',
  burp: '満腹！',
  dance: '♪',
  crumbs: 'パン屑！',
  decorate: '飾り付け！',
  treeDone: '完成！',
  takeDown: '片付け。',
  standUp: 'よいしょ。',
  knocked: '壊れた！',
  nibble: (layer: LayerId): string => `${LAYER_JA[layer]}を齧る`,
  chewTape: 'テープを噛む',
  squeak: 'チュー！',
};
