/**
 * Wrapper around the Claude Code CLI for fleet reconciliation.
 *
 * Security note: we ALWAYS exec without a shell using an argv array
 * (execFile) with a fixed argument list — no string interpolation of any
 * external input ever reaches process spawning here.
 */
import { execFile } from 'node:child_process';

let warnedUnavailable = false;

/**
 * Attempt `claude agents --json --all`.
 * Resolves to an array on success, or null when the CLI is unavailable
 * (not installed / non-interactive environment). Never throws.
 */
export function fetchAgentSessions(timeoutMs = 15000) {
  return new Promise((resolve) => {
    // Prefer explicit binary; falls back to PATH lookup.
    const tryRun = (cmd) => {
      execFile(
        cmd,
        ['agents', '--json', '--all'],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            if (!warnedUnavailable) {
              console.warn(
                `[agents-cli] 'claude agents' unavailable via ${cmd}: ${err.message}. ` +
                  'Board will rely on transcript scanning + webhooks.',
              );
              warnedUnavailable = true;
            }
            resolve(null);
            return;
          }
          try {
            const parsed = JSON.parse(stdout);
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch {
            // Some versions may wrap in an object.
            try {
              const obj = JSON.parse(stdout);
              for (const key of ['sessions', 'agents', 'data']) {
                if (Array.isArray(obj?.[key])) {
                  resolve(obj[key]);
                  return;
                }
              }
            } catch {
              /* ignore */
            }
            resolve([]);
          }
        },
      );
    };

    tryRun('claude');
  });
}
