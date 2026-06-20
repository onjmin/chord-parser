// ============================================================
// コードクオリティの一覧と、その「pitch class 集合」テーブル。
//
// テーブルは parseChord 自身を使って生成する。こうすることで
// (A) コードネーム→構成音 と (B) 構成音→コードネーム の解釈が必ず一致する。
// ============================================================

import { parseChord } from "./parse-chord";

/** 検出対象とするコードクオリティの定義。配列の並び順が優先度（先頭ほど一般的）。 */
export interface QualityDef {
	/** コードネームのクオリティ部分（ルートに連結して使う）。例: "m7"。 */
	quality: string;
	/** ルート C で生成したときの相対 pitch class 集合（0〜11, 昇順）。 */
	pitchClasses: number[];
	/** 優先度（小さいほど一般的＝検出時に優先）。配列インデックスと同じ。 */
	priority: number;
}

// 優先度順（先頭ほど一般的なコード）。
// ここに並べた suffix はすべて parseChord が解釈できるものに限る。
const QUALITY_SOURCE = [
	"", // major
	"m", // minor
	"7", // dominant 7th
	"M7", // major 7th
	"m7", // minor 7th
	"dim", // diminished triad
	"m7b5", // half-diminished
	"aug", // augmented triad
	"6", // major 6th
	"m6", // minor 6th
	"sus4",
	"sus2",
	"mM7", // minor major 7th
	"dim7", // diminished 7th
	"7sus4",
	"7#5", // augmented 7th
	"add9",
	"madd9",
	"9",
	"M9",
	"m9",
	"69",
	"m69",
	"5", // power chord
];

/** 全クオリティ定義（優先度順）。 */
export const QUALITIES: QualityDef[] = QUALITY_SOURCE.map(
	(quality, priority) => ({
		quality,
		pitchClasses: parseChord(`C${quality}`).pitchClasses,
		priority,
	}),
);

/**
 * 「相対 pitch class 集合の文字列キー」→ 最優先のクオリティ定義 のマップ。
 * 同一集合に複数クオリティが対応する場合（例: aug7 と 7#5）は優先度が高い方を採用。
 */
export const QUALITY_BY_PCSET: Map<string, QualityDef> = (() => {
	const map = new Map<string, QualityDef>();
	for (const def of QUALITIES) {
		const key = def.pitchClasses.join(",");
		if (!map.has(key)) map.set(key, def);
	}
	return map;
})();
