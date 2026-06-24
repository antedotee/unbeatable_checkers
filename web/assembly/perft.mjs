// Correctness gate for the WASM engine. Run after `npm run asbuild`:
//   node assembly/perft.mjs   (or: npm run asperft)
// Instantiates public/checkers.wasm and checks perft against the published
// English-draughts numbers. Match => the WASM port plays the real game.
import { readFileSync } from 'node:fs';

const bytes = readFileSync(new URL('../public/checkers.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, { env: { abort() {} } });
const { perft } = instance.exports;

const EXPECTED = { 1: 7, 2: 49, 3: 302, 4: 1469, 5: 7361, 6: 36768, 7: 179740, 8: 845931 };
let ok = true;
for (const [d, exp] of Object.entries(EXPECTED)) {
  const got = perft(+d);
  const pass = got === exp;
  ok = ok && pass;
  console.log(`perft(${d}) = ${got} ${pass ? 'OK' : 'MISMATCH expected ' + exp}`);
}
console.log(ok ? '\nWASM ENGINE VERIFIED ✓' : '\nFAILED');
process.exit(ok ? 0 : 1);
