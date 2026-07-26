/**
 * Single place where "does this model support X" is decided.
 *
 * Previously each capability was an ad-hoc `model.includes('opus-4-6')` check scattered
 * across the codebase, which meant every new model was silently treated as legacy and
 * downgraded. Rules here are expressed as a version floor plus explicit exceptions, so
 * a newer model inherits the capability instead of losing it.
 *
 * Note the deliberate asymmetry: capabilities that only degrade quality when wrongly
 * denied (effort, adaptive thinking) leave `families` open so genuinely new model
 * families are covered, while capabilities that would error or weaken a safety control
 * stay pinned to the families they were validated on.
 */
import { isEnvTruthy } from '../envUtils.js'
import { isClaudeVersionAtLeast, parseModelVersion } from './modelVersion.js'
import {
  get3PModelCapabilityOverride,
  type ModelCapabilityOverride,
} from './modelSupportOverrides.js'
import { getAPIProvider, type APIProvider } from './providers.js'

export type CapabilityName =
  | 'effort'
  | 'adaptiveThinking'
  | 'structuredOutputs'
  | 'autoMode'
  | 'advisor'
  | 'fastMode'

type CapabilityRule = {
  /** Lowest `[major, minor]` Claude version known to support this capability. */
  minVersion: readonly [major: number, minor: number]
  /** When set, only these model families qualify. Omit to accept any Claude family. */
  families?: readonly string[]
  /** When set, the capability is unavailable on any other API provider. */
  providers?: readonly APIProvider[]
  /**
   * Providers on which an unparseable model string is given the benefit of the doubt.
   * Third-party providers mangle model IDs, so defaulting them to "supported" caused a
   * real regression before (anthropics/claude-code#30795) — keep this to proxies whose
   * strings we control.
   */
  unknownModelProviders?: readonly APIProvider[]
  /** Key for the ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES escape hatch. */
  override?: ModelCapabilityOverride
  /** Env var that force-enables the capability regardless of model. */
  alwaysEnableEnvVar?: string
  /** Ant-internal models are unversioned; treat them as supported. */
  supportedForAnts?: boolean
}

const CAPABILITY_RULES: Record<CapabilityName, CapabilityRule> = {
  // Family-open: denying effort on a capable model measurably degrades output, and
  // research owns this default. See the warning in getDefaultEffortForModel.
  effort: {
    minVersion: [4, 6],
    unknownModelProviders: ['firstParty'],
    override: 'effort',
    alwaysEnableEnvVar: 'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  },
  // Family-open for the same reason as effort: newer models are trained on adaptive
  // thinking and MUST have it on, or we silently ship worse output.
  adaptiveThinking: {
    minVersion: [4, 6],
    unknownModelProviders: ['firstParty', 'foundry'],
    override: 'adaptive_thinking',
  },
  // 4.1 floor covers opus-4-1/4-5/4-6, sonnet-4-5/4-6 and haiku-4-5 while excluding the
  // 4.0 generation. Unknown strings stay unsupported: sending the beta to a model that
  // lacks it is an API error, not a quality regression.
  structuredOutputs: {
    minVersion: [4, 1],
    providers: ['firstParty', 'foundry'],
  },
  // Safety probes are only wired for opus/sonnet on the first-party API.
  autoMode: {
    minVersion: [4, 6],
    families: ['opus', 'sonnet'],
    providers: ['firstParty'],
  },
  advisor: {
    minVersion: [4, 6],
    families: ['opus', 'sonnet'],
    supportedForAnts: true,
  },
  fastMode: {
    minVersion: [4, 6],
    families: ['opus'],
  },
}

export function modelHasCapability(
  model: string,
  capability: CapabilityName,
): boolean {
  const rule = CAPABILITY_RULES[capability]

  if (rule.alwaysEnableEnvVar && isEnvTruthy(process.env[rule.alwaysEnableEnvVar])) {
    return true
  }

  if (rule.override) {
    const override = get3PModelCapabilityOverride(model, rule.override)
    if (override !== undefined) {
      return override
    }
  }

  if (rule.supportedForAnts && process.env.USER_TYPE === 'ant') {
    return true
  }

  const provider = getAPIProvider()
  if (rule.providers && !rule.providers.includes(provider)) {
    return false
  }

  const parsed = parseModelVersion(model)
  if (!parsed.isClaude) {
    return rule.unknownModelProviders?.includes(provider) ?? false
  }

  if (rule.families && (!parsed.family || !rule.families.includes(parsed.family))) {
    return false
  }

  return isClaudeVersionAtLeast(model, rule.minVersion[0], rule.minVersion[1])
}
