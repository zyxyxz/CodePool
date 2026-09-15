import { readFileSync, writeFileSync } from 'node:fs';

// Detached HEAD and loose/packed branch refs, without copying Git history.
let commit = readFileSync('.git/HEAD', 'utf8').trim();
if (commit.startsWith('ref: ')) {
  const ref = commit.slice(5);
  if (!/^refs\/[a-zA-Z0-9_./-]+$/.test(ref) || ref.includes('..')) throw new Error('Invalid build ref');
  try { commit = readFileSync(`.git/${ref}`, 'utf8').trim(); }
  catch {
    commit = readFileSync('.git/packed-refs', 'utf8').split('\n').find((line) => line.endsWith(` ${ref}`))?.split(' ')[0] || '';
  }
}
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Cannot identify build commit');
writeFileSync('codepool-build.json', JSON.stringify({ commit }));
