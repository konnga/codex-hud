import type { SessionInfo } from '../types/state.js'
// @env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'smol-toml'
import { getCodexHome } from '../config/paths.js'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * The `ModelProviderInfo` entry Codex resolved for a session.
 *
 * Codex accepts an inference credential in several places. `OPENAI_API_KEY`
 * and `auth.json` cover the built-in OpenAI provider, but a custom provider
 * can instead carry an inline `experimental_bearer_token` (the shape CC Switch
 * writes) or name an `env_key` it reads at request time. Both leave no trace in
 * `auth.json`, so a HUD that only inspects that file sees such a session as
 * unauthenticated.
 */
export interface ActiveProviderConfig {
  /** The provider Codex resolved, from the session or from `model_provider`. */
  name: string
  baseUrl: string | null
  /** An inline `experimental_bearer_token`, already trimmed. */
  inlineToken: string | null
  /** The variable named by `env_key`, which holds the credential when Codex reads it from the environment. */
  envKey: string | null
}

/**
 * config.toml is only evidence about a session while it has not been rewritten
 * since that session started. A newer file may describe a provider the user
 * switched to afterwards, and before a session is bound there is nothing to
 * attribute the file to — that window is exactly Codex's startup, when a
 * provider the user just switched away from is still the newest thing on disk.
 */
export function readActiveProviderConfig(
  session: SessionInfo | null,
  env: NodeJS.ProcessEnv = process.env,
): ActiveProviderConfig | null {
  if (!session) {
    return null
  }
  try {
    const configPath = path.join(getCodexHome(env), 'config.toml')
    if (fs.statSync(configPath).mtimeMs > session.startTime.getTime()) {
      return null
    }
    const config = record(parse(fs.readFileSync(configPath, 'utf8')))
    const name = session.modelProvider
      ?? nonEmptyString(config?.model_provider)
    if (!name) {
      return null
    }
    const provider = record(record(config?.model_providers)?.[name])
    if (!provider) {
      // The built-in OpenAI provider has no `model_providers` entry of its own.
      return name.toLowerCase() === 'openai'
        ? { name, baseUrl: null, inlineToken: null, envKey: null }
        : null
    }
    return {
      name,
      baseUrl: nonEmptyString(provider.base_url),
      inlineToken: nonEmptyString(provider.experimental_bearer_token),
      envKey: nonEmptyString(provider.env_key),
    }
  }
  catch {
    return null
  }
}

/**
 * The credential a resolved provider authenticates with, when it does not come
 * from `OPENAI_API_KEY` or `auth.json`. Never returned for rendering: callers
 * use it to reach the relay the session already talks to, and a query stores it
 * only as a hash when it needs a cache key.
 */
export function providerCredential(
  provider: ActiveProviderConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!provider) {
    return null
  }
  if (provider.inlineToken) {
    return provider.inlineToken
  }
  if (provider.envKey) {
    return nonEmptyString(env[provider.envKey])
  }
  return null
}

/** `providerCredential` for a session, resolving the provider from `config.toml` first. */
export function configuredProviderCredential(
  session: SessionInfo | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return providerCredential(readActiveProviderConfig(session, env), env)
}
