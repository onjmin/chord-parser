// ============================================================
// (D) 曲全体のノート → 時間軸に沿ったコード進行（＋キー）の推定
//
// 「半小節ごとに detectChord」する素朴版の弱点（完全一致ゆえ非和声音に弱い／
// 固定グリッドが境界とずれる／キー文脈を使わない／ちらつく）を避け、
// 自動コード推定(ACE)の定石でパイプライン化する:
//
//   notes ─▶ [A] フレーム化（拍/半小節 or 秒グリッド、duration 重み）
//         ─▶ [B] 各フレームで全コード候補を「ソフト照合」スコア化（非和声音に頑健）
//         ─▶ [C] detectKeyChanges のキーで diatonic/借用にボーナス（事前確率）
//         ─▶ [D] DP（ビタビ）で「適合度の総和 − 変化ペナルティ」を大域最適化
//         ─▶ 連続する同一コードを統合し、キー・ローマ数字を付与
//
// コードテンプレートは chord-table の QUALITIES を再利用するため、
// parseChord / detectChord と同じ語彙・解釈で一貫する。
// ============================================================

import { QUALITIES } from "./chord-table";
import {
	type DetectedKey,
	type DetectKeyChangesOptions,
	detectKeyChanges,
	type KeySegment,
	type TimedNote,
} from "./detect-key";
import { noteName, toPitchClass } from "./note";

/** detectProgression が返す、1コード分の時間区間付きイベント。 */
export interface ChordSegment {
	/** コードネーム。転回形なら "C/E" のようにベース音を併記する。 */
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
	/** 区間の開始時刻（秒）。 */
	when: number;
	/** 区間の長さ（秒）。 */
	duration: number;
	/** その区間のキー（転調を考慮）。不明なら null。 */
	key: DetectedKey | null;
	/** キーに対するローマ数字 / 度数（例: G調の C → "IV"）。キー不明なら null。 */
	degree: string | null;
}

/** detectProgression の返り値。時間軸に沿ったキーとコードの両方を含む。 */
export interface ProgressionAnalysis {
	/** 時刻ごとのキー（detectKeyChanges の結果）。 */
	keys: KeySegment[];
	/** 時刻ごとのコード。 */
	chords: ChordSegment[];
}

/** detectProgression のオプション。{@link DetectKeyChangesOptions} を内包する。 */
export interface DetectProgressionOptions extends DetectKeyChangesOptions {
	/**
	 * テンポ（BPM）。指定すると拍単位（1拍 = 60/bpm 秒）の音楽的グリッドで
	 * フレーム化する。未指定なら frameSize（秒）でフレーム化する。
	 */
	bpm?: number;
	/** bpm 未指定時のフレーム長（秒、既定 0.5）。 */
	frameSize?: number;
	/**
	 * コードを切り替えるときに課す DP のペナルティ（既定 0.4）。
	 * 大きいほどコードが保持されやすく（＝長い区間になり）ちらつきが減る。
	 */
	changePenalty?: number;
	/**
	 * 非和声音（コード構成音でない音）に課すペナルティ係数（既定 0.55）。
	 * 大きいほど構成音以外が鳴っているコードを嫌う。
	 */
	nonChordTonePenalty?: number;
	/**
	 * キーの事前確率（diatonic/借用ボーナス）を使うか（既定 true）。
	 * false にするとキーを無視して純粋にスコア最大のコードを選ぶ。
	 */
	useKey?: boolean;
}

// --- コードテンプレート -------------------------------------------------

/** コード候補（ルート × クオリティ）。スコア計算用に絶対 pitch class とテンプレートを持つ。 */
interface ChordTemplate {
	root: number;
	quality: string;
	priority: number;
	/** 構成音の絶対 pitch class 集合。 */
	pcs: Set<number>;
	/** 12 次元の役割重み（構成音のみ正、非構成音は 0）。 */
	weights: number[];
	/** 相対音程の集合（ルート 0 基準、ローマ数字判定に使う）。 */
	rel: Set<number>;
}

/** ルートからの相対音程ごとの役割重み（root/3rd を重く、5th を軽く）。 */
const toneRoleWeight = (rel: number): number => {
	if (rel === 0) return 1.3; // ルート
	if (rel === 3 || rel === 4) return 1.2; // 3rd（長短）
	if (rel === 10 || rel === 11) return 0.95; // 7th
	if (rel === 6 || rel === 7 || rel === 8) return 0.7; // 5th（減/完全/増）
	return 0.85; // テンション等
};

