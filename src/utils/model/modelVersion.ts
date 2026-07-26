/**
 * Version parsing for Claude model identifiers.
 *
 * Capability checks used to be written as `model.includes('opus-4-6')`, which silently
 * misclassifies every model released afterwards. Parsing the version out of the model
 * string lets those checks be expressed as "at least 4.6" instead.
 *
 * Deliberately does NOT go through `getCanonicalName()`: its fallback regex
 * (`/(claude-(\d+-\d+-)?\w+)/`) drops the version from unregistered models, turning
 * `claude-opus-5` into `claude-opus`. This module has to work for exactly the models
 * that are not in the registry yet.
 */

/** Families we recognise without a `claude-` prefix, for pinned 3P model strings. */
const BARE_FAMILIES = ['opus', 'sonnet', 'haiku'] as const

/**
 * Modern naming: `claude-<family>-<major>[-<minor>]`.
 *
 * The minor group is capped at two digits and followed by a negative lookahead so a
 * release date is never read as a minor version: `claude-opus-4-20250514` is 4.0, not
 * 4.20250514. Unanchored on purpose so it also matches Bedrock ARNs and Vertex IDs
 * that wrap the name in a prefix/suffix.
 */
const MODERN_PATTERN = /claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/

/** Same shape without the `claude-` prefix, restricted to known families. */
const BARE_PATTERN = new RegExp(
  `(?:^|[^a-z])(${BARE_FAMILIES.join('|')})-(\\d+)(?:-(\\d{1,2})(?!\\d))?`,
)

/** Claude 3.x naming: `claude-<major>[-<minor>]-<family>`. */
const LEGACY_PATTERN = /claude-(\d+)(?:-(\d+))?-([a-z]+)/

export type ParsedModelVersion = {
  /** Family name, e.g. `opus`, `sonnet`, `haiku`, `fable`. Open set by design. */
  family: string | undefined
  major: number | undefined
  /** Defaults to 0 when the model string carries no minor version. */
  minor: number
  /** True when the string is recognisably a Claude model of any version. */
  isClaude: boolean
}

const UNPARSED: ParsedModelVersion = {
  family: undefined,
  major: undefined,
  minor: 0,
  isClaude: false,
}

/**
 * Strip provider-specific decoration so the version patterns see a bare model name.
 * Bedrock appends `-v1:0`, Vertex appends `@<date>`, and the 1M context variants
 * append `[1m]`.
 */
function normalize(model: string): string {
  return model
    .toLowerCase()
    .replace(/\[1m\]/g, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/@[\w-]+$/, '')
}

export function parseModelVersion(model: string): ParsedModelVersion {
  const normalized = normalize(model)

  const modern = MODERN_PATTERN.exec(normalized)
  if (modern) {
    return {
      family: modern[1],
      major: Number(modern[2]),
      minor: modern[3] ? Number(modern[3]) : 0,
      isClaude: true,
    }
  }

  const legacy = LEGACY_PATTERN.exec(normalized)
  if (legacy) {
    return {
      family: legacy[3],
      major: Number(legacy[1]),
      minor: legacy[2] ? Number(legacy[2]) : 0,
      isClaude: true,
    }
  }

  const bare = BARE_PATTERN.exec(normalized)
  if (bare) {
    return {
      family: bare[1],
      major: Number(bare[2]),
      minor: bare[3] ? Number(bare[3]) : 0,
      isClaude: true,
    }
  }

  return UNPARSED
}

/** True when `model` parses to a Claude version greater than or equal to major.minor. */
export function isClaudeVersionAtLeast(
  model: string,
  major: number,
  minor: number,
): boolean {
  const parsed = parseModelVersion(model)
  if (parsed.major === undefined) {
    return false
  }
  return (
    parsed.major > major || (parsed.major === major && parsed.minor >= minor)
  )
}
