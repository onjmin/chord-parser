// ============================================================
// (A) コードネーム（chord symbol）→ 構成音（chord tones）
//
// onjmin/piano の mjs/parseChord.mjs を TypeScript へ移植したもの。
// 元実装の外部依存（SortedSet.mjs）はこのファイル内の軽量実装に置き換えた。
// パースのロジック自体は元実装と等価。
// ============================================================

import { noteName, toPitchClass } from "./note";

/** parseChord の返り値。 */
export interface ParsedChord {
	/** 入力されたコードネームそのもの。 */
	symbol: string;
	/** ルート音の pitch class（0〜11）。 */
	root: number;
	/**
	 * 構成音。ルート音を起点とした絶対半音オフセットの配列（昇順）。
	 * 例: Cmaj7 → [0, 4, 7, 11]
	 */
	notes: number[];
	/**
	 * 構成音の pitch class 配列（0〜11、昇順・重複なし）。
	 * オクターブを無視した「鳴っている音」の集合。
	 */
	pitchClasses: number[];
	/** ルート音からの相対音程の集合（昇順）。 */
	intervals: number[];
}

class SyntaxErrorWithPos extends Error {
	constructor(input: Input, msg: string) {
		super(
			`SyntaxError: ${msg}\ninput.idx: ${input.idx}\ninput.str: ${input.str}`,
		);
		this.name = "ChordSyntaxError";
	}
}

const err = (input: Input, msg: string): never => {
	throw new SyntaxErrorWithPos(input, msg);
};

class Input {
	static nums = new Set("0123456789");
	str: string;
	nest: number;
	idx: number;
	constructor(str: string, nest = 0) {
		this.str = str;
		this.nest = nest;
		this.idx = 0;
	}
	get isEOF(): boolean {
		return this.str.length <= this.idx;
	}
	get char(): string | undefined {
		return this.str[this.idx];
	}
	/** 先頭の連続する数字を消費して数値で返す（破壊的）。数字が無ければ null。 */
	get num(): number | null {
		let str = "";
		while (!this.isEOF) {
			const char = this.char as string;
			if (!Input.nums.has(char)) break;
			str += char;
			this.idx++;
		}
		return str.length ? Number(str) : null;
	}
	slice(i: number): string {
		return this.str.slice(this.idx, this.idx + i);
	}
}

class Output {
	pitch: number | null = null;
	chord: Set<number> | null = null;
	isChord = false;
	pending: ((chord: Set<number>, n: number, half: number) => void) | null =
		null;
	nest = -1;
	get value(): Set<number> {
		const { pitch, chord } = this;
		return new Set(
			[...(chord as Set<number>)].map((v) => v + (pitch as number)),
		);
	}
	set value(chord: Iterable<number>) {
		const pitch = this.pitch as number;
		this.chord = new Set([...chord].map((v) => v - pitch));
	}
}

type ParseVal = number | number[] | ((...args: never[]) => unknown);

/** 最長一致でキーを引く小さな字句マッチャ。元実装の Parser + SortedSet を統合したもの。 */
class Matcher<T extends ParseVal> {
	private map = new Map<string, T>();
	/** キー長を降順で保持（最長一致のため）。 */
	private lengths: number[] = [];
	private _set(key: string, value: T): void {
		this.map.set(key, value);
		if (!this.lengths.includes(key.length)) {
			this.lengths.push(key.length);
			this.lengths.sort((a, b) => b - a);
		}
	}
	set(key: string | string[], value: T): void {
		if (Array.isArray(key)) for (const k of key) this._set(k, value);
		else this._set(key, value);
	}
	parse(input: Input): T | null {
		for (const i of this.lengths) {
			const s = input.slice(i);
			if (this.map.has(s)) {
				input.idx += s.length;
				return this.map.get(s) as T;
			}
		}
		return null;
	}
}

// --- フォーミュラ層（括弧・カンマ・分数コード）-------------------------

const BRACKET_START = 0;
const BRACKET_END = 1;
const COMMA = 2;
const DIVIDE = 3;

const formulaMatcher = new Matcher<number>();
formulaMatcher.set("(", BRACKET_START);
formulaMatcher.set(")", BRACKET_END);
formulaMatcher.set(",", COMMA);
formulaMatcher.set(["/", "on"], DIVIDE);

