// public/ の4ファイルを1枚の HTML にまとめる（サーバなしで配れる「CPUと対戦」専用版）。
//   node build-single.mjs [出力先]   既定: dist/kokohore-wanwan.html
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFile(path.join(here, 'public', f), 'utf8');
const out = path.resolve(process.argv[2] || path.join(here, 'dist', 'kokohore-wanwan.html'));

const [html, css, sim, client] = await Promise.all([read('index.html'), read('style.css'), read('sim.js'), read('client.js')]);
const body = html.match(/<!--BODY-->([\s\S]*)<!--\/BODY-->/)[1];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const simBody = sim.replace(/^export \{([^}]+)\};?\s*$/m, 'return {$1};');
const clientBody = client.replace(/^import \* as Sim from '\.\/sim\.js';\s*$/m, '');
if (simBody === sim || clientBody === client) throw new Error('import/export の書き方が変わったので build-single.mjs を直してください');

const page = `<title>ここほれワンワン</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}</style>
${body}
<script>
const Sim = (() => {
${simBody}
})();
(() => {
${clientBody}
})();
</script>
`;
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`${out} (${(page.length / 1024).toFixed(1)} KB)`);