/** 全コード候補（12 ルート × QUALITIES）を一度だけ構築する。 */
const CHORD_TEMPLATES: ChordTemplate[] = (() => {
	const templates: ChordTemplate[] = [];
	for (let root = 0; root < 12; root++) {
		for (const def of QUALITIES) {
			const pcs = new Set<number>();
			const weights = new Array(12).fill(0);
			const rel = new Set<number>();
			for (const relPc of def.pitchClasses) {
				rel.add(relPc);
				const pc = toPitchClass(relPc + root);
				pcs.add(pc);
				weights[pc] = toneRoleWeight(relPc);
			}
			templates.push({
				root,
				quality: def.quality,
				priority: def.priority,
				pcs,
				weights,
				rel,
			});
		}
	}
	return templates;
})();

// --- キー（スケール）ユーティリティ ------------------------------------

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

const scaleOf = (key: DetectedKey): number[] => {
	const base = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
	return base.map((d) => toPitchClass(d + key.tonic));
};

/**
 * コードのキーに対する事前確率ボーナス。
 * 全構成音が diatonic → 高ボーナス、ルートのみ diatonic（借用）→ 小ボーナス。
 * トニック / サブドミナント / ドミナント上の和音はさらに少し優遇する。
 */
const keyBonus = (tmpl: ChordTemplate, key: DetectedKey): number => {
	const scale = scaleOf(key);
	const scaleSet = new Set(scale);
	const rootDiatonic = scaleSet.has(tmpl.root);
	let allDiatonic = true;
	for (const pc of tmpl.pcs)
		if (!scaleSet.has(pc)) {
			allDiatonic = false;
			break;
		}
	let bonus = 0;
	if (allDiatonic) bonus += 0.25;
	else if (rootDiatonic) bonus += 0.1; // 借用（セカンダリードミナント等）も許容
	// 主要三和音（I / IV / V）の機能を少し優遇
	const degree = toPitchClass(tmpl.root - key.tonic);
	if (degree === 0 || degree === 5 || degree === 7) bonus += 0.05;
	return bonus;
};

// --- フレーム化 ---------------------------------------------------------

interface Frame {
	when: number;
	duration: number;
	/** 正規化済み pitch class 重み（合計 1、空フレームは全 0）。 */
	profile: number[];
	/** 最低音の pitch class（空フレームは -1）。 */
	bass: number;
	empty: boolean;
}

/** 時間区間 [start, end) のノートを集計し、正規化プロファイルとベース音を得る。 */
const makeFrame = (notes: TimedNote[], start: number, end: number): Frame => {
	const raw = new Array(12).fill(0);
	let total = 0;
	let bassPitch = Number.POSITIVE_INFINITY;
	let bass = -1;
	for (const n of notes) {
		const s = Math.max(n.when, start);
		const e = Math.min(n.when + Math.max(n.duration, 0), end);
		const overlap =
			n.duration <= 0
				? n.when >= start && n.when < end
					? 1
					: 0
				: Math.max(e - s, 0);
		if (overlap <= 0) continue;
		raw[toPitchClass(n.pitch)] += overlap;
		total += overlap;
		if (n.pitch < bassPitch) {
			bassPitch = n.pitch;
			bass = toPitchClass(n.pitch);
		}
	}
	const profile = total > 0 ? raw.map((v) => v / total) : raw;
	return {
		when: start,
		duration: end - start,
		profile,
		bass,
		empty: total === 0,
	};
};

/**
 * 1フレームに対する各コード候補の適合度（emission スコア）。
 * 構成音が鳴っている度合いを役割重みで加点し、非和声音を減点。
 * ルート不在はさらに減点し、キーがあれば事前確率ボーナスを加える。
 */
const emissionScore = (
	frame: Frame,
	tmpl: ChordTemplate,
	key: DetectedKey | null,
	ncTonePenalty: number,
): number => {
	let hit = 0;
	let miss = 0;
	for (let pc = 0; pc < 12; pc++) {
		const w = frame.profile[pc];
		if (w === 0) continue;
		if (tmpl.pcs.has(pc)) hit += w * tmpl.weights[pc];
		else miss += w;
	}
	let score = hit - ncTonePenalty * miss;
	if (frame.profile[tmpl.root] === 0) score -= 0.3; // ルート不在を嫌う
	// 最低音はルートを強く示唆する。基本形（root === bass）を優遇し、
	// C6/A と Am7 のような同一構成音の曖昧さをベース音で解消する。
	if (frame.bass !== -1 && tmpl.root === frame.bass) score += 0.3;
	if (key) score += keyBonus(tmpl, key);
	// 僅差は一般的なクオリティ（priority が小さい）を優先する微小タイブレーク。
	score -= tmpl.priority * 0.002;
	return score;
};

