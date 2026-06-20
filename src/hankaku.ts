/**
 * 全角の英数字・記号を半角へ変換する（onjmin/mylib の toHan 相当の軽量版）。
 * 全角スペース（U+3000）は半角スペースへ。U+FF01〜FF5E は ASCII 0x21〜0x7E へ写す。
 */
export const toHan = (str: string): string =>
	str
		.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
		.replace(/　/g, " ");
