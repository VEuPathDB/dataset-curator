import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const { sharedFiles } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const shared = new Set(Object.entries(sharedFiles).flatMap(([file, skills]) => skills.map((s) => `skills/${s}/${file}`)));

const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const files = readdirSync(join(ROOT, 'skills')).flatMap((skill) => ['scripts', 'resources'].flatMap((d) => (existsSync(join(ROOT, 'skills', skill, d)) ? walk(`skills/${skill}/${d}`) : [])));

const generated = (paths) => {
  const out = execFileSync('git', ['check-attr', '--stdin', 'linguist-generated'], { cwd: ROOT, input: paths.join('\n'), encoding: 'utf-8' });
  return new Map(out.trim().split('\n').map((l) => { const [, path, value] = /^(.*): linguist-generated: (.*)$/.exec(l); return [path, value === 'true']; }));
};

test('.gitattributes marks exactly the files sharedFiles copies as generated', () => {
  const marked = generated(files);
  assert.deepEqual(files.filter((f) => shared.has(f) !== marked.get(f)), []);
});