// --- ローマ数字（度数）-------------------------------------------------

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** キーに対するコードのローマ数字（度数）。和音の三和音種別で大文字小文字・記号を決める。 */
const chordDegree = (key: DetectedKey, tmpl: ChordTemplate): string => {
	// 主音を 0 とした相対スケールで度数を引く（scaleOf は絶対 pc なので使わない）。
	const scale = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
	const rel = toPitchClass(tmpl.root - key.tonic);
	let idx = scale.indexOf(rel);
	let accidental = "";
	if (idx === -1) {
		// 非スケール音 → 半音下が在れば #、半音上が在れば b で近似
		const below = scale.indexOf(toPitchClass(rel - 1));
		const above = scale.indexOf(toPitchClass(rel + 1));
		if (below !== -1) {
			idx = below;
			accidental = "#";
		} else if (above !== -1) {
			idx = above;
			accidental = "b";
		} else {
			idx = 0;
			accidental = "?";
		}
	}
	// 三和音の種別を相対音程から判定
	const hasM3 = tmpl.rel.has(4);
	const hasm3 = tmpl.rel.has(3);
	const hasDim5 = tmpl.rel.has(6);
	const hasAug5 = tmpl.rel.has(8);
	const hasMin7 = tmpl.rel.has(10);
	let numeral = ROMAN[idx];
	let suffix = "";
	if (hasm3 && hasDim5) {
		numeral = numeral.toLowerCase();
		suffix = hasMin7 ? "ø7" : "°"; // half-dim / dim
		if (tmpl.rel.has(9)) suffix = "°7"; // dim7
	} else if (hasM3 && hasAug5) {
		suffix = "+";
	} else if (hasm3) {
		numeral = numeral.toLowerCase();
	} else if (!hasM3) {
		// 3rd を持たない（sus / power）→ 大文字のまま
	}
	// 7th / テンションの簡易タグ
	if (!suffix) {
		if (tmpl.rel.has(11)) suffix = "M7";
		else if (hasMin7) suffix = "7";
		else if (tmpl.rel.has(9) && !tmpl.rel.has(10)) suffix = "6";
	}
	return accidental + numeral + suffix;
};

// --- DP（ビタビ）-------------------------------------------------------

/**
 * 「適合度の総和 − コード変化回数 × changePenalty」を最大化するコード列を求める。
 * 遷移コストが一様（同一 0 / 異なる P）なので O(状態数 × フレーム数) で解ける。
 */
const viterbi = (emissions: number[][], changePenalty: number): number[] => {
	const T = emissions.length;
	const N = CHORD_TEMPLATES.length;
	if (T === 0) return [];
	const back: number[][] = Array.from({ length: T }, () =>
		new Array(N).fill(-1),
	);
	let prev = emissions[0].slice();
	for (let t = 1; t < T; t++) {
		// 直前列の最良状態（切り替え元の候補）
		let bestPrevVal = Number.NEGATIVE_INFINITY;
		let bestPrevIdx = 0;
		for (let j = 0; j < N; j++)
			if (prev[j] > bestPrevVal) {
				bestPrevVal = prev[j];
				bestPrevIdx = j;
			}
		const curr = new Array(N).fill(0);
		const em = emissions[t];
		const switchVal = bestPrevVal - changePenalty;
		for (let i = 0; i < N; i++) {
			// 同一コードを保持（ペナルティ無し）か、最良状態から切り替えるか
			if (prev[i] >= switchVal) {
				curr[i] = em[i] + prev[i];
				back[t][i] = i;
			} else {
				curr[i] = em[i] + switchVal;
				back[t][i] = bestPrevIdx;
			}
		}
		prev = curr;
	}
	// 終端の最良状態から後ろ向きに復元
	let bestIdx = 0;
	for (let i = 1; i < N; i++) if (prev[i] > prev[bestIdx]) bestIdx = i;
	const path = new Array(T).fill(0);
	path[T - 1] = bestIdx;
	for (let t = T - 1; t > 0; t--) path[t - 1] = back[t][path[t]];
	return path;
};

