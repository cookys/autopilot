// mods/viewer/model.ts — pure helpers of the viewer mod (the `show` tool). No `$` in here: every file read, every git run and every UI call stays in register.ts.
//
// The contract this file protects: what the MODEL is told is one short line (`summaryOf`, `errorOf`) built from the path, the line numbers and the counts — never from the
// file's text. The text goes only to the owner's screen.

export type ShowInput = {
  path?: unknown
  start?: unknown
  end?: unknown
  diff?: unknown
}

export type ShowRequest =
  | { kind: 'path'; path: string; start: number | null; end: number | null; tail?: boolean } // tail: from the last TAIL_LINES lines (a log's end)
  | { kind: 'diff'; args: string[] }

export type Parsed = { ok: true; req: ShowRequest } | { ok: false; why: string }

export const TAIL_LINES = 40
export const CONTEXT_BEFORE = 2 // a window opened for a pressed `path:line` starts this many lines above it
export const startAbove = (line: number): number => Math.max(1, line - CONTEXT_BEFORE)
export const MAX_FILE_BYTES = 4 * 1024 * 1024 // $.fs.read's cap: a bigger file is refused with its reason
export const WINDOW_CHARS = 80_000 // one drawing holds 100000 characters of Code in all; keep room for the header and footer lines
export const WINDOW_LINES = 2000 // a part never holds more lines than this, so a minified one-line-per-megabyte file cannot starve the window
export const DIFF_CHUNK_CHARS = 9_500 // Code format:'diff' takes 10000 characters of source; a hunk cut in the middle does not parse
export const DIFF_TOTAL_CHARS = 80_000

const GIT_DENIED = /^(--output(=|$)|--ext-diff$|--textconv$|--open-files-in-pager(=|$)|-O|--no-index$|--exit-code$)/
const hasControl = (s: string): boolean => /[\0\r\n]/.test(s)

const asLine = (v: unknown): number | null | undefined => (v === undefined || v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined)

// The tool takes exactly one of: a file `path` (optional `start` / `end` line, 1-based, inclusive) or a git `diff` (the arguments after `git diff`, one string per argument).
// A string `diff` is split on whitespace (no quoting: an argument with a space must come as an array).
export function parseShowInput(input: ShowInput): Parsed {
  const hasPath = input.path !== undefined && input.path !== null
  const hasDiff = input.diff !== undefined && input.diff !== null
  if (hasPath === hasDiff) return { ok: false, why: 'give exactly one of path or diff' }
  if (hasPath) {
    if (typeof input.path !== 'string' || input.path.trim() === '' || hasControl(input.path)) return { ok: false, why: 'path must be a non-empty single-line string' }
    const start = asLine(input.start)
    const end = asLine(input.end)
    if (start === undefined || end === undefined) return { ok: false, why: 'start and end must be whole numbers from 1' }
    if (start !== null && end !== null && end < start) return { ok: false, why: 'end is before start' }
    return { ok: true, req: { kind: 'path', path: input.path, start, end } }
  }
  if (input.start !== undefined || input.end !== undefined) return { ok: false, why: 'start and end go with path, not diff' }
  const raw = input.diff
  const args = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s+/).filter(x => x !== '') : null
  if (args === null || args.length > 40) return { ok: false, why: 'diff must be a list of git diff arguments (at most 40)' }
  const out: string[] = []
  let afterDashes = false
  for (const a of args) {
    if (typeof a !== 'string' || hasControl(a)) return { ok: false, why: 'diff arguments must be single-line strings' }
    if (!afterDashes && a === '--') afterDashes = true
    else if (!afterDashes && GIT_DENIED.test(a)) return { ok: false, why: 'git diff option ' + a + ' is not allowed here' }
    out.push(a)
  }
  return { ok: true, req: { kind: 'diff', args: out } }
}

// the argument vector for the diff run: fixed options first, then the model's arguments (never through a shell)
export const gitDiffArgv = (args: readonly string[]): string[] => ['git', '--no-pager', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', ...args]

// ---- file view ----

export type FileView = {
  path: string
  total: number // lines in the file
  first: number // 1-based first line shown
  last: number // 1-based last line shown
  source: string // the text of lines first..last (joined with \n)
  partial: boolean // true when the part shown is not the whole file
}

export const splitLines = (text: string): string[] => {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop() // a trailing newline does not start another line
  return lines.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l))
}