const parseFormula = (
	input: Input,
	output = new Output(),
	nest = 0,
): Output => {
	let start = input.idx;
	const _eval = (idx: number): void => {
		const str = input.str.slice(start, idx);
		if (str.length) parseTerm(new Input(str, nest), output);
	};
	while (true) {
		const { idx } = input;
		if (input.isEOF) {
			if (nest) err(input, `Unclosed ${nest} brackets`);
			_eval(idx);
			return output;
		}
		const res = formulaMatcher.parse(input);
		if (res === null) {
			input.idx++;
			continue;
		}
		const { pending } = output;
		_eval(idx);
		switch (res) {
			case BRACKET_START:
				parseFormula(input, output, nest + 1);
				break;
			case BRACKET_END:
				if (nest - 1 < 0) err(input, "Unable to close brackets");
				return output;
			case COMMA:
				output.pending = pending;
				break;
			case DIVIDE: {
				const o = parseFormula(input, new Output(), nest);
				const v = [...output.value];
				if (o.isChord) {
					// UST（アッパーストラクチャートライアド）: 両方をそのまま重ねる
					output.value = [...o.value].concat(v);
				} else {
					// 分数コード / インヴァージョン: ベース音を最低音に置く
					const a = v.sort((x, y) => x - y);
					const pitch = (((o.pitch as number) + 3) % 12) - 3;
					if (a[0] < pitch) {
						while (a[0] < pitch) a.push((a.shift() as number) + 12);
					} else {
						while (true) {
							const w = a[a.length - 1] - 12;
							if (w < pitch) break;
							a.pop();
							a.unshift(w);
						}
					}
					a.push(pitch);
					output.value = a;
				}
				break;
			}
		}
		start = input.idx;
	}
};

// --- 項層（ピッチ / クオリティ / 関数）---------------------------------

const parseTerm = (input: Input, output: Output): Output => {
	if (input.isEOF) return output;
	if (output.pitch === null) return parsePitch(input, output);
	if (output.pending === null) return parseFunc(input, output);
	return parsePending(input, output);
};

const halfMatcher = new Matcher<number>();
const halfMatcherStrict = new Matcher<number>();
for (const m of [halfMatcher, halfMatcherStrict]) {
	m.set(["#", "♯"], 1);
	m.set(["b", "♭"], -1);
}
halfMatcher.set("+", 1);
halfMatcher.set("-", -1);

/** シャープ/フラット記号を消費して +1 / -1 を返す。isPitch=true ではピッチ用の厳密版を使う。 */
const parseHalf = (input: Input, isPitch = false): number | null =>
	(isPitch ? halfMatcherStrict : halfMatcher).parse(input);

// [degree - 1] → pitch class
const idx2pitch = [0, 2, 4, 5, 7, 9, 11];
for (const i of [...idx2pitch.keys()]) idx2pitch.push(idx2pitch[i] + 12);
/** 度数（1, 3, 5, 7, 9, 11, 13...）→ ルートからの半音数 */
const deg2pitch = (deg: number): number => idx2pitch[deg - 1];

const pitchMatcher = new Matcher<number>();
for (const [i, v] of [..."CDEFGAB"].entries())
	pitchMatcher.set(v, idx2pitch[i]);

const parsePitch = (input: Input, output: Output): Output => {
	const pitch = pitchMatcher.parse(input);
	if (pitch === null) err(input, "Not found pitch");
	output.pitch = pitch as number;
	const half = parseHalf(input, true);
	if (half !== null) output.pitch += half;
	return parseBase(input, output);
};

const MAJOR = [0, 4, 7];
const DIM = [0, 3, 6];

const baseMatcher = new Matcher<number[]>();
baseMatcher.set(["m", "min", "Min", "minor", "Minor", "-"], [0, 3, 7]);
baseMatcher.set(["dim", "〇"], DIM);
baseMatcher.set("+", [0, 4, 8]); // aug
baseMatcher.set(["Φ", "φ", "ø"], [0, 3, 6, 10]); // half-diminished

