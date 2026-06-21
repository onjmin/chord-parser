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
// (C) 曲全体のノート → キー（調）/ 転調
export {
	chordEventsToNotes,
	type DetectedKey,
	type DetectKeyChangesOptions,
	type DetectKeyOptions,
	detectKey,
	detectKeyChanges,
	type KeyCandidate,
	type KeyMode,
	type KeySegment,
	type TimedNote,
	type WeightedNote,
} from "./detect-key";
// (D) 曲全体のノート → 時間軸に沿ったコード進行（＋キー）
export {
	type ChordSegment,
	type DetectProgressionOptions,
	detectProgression,
	type ProgressionAnalysis,
} from "./detect-progression";
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
