// src/note.ts
var SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B"
];
var FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B"
];
var toPitchClass = (n) => (n % 12 + 12) % 12;
var noteName = (pc, flat = false) => (flat ? FLAT_NAMES : SHARP_NAMES)[toPitchClass(pc)];

// src/parse-chord.ts
var SyntaxErrorWithPos = class extends Error {
  constructor(input, msg) {
    super(
      `SyntaxError: ${msg}
input.idx: ${input.idx}
input.str: ${input.str}`
    );
    this.name = "ChordSyntaxError";
  }
};
var err = (input, msg) => {
  throw new SyntaxErrorWithPos(input, msg);
};
var Input = class _Input {
  static nums = new Set("0123456789");
  str;
  nest;
  idx;
  constructor(str, nest = 0) {
    this.str = str;
    this.nest = nest;
    this.idx = 0;
  }
  get isEOF() {
    return this.str.length <= this.idx;
  }
  get char() {
    return this.str[this.idx];
  }
  /** 先頭の連続する数字を消費して数値で返す（破壊的）。数字が無ければ null。 */
  get num() {
    let str = "";
    while (!this.isEOF) {
      const char = this.char;
      if (!_Input.nums.has(char)) break;
      str += char;
      this.idx++;
    }
    return str.length ? Number(str) : null;
  }
  slice(i) {
    return this.str.slice(this.idx, this.idx + i);
  }
};
var Output = class {
  pitch = null;
  chord = null;
  isChord = false;
  pending = null;
  nest = -1;
  get value() {
    const { pitch, chord } = this;
    return new Set(
      [...chord].map((v) => v + pitch)
    );
  }
  set value(chord) {
    const pitch = this.pitch;
    this.chord = new Set([...chord].map((v) => v - pitch));
  }
};
var Matcher = class {
  map = /* @__PURE__ */ new Map();
  /** キー長を降順で保持（最長一致のため）。 */
  lengths = [];
  _set(key, value) {
    this.map.set(key, value);
    if (!this.lengths.includes(key.length)) {
      this.lengths.push(key.length);
      this.lengths.sort((a, b) => b - a);
    }
  }
  set(key, value) {
    if (Array.isArray(key)) for (const k of key) this._set(k, value);
    else this._set(key, value);
  }
  parse(input) {
    for (const i of this.lengths) {
      const s = input.slice(i);
      if (this.map.has(s)) {
        input.idx += s.length;
        return this.map.get(s);
      }
    }
    return null;
  }
};
var BRACKET_START = 0;
var BRACKET_END = 1;
var COMMA = 2;
var DIVIDE = 3;
var formulaMatcher = new Matcher();
formulaMatcher.set("(", BRACKET_START);
formulaMatcher.set(")", BRACKET_END);
formulaMatcher.set(",", COMMA);
formulaMatcher.set(["/", "on"], DIVIDE);
var parseFormula = (input, output = new Output(), nest = 0) => {
  let start = input.idx;
  const _eval = (idx) => {
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
          output.value = [...o.value].concat(v);
        } else {
          const a = v.sort((x, y) => x - y);
          const pitch = (o.pitch + 3) % 12 - 3;
          if (a[0] < pitch) {
            while (a[0] < pitch) a.push(a.shift() + 12);
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
var parseTerm = (input, output) => {
  if (input.isEOF) return output;
  if (output.pitch === null) return parsePitch(input, output);
  if (output.pending === null) return parseFunc(input, output);
  return parsePending(input, output);
};
var halfMatcher = new Matcher();
var halfMatcherStrict = new Matcher();
for (const m of [halfMatcher, halfMatcherStrict]) {
  m.set(["#", "\u266F"], 1);
  m.set(["b", "\u266D"], -1);
}
halfMatcher.set("+", 1);
halfMatcher.set("-", -1);
var parseHalf = (input, isPitch = false) => (isPitch ? halfMatcherStrict : halfMatcher).parse(input);
var idx2pitch = [0, 2, 4, 5, 7, 9, 11];
for (const i of [...idx2pitch.keys()]) idx2pitch.push(idx2pitch[i] + 12);
var deg2pitch = (deg) => idx2pitch[deg - 1];
var pitchMatcher = new Matcher();
for (const [i, v] of [..."CDEFGAB"].entries())
  pitchMatcher.set(v, idx2pitch[i]);
var parsePitch = (input, output) => {
  const pitch = pitchMatcher.parse(input);
  if (pitch === null) err(input, "Not found pitch");
  output.pitch = pitch;
  const half = parseHalf(input, true);
  if (half !== null) output.pitch += half;
  return parseBase(input, output);
};
var MAJOR = [0, 4, 7];
var DIM = [0, 3, 6];
var baseMatcher = new Matcher();
baseMatcher.set(["m", "min", "Min", "minor", "Minor", "-"], [0, 3, 7]);
baseMatcher.set(["dim", "\u3007"], DIM);
baseMatcher.set("+", [0, 4, 8]);
baseMatcher.set(["\u03A6", "\u03C6", "\xF8"], [0, 3, 6, 10]);
var parseBase = (input, output) => {
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
var add = (chord, n, half) => {
  chord.add(deg2pitch(n) + half);
};
var aug = (chord) => {
  chord.delete(deg2pitch(5));
  chord.add(deg2pitch(5) + 1);
};
var _7th = (chord, n, _half2, isFlat = false) => {
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
var _half = (chord, n, half) => {
  chord.delete(deg2pitch(n));
  chord.add(deg2pitch(n) + half);
};
var funcMatcher = new Matcher();
funcMatcher.set("add", add);
funcMatcher.set(["omit", "no"], (chord, n, half) => {
  chord.delete(deg2pitch(n) + half);
});
funcMatcher.set("sus", (chord, n, half) => {
  chord.delete(deg2pitch(3));
  chord.add(deg2pitch(n) + half);
});
funcMatcher.set(
  ["M", "maj", "Maj", "major", "Major", "\u25B3", "\u0394"],
  _7th
);
funcMatcher.set("aug", aug);
var parseFunc = (input, output) => {
  if (!output.isChord) output.isChord = true;
  const func = funcMatcher.parse(input);
  const chord = output.chord;
  if (func === null) {
    const isAug = input.char === "+";
    const half = parseHalf(input);
    const { num } = input;
    if (num === null) {
      if (isAug) aug(chord);
      else err(input, "Not found number");
    }
    if (half === null) {
      if (input.nest === output.nest) _7th(chord, num, 0, true);
      else add(chord, num, 0);
    } else {
      _half(chord, num, half);
    }
  } else if (func === aug) {
    aug(chord);
  } else {
    output.pending = func;
  }
  return parseTerm(input, output);
};
var parsePending = (input, output) => {
  const half = parseHalf(input);
  const { num } = input;
  const { pending, chord } = output;
  if (num === null) err(input, "Not found number");
  pending(
    chord,
    num,
    half === null ? 0 : half
  );
  output.pending = null;
  return parseTerm(input, output);
};
var parseChord = (symbol) => {
  const output = parseFormula(new Input(symbol));
  const notes = [...output.value].sort((a, b) => a - b);
  const intervals = [...output.chord].sort((a, b) => a - b);
  const pitchClasses = [...new Set(notes.map(toPitchClass))].sort(
    (a, b) => a - b
  );
  return {
    symbol,
    root: toPitchClass(output.pitch),
    notes,
    pitchClasses,
    intervals
  };
};

// src/chord-table.ts
var QUALITY_SOURCE = [
  "",
  // major
  "m",
  // minor
  "7",
  // dominant 7th
  "M7",
  // major 7th
  "m7",
  // minor 7th
  "dim",
  // diminished triad
  "m7b5",
  // half-diminished
  "aug",
  // augmented triad
  "6",
  // major 6th
  "m6",
  // minor 6th
  "sus4",
  "sus2",
  "mM7",
  // minor major 7th
  "dim7",
  // diminished 7th
  "7sus4",
  "7#5",
  // augmented 7th
  "add9",
  "madd9",
  "9",
  "M9",
  "m9",
  "69",
  "m69",
  "5"
  // power chord
];
var QUALITIES = QUALITY_SOURCE.map(
  (quality, priority) => ({
    quality,
    pitchClasses: parseChord(`C${quality}`).pitchClasses,
    priority
  })
);
var QUALITY_BY_PCSET = (() => {
  const map = /* @__PURE__ */ new Map();
  for (const def of QUALITIES) {
    const key = def.pitchClasses.join(",");
    if (!map.has(key)) map.set(key, def);
  }
  return map;
})();

// src/detect-chord.ts
var detectChord = (notes, options = {}) => {
  if (!notes.length) return [];
  const { flat = false } = options;
  const pcs = [...new Set(notes.map(toPitchClass))].sort((a, b) => a - b);
  const bass = toPitchClass(
    options.bass ?? notes.reduce((m, v) => Math.min(m, v), notes[0])
  );
  const scored = [];
  for (const root of pcs) {
    const rel = pcs.map((pc) => toPitchClass(pc - root)).sort((a, b) => a - b);
    const def = QUALITY_BY_PCSET.get(rel.join(","));
    if (!def) continue;
    const rootSymbol = noteName(root, flat) + def.quality;
    const inversion = root !== bass;
    scored.push({
      priority: def.priority,
      candidate: {
        symbol: inversion ? `${rootSymbol}/${noteName(bass, flat)}` : rootSymbol,
        rootSymbol,
        root,
        quality: def.quality,
        bass,
        inversion
      }
    });
  }
  scored.sort((a, b) => {
    if (a.candidate.inversion !== b.candidate.inversion)
      return a.candidate.inversion ? 1 : -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.candidate.root - b.candidate.root;
  });
  return scored.map((s) => s.candidate);
};

// src/hankaku.ts
var toHan = (str) => str.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)).replace(/　/g, " ");

// src/parse-chords.ts
var parseChords = (str, bpm = 120) => {
  const output = [];
  const secBar = 60 / bpm * 4;
  const frontChars = new Set("ABCDEFG_=%N");
  let idx = 0;
  let last = null;
  for (const line of toHan(str).split("\n").map((v) => v.trim())) {
    if (!line.length || /^#/.test(line)) continue;
    for (const str2 of line.split(/[|lｌ→]/)) {
      if (!str2.length) continue;
      const when = idx++ * secBar;
      const a = [];
      for (let i = 0; i < str2.length; i++) {
        const char = str2[i];
        const prev = str2[i - 1];
        const prev2 = str2.slice(i - 2, i);
        if (!frontChars.has(char)) continue;
        if (prev === "/" || prev2 === "on") continue;
        if (prev2 === "N." && char === "C") continue;
        a.push(i);
      }
      if (!a.length) continue;
      const divide = 2 ** Math.ceil(Math.log2(a.length));
      const unitTime = secBar / divide;
      for (const [i, v] of a.entries()) {
        const s = str2.slice(v, i === a.length - 1 ? str2.length : a[i + 1]).replace(/\s+/g, "");
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
          const base = last;
          last = { ...base, when: _when, duration: unitTime };
        } else {
          const key = s.slice(0, s[1] === "#" ? 2 : 1);
          const chord = s.slice(key.length).replace(/[\s・]/g, "");
          last = {
            key,
            chord,
            when: _when,
            duration: unitTime
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
export {
  FLAT_NAMES,
  QUALITIES,
  SHARP_NAMES,
  detectChord,
  noteName,
  parseChord,
  parseChords,
  toPitchClass
};
