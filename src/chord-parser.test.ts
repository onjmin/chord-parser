import assert from "node:assert/strict";
import { test } from "node:test";
import { detectChord } from "./detect-chord";
import { parseChord } from "./parse-chord";
import { parseChords } from "./parse-chords";

// ---- (A) parseChord -------------------------------------------------

test("parseChord: major triad", () => {
	assert.deepEqual(parseChord("C").notes, [0, 4, 7]);
});

test("parseChord: major 7th", () => {
	assert.deepEqual(parseChord("Cmaj7").notes, [0, 4, 7, 11]);
	assert.deepEqual(parseChord("CM7").notes, [0, 4, 7, 11]);
});

test("parseChord: minor 7th", () => {
	assert.deepEqual(parseChord("Dm7").pitchClasses, [0, 2, 5, 9]);
});

test("parseChord: dominant 7th", () => {
	assert.deepEqual(parseChord("G7").pitchClasses, [2, 5, 7, 11]);
});

test("parseChord: half-diminished", () => {
	assert.deepEqual(parseChord("Cm7b5").pitchClasses, [0, 3, 6, 10]);
});

test("parseChord: slash chord puts bass at the bottom", () => {
	const { notes, root } = parseChord("C/E");
	assert.equal(root, 0); // ルートは C
	assert.equal(Math.min(...notes), notes[0]); // 最低音が先頭
	assert.equal(((notes[0] % 12) + 12) % 12, 4); // 最低音は E
});

test("parseChord: throws on garbage", () => {
	assert.throws(() => parseChord("???"));
});

// ---- (B) detectChord ------------------------------------------------

test("detectChord: major triad", () => {
	assert.equal(detectChord([0, 4, 7])[0].symbol, "C");
});

test("detectChord: works with MIDI note numbers", () => {
	assert.equal(detectChord([60, 64, 67, 71])[0].symbol, "CM7");
});

test("detectChord: minor 7th", () => {
	assert.equal(detectChord([2, 5, 9, 0])[0].rootSymbol, "Dm7");
});

test("detectChord: inversion is named as a slash chord", () => {
	const top = detectChord([4, 7, 12])[0]; // E G C, bass = E
	assert.equal(top.symbol, "C/E");
	assert.equal(top.inversion, true);
});

test("detectChord: empty input", () => {
	assert.deepEqual(detectChord([]), []);
});

// ---- round trip -----------------------------------------------------

test("round trip: parseChord -> detectChord -> same pitch classes", () => {
	for (const sym of ["C", "Am7", "G7", "FM7", "Bdim", "Dm7b5"]) {
		const parsed = parseChord(sym);
		const detected = detectChord(parsed.notes);
		const back = parseChord(detected[0].rootSymbol);
		assert.deepEqual(back.pitchClasses, parsed.pitchClasses, sym);
	}
});

// ---- parseChords ----------------------------------------------------

test("parseChords: simple progression", () => {
	const events = parseChords("C | G | Am | F", 120);
	assert.equal(events.length, 4);
	assert.equal(events[0].key, "C");
	assert.equal(events[2].key, "A");
	assert.equal(events[2].chord, "m");
	assert.equal(events[1].when, 2); // bpm120 → 1小節2秒
});