const parseBase = (input: Input, output: Output): Output => {
	// "maj" / "major" は長調7thの関数マーカー（parseFunc が処理）。
	// 基底の "m"(minor) が "maj" の "m" を食ってしまうのを防ぎ、メジャー基底として扱う。
	const isMajMarker = /^maj/i.test(input.str.slice(input.idx));
	const res = isMajMarker ? null : baseMatcher.parse(input);
	if (res !== null) output.isChord = true;
	output.chord = new Set(res || MAJOR);
	if (res === DIM) {
		const { num } = input;
		const chord = output.chord;
		if (num !== null) chord.add(deg2pitch(num) - 2);
	}
	output.nest = input.nest;
	return parseTerm(input, output);
};

type FuncOp = (chord: Set<number>, n: number, half: number) => void;

const add: FuncOp = (chord, n, half) => {
	chord.add(deg2pitch(n) + half);
};
const aug = (chord: Set<number>): void => {
	chord.delete(deg2pitch(5));
	chord.add(deg2pitch(5) + 1);
};
const _7th = (
	chord: Set<number>,
	n: number,
	_half: number,
	isFlat = false,
): void => {
	if (n === 5) chord.delete(deg2pitch(3));
	else if (n === 6) chord.add(deg2pitch(6));
	else if (n === 69) chord.add(deg2pitch(6)).add(deg2pitch(9));
	else {
		if (n >= 7) chord.add(deg2pitch(7) + (isFlat ? -1 : 0));
		if (n >= 9) chord.add(deg2pitch(9));
		if (n >= 11) chord.add(deg2pitch(11));
		if (n >= 13) chord.add(deg2pitch(13));
	}
};
const _half: FuncOp = (chord, n, half) => {
	chord.delete(deg2pitch(n));
	chord.add(deg2pitch(n) + half);
};

const funcMatcher = new Matcher<FuncOp | ((chord: Set<number>) => void)>();
funcMatcher.set("add", add);
funcMatcher.set(["omit", "no"], (chord, n, half) => {
	chord.delete(deg2pitch(n) + half);
});
funcMatcher.set("sus", (chord, n, half) => {
	chord.delete(deg2pitch(3));
	chord.add(deg2pitch(n) + half);
});
funcMatcher.set(
	["M", "maj", "Maj", "major", "Major", "△", "Δ"],
	_7th as FuncOp,
);
funcMatcher.set("aug", aug);

const parseFunc = (input: Input, output: Output): Output => {
	if (!output.isChord) output.isChord = true;
	const func = funcMatcher.parse(input);
	const chord = output.chord as Set<number>;
	if (func === null) {
		const isAug = input.char === "+";
		const half = parseHalf(input);
		const { num } = input;
		if (num === null) {
			if (isAug) aug(chord);
			else err(input, "Not found number");
		}
		if (half === null) {
			if (input.nest === output.nest) _7th(chord, num as number, 0, true);
			else add(chord, num as number, 0);
		} else {
			_half(chord, num as number, half);
		}
	} else if (func === aug) {
		aug(chord);
	} else {
		output.pending = func as FuncOp;
	}
	return parseTerm(input, output);
};

const parsePending = (input: Input, output: Output): Output => {
	const half = parseHalf(input);
	const { num } = input;
	const { pending, chord } = output;
	if (num === null) err(input, "Not found number");
	(pending as FuncOp)(
		chord as Set<number>,
		num as number,
		half === null ? 0 : half,
	);
	output.pending = null;
	return parseTerm(input, output);
};

/**
 * 単一のコードネームを解析して構成音を返す。
 *
 * @example
 * parseChord("Cmaj7").notes        // => [0, 4, 7, 11]
 * parseChord("Dm7").pitchClasses   // => [0, 2, 5, 9]
 * parseChord("C/E").notes          // ベース音 E を最低音に持つ転回形
 *
 * @param symbol コードネーム（例: "C", "Am7", "G7sus4", "FM9", "C/E", "C(onG)"）
 * @returns 構成音・ルート・音程などを含む {@link ParsedChord}
 * @throws 解析できない文字列のとき ChordSyntaxError を投げる
 */
export const parseChord = (symbol: string): ParsedChord => {
	const output = parseFormula(new Input(symbol));
	const notes = [...output.value].sort((a, b) => a - b);
	const intervals = [...(output.chord as Set<number>)].sort((a, b) => a - b);
	const pitchClasses = [...new Set(notes.map(toPitchClass))].sort(
		(a, b) => a - b,
	);
	return {
		symbol,
		root: toPitchClass(output.pitch as number),
		notes,
		pitchClasses,
		intervals,
	};
};

export { noteName };
