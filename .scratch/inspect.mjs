import fs from 'node:fs';
const file = process.argv[2];
const t = fs.readFileSync(file, 'utf8').split('\n');
const from = Number(process.argv[3] ?? 1);
const to = Number(process.argv[4] ?? t.length);
const pat = process.argv[5];
if (pat) {
  const re = new RegExp(pat);
  t.slice(from - 1, to).forEach((l, i) => {
    if (re.test(l)) console.log((from + i) + ': ' + l.trim());
  });
} else {
  console.log(t.slice(from - 1, to).join('\n'));
}
