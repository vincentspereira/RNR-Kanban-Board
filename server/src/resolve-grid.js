/**
 * "Resolve Grid" (B2): summon every stalled/amber agent into a balanced
 * Windows Terminal pane grid via wt.exe split-pane scripting (spec §Advanced
 * Terminal Automation), or WezTerm-class flows on other platforms.
 *
 * WSL consideration: agent cwds are Linux paths; wt.exe is a Windows binary,
 * so we translate them to \\wsl.localhost\<distro>\... UNC paths using the
 * WSL_DISTRO_NAME environment variable provided by interop.
 */
import { execFile } from 'node:child_process';
import os from 'node:os';

const MAX_PANES = 4;

export function toWindowsPath(p) {
  if (
    typeof p === 'string' &&
    p.startsWith('/') &&
    process.env.WSL_DISTRO_NAME
  ) {
    return `\\\\wsl.localhost\\${process.env.WSL_DISTRO_NAME}${p}`;
  }
  return p;
}

/** Build the wt.exe argv replicating the spec's balanced 2x2 grid recipe. */
export function buildWtArgs(dirs) {
  if (dirs.length === 0) throw new Error('No directories to open');
  const args = ['-d', dirs[0], 'pwsh'];
  if (dirs.length > 1) args.push(';', 'split-pane', '-H', '-d', dirs[1], 'pwsh');
  if (dirs.length > 2) {
    args.push(';', 'move-focus', 'left', ';', 'split-pane', '-V', '-d', dirs[2], 'pwsh');
  }
  if (dirs.length > 3) {
    args.push(';', 'move-focus', 'right', ';', 'split-pane', '-V', '-d', dirs[3], 'pwsh');
  }
  return args;
}

/**
 * Open a native terminal grid for up to MAX_PANES sessions that need input.
 * Resolves with a summary string; rejects with a user-actionable message.
 */
export function openResolveGrid(cards) {
  const dirs = cards
    .filter((c) => c.cwd && typeof c.cwd === 'string')
    .map((c) => toWindowsPath(c.cwd))
    .slice(0, MAX_PANES);

  if (dirs.length === 0) {
    return Promise.reject(
      new Error('None of the attention-needing sessions have a known directory'),
    );
  }

  const isWindowsHost = os.platform() === 'win32' || process.env.WSL_DISTRO_NAME;
  if (!isWindowsHost) {
    return Promise.reject(
      new Error('Resolve Grid requires Windows Terminal (wt.exe); not available on this host'),
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      'wt.exe',
      buildWtArgs(dirs),
      { timeout: 15_000, windowsHide: true },
      (err) => {
        if (err) {
          reject(
            new Error(
              'Failed to launch wt.exe — is Windows Terminal installed and on PATH?',
            ),
          );
          return;
        }
        resolve(`Opened ${dirs.length}-pane grid: ${dirs.join(', ')}`);
      },
    );
  });
}
