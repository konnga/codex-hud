// @env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getCodexHome, getHudStateDirectory } from '../config/paths.js'
import { isCaseInsensitivePath, pathIdentity } from '../runtime/path-identity.js'
import { pruneTimedCache, setTimedCache } from '../runtime/timed-cache.js'

/**
 * Where an endpoint came from. `log-request` is a URL Codex actually posted to;
 * `log-init` is the provider Codex resolved when the session started, looked up
 * by session or, before a session exists, by the Codex process itself.
 */
export type EndpointSource = 'log-request' | 'log-init' | 'persisted'

export interface SessionEndpoint {
  url: string
  source: EndpointSource
}

const SESSION_ID_PATTERN = /^[\w-]{1,128}$/
const LOG_DATABASE_PATTERN = /^logs(?:_(\d+))?\.sqlite$/
const QUERY_TIMEOUT_MS = 750
const PROCESS_SESSION_QUERY_TIMEOUT_MS = 3_000
const ENDPOINT_CACHE_MS = 30_000
const PROCESS_SESSION_CACHE_MS = 1_000
const CACHE_MAX_AGE_MS = 30 * 60_000
const CACHE_MAX_ENTRIES = 256
const STORED_ENDPOINT_MAX_AGE_MS = 30 * 24 * 60 * 60_000
const STORED_ENDPOINT_MAX_ENTRIES = 256
const STORED_ENDPOINT_MAX_BYTES = 4 * 1024
// `ts` stores whole seconds, so several rows routinely share one value; the
// rowid tiebreak keeps "newest" meaning insertion order rather than scan order.
const NEWEST_FIRST = 'ORDER BY ts DESC, id DESC LIMIT 1'

const endpointCache = new Map<string, { at: number, value: SessionEndpoint | null }>()
const processSessionCache = new Map<string, { at: number, value: ProcessSession | null }>()

interface StoredEndpoint {
  version: 1
  origin: string
  evidenceSource: Exclude<EndpointSource, 'persisted'>
  observedAt: string
}

export interface ProcessSession {
  sessionId: string
  rolloutPath: string
}

export interface CodexLogSchemaInspection {
  database: string | null
  columns: string[]
  endpointCompatible: boolean
  rateLimitCompatible: boolean
}

function storedEndpointDirectory(env: NodeJS.ProcessEnv): string {
  return path.join(getHudStateDirectory(env), 'session-endpoints')
}

function storedEndpointPath(sessionId: string, env: NodeJS.ProcessEnv): string {
  return path.join(storedEndpointDirectory(env), `${sessionId}.json`)
}

function readStoredEndpoint(sessionId: string, env: NodeJS.ProcessEnv, now: number): SessionEndpoint | null {
  const filePath = storedEndpointPath(sessionId, env)
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > STORED_ENDPOINT_MAX_BYTES || now - stat.mtimeMs > STORED_ENDPOINT_MAX_AGE_MS) {
      return null
    }
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<StoredEndpoint>
    const observedAt = typeof stored.observedAt === 'string' ? new Date(stored.observedAt) : null
    if (stored.version !== 1
      || typeof stored.origin !== 'string'
      || (stored.evidenceSource !== 'log-request' && stored.evidenceSource !== 'log-init')
      || !observedAt
      || Number.isNaN(observedAt.getTime())
      || now - observedAt.getTime() > STORED_ENDPOINT_MAX_AGE_MS) {
      return null
    }
    const origin = endpointOrigin(stored.origin)
    return origin ? { url: origin, source: 'persisted' } : null
  }
  catch {
    return null
  }
}

function pruneStoredEndpoints(directory: string, now: number): void {
  try {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && SESSION_ID_PATTERN.test(entry.name.replace(/\.json$/, '')))
      .map((entry) => {
        const filePath = path.join(directory, entry.name)
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs }
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
    for (const [index, entry] of entries.entries()) {
      if (index >= STORED_ENDPOINT_MAX_ENTRIES || now - entry.mtimeMs > STORED_ENDPOINT_MAX_AGE_MS) {
        fs.rmSync(entry.filePath, { force: true })
      }
    }
  }
  catch {
    // Endpoint evidence is an optional resilience cache.
  }
}

