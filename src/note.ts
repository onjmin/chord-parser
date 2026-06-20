// 音名（pitch class）とラベルの相互変換ユーティリティ。
//
// 用語:
// - pitch class ... 1オクターブ12音を 0=C, 1=C#, ... 11=B で表した整数（オクターブ無視）
// - semitone offset ... ルート音を 0 とした相対半音数（オクターブを跨ぐ場合あり）

/** シャープ表記の音名（C, C#, D, ...）。pitch class のインデックスで引く。 */
export const SHARP_NAMES = [
	"C",
	"C#",
	"D",
	"D#",
	"E",
	"F",
	"F#",
	"G",
	"G#",
	"A",
	"A#",
	"B",
] as const;

/** フラット表記の音名（C, Db, D, ...）。pitch class のインデックスで引く。 */
export const FLAT_NAMES = [
	"C",
	"Db",
	"D",
	"Eb",
	"E",
	"F",
	"Gb",
	"G",
	"Ab",
	"A",
	"Bb",
	"B",
] as const;

/** 任意の整数を 0〜11 の pitch class に正規化する（負数も可）。 */
export const toPitchClass = (n: number): number => ((n % 12) + 12) % 12;

/**
 * pitch class を音名ラベルに変換する。
 * @param pc pitch class（自動で 0〜11 に正規化）
 * @param flat true ならフラット表記、false（既定）ならシャープ表記
 */
export const noteName = (pc: number, flat = false): string =>
	(flat ? FLAT_NAMES : SHARP_NAMES)[toPitchClass(pc)];
