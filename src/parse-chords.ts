// ============================================================
// (A) コード進行文字列 → 時刻付きコードイベント列
//
// onjmin/piano の mjs/parseChords.mjs を TypeScript へ移植したもの。
// 外部依存（hankaku.mjs の toHan）は ./hankaku に置き換えた。
// ============================================================

import { toHan } from "./hankaku";

/** parseChords が返す、1コード分の時刻付きイベント。 */
export interface ChordEvent {
	/** ルート音文字列（例: "C", "G", "F#"）。 */
	key: string;
	/** コードのクオリティ部分（例: "maj7", "m7", "dim"）。ルートのみなら ""。 */
	chord: string;
	/** 再生開始時刻（秒）。 */
	when: number;
	/** 持続時間（秒）。 */
	duration: number;
}

/**
 * コード進行を表す文字列を解析し、時刻付きイベント配列に変換する。
 *
 * 記法:
 * - 行ごとに `|` `l` `ｌ` `→` で小節（区切り）を分割
 * - `=` は直前コードの継続（伸ばす）
 * - `_` は休符、`N` / `N.C.` はノーコード
 * - `%` は直前コードの繰り返し
 * - `#` で始まる行はコメントとして無視
 *
 * @example
 * parseChords("C | G | Am | F", 120)
 *
 * @param str コード進行文字列
 * @param bpm テンポ（既定 120）。これを基に when / duration を秒で算出する。
 * @returns 時刻付き {@link ChordEvent} の配列
 */
export const parseChords = (str: string, bpm = 120): ChordEvent[] => {
	const output: ChordEvent[] = [];
	const secBar = (60 / bpm) * 4;
	const frontChars = new Set("ABCDEFG_=%N"); // N === N.C.
	let idx = 0;
	let last: ChordEvent | null = null;
	for (const line of toHan(str)
		.split("\n")
		.map((v) => v.trim())) {
		if (!line.length || /^#/.test(line)) continue;
		for (const str of line.split(/[|lｌ→]/)) {
			if (!str.length) continue;
			const when = idx++ * secBar;
			const a: number[] = [];
			for (let i = 0; i < str.length; i++) {
				const char = str[i];
				const prev = str[i - 1];
				const prev2 = str.slice(i - 2, i);
				if (!frontChars.has(char)) continue;
				if (prev === "/" || prev2 === "on") continue;
				if (prev2 === "N." && char === "C") continue;
				a.push(i);
			}
			if (!a.length) continue;
			const divide = 2 ** Math.ceil(Math.log2(a.length));
			const unitTime = secBar / divide;
			for (const [i, v] of a.entries()) {
				const s = str
					.slice(v, i === a.length - 1 ? str.length : a[i + 1])
					.replace(/\s+/g, "");
				const c = s[0];
				if (c === "_" || c === "N") {
					last = null;
					continue;
				}
				if (c === "=") {
					if (last) last.duration += unitTime;
					continue;
				}
				const _when = when + i * unitTime;
				if (c === "%") {
					if (last === null) continue;
					const base: ChordEvent = last;
					last = { ...base, when: _when, duration: unitTime };
				} else {
					const key = s.slice(0, s[1] === "#" ? 2 : 1);
					const chord = s.slice(key.length).replace(/[\s・]/g, "");
					last = {
						key,
						chord,
						when: _when,
						duration: unitTime,
					};
				}
				output.push(last);
			}
			if (last !== null && divide > a.length)
				last.duration += unitTime * (divide - a.length);
		}
	}
	return output;
};