function writeStoredEndpoint(
  sessionId: string,
  endpoint: SessionEndpoint,
  env: NodeJS.ProcessEnv,
  now: number,
): void {
  if (endpoint.source === 'persisted') {
    return
  }
  const origin = endpointOrigin(endpoint.url)
  if (!origin) {
    return
  }
  const directory = storedEndpointDirectory(env)
  const filePath = storedEndpointPath(sessionId, env)
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const stored: StoredEndpoint = {
      version: 1,
      origin,
      evidenceSource: endpoint.source,
      observedAt: new Date(now).toISOString(),
    }
    fs.writeFileSync(temporaryPath, `${JSON.stringify(stored)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporaryPath, filePath)
    fs.chmodSync(filePath, 0o600)
    pruneStoredEndpoints(directory, now)
  }
  catch {
    try {
      fs.rmSync(temporaryPath, { force: true })
    }
    catch {
      // Endpoint evidence must never break the HUD.
    }
  }
}

export function clearEndpointCaches(): void {
  endpointCache.clear()
  processSessionCache.clear()
}

/**
 * Codex writes its tracing log to `logs_<schema>.sqlite`; pick the newest
 * schema so a Codex upgrade that bumps the suffix keeps working.
 */
export function findCodexLogDatabase(codexHome: string = getCodexHome()): string | null {
  let best: { file: string, version: number } | null = null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(codexHome, { withFileTypes: true })
  }
  catch {
    return null
  }
  for (const entry of entries) {
    const match = LOG_DATABASE_PATTERN.exec(entry.name)
    if (!match || !entry.isFile()) {
      continue
    }
    const version = Number(match[1] ?? 0)
    if (!best || version > best.version) {
      best = { file: path.join(codexHome, entry.name), version }
    }
  }
  return best?.file ?? null
}

const STATE_DATABASE_PATTERN = /^state(?:_(\d+))?\.sqlite$/

/**
 * Codex keeps thread registry state in `state_<schema>.sqlite`; pick the newest
 * schema so a Codex upgrade that bumps the suffix keeps working.
 */
export function findCodexStateDatabase(codexHome: string = getCodexHome()): string | null {
  let best: { file: string, version: number } | null = null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(codexHome, { withFileTypes: true })
  }
  catch {
    return null
  }
  for (const entry of entries) {
    const match = STATE_DATABASE_PATTERN.exec(entry.name)
    if (!match || !entry.isFile()) {
      continue
    }
    const version = Number(match[1] ?? 0)
    if (!best || version > best.version) {
      best = { file: path.join(codexHome, entry.name), version }
    }
  }
  return best?.file ?? null
}

/**
 * Since Codex moved session hosting into a managed app-server daemon
 * (`~/.codex/packages/app-server-daemon`), the TUI process no longer writes
 * thread-bearing tracing rows and no longer holds the rollout file; the daemon
 * process does. Process-owned lookups must fall back to the daemon's own
 * thread registry when they find nothing.
 */
function managedAppServerDaemonInstalled(codexHome: string): boolean {
  try {
    return fs.statSync(path.join(codexHome, 'packages', 'app-server-daemon')).isDirectory()
  }
  catch {
    return false
  }
}

function query(database: string, sql: string, timeout = QUERY_TIMEOUT_MS): string[] {
  const attempt = (readonly: boolean): { status: number | null, lines: string[] } => {
    const result = spawnSync('sqlite3', [
      ...(readonly ? ['-readonly'] : []),
      '-noheader',
      '-batch',
      database,
      sql,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    })
    // sqlite3 aborts on the first failing statement but keeps whatever earlier
    // ones already printed, so a broken fallback query must not discard a good
    // answer from the query before it.
    return {
      status: result.status,
      lines: typeof result.stdout === 'string' ? result.stdout.split('\n') : [],
    }
  }
  const readonly = attempt(true)
  if (readonly.status === 0) {
    return readonly.lines
  }
  // A WAL database left without a live writer has no -shm file, which a
  // read-only connection cannot create and fails on with CANTOPEN. Every HUD
  // statement is a SELECT, so reopening writable never modifies Codex state.
  return attempt(false).lines
}

export function inspectCodexLogSchema(
  codexHome: string = getCodexHome(),
): CodexLogSchemaInspection {
  const database = findCodexLogDatabase(codexHome)
  if (!database) {
    return { database: null, columns: [], endpointCompatible: false, rateLimitCompatible: false }
  }
  const columns = query(database, 'SELECT name FROM pragma_table_info(\'logs\') ORDER BY cid;')
    .map(value => value.trim())
    .filter(Boolean)
  const available = new Set(columns)
  return {
    database,
    columns,
    endpointCompatible: ['id', 'ts', 'process_uuid', 'thread_id', 'target', 'feedback_log_body']
      .every(column => available.has(column)),
    rateLimitCompatible: ['id', 'ts', 'process_uuid', 'target', 'feedback_log_body']
      .every(column => available.has(column)),
  }
}

function firstUrl(value: string): string | null {
  const url = value.trim().split(/[\s"]/)[0]
  return url.startsWith('http') ? url : null
}

export function endpointOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase()
  }
  catch {
    return null
  }
}

/** Only official OpenAI origins are authoritative for Codex subscription limits. */
export function isOfficialOpenAIEndpoint(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'api.openai.com'
      || hostname === 'chatgpt.com'
      || hostname.endsWith('.chatgpt.com')
  }
  catch {
    return false
  }
}

const INIT_ROW = [
  `SELECT 'init|' || substr(feedback_log_body, instr(feedback_log_body, 'base_url: Some("') + 16, 200)`,
  `  FROM logs`,
  ` WHERE thread_id IS NULL`,
  `   AND target = 'codex_core::session::session'`,
  `   AND instr(feedback_log_body, 'base_url: Some("') > 0`,
].join('\n')

/** `process_uuid` is `pid:<PID>:<uuid>`, so a PID is a prefix range on it. */
function processRange(pid: number): string {
  return `(process_uuid >= 'pid:${pid}:' AND process_uuid < 'pid:${pid};')`
}

/**
 * npm wrappers and managed app-server daemons can put the log writer several
 * generations below the launcher. Read one bounded snapshot and follow only
 * descendants; cwd alone cannot distinguish concurrent Codex sessions.
 */
function processFamily(pid: number): number[] {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: QUERY_TIMEOUT_MS,
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return [pid]
  }
  const children = new Map<number, number[]>()
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (!match)
      continue
    const child = Number(match[1])
    const parent = Number(match[2])
    if (!Number.isSafeInteger(child) || child <= 0 || !Number.isSafeInteger(parent))
      continue
    const siblings = children.get(parent) ?? []
    siblings.push(child)
    children.set(parent, siblings)
  }
  const family = new Set([pid])
  for (const parent of family) {
    for (const child of children.get(parent) ?? []) {
      family.add(child)
      // Avoid an oversized SQL predicate on an unexpectedly large process tree.
      if (family.size > 256)
        return [pid]
    }
  }
  return [...family]
}

function shellSql(value: string): string {
  return value.replaceAll('\'', '\'\'')
}

/**
 * Resolve a session from the Codex process that owns it. This is needed before
 * a HUD binding has a rollout path: selecting by cwd at that point can borrow a
 * different concurrent session in the same project.
 */
export function resolveProcessSession(
  codexPid: number,
  cwd: string,
  since: Date,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): ProcessSession | null {
  if (!Number.isInteger(codexPid) || codexPid <= 0) {
    return null
  }
  const codexHome = getCodexHome(env)
  const cacheKey = `${codexHome}:${codexPid}:${pathIdentity(cwd, env)}`
  const cached = processSessionCache.get(cacheKey)
  if (cached && now - cached.at < PROCESS_SESSION_CACHE_MS) {
    return cached.value ? { ...cached.value } : null
  }
  const remember = (value: ProcessSession | null): ProcessSession | null => {
    setTimedCache(processSessionCache, cacheKey, { at: now, value }, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
    return value ? { ...value } : null
  }
  const stateDatabase = findCodexStateDatabase(codexHome)
  if (!stateDatabase) {
    return remember(null)
  }
  const resolvedCwd = path.resolve(cwd)
  const cwdColumn = isCaseInsensitivePath(resolvedCwd, env) ? 'cwd COLLATE NOCASE' : 'cwd'
  const rootThreadFilters = [
    `   AND ${cwdColumn} = '${shellSql(resolvedCwd)}'`,
    '   AND (thread_source = \'user\' OR thread_source IS NULL)',
    '   AND (agent_path IS NULL OR agent_path = \'\')',
  ]
  const selectThread = (conditions: string[], order: string, unique = false): ProcessSession | null => {
    const rows = query(stateDatabase, [
      'SELECT id || \'|\' || rollout_path',
      '  FROM threads',
      ...conditions,
      ` ORDER BY ${order}`,
      unique ? ' LIMIT 2;' : ' LIMIT 1;',
    ].join('\n'), PROCESS_SESSION_QUERY_TIMEOUT_MS)
    if (unique && rows.filter(row => row.includes('|')).length !== 1) {
      return null
    }
    for (const row of rows) {
      const separator = row.indexOf('|')
      if (separator < 0)
        continue
      const sessionId = row.slice(0, separator)
      const rolloutPath = row.slice(separator + 1)
      if (SESSION_ID_PATTERN.test(sessionId) && fs.existsSync(rolloutPath)) {
        return { sessionId, rolloutPath }
      }
    }
    return null
  }
  const database = findCodexLogDatabase(codexHome)
  const ranges = database ? processFamily(codexPid).map(processRange).join(' OR ') : ''
  const ids = ranges
    ? query(database as string, [
        'SELECT DISTINCT thread_id',
        '  FROM logs',
        ' WHERE thread_id IS NOT NULL',
        `   AND ts >= ${Math.floor(since.getTime() / 1_000) - 60}`,
        `   AND (${ranges})`,
        ' ORDER BY ts ASC, id ASC;',
      ].join('\n'), PROCESS_SESSION_QUERY_TIMEOUT_MS).filter(id => SESSION_ID_PATTERN.test(id.trim()))
    : []
  if (ids.length > 0) {
    const candidates = ids.map(id => `'${shellSql(id.trim())}'`).join(',')
    const owned = selectThread([
      ` WHERE id IN (${candidates})`,
      ...rootThreadFilters,
    ], 'created_at_ms ASC, id ASC', true)
    // Process-owned candidates must be unambiguous; do not guess via the daemon fallback.
    return remember(owned)
  }
  // A managed app-server daemon hosts every session in one long-lived process,
  // so TUI logs never carry the thread id and the rollout is daemon-owned too.
  // Identify this launch's session from the daemon's thread registry instead:
  // the first user thread created in this project at or after the launch. The
  // daemon inserts the row when the TUI connects, well before the first
  // message, and the small slack only absorbs launcher-to-pane startup delay.
  if (!managedAppServerDaemonInstalled(codexHome)) {
    return remember(null)
  }
  const createdAfter = Math.max(0, since.getTime() - 5_000)
  const discovered = selectThread([
    ' WHERE archived = 0',
    `   AND COALESCE(created_at_ms, created_at * 1000) >= ${createdAfter}`,
    ...rootThreadFilters,
  ], 'COALESCE(created_at_ms, created_at * 1000) ASC, id ASC')
  return remember(discovered)
}

/**
 * The endpoint of a Codex process that has not created a session yet. Codex
 * writes no rollout until the first message, so between launch and that message
 * the process is the only thing the HUD can key on.
 *
 * `since` bounds the scan to this launch: the timestamp column is the indexed
 * one, and without a bound the lookup walks every threadless row ever logged.
 */
export function resolveProcessEndpoint(
  codexPid: number,
  since: Date,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): SessionEndpoint | null {
  if (!Number.isInteger(codexPid) || codexPid <= 0) {
    return null
  }
  const codexHome = getCodexHome(env)
  const cacheKey = `${codexHome}:pid:${codexPid}`
  const cached = endpointCache.get(cacheKey)
  if (cached && now - cached.at < ENDPOINT_CACHE_MS) {
    return cached.value ? { ...cached.value } : null
  }
  const database = findCodexLogDatabase(codexHome)
  const ranges = database ? processFamily(codexPid).map(processRange).join(' OR ') : ''
  const lines = ranges
    ? query(database as string, [
        INIT_ROW,
        `   AND ts >= ${Math.floor(since.getTime() / 1_000) - 60}`,
        `   AND (${ranges})`,
        ` ${NEWEST_FIRST};`,
      ].join('\n'))
    : []
  let value: SessionEndpoint | null = null
  for (const line of lines) {
    const url = line.startsWith('init|') ? firstUrl(line.slice(5)) : null
    if (url) {
      value = { url, source: 'log-init' }
      break
    }
  }
  // Codex tracing logs are bounded and may evict the process init row while
  // the process is still alive. A missing refresh is not evidence that the
  // already-confirmed endpoint changed.
  value ??= cached?.value ?? null
  sweep(now)
  setTimedCache(endpointCache, cacheKey, { at: now, value }, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
  return value ? { ...value } : null
}

function sweep(now: number): void {
  pruneTimedCache(endpointCache, now, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
  pruneTimedCache(processSessionCache, now, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
}

/**
 * The session id doubles as the tracing `thread_id`, so Codex's own log is the
 * only record of which endpoint a session really used: `config.toml` may have
 * been rewritten since, and the rollout stores just the provider id.
 *
 * Both queries are index-backed. `AND thread_id IS NULL` on the second one is
 * load-bearing for speed, not only correctness: without it the lookup degrades
 * to a full scan of a multi-hundred-megabyte table on the render path.
 */
export function resolveSessionEndpoint(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): SessionEndpoint | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return null
  }
  const codexHome = getCodexHome(env)
  const cacheKey = `${codexHome}:${sessionId}`
  const cached = endpointCache.get(cacheKey)
  if (cached && now - cached.at < ENDPOINT_CACHE_MS) {
    return cached.value ? { ...cached.value } : null
  }
  const remember = (value: SessionEndpoint | null): SessionEndpoint | null => {
    if (value) {
      writeStoredEndpoint(sessionId, value, env, now)
    }
    sweep(now)
    setTimedCache(endpointCache, cacheKey, { at: now, value }, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
    return value ? { ...value } : null
  }
  const database = findCodexLogDatabase(codexHome)
  if (!database) {
    return remember(cached?.value ?? readStoredEndpoint(sessionId, env, now))
  }
  const lines = query(database, [
    `SELECT 'request|' || substr(feedback_log_body, instr(feedback_log_body, 'url=') + 4, 200)`,
    `  FROM logs`,
    ` WHERE thread_id = '${sessionId}'`,
    `   AND target IN ('codex_http_client::default_client', 'codex_http_client::client')`,
    `   AND instr(feedback_log_body, 'url=') > 0`,
    ` ${NEWEST_FIRST};`,
    // One Codex process can host several sessions in turn, each writing its own
    // threadless init row, so bound the fallback to this thread's own lifetime.
    INIT_ROW,
    `   AND process_uuid = (SELECT process_uuid FROM logs WHERE thread_id = '${sessionId}' ${NEWEST_FIRST})`,
    `   AND ts <= (SELECT min(ts) FROM logs WHERE thread_id = '${sessionId}')`,
    ` ${NEWEST_FIRST};`,
  ].join('\n'))
  let fallback: SessionEndpoint | null = null
  for (const line of lines) {
    const separator = line.indexOf('|')
    if (separator < 0) {
      continue
    }
    const tag = line.slice(0, separator)
    const url = firstUrl(line.slice(separator + 1))
    if (!url) {
      continue
    }
    if (tag === 'request') {
      return remember({ url, source: 'log-request' })
    }
    if (tag === 'init' && !fallback) {
      fallback = { url, source: 'log-init' }
    }
  }
  // The log database has bounded retention. Long-running sessions can outlive
  // both their request and init rows, so keep the last confirmed endpoint when
  // a refresh has no newer positive evidence.
  return remember(fallback ?? cached?.value ?? readStoredEndpoint(sessionId, env, now))
}