// --- 本体 ---------------------------------------------------------------

const keyAt = (keys: KeySegment[], when: number): DetectedKey | null => {
	for (const k of keys)
		if (when >= k.when && when < k.when + k.duration) return k.key;
	return keys.length ? keys[keys.length - 1].key : null;
};

const buildSymbol = (tmpl: ChordTemplate, bass: number, flat: boolean) => {
	const rootSymbol = noteName(tmpl.root, flat) + tmpl.quality;
	const inversion = bass !== -1 && bass !== tmpl.root && tmpl.pcs.has(bass);
	return {
		symbol: inversion ? `${rootSymbol}/${noteName(bass, flat)}` : rootSymbol,
		rootSymbol,
		inversion,
		bass: bass === -1 ? tmpl.root : bass,
	};
};

/**
 * 曲全体のノートから、時間軸に沿ったキーとコード進行を推定する。
 *
 * 内部で {@link detectKeyChanges} により転調込みのキー領域を求め、それを事前確率
 * として各フレームのコードをソフト照合でスコア化し、DP で大域最適なコード列に
 * 平滑化する。連続する同一コードは 1 つの {@link ChordSegment} に統合される。
 *
 * @example
 * // コード進行文字列から直接推定
 * detectProgression(chordEventsToNotes(parseChords("C | G | Am | F", 120)), { bpm: 120 })
 *
 * @param notes 時刻付きノートの配列（{@link TimedNote}）。
 * @param options {@link DetectProgressionOptions}
 * @returns 時刻ごとのキーとコードを含む {@link ProgressionAnalysis}
 */
export const detectProgression = (
	notes: TimedNote[],
	options: DetectProgressionOptions = {},
): ProgressionAnalysis => {
	if (!notes.length) return { keys: [], chords: [] };
	const {
		flat = false,
		bpm,
		frameSize = 0.5,
		changePenalty = 0.4,
		nonChordTonePenalty = 0.55,
		useKey = true,
	} = options;

	const keys = detectKeyChanges(notes, options);

	const start = notes.reduce(
		(m, n) => Math.min(m, n.when),
		Number.POSITIVE_INFINITY,
	);
	const end = notes.reduce(
		(m, n) => Math.max(m, n.when + Math.max(n.duration, 0)),
		Number.NEGATIVE_INFINITY,
	);
	if (end <= start) return { keys, chords: [] };

	// フレーム長: bpm があれば拍単位、無ければ秒指定
	const frameDur = bpm ? 60 / bpm : Math.max(frameSize, 1e-3);

	// フレーム生成（空フレームは前のコードを保持させるため emission を全 0 にする）
	const frames: Frame[] = [];
	for (let t = start; t < end - 1e-9; t += frameDur)
		frames.push(makeFrame(notes, t, Math.min(t + frameDur, end)));

	const emissions: number[][] = frames.map((frame) => {
		if (frame.empty) return new Array(CHORD_TEMPLATES.length).fill(0);
		const key = useKey ? keyAt(keys, frame.when + frame.duration / 2) : null;
		return CHORD_TEMPLATES.map((tmpl) =>
			emissionScore(frame, tmpl, key, nonChordTonePenalty),
		);
	});

	const path = viterbi(emissions, changePenalty);

	// 連続する同一コードを統合
	const chords: ChordSegment[] = [];
	for (let t = 0; t < frames.length; t++) {
		const frame = frames[t];
		const tmpl = CHORD_TEMPLATES[path[t]];
		const last = chords[chords.length - 1];
		const sameAsLast =
			last && last.root === tmpl.root && last.quality === tmpl.quality;
		if (sameAsLast) {
			last.duration = frame.when + frame.duration - last.when;
			continue;
		}
		const key = keyAt(keys, frame.when + frame.duration / 2);
		const { symbol, rootSymbol, inversion, bass } = buildSymbol(
			tmpl,
			frame.bass,
			flat,
		);
		chords.push({
			symbol,
			rootSymbol,
			root: tmpl.root,
			quality: tmpl.quality,
			bass,
			inversion,
			when: frame.when,
			duration: frame.duration,
			key,
			degree: key ? chordDegree(key, tmpl) : null,
		});
	}

	return { keys, chords };
};
