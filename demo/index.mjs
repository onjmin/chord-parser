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

// src/detect-key.ts
var MAJOR_PROFILE = [
  6.35,
  2.23,
  3.48,
  2.33,
  4.38,
  4.09,
  2.52,
  5.19,
  2.39,
  3.66,
  2.29,
  2.88
];
var MINOR_PROFILE = [
  6.33,
  2.68,
  3.52,
  5.38,
  2.6,
  3.53,
  2.54,
  4.75,
  3.98,
  2.69,
  3.34,
  3.17
];
var mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
var pearson = (a, b) => {
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
var keyName = (tonic, mode, flat) => `${noteName(tonic, flat)} ${mode}`;
var stripScore = (c) => ({
  tonic: c.tonic,
  mode: c.mode,
  name: c.name
});
var sameKey = (a, b) => a.tonic === b.tonic && a.mode === b.mode;
var buildHistogram = (notes) => {
  const h = new Array(12).fill(0);
  for (const n of notes) {
    if (typeof n === "number") h[toPitchClass(n)] += 1;
    else h[toPitchClass(n.pitch)] += n.duration ?? 1;
  }
  return h;
};
var windowHistogram = (notes, start, end) => {
  const h = new Array(12).fill(0);
  for (const n of notes) {
    if (n.duration <= 0) {
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
var rankKeys = (histogram, flat) => {
  const candidates = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ["major", "minor"]) {
      const profile = mode === "major" ? MAJOR_PROFILE : MINOR_PROFILE;
      const rotated = histogram.map(
        (_, pc) => profile[toPitchClass(pc - tonic)]
      );
      candidates.push({
        tonic,
        mode,
        name: keyName(tonic, mode, flat),
        score: pearson(histogram, rotated)
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
};
var detectKey = (notes, options = {}) => {
  if (!notes.length) return [];
  const { flat = false } = options;
  const histogram = buildHistogram(notes);
  if (histogram.every((v) => v === 0)) return [];
  return rankKeys(histogram, flat);
};
var coalesce = (segments) => {
  const out = [];
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
var mergeShortSegments = (segments, min) => {
  if (min <= 0) return segments;
  const result = segments.map((s) => ({ ...s }));
  let i = 0;
  while (i < result.length && result.length > 1) {
    if (result[i].duration >= min) {
      i++;
      continue;
    }
    if (i > 0) {
      result[i - 1].duration += result[i].duration;
      result.splice(i, 1);
    } else {
      result[i + 1].when = result[i].when;
      result[i + 1].duration += result[i].duration;
      result.splice(i, 1);
    }
  }
  return coalesce(result);
};
var detectKeyChanges = (notes, options = {}) => {
  if (!notes.length) return [];
  const { flat = false } = options;
  const start = notes.reduce(
    (m, n) => Math.min(m, n.when),
    Number.POSITIVE_INFINITY
  );
  const end = notes.reduce(
    (m, n) => Math.max(m, n.when + Math.max(n.duration, 0)),
    Number.NEGATIVE_INFINITY
  );
  const span = end - start;
  if (span <= 0) {
    const top = detectKey(
      notes.map((n) => ({ pitch: n.pitch, duration: Math.max(n.duration, 1) })),
      { flat }
    )[0];
    return top ? [{ key: stripScore(top), when: start, duration: 0 }] : [];
  }
  const windowSize = options.windowSize ?? span / 4;
  const hopSize = options.hopSize ?? windowSize / 2;
  const minSegmentDuration = options.minSegmentDuration ?? 0;
  const switchMargin = options.switchMargin ?? 0.08;
  const segments = [];
  for (let t = start; t < end - 1e-9; t += hopSize) {
    const regionEnd = Math.min(t + hopSize, end);
    const winEnd = Math.min(t + windowSize, end);
    const winStart = Math.max(start, winEnd - windowSize);
    const histogram = windowHistogram(notes, winStart, winEnd);
    const last = segments[segments.length - 1];
    if (histogram.every((v) => v === 0)) {
      if (last) last.duration = regionEnd - last.when;
      continue;
    }
    const candidates = rankKeys(histogram, flat);
    let chosen = candidates[0];
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
        duration: regionEnd - t
      });
    }
  }
  return mergeShortSegments(coalesce(segments), minSegmentDuration);
};
var CHORD_NOTE_BASE = 60;
var chordEventsToNotes = (events) => {
  const notes = [];
  for (const e of events) {
    let voicing;
    try {
      voicing = parseChord(`${e.key}${e.chord}`).notes;
    } catch {
      continue;
    }
    for (const offset of voicing)
      notes.push({
        pitch: CHORD_NOTE_BASE + offset,
        when: e.when,
        duration: e.duration
      });
  }
  return notes;
};

// src/detect-progression.ts
var toneRoleWeight = (rel) => {
  if (rel === 0) return 1.3;
  if (rel === 3 || rel === 4) return 1.2;
  if (rel === 10 || rel === 11) return 0.95;
  if (rel === 6 || rel === 7 || rel === 8) return 0.7;
  return 0.85;
};
var CHORD_TEMPLATES = (() => {
  const templates = [];
  for (let root = 0; root < 12; root++) {
    for (const def of QUALITIES) {
      const pcs = /* @__PURE__ */ new Set();
      const weights = new Array(12).fill(0);
      const rel = /* @__PURE__ */ new Set();
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
        rel
      });
    }
  }
  return templates;
})();
var MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
var NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
var scaleOf = (key) => {
  const base = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  return base.map((d) => toPitchClass(d + key.tonic));
};
var keyBonus = (tmpl, key) => {
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
  else if (rootDiatonic) bonus += 0.1;
  const degree = toPitchClass(tmpl.root - key.tonic);
  if (degree === 0 || degree === 5 || degree === 7) bonus += 0.05;
  return bonus;
};
var makeFrame = (notes, start, end) => {
  const raw = new Array(12).fill(0);
  let total = 0;
  let bassPitch = Number.POSITIVE_INFINITY;
  let bass = -1;
  for (const n of notes) {
    const s = Math.max(n.when, start);
    const e = Math.min(n.when + Math.max(n.duration, 0), end);
    const overlap = n.duration <= 0 ? n.when >= start && n.when < end ? 1 : 0 : Math.max(e - s, 0);
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
    empty: total === 0
  };
};
var emissionScore = (frame, tmpl, key, ncTonePenalty) => {
  let hit = 0;
  let miss = 0;
  for (let pc = 0; pc < 12; pc++) {
    const w = frame.profile[pc];
    if (w === 0) continue;
    if (tmpl.pcs.has(pc)) hit += w * tmpl.weights[pc];
    else miss += w;
  }
  let score = hit - ncTonePenalty * miss;
  if (frame.profile[tmpl.root] === 0) score -= 0.3;
  if (frame.bass !== -1 && tmpl.root === frame.bass) score += 0.3;
  if (key) score += keyBonus(tmpl, key);
  score -= tmpl.priority * 2e-3;
  return score;
};
var ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
var chordDegree = (key, tmpl) => {
  const scale = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  const rel = toPitchClass(tmpl.root - key.tonic);
  let idx = scale.indexOf(rel);
  let accidental = "";
  if (idx === -1) {
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
  const hasM3 = tmpl.rel.has(4);
  const hasm3 = tmpl.rel.has(3);
  const hasDim5 = tmpl.rel.has(6);
  const hasAug5 = tmpl.rel.has(8);
  const hasMin7 = tmpl.rel.has(10);
  let numeral = ROMAN[idx];
  let suffix = "";
  if (hasm3 && hasDim5) {
    numeral = numeral.toLowerCase();
    suffix = hasMin7 ? "\xF87" : "\xB0";
    if (tmpl.rel.has(9)) suffix = "\xB07";
  } else if (hasM3 && hasAug5) {
    suffix = "+";
  } else if (hasm3) {
    numeral = numeral.toLowerCase();
  } else if (!hasM3) {
  }
  if (!suffix) {
    if (tmpl.rel.has(11)) suffix = "M7";
    else if (hasMin7) suffix = "7";
    else if (tmpl.rel.has(9) && !tmpl.rel.has(10)) suffix = "6";
  }
  return accidental + numeral + suffix;
};
var viterbi = (emissions, changePenalty) => {
  const T = emissions.length;
  const N = CHORD_TEMPLATES.length;
  if (T === 0) return [];
  const back = Array.from(
    { length: T },
    () => new Array(N).fill(-1)
  );
  let prev = emissions[0].slice();
  for (let t = 1; t < T; t++) {
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
  let bestIdx = 0;
  for (let i = 1; i < N; i++) if (prev[i] > prev[bestIdx]) bestIdx = i;
  const path = new Array(T).fill(0);
  path[T - 1] = bestIdx;
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t][path[t]];
  return path;
};
var keyAt = (keys, when) => {
  for (const k of keys)
    if (when >= k.when && when < k.when + k.duration) return k.key;
  return keys.length ? keys[keys.length - 1].key : null;
};
var buildSymbol = (tmpl, bass, flat) => {
  const rootSymbol = noteName(tmpl.root, flat) + tmpl.quality;
  const inversion = bass !== -1 && bass !== tmpl.root && tmpl.pcs.has(bass);
  return {
    symbol: inversion ? `${rootSymbol}/${noteName(bass, flat)}` : rootSymbol,
    rootSymbol,
    inversion,
    bass: bass === -1 ? tmpl.root : bass
  };
};
var detectProgression = (notes, options = {}) => {
  if (!notes.length) return { keys: [], chords: [] };
  const {
    flat = false,
    bpm,
    frameSize = 0.5,
    changePenalty = 0.4,
    nonChordTonePenalty = 0.55,
    useKey = true
  } = options;
  const keys = detectKeyChanges(notes, options);
  const start = notes.reduce(
    (m, n) => Math.min(m, n.when),
    Number.POSITIVE_INFINITY
  );
  const end = notes.reduce(
    (m, n) => Math.max(m, n.when + Math.max(n.duration, 0)),
    Number.NEGATIVE_INFINITY
  );
  if (end <= start) return { keys, chords: [] };
  const frameDur = bpm ? 60 / bpm : Math.max(frameSize, 1e-3);
  const frames = [];
  for (let t = start; t < end - 1e-9; t += frameDur)
    frames.push(makeFrame(notes, t, Math.min(t + frameDur, end)));
  const emissions = frames.map((frame) => {
    if (frame.empty) return new Array(CHORD_TEMPLATES.length).fill(0);
    const key = useKey ? keyAt(keys, frame.when + frame.duration / 2) : null;
    return CHORD_TEMPLATES.map(
      (tmpl) => emissionScore(frame, tmpl, key, nonChordTonePenalty)
    );
  });
  const path = viterbi(emissions, changePenalty);
  const chords = [];
  for (let t = 0; t < frames.length; t++) {
    const frame = frames[t];
    const tmpl = CHORD_TEMPLATES[path[t]];
    const last = chords[chords.length - 1];
    const sameAsLast = last && last.root === tmpl.root && last.quality === tmpl.quality;
    if (sameAsLast) {
      last.duration = frame.when + frame.duration - last.when;
      continue;
    }
    const key = keyAt(keys, frame.when + frame.duration / 2);
    const { symbol, rootSymbol, inversion, bass } = buildSymbol(
      tmpl,
      frame.bass,
      flat
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
      degree: key ? chordDegree(key, tmpl) : null
    });
  }
  return { keys, chords };
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
  chordEventsToNotes,
  detectChord,
  detectKey,
  detectKeyChanges,
  detectProgression,
  noteName,
  parseChord,
  parseChords,
  toPitchClass
};
