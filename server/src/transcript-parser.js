/**
 * Parser for Claude Code append-only JSONL session transcripts.
 *
 * Transcripts live at: <claudeDir>/projects/<munged-project-path>/<session-uuid>.jsonl
 * The directory name is the project path with "/" replaced by "-".
 *
 * All parsing is defensive: transcript files contain model/tool output (i.e.
 * semi-trusted content), so every line is independently wrapped in try/catch,
 * sizes are capped, and no field is trusted for anything beyond display or
 * opaque identifiers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Safely parse a single JSONL line; returns null on any failure. */
function parseLine(line) {
  if (!line || line.length > 1024 * 1024) return null; // absurd lines are skipped
  try {
    const obj = JSON.parse(line);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/** Extract a human title from an entry's message content. */
function extractText(entry) {
  try {
    const msg = entry?.message;
    if (!msg) return null;
    const content = msg.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'text' && typeof part.text === 'string') return part.text;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Read a bounded slice of a file (bounded memory regardless of file size).
 */
function readSlice(filePath, maxBytes, fromStart = false) {
  let fh;
  try {
    fh = fs.openSync(filePath, 'r');
    const { size } = fs.fstatSync(fh);
    const start = fromStart ? 0 : Math.max(0, size - maxBytes);
    const length = Math.min(size - start, maxBytes);
    const buf = Buffer.alloc(length);
    fs.readSync(fh, buf, 0, length, start);
    return buf.toString('utf8');
  } finally {
    try {
      fh?.close();
    } catch {
      /* ignore */
    }
  }
}

const readTail = (filePath, maxBytes) => readSlice(filePath, maxBytes, false);

/** Scan raw JSONL text accumulating stats. Returns aggregate info. */
function scanEntries(text) {
  let firstUserText = null;
  let toolUseCount = 0;
  let totalTokens = 0;
  let lastEventType = null;
  let lastTimestamp = null;
  let cwd = null;
  let gitBranch = null;

  for (const rawLine of text.split('\n')) {
    const entry = parseLine(rawLine);
    if (!entry) continue;

    lastEventType = typeof entry.type === 'string' ? entry.type : lastEventType;
    if (typeof entry.timestamp === 'string') lastTimestamp = entry.timestamp;
    if (typeof entry.cwd === 'string' && !cwd) cwd = entry.cwd;
    if (typeof entry.gitBranch === 'string') gitBranch = entry.gitBranch;

    if (entry.type === 'user' && firstUserText === null) {
      const text = extractText(entry);
      if (text) firstUserText = text;
    }

    if (entry.type === 'assistant') {
      if (Array.isArray(entry.message?.content)) {
        for (const part of entry.message.content) {
          if (part?.type === 'tool_use') toolUseCount += 1;
        }
      }
      const usage = entry.message?.usage;
      if (usage && typeof usage === 'object') {
        // Input+output only; cache-read counters excluded deliberately so the
        // figure stays a rough magnitude rather than an inflated total.
        const inp = Number(usage.input_tokens) || 0;
        const out = Number(usage.output_tokens) || 0;
        totalTokens += inp + out;
      }
    }
  }

  return { firstUserText, toolUseCount, totalTokens, lastEventType, lastTimestamp, cwd, gitBranch };
}

/** Summarize one transcript file into a card-shaped record. */
export function summarizeTranscript(filePath, mungedProjectDir) {
  const base = path.basename(filePath);
  if (!base.endsWith('.jsonl')) return null;
  const sessionId = base.slice(0, -'.jsonl'.length);
  if (!UUID_RE.test(sessionId)) return null;

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  // Project path is the munged dir name; unmunge conservatively for display.
  const project = mungedProjectDir.replaceAll('-', '/').trim() || 'unknown';

  // Titles come from the FIRST user message, which lives at the head of the
  // file; activity/tool/token stats come from the tail. For small files the
  // two windows overlap, so we deduplicate by reading a single slice.
  const headText =
    stat.size > CONFIG.transcriptTailBytes
      ? readSlice(filePath, CONFIG.transcriptHeadBytes, true)
      : null;
  const tailText = readTail(filePath, CONFIG.transcriptTailBytes);

  const head = headText ? scanEntries(headText) : null;
  const tail = scanEntries(tailText);

  const firstUserText = head?.firstUserText ?? tail.firstUserText;
  const title = firstUserText
    ? firstUserText.replace(/\s+/g, ' ').slice(0, 120)
    : `Session ${sessionId.slice(0, 8)}`;

  return {
    id: sessionId,
    title,
    project,
    cwd: tail.cwd,
    gitBranch: tail.gitBranch,
    transcriptPath: filePath,
    startedAt: stat.birthtimeMs,
    fileModifiedAt: stat.mtimeMs,
    lastTimestamp: tail.lastTimestamp,
    lastEventType: tail.lastEventType,
    toolUseCount: tail.toolUseCount,
    totalTokens: tail.totalTokens,
    sizeBytes: stat.size,
  };
}

/** Scan all project directories and summarize every session transcript. */
export function discoverTranscriptSessions() {
  const projectsDir = path.join(CONFIG.claudeDir, 'projects');
  const results = [];
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return results; // no ~/.claude/projects yet
  }

  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const dirPath = path.join(projectsDir, dirent.name);
    let files;
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      try {
        const summary = summarizeTranscript(path.join(dirPath, file), dirent.name);
        if (summary) results.push(summary);
      } catch {
        /* never let one bad transcript kill the scan */
      }
    }
  }

  results.sort((a, b) => b.fileModifiedAt - a.fileModifiedAt);
  return results;
}
