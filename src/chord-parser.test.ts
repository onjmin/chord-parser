import assert from "node:assert/strict";
import { test } from "node:test";
import { detectChord } from "./detect-chord";
import { chordEventsToNotes, detectKey, detectKeyChanges } from "./detect-key";
import { detectProgression } from "./detect-progression";
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

// ---- (C) detectKey --------------------------------------------------

test("detectKey: C major scale → C major", () => {
	const top = detectKey([0, 2, 4, 5, 7, 9, 11])[0];
	assert.equal(top.tonic, 0);
	assert.equal(top.mode, "major");
	assert.equal(top.name, "C major");
});

test("detectKey: tonic-emphasized A minor → A minor", () => {
	// A natural minor と C major は構成音が同じ。主音 A を強調して曖昧さを解消する。
	const notes = [
		{ pitch: 9, duration: 8 }, // A（主音）
		{ pitch: 4, duration: 6 }, // E（属音）
		{ pitch: 0, duration: 4 }, // C
		{ pitch: 11, duration: 2 }, // B
		{ pitch: 2, duration: 2 }, // D
		{ pitch: 5, duration: 1 }, // F
		{ pitch: 7, duration: 1 }, // G
	];
	const top = detectKey(notes)[0];
	assert.equal(top.tonic, 9);
	assert.equal(top.mode, "minor");
});

test("detectKey: weighting by duration shifts the tonic", () => {
	// G を強調した G メジャー的なノート群
	const notes = [
		{ pitch: 7, duration: 8 }, // G
		{ pitch: 11, duration: 4 }, // B
		{ pitch: 2, duration: 4 }, // D
		{ pitch: 6, duration: 2 }, // F#（G major の導音）
	];
	const top = detectKey(notes)[0];
	assert.equal(top.tonic, 7); // G
});

test("detectKey: empty input", () => {
	assert.deepEqual(detectKey([]), []);
});

// ---- (C) detectKeyChanges (転調) ------------------------------------

// 短い進行を繰り返して「曲」らしい長さにする（窓が十分なコンテキストを持つように）。
const loop = (line: string, times: number): string =>
	Array(times).fill(line).join(" | ");

test("detectKeyChanges: no modulation → single segment", () => {
	const notes = chordEventsToNotes(parseChords(loop("C | F | G | C", 4), 120));
	const segments = detectKeyChanges(notes);
	assert.equal(segments.length, 1);
	assert.equal(segments[0].key.name, "C major");
});

test("detectKeyChanges: detects a modulation across the song", () => {
	// 前半 C major、後半 E major へ転調する「曲」
	const first = parseChords(loop("C | F | G | C", 4), 120);
	const secondRaw = parseChords(loop("E | A | B | E", 4), 120);
	// 後半イベントの時刻を前半の直後へずらす
	const offset =
		first[first.length - 1].when + first[first.length - 1].duration;
	const second = secondRaw.map((e) => ({ ...e, when: e.when + offset }));
	const notes = chordEventsToNotes([...first, ...second]);

	const segments = detectKeyChanges(notes, { minSegmentDuration: 1 });
	assert.ok(segments.length >= 2, "transition should yield ≥2 segments");
	assert.equal(segments[0].key.name, "C major");
	assert.equal(segments[segments.length - 1].key.tonic, 4); // E
	// セグメントは時間順かつ連続している
	for (let i = 1; i < segments.length; i++) {
		assert.ok(segments[i].when >= segments[i - 1].when);
	}
});

test("detectKeyChanges: empty input", () => {
	assert.deepEqual(detectKeyChanges([]), []);
});

// ---- (D) detectProgression -----------------------------------------

test("detectProgression: recovers chord symbols from notes", () => {
	const notes = chordEventsToNotes(parseChords("CM7 | Am7 | Dm7 | G7", 120));
	const { chords } = detectProgression(notes, { bpm: 120 });
	assert.deepEqual(
		chords.map((c) => c.symbol),
		["CM7", "Am7", "Dm7", "G7"],
	);
});

test("detectProgression: bass disambiguates Am7 from C6", () => {
	// {A,C,E,G} は C6 と Am7 で同一構成音。ベース A により Am へ解決する。
	const notes = chordEventsToNotes(parseChords("C | G | Am | F", 120));
	const { chords } = detectProgression(notes, { bpm: 120 });
	assert.deepEqual(
		chords.map((c) => c.symbol),
		["C", "G", "Am", "F"],
	);
});

test("detectProgression: detects inversion as a slash chord", () => {
	const notes = chordEventsToNotes(parseChords("C/E | F | G | C", 120));
	const { chords } = detectProgression(notes, { bpm: 120 });
	assert.equal(chords[0].symbol, "C/E");
	assert.equal(chords[0].inversion, true);
	assert.equal(chords[0].root, 0);
	assert.equal(chords[0].bass, 4); // E
});

test("detectProgression: assigns Roman-numeral degrees in the key", () => {
	const notes = chordEventsToNotes(parseChords(loop("C | G | Am | F", 4), 120));
	const { keys, chords } = detectProgression(notes, { bpm: 120 });
	assert.equal(keys.length, 1);
	assert.equal(keys[0].key.name, "C major");
	assert.deepEqual(
		chords.slice(0, 4).map((c) => c.degree),
		["I", "V", "vi", "IV"],
	);
});

test("detectProgression: degrees follow a modulation", () => {
	const first = parseChords(loop("C | G | Am | F", 4), 120);
	const secondRaw = parseChords(loop("E | B | C#m | A", 4), 120);
	const offset =
		first[first.length - 1].when + first[first.length - 1].duration;
	const second = secondRaw.map((e) => ({ ...e, when: e.when + offset }));
	const notes = chordEventsToNotes([...first, ...second]);

	const { keys, chords } = detectProgression(notes, {
		bpm: 120,
		minSegmentDuration: 2,
	});
	assert.ok(keys.length >= 2);
	// 後半（E major 領域）の最初のコードは E = I 度になる
	const afterMod = chords.find((c) => c.when >= offset && c.symbol === "E");
	assert.ok(afterMod, "E chord should appear after modulation");
	assert.equal(afterMod?.degree, "I");
	assert.equal(afterMod?.key?.name, "E major");
});

test("detectProgression: empty input", () => {
	assert.deepEqual(detectProgression([]), { keys: [], chords: [] });
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
