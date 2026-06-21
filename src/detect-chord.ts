// ============================================================
// (B) 構成音（chord tones）→ コードネーム（chord symbol）
//
// 新規アプローチ:
//   入力された音を pitch class 集合へ正規化し、各構成音を「仮のルート」として
//   ルート相対の集合に変換 → クオリティテーブル（chord-table）と完全一致するか照合する。
//   一致したものをルートとベースの関係（基本形/転回形）と一般性で順位付けして返す。
//
// テーブルは parseChord 由来なので、detectChord の結果を parseChord に通すと
// 同じ構成音へ戻る（往復一致）。
// ============================================================

import { QUALITY_BY_PCSET } from "./chord-table";
import { noteName, toPitchClass } from "./note";

/** detectChord が返す、1つのコード候補。 */
export interface ChordCandidate {
	/** 推定されたコードネーム。転回形なら "C/E" のようにベース音を併記する。 */
	symbol: string;
	/** 転回形を考慮しない基本形のコードネーム（例: "C"）。 */
	rootSymbol: string;
	/** ルート音の pitch class（0〜11）。 */
	root: number;
	/** クオリティ部分（例: "m7"）。 */
	quality: string;
	/** ベース音（最低音）の pitch class。 */
	bass: number;
	/** ベース音がルートと異なる（＝転回形 / 分数コード）か。 */
	inversion: boolean;
}

/** detectChord のオプション。 */
export interface DetectChordOptions {
	/** 音名をフラット表記にする（既定はシャープ表記）。 */
	flat?: boolean;
	/**
	 * ベース音（最低音）として扱う値。未指定なら notes の最小値を用いる。
	 * 入力が pitch class（0〜11）のみで音域情報が無い場合に明示できる。
	 */
	bass?: number;
}

/**
 * 構成音からコードネームを推定する。
 *
 * @example
 * detectChord([0, 4, 7])           // => 先頭が "C"
 * detectChord([60, 64, 67, 71])    // => 先頭が "CM7"（MIDIノート番号でも可）
 * detectChord([4, 7, 12])          // 最低音 E → 先頭が "C/E"（転回形）
 *
 * @param notes 構成音。pitch class でも MIDI ノート番号でも可（オクターブは無視）。
 *              最低音をベースとして転回形判定に用いる。
 * @param options {@link DetectChordOptions}
 * @returns 一般性・基本形/転回形で順位付けされた {@link ChordCandidate} の配列（完全一致のみ）
 */
export const detectChord = (
	notes: number[],
	options: DetectChordOptions = {},
): ChordCandidate[] => {
	if (!notes.length) return [];
	const { flat = false } = options;

	// pitch class 集合（昇順・重複なし）
	const pcs = [...new Set(notes.map(toPitchClass))].sort((a, b) => a - b);
	// ベース音 = 明示値 or 最低音
	const bass = toPitchClass(
		options.bass ?? notes.reduce((m, v) => Math.min(m, v), notes[0]),
	);

	const scored: {
		candidate: ChordCandidate;
		score: number;
		priority: number;
	}[] = [];
	for (const root of pcs) {
		// root を 0 とした相対 pitch class 集合の Set
		const relSet = new Set(pcs.map((pc) => toPitchClass(pc - root)));

		for (const def of QUALITY_BY_PCSET.values()) {
			let matchCount = 0;
			let hasRoot = false;

			for (const pc of def.pitchClasses) {
				if (relSet.has(pc)) {
					matchCount++;
					if (pc === 0) hasRoot = true;
				}
			}

			// ルート音 (0) が入力に含まれていない場合は不適合
			if (!hasRoot) continue;

			// 主要音の一致数が2音未満（三和音のサブセットに満たない、またはパワーコード未満）はスキップ
			if (matchCount < Math.min(2, def.pitchClasses.length)) continue;

			const missingCount = def.pitchClasses.length - matchCount;

			let extraCount = 0;
			const defSet = new Set(def.pitchClasses);
			for (const pc of relSet) {
				if (!defSet.has(pc)) {
					extraCount++;
				}
			}

			// スコア計算: 一致=+2, 欠損=-1, 余計=-0.5
			const score = matchCount * 2.0 - missingCount * 1.0 - extraCount * 0.5;

			const rootSymbol = noteName(root, flat) + def.quality;
			const inversion = root !== bass;
			scored.push({
				score,
				priority: def.priority,
				candidate: {
					symbol: inversion
						? `${rootSymbol}/${noteName(bass, flat)}`
						: rootSymbol,
					rootSymbol,
					root,
					quality: def.quality,
					bass,
					inversion,
				},
			});
		}
	}

	// 順位付け: スコアが高い順 → 基本形を優先 → 一般的なクオリティを優先 → ルートの低い順
	scored.sort((a, b) => {
		if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
		if (a.candidate.inversion !== b.candidate.inversion)
			return a.candidate.inversion ? 1 : -1;
		if (a.priority !== b.priority) return a.priority - b.priority;
		return a.candidate.root - b.candidate.root;
	});

	return scored.map((s) => s.candidate);
};
