// ============================================================
// (C) 曲全体のノート → キー（調）の推定
//
// 曲を構成するノート（音）の集合から、コード進行のベースとなるキー
// （主音 + 長調/短調）を推定する。Krumhansl–Schmuckler の鍵推定法を採用:
//   入力ノートを 12 個の pitch class ごとの重み（鳴っていた長さ）に集計し、
//   24 通り（12主音 × 長調/短調）のキープロファイルと相関を取り、
//   最も相関の高いキーを推定結果とする。
//
// 転調にも対応する。detectKeyChanges は時間軸を窓（ウィンドウ）でスライドさせ、
// 各区間ごとにキーを推定し、連続して同じキーの区間を 1 つのセグメントへ統合して返す。
// ============================================================

import { noteName, toPitchClass } from "./note";
import { parseChord } from "./parse-chord";
import type { ChordEvent } from "./parse-chords";

/** 調の種別（長調 / 短調）。 */
export type KeyMode = "major" | "minor";

/** 推定されたキー（調）。 */
export interface DetectedKey {
	/** 主音（トニック）の pitch class（0〜11）。 */
	tonic: number;
	/** 長調 / 短調。 */
	mode: KeyMode;
	/** 表示名（例: "C major", "A minor"）。 */
	name: string;
}

/** detectKey が返す、スコア付きのキー候補。 */
export interface KeyCandidate extends DetectedKey {
	/** キープロファイルとの相関係数（-1〜1、高いほど確からしい）。 */
	score: number;
}

/** detectKeyChanges が返す、時間区間付きのキー。 */
export interface KeySegment {
	/** その区間で推定されたキー。 */
	key: DetectedKey;
	/** 区間の開始時刻（秒）。 */
	when: number;
	/** 区間の長さ（秒）。 */
	duration: number;
}

/** 重み付きノート（pitch class または MIDI ノート番号 + 任意の重み）。 */
export interface WeightedNote {
	/** 音高。pitch class でも MIDI ノート番号でも可（オクターブは無視）。 */
	pitch: number;
	/** 重み（鳴っていた長さなど）。未指定なら 1。 */
	duration?: number;
}

/** 時刻付きノート（転調検出に用いる）。 */
export interface TimedNote {
	/** 音高。pitch class でも MIDI ノート番号でも可（オクターブは無視）。 */
	pitch: number;
	/** 発音開始時刻（秒）。 */
	when: number;
	/** 持続時間（秒）。 */
	duration: number;
}

/** detectKey のオプション。 */
export interface DetectKeyOptions {
	/** 主音名をフラット表記にする（既定はシャープ表記）。 */
	flat?: boolean;
}

/** detectKeyChanges のオプション。 */
export interface DetectKeyChangesOptions extends DetectKeyOptions {
	/**
	 * キー推定に用いる窓の長さ（秒）。未指定なら曲全体の長さ / 4。
	 * キーの推定には数コード分のまとまった文脈が要るため、窓が小さすぎると
	 * 近親調にちらつく。大きすぎると短い転調を見逃す。曲調に応じて調整する。
	 */
	windowSize?: number;
	/**
	 * 窓をずらす幅（秒、＝時間分解能）。未指定なら windowSize / 2。
	 */
	hopSize?: number;
	/**
	 * これより短いセグメントは隣接区間へ吸収して除去する（秒、既定 0＝無効）。
	 * 一瞬だけ別キーと誤判定される「ちらつき」を抑えるのに使う。
	 */
	minSegmentDuration?: number;
	/**
	 * キーの切り替えに必要な相関スコアの差（ヒステリシス、既定 0.08）。
	 * 現在のキーより新候補がこの値を超えて高いときだけ転調と見なす。
	 * 近親調（C↔G など）の細かなちらつきを抑え、明確な転調だけを拾う。
	 * 0 にすると毎窓で最良キーへ即座に切り替わる。
	 */
	switchMargin?: number;
}

// --- キープロファイル ---------------------------------------------------
// Krumhansl & Kessler (1982) の調性プロファイル。主音を 0 とした相対 pitch class。

const MAJOR_PROFILE = [
	6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
	6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

/** ピアソンの相関係数。分母が 0（定数列）のときは 0 を返す。 */
const pearson = (a: number[], b: number[]): number => {
	const ma = mean(a);
	const mb = mean(b);
	let num = 0;
	let da = 0;
	let db = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] - ma;
		const y = b[i] - mb;
		num += x * y;
		da += x * x;
		db += y * y;
	}
	const den = Math.sqrt(da * db);
	return den === 0 ? 0 : num / den;
};

const keyName = (tonic: number, mode: KeyMode, flat: boolean): string =>
	`${noteName(tonic, flat)} ${mode}`;