// The window of the file the pane draws: the requested lines (whole file when none are given), cut to WINDOW_LINES lines and WINDOW_CHARS characters from the first line.
// `from` is where the window starts (1-based); a request past the end is clamped to the last line. Returns null for an empty file.
export function fileView(path: string, text: string, from: number | null, to: number | null): FileView | null {
  const lines = splitLines(text)
  const total = lines.length
  if (total === 0 || (total === 1 && lines[0] === '')) return null
  const first = Math.min(Math.max(from ?? 1, 1), total)
  const wantLast = Math.min(to ?? total, total)
  let last = first - 1
  let chars = 0
  while (last < wantLast && last - first + 1 < WINDOW_LINES) {
    const next = lines[last].length + 1
    if (chars + next > WINDOW_CHARS && last >= first) break
    chars += next
    last += 1
  }
  if (last < first) last = first // a single line over the window still shows (its start)
  const slice = lines.slice(first - 1, last)
  const source = slice.map(l => (l.length > WINDOW_CHARS ? l.slice(0, WINDOW_CHARS) : l)).join('\n')
  return { path, total, first, last, source, partial: first > 1 || last < total }
}

// the window before / after this one, as start lines (null at the file's edge); a part is as long as the file view cut it
export const nextStart = (v: FileView): number | null => (v.last < v.total ? v.last + 1 : null)
export const prevStart = (v: FileView, partLines: number): number | null => (v.first > 1 ? Math.max(1, v.first - Math.max(partLines, 1)) : null)

// ---- diff view ----

export type DiffSection = { file: string; chunks: string[]; cut: boolean }
export type DiffView = { sections: DiffSection[]; files: number; hunks: number; shownChars: number; truncated: boolean }

const FILE_HEAD = /^diff --git a\/(.+?) b\/(.+)$/

// Split `git diff` output into sections per file, each section into chunks of whole hunks that fit Code's 10000-character limit.
// A hunk bigger than a chunk stands alone as its own chunk (the pane draws it as plain text, the engine's rule for a source that does not parse).
export function diffView(stdout: string): DiffView {
  const lines = stdout.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const sections: DiffSection[] = []
  let cur: { file: string; hunks: string[][] } | null = null
  let hunk: string[] | null = null
  const flushHunk = () => { if (cur !== null && hunk !== null && hunk.length > 0) cur.hunks.push(hunk); hunk = null }
  const flushFile = () => {
    flushHunk()
    if (cur !== null) sections.push({ file: cur.file, chunks: chunkHunks(cur.hunks), cut: false })
    cur = null
  }
  for (const line of lines) {
    const head = FILE_HEAD.exec(line)
    if (head !== null) {
      flushFile()
      cur = { file: head[2], hunks: [] }
      continue
    }
    if (cur === null) continue
    if (line.startsWith('@@')) { flushHunk(); hunk = [line]; continue }
    if (hunk !== null) hunk.push(line)
  }
  flushFile()
  let hunks = 0
  let shown = 0
  let truncated = false
  const kept: DiffSection[] = []
  for (const s of sections) {
    const chunks: string[] = []
    let cut = false
    for (const c of s.chunks) {
      if (shown + c.length > DIFF_TOTAL_CHARS) { cut = true; truncated = true; break }
      shown += c.length
      hunks += c.split('\n').filter(l => l.startsWith('@@')).length
      chunks.push(c)
    }
    if (chunks.length > 0 || cut) kept.push({ file: s.file, chunks, cut })
    if (truncated) break
  }
  return { sections: kept, files: sections.length, hunks, shownChars: shown, truncated }
}

function chunkHunks(hunks: string[][]): string[] {
  const out: string[] = []
  let cur = ''
  for (const h of hunks) {
    const text = h.join('\n')
    if (cur !== '' && cur.length + 1 + text.length > DIFF_CHUNK_CHARS) { out.push(cur); cur = '' }
    cur = cur === '' ? text : cur + '\n' + text
  }
  if (cur !== '') out.push(cur)
  return out
}

// ---- what the model reads ----

export const summaryOfFile = (v: FileView): string =>
  `Shown to the user: ${v.path} lines ${v.first}-${v.last} of ${v.total}. The content was not returned to you; read the file if you need to analyze it.`

export const summaryOfDiff = (args: readonly string[], d: DiffView): string =>
  `Shown to the user: git diff ${args.join(' ')} (${d.files} file${d.files === 1 ? '' : 's'}, ${d.hunks} hunk${d.hunks === 1 ? '' : 's'}${d.truncated ? ', cut for size' : ''}). The content was not returned to you; run the diff yourself if you need to analyze it.`

export const summaryOfEmpty = (what: string): string => `Shown to the user: ${what} is empty. Nothing was returned to you.`

// an error line names the cause only; the file's text never enters it
export const errorOf = (why: string): string => `show failed: ${why}`
