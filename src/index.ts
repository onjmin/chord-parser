// @onjmin/chord-parser
// コードネーム（chord symbol）⇄ 構成音（chord tones）の相互変換。

// クオリティ一覧（検出対象のコード種別）
export { QUALITIES, type QualityDef } from "./chord-table";
// (B) 構成音 → コードネーム
export {
	type ChordCandidate,
	type DetectChordOptions,
	detectChord,
} from "./detect-chord";
// 音名ユーティリティ
export {
	FLAT_NAMES,
	noteName,
	SHARP_NAMES,
	toPitchClass,
} from "./note";
// (A) コードネーム → 構成音
export { type ParsedChord, parseChord } from "./parse-chord";
// (A) コード進行 → 時刻付きイベント
export { type ChordEvent, parseChords } from "./parse-chords";
