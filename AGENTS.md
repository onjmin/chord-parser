# chord-parser 概要

コードネーム（chord symbol）⇄ 構成音（chord tones）を相互変換する、依存ゼロの TypeScript ライブラリ。

## 主要ファイル

| ファイル | 役割 |
|---------|------|
| `src/index.ts` | エントリポイント、エクスポート |
| `src/parse-chord.ts` | (A) コードネーム → 構成音。onjmin/piano `parseChord.mjs` の TS 移植 |
| `src/parse-chords.ts` | (A) コード進行文字列 → 時刻付きイベント列。`parseChords.mjs` の TS 移植 |
| `src/detect-chord.ts` | (B) 構成音 → コードネーム（本ライブラリ独自の逆引き） |
| `src/chord-table.ts` | 検出用クオリティ表。`parseChord` で生成し A/B の解釈を一致させる |
| `src/note.ts` | pitch class ⇄ 音名ユーティリティ |
| `src/hankaku.ts` | 全角→半角変換（`toHan` 相当） |
| `src/chord-parser.test.ts` | node:test によるテスト |
| `demo/` | ブラウザデモ（`index.html`）と Hono ローカルサーバ（`server.ts`） |

## 設計メモ

- (A) のパース本体は元 `.mjs` と等価。外部依存 `SortedSet` は `parse-chord.ts` 内の `Matcher`（最長一致）に、`toHan` は `hankaku.ts` に内製化。
- 元実装は `maj7`（小文字 maj）を minor として誤読していたため、`parseBase` で `maj`/`major` をメジャー7thマーカーへ振り分ける修正を入れている。
- (B) は「各構成音を仮ルートとしてルート相対集合を作り、クオリティ表と完全一致照合 → 基本形/一般性で順位付け」する方式。表が `parseChord` 由来なので往復一致が保証される。
- pitch class は 0=C … 11=B。`notes` はルートを 0 とした絶対半音オフセット（転回形では最低音が先頭）。

## ビルド/検証

- `pnpm build` … tsup で ESM(.js)/CJS(.cjs)/dts を `dist` に出力（`files: ["dist"]` のみ publish）。
- `pnpm test` / `pnpm typecheck` / `pnpm dev`（デモサーバ :40299）。
- tsconfig は `moduleResolution: bundler`（tsup でバンドルするため拡張子不要）。

## 参考実装
- C:\_own\git\_users\onjmin\piano\mjs\parseChord.mjs
- C:\_own\git\_users\onjmin\piano\mjs\parseChords.mjs
