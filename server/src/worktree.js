/**
 * Git worktree lifecycle actions (B1) — merge a finished agent branch back
 * and prune its worktree.
 *
 * Security notes:
 *  - `git` is invoked via execFile with an ARGV ARRAY only; no shell.
 *  - Branch/ref names are validated against a strict pattern before use.
 *  - Paths come from `git worktree list --porcelain` output (machine-readable)
 *    rather than anything user-typed, and are compared literally.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

const REF_RE = /^[A-Za-z0-9._\-/]{1,120}$/;

function git(args, cwd, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: cwd || undefined, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || err.message).trim().slice(0, 500)));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Parse `git worktree list --porcelain` output into blocks.
 * Each block: { path, head?, bare?, detached? } — first entry is the main one.
 */
export function parseWorktrees(porcelainText) {
  const blocks = [];
  let current = null;
  for (const rawLine of porcelainText.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length) };
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (current && line === 'bare') {
      current.bare = true;
    } else if (current && line === 'detached') {
      current.detached = true;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/** Locate the worktree block matching dirPath (lexically normalized). */
function findWorktreeBlock(blocks, dirPath) {
  const norm = (p) => path.resolve(p);
  const target = norm(dirPath);
  return blocks.find((b) => norm(b.path) === target) ?? null;
}

/**
 * Merge this session's branch into the repo's main worktree.
 * Returns a human-readable result string.
 */
export async function mergeSessionBranch(card) {
  if (!card.cwd || typeof card.cwd !== 'string') {
    throw new Error('Session has no working directory recorded');
  }
  if (!card.gitBranch || !REF_RE.test(card.gitBranch)) {
    throw new Error('Session has no usable branch name');
  }
  if (['main', 'master'].includes(card.gitBranch)) {
    throw new Error('Refusing to merge a primary branch into itself');
  }

  const { stdout } = await git(['worktree', 'list', '--porcelain'], card.cwd);
  const blocks = parseWorktrees(stdout);
  if (blocks.length === 0) throw new Error('No git repository found');

  const main = blocks[0];
  if (!main || main.bare) {
    throw new Error('Cannot determine a non-bare main worktree to merge into');
  }
  // Never merge into the worktree the agent itself was running in.
  if (findWorktreeBlock(blocks, card.cwd) === main) {
    throw new Error(
      'This session ran in the main worktree; nothing to merge. ' +
        'Use git directly or run agents in isolated worktrees.',
    );
  }
  // Ensure the branch still exists before merging.
  await git(['show-ref', '--verify', '--quiet', `refs/heads/${card.gitBranch}`], main.path);

  const { stdout: mergeOut } = await git(['merge', card.gitBranch, '--no-edit'], main.path);
  return `Merged ${card.gitBranch} into ${path.basename(main.path)}:\n${mergeOut.trim().slice(0, 400)}`;
}

/**
 * Remove the worktree this session ran in (Done-card cleanup).
 * Refuses to touch the main worktree or dirty/locked ones without force.
 */
export async function pruneSessionWorktree(card, { force = false } = {}) {
  if (!card.cwd || typeof card.cwd !== 'string') {
    throw new Error('Session has no working directory recorded');
  }

  const { stdout } = await git(['worktree', 'list', '--porcelain'], card.cwd);
  const blocks = parseWorktrees(stdout);
  if (blocks.length <= 1) {
    throw new Error('Only the main worktree exists; nothing to prune');
  }

  const target = findWorktreeBlock(blocks, card.cwd);
  if (!target) throw new Error('Working directory is not a registered worktree');
  if (target === blocks[0]) {
    throw new Error('Refusing to remove the main worktree');
  }

  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(target.path);
  await git(args, card.cwd);

  return { removed: target.path };
}
