# @onjmin/chord-parser

コードネーム（**chord symbol** / 例: `Cmaj7`）⇄ 構成音（**chord tones** / 例: `[0, 4, 7, 11]`）を相互変換する、依存ゼロ・軽量の TypeScript パーサです。

- **(A) コードネーム → 構成音** … `parseChord` / `parseChords`
- **(B) 構成音 → コードネーム** … `detectChord`

> **用語について**
> `Cmaj7` `Dm7` のような表記は、一般に **コードネーム**（英: **chord symbol** / lead-sheet symbol）と呼びます。日本語の「コード記法」は通称で、音楽理論上の標準語ではありません。本ライブラリでは標準語に合わせて **chord symbol（コードネーム）** と **chord tones / 構成音** という名前を採用しています。

デモ: <https://onjmin.github.io/chord-parser/demo/> ・ API ドキュメント: <https://onjmin.github.io/chord-parser/>

## インストール

```sh
pnpm add @onjmin/chord-parser
# npm i @onjmin/chord-parser / yarn add @onjmin/chord-parser
```

ESM / CJS / 型定義 すべて同梱。ブラウザからは CDN 直読みも可能です。

```js
import { parseChord, detectChord, parseChords } from "@onjmin/chord-parser";
```

## (A) コードネーム → 構成音

### `parseChord(symbol)`

単一のコードネームを解析して構成音を返します。

```js
parseChord("Cmaj7");
// {
//   symbol: "Cmaj7",
//   root: 0,                  // ルートの pitch class（0=C, 1=C#, ... 11=B）
//   notes: [0, 4, 7, 11],     // ルートを 0 とした絶対半音オフセット（昇順）
//   pitchClasses: [0, 4, 7, 11], // オクターブを無視した pitch class 集合
//   intervals: [0, 4, 7, 11], // ルートからの相対音程
// }

parseChord("Dm7").pitchClasses;  // [0, 2, 5, 9]
parseChord("C/E").notes;         // [4, 7, 12]  ベース音 E を最低音に置いた転回形
```

| 例 | 意味 |
|----|------|
| `C` `Cm` `Cdim` `Caug` / `C+` | 三和音（メジャー/マイナー/ディミニッシュ/オーグメント） |
| `Cmaj7` `CM7` `C7` `Cm7` `CmM7` | 各種7th |
| `Cdim7` `Cm7b5` / `Cø` | 減七 / 半減七 |
| `C6` `Cm6` `C69` | 6th 系 |
| `Csus4` `Csus2` `C7sus4` | サスペンド |
| `Cadd9` `C9` `CM9` `Cm9` | テンション/拡張 |
| `C(#5)` `C(9,11)` `C7b9` `C7#11` | 括弧つき構成音指定 |
| `Comit3` `Cno5` | 構成音の省略 |
| `C/E` `ConE` `Dm7/G` | 分数コード / オンコード（転回形・ハイブリッド） |

> ルート音は `C D E F G A B`、変化記号は `# ♯ b ♭`。`m`/`min`/`minor`、`maj`/`major`/`M`、`dim`/`aug` など別綴りや全角記号（`△` `Δ` `ø`）にも対応します。解析できない文字列では `ChordSyntaxError` を投げます。

### `parseChords(str, bpm = 120)`

コード進行の文字列を、時刻つきイベント列に変換します。

```js
parseChords("C | G | Am | F", 120);
// [
//   { key: "C", chord: "",  when: 0, duration: 2 },
//   { key: "G", chord: "",  when: 2, duration: 2 },
//   { key: "A", chord: "m", when: 4, duration: 2 },
//   { key: "F", chord: "",  when: 6, duration: 2 },
// ]
```

記法:

- 行ごとに `|` `l` `ｌ` `→` で小節を区切る
- `=` 直前コードの継続 / `%` 直前コードの繰り返し
- `_` 休符 / `N`・`N.C.` ノーコード
- `#` で始まる行はコメント

`key` と `chord` を連結して `parseChord` に渡せば、各コードの構成音が得られます。

```js
for (const ev of parseChords("C | Am | F | G")) {
  const { notes } = parseChord(`${ev.key}${ev.chord}`);
  // ev.when / ev.duration（秒）に合わせてノートを鳴らす
}
```

## (B) 構成音 → コードネーム

### `detectChord(notes, options?)`

構成音からコードネームを推定します。一般性と基本形/転回形で順位づけした候補配列を返します。

```js
detectChord([0, 4, 7]);          // [{ symbol: "C", ... }, ...]
detectChord([60, 64, 67, 71]);   // [{ symbol: "CM7", ... }]  MIDIノート番号でも可
detectChord([4, 7, 12])[0];      // { symbol: "C/E", inversion: true, root: 0, bass: 4, ... }
detectChord([0, 3, 7], { flat: true })[0].symbol; // "Cm"（フラット表記）
```

候補の各要素:

```ts
interface ChordCandidate {
  symbol: string;      // 推定コードネーム（転回形は "C/E" のようにベース併記）
  rootSymbol: string;  // 転回形を考慮しない基本形（"C"）
  root: number;        // ルートの pitch class
  quality: string;     // クオリティ部分（"m7" など）
  bass: number;        // 最低音の pitch class
  inversion: boolean;  // ベース ≠ ルート（転回形 / 分数コード）か
}
```

| オプション | 既定 | 説明 |
|------------|------|------|
| `flat` | `false` | 音名をフラット表記（`Db` 等）にする |
| `bass` | 最小値 | ベース音として扱う値を明示（pitch class のみで音域情報がないとき用） |

入力は **pitch class（0〜11）** でも **MIDI ノート番号** でも構いません（オクターブは無視、最低音をベースとして転回形を判定）。完全一致のみを返し、見つからなければ空配列です。

#### しくみ

検出テーブルは `parseChord` 自身で生成しています（`C` を各クオリティに付けて構成音を求め、その pitch class 集合を逆引きキーにする）。そのため **(A) と (B) の解釈は必ず一致**し、`detectChord` の `rootSymbol` を `parseChord` に通すと元の構成音へ戻ります（往復一致）。検出対象のクオリティ一覧は `QUALITIES` で参照できます。

## その他のエクスポート

- `noteName(pc, flat?)` … pitch class → 音名（`0 → "C"`）
- `SHARP_NAMES` / `FLAT_NAMES` … 音名テーブル
- `toPitchClass(n)` … 任意の整数を 0〜11 に正規化
- `QUALITIES` … 検出対象コードクオリティの定義一覧（優先度順）

## 由来

(A) のパーサは [rpgen3/piano](https://github.com/rpgen3/piano/tree/main/mjs) の `parseChord.mjs` / `parseChords.mjs` を TypeScript へ移植し、外部依存（`SortedSet` / `toHan`）を内製の軽量実装へ置き換えたものです。`maj7` がメジャー7thとして解釈されるよう、元実装の取りこぼしを修正しています。(B) は本ライブラリ独自の逆引き方式です。

## 開発

```sh
pnpm install
pnpm build      # tsup で dist を生成
pnpm test       # node:test
pnpm typecheck
pnpm dev        # ビルド + ローカルデモサーバ（http://localhost:40299）
```

## License

MIT © onjmin