const stripScore = (c: KeyCandidate): DetectedKey => ({
	tonic: c.tonic,
	mode: c.mode,
	name: c.name,
});

const sameKey = (a: DetectedKey, b: DetectedKey): boolean =>
	a.tonic === b.tonic && a.mode === b.mode;

/** ノート列を 12 個の pitch class ヒストグラム（重みの合計）に集計する。 */
const buildHistogram = (notes: (number | WeightedNote)[]): number[] => {
	const h = new Array(12).fill(0);
	for (const n of notes) {
		if (typeof n === "number") h[toPitchClass(n)] += 1;
		else h[toPitchClass(n.pitch)] += n.duration ?? 1;
	}
	return h;
};

/** 時間区間 [start, end) に重なるノートを、重なり長さで重み付けして集計する。 */
const windowHistogram = (
	notes: TimedNote[],
	start: number,
	end: number,
): number[] => {
	const h = new Array(12).fill(0);
	for (const n of notes) {
		if (n.duration <= 0) {
			// 持続時間 0（点イベント）は窓内なら重み 1 で数える
			if (n.when >= start && n.when < end) h[toPitchClass(n.pitch)] += 1;
			continue;
		}
		const s = Math.max(n.when, start);
		const e = Math.min(n.when + n.duration, end);
		const overlap = e - s;
		if (overlap > 0) h[toPitchClass(n.pitch)] += overlap;
	}
	return h;
};

/** ヒストグラムを 24 通りのキープロファイルと相関し、スコア順の候補に変換する。 */
const rankKeys = (histogram: number[], flat: boolean): KeyCandidate[] => {
	const candidates: KeyCandidate[] = [];
	for (let tonic = 0; tonic < 12; tonic++) {
		for (const mode of ["major", "minor"] as const) {
			const profile = mode === "major" ? MAJOR_PROFILE : MINOR_PROFILE;
			// プロファイルを主音に合わせて回転（index 0 が tonic になるよう揃える）
			const rotated = histogram.map(
				(_, pc) => profile[toPitchClass(pc - tonic)],
			);
			candidates.push({
				tonic,
				mode,
				name: keyName(tonic, mode, flat),
				score: pearson(histogram, rotated),
			});
		}
	}
	candidates.sort((a, b) => b.score - a.score);
	return candidates;
};

/**
 * 曲全体のノートから、最も確からしいキー（調）を推定する。
 * 転調は考慮せず、曲全体を 1 つのキーとして要約する。
 *
 * @example
 * detectKey([0, 2, 4, 5, 7, 9, 11])[0].name        // => "C major"
 * detectKey([{ pitch: 0, duration: 4 }, { pitch: 7, duration: 2 }])
 *
 * @param notes 構成音。pitch class でも MIDI ノート番号でも可。
 *              {@link WeightedNote} を渡すと duration を重みとして使う。
 * @param options {@link DetectKeyOptions}
 * @returns 相関スコア順に並んだ {@link KeyCandidate} の配列（24 通り）
 */
export const detectKey = (
	notes: (number | WeightedNote)[],
	options: DetectKeyOptions = {},
): KeyCandidate[] => {
	if (!notes.length) return [];
	const { flat = false } = options;
	const histogram = buildHistogram(notes);
	if (histogram.every((v) => v === 0)) return [];
	return rankKeys(histogram, flat);
};

/** 隣接する同一キーのセグメントを 1 つに統合する。 */
const coalesce = (segments: KeySegment[]): KeySegment[] => {
	const out: KeySegment[] = [];
	for (const s of segments) {
		const last = out[out.length - 1];
		if (last && sameKey(last.key, s.key)) {
			last.duration = s.when + s.duration - last.when;
		} else {
			out.push({ ...s });
		}
	}
	return out;
};

/** minSegmentDuration より短いセグメントを隣接区間へ吸収する。 */
const mergeShortSegments = (
	segments: KeySegment[],
	min: number,
): KeySegment[] => {
	if (min <= 0) return segments;
	const result = segments.map((s) => ({ ...s }));
	let i = 0;
	while (i < result.length && result.length > 1) {
		if (result[i].duration >= min) {
			i++;
			continue;
		}
		if (i > 0) {
			// 直前のセグメントへ吸収（直前のキーを延長）
			result[i - 1].duration += result[i].duration;
			result.splice(i, 1);
		} else {
			// 先頭は直後のセグメントへ吸収
			result[i + 1].when = result[i].when;
			result[i + 1].duration += result[i].duration;
			result.splice(i, 1);
		}
	}
	return coalesce(result);
};

/**
 * 曲全体のノートから、時間経過に伴うキー（調）の変化＝転調を推定する。
 *
 * 時間軸を窓（ウィンドウ）でスライドさせながら各区間のキーを推定し、
 * 連続して同じキーになる区間を 1 つの {@link KeySegment} へ統合して返す。
 * 転調が無ければセグメントは 1 つだけになる。
 *
 * @example
 * // 前半 C major、後半 G major で転調する曲
 * detectKeyChanges(notes)  // => [{ key: C major, when, duration }, { key: G major, ... }]
 *
 * @param notes 時刻付きノートの配列（{@link TimedNote}）。
 * @param options {@link DetectKeyChangesOptions}
 * @returns 時間順に並んだ {@link KeySegment} の配列
 */
export const detectKeyChanges = (
	notes: TimedNote[],
	options: DetectKeyChangesOptions = {},
): KeySegment[] => {
	if (!notes.length) return [];
	const { flat = false } = options;

	const start = notes.reduce(
		(m, n) => Math.min(m, n.when),
		Number.POSITIVE_INFINITY,
	);
	const end = notes.reduce(
		(m, n) => Math.max(m, n.when + Math.max(n.duration, 0)),
		Number.NEGATIVE_INFINITY,
	);
	const span = end - start;

	// 全ノートが同一時刻に集中 → 単一キーとして要約
	if (span <= 0) {
		const top = detectKey(
			notes.map((n) => ({ pitch: n.pitch, duration: Math.max(n.duration, 1) })),
			{ flat },
		)[0];
		return top ? [{ key: stripScore(top), when: start, duration: 0 }] : [];
	}

	const windowSize = options.windowSize ?? span / 4;
	const hopSize = options.hopSize ?? windowSize / 2;
	const minSegmentDuration = options.minSegmentDuration ?? 0;
	const switchMargin = options.switchMargin ?? 0.08;

	const segments: KeySegment[] = [];
	for (let t = start; t < end - 1e-9; t += hopSize) {
		const regionEnd = Math.min(t + hopSize, end);
		// 推定窓は常に windowSize 幅を保ち、末尾では [end - windowSize, end) を使う。
		// これで曲末の窓が最後の1コードだけに縮んで誤判定するのを防ぐ。
		const winEnd = Math.min(t + windowSize, end);
		const winStart = Math.max(start, winEnd - windowSize);
		const histogram = windowHistogram(notes, winStart, winEnd);
		const last = segments[segments.length - 1];
		if (histogram.every((v) => v === 0)) {
			// この区間にノートが無い → 直前のキーを延長（休符・空白を埋める）
			if (last) last.duration = regionEnd - last.when;
			continue;
		}
		const candidates = rankKeys(histogram, flat);
		let chosen = candidates[0];
		// ヒステリシス: 現在のキーが僅差で負ける程度なら維持し、ちらつきを抑える
		if (last) {
			const current = candidates.find((c) => sameKey(c, last.key));
			if (current && chosen.score - current.score <= switchMargin)
				chosen = current;
		}
		if (last && sameKey(last.key, chosen)) {
			last.duration = regionEnd - last.when;
		} else {
			segments.push({
				key: stripScore(chosen),
				when: t,
				duration: regionEnd - t,
			});
		}
	}

	return mergeShortSegments(coalesce(segments), minSegmentDuration);
};

/** chordEventsToNotes が音高を MIDI 風に並べるときの基準（C4 付近）。 */
const CHORD_NOTE_BASE = 60;

/**
 * コード進行イベント列（{@link ChordEvent}）を、推定用の時刻付きノートへ展開する。
 * 各コードを構成音に分解し、コードの持続時間を各音の重みとする。
 *
 * 音高はオクターブ情報を保持した MIDI 風の値（C4=60 基準）で、転回形（スラッシュ
 * コード）のベース音が最低音に来る。キー推定はオクターブを無視するので影響せず、
 * コード推定（detectProgression）ではベース音から転回形を判定できる。
 *
 * これにより `parseChords` → `chordEventsToNotes` → `detectKeyChanges` /
 * `detectProgression` と繋ぐと、コード進行文字列から直接キー／コードを推定できる。
 *
 * @example
 * detectKeyChanges(chordEventsToNotes(parseChords("C | G | Am | F", 120)))
 *
 * @param events {@link ChordEvent} の配列（parseChords の出力）。
 * @returns 時刻付きノート（{@link TimedNote}）の配列。解析できないコードは無視する。
 */
export const chordEventsToNotes = (events: ChordEvent[]): TimedNote[] => {
	const notes: TimedNote[] = [];
	for (const e of events) {
		let voicing: number[];
		try {
			// notes はベース音を最低音に持つ、ルート基準の絶対半音オフセット配列。
			voicing = parseChord(`${e.key}${e.chord}`).notes;
		} catch {
			continue;
		}
		for (const offset of voicing)
			notes.push({
				pitch: CHORD_NOTE_BASE + offset,
				when: e.when,
				duration: e.duration,
			});
	}
	return notes;
};
