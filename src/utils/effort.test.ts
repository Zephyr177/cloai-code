import { afterEach, describe, expect, test } from 'bun:test'
import {
  convertEffortValueToLevel,
  getEffortLevelDescription,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  parseEffortValue,
  resolveAppliedEffort,
  toPersistableEffort,
} from './effort.js'

const MANAGED_ENV = ['USER_TYPE', 'CLAUDE_CODE_EFFORT_LEVEL'] as const

const ORIGINAL_ENV = Object.fromEntries(
  MANAGED_ENV.map(key => [key, process.env[key]]),
)

afterEach(() => {
  for (const key of MANAGED_ENV) {
    const original = ORIGINAL_ENV[key]
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
})

describe('parseEffortValue', () => {
  test.each(['low', 'medium', 'high', 'max'])('accepts the level %p', level => {
    expect(parseEffortValue(level)).toBe(level)
  })

  // The point of the change: this client must not decide which levels exist.
  test.each(['xhigh', 'ultra', 'turbo-2'])(
    'passes the custom level %p through',
    level => {
      expect(parseEffortValue(level)).toBe(level)
    },
  )

  test('normalizes case and surrounding whitespace', () => {
    expect(parseEffortValue('  XHigh ')).toBe('xhigh')
  })

  test.each([undefined, null, '', '   '])('rejects %p', value => {
    expect(parseEffortValue(value)).toBeUndefined()
  })

  test('reads whole-number strings as numeric effort', () => {
    expect(parseEffortValue('70')).toBe(70)
    expect(parseEffortValue(70)).toBe(70)
  })

  // parseInt('4x') is 4, which would have turned a custom level into a numeric override.
  test('does not read a leading digit as numeric effort', () => {
    expect(parseEffortValue('4x')).toBe('4x')
  })

  test('rejects non-integer numbers', () => {
    expect(parseEffortValue(1.5)).toBeUndefined()
  })
})

describe('toPersistableEffort', () => {
  test.each(['low', 'medium', 'high', 'max', 'xhigh'])(
    'persists %p',
    level => {
      expect(toPersistableEffort(level)).toBe(level)
    },
  )

  test('keeps numeric effort session-scoped', () => {
    expect(toPersistableEffort(70)).toBeUndefined()
    expect(toPersistableEffort(undefined)).toBeUndefined()
  })

  test('round-trips a custom level for a non-ant user', () => {
    process.env.USER_TYPE = 'external'
    const parsed = parseEffortValue('xhigh')
    expect(toPersistableEffort(parsed)).toBe('xhigh')
  })

  test('persists max without requiring an ant user', () => {
    process.env.USER_TYPE = 'external'
    expect(toPersistableEffort('max')).toBe('max')
  })
})

describe('convertEffortValueToLevel', () => {
  test('reports a custom level as itself rather than as high', () => {
    expect(convertEffortValueToLevel('xhigh')).toBe('xhigh')
  })

  test.each(['low', 'medium', 'high', 'max'])('reports %p as itself', level => {
    expect(convertEffortValueToLevel(level)).toBe(level)
  })
})

describe('getEffortLevelDescription', () => {
  test('describes the built-in levels', () => {
    expect(getEffortLevelDescription('low')).toContain('Quick')
    expect(getEffortLevelDescription('max')).toContain('Maximum')
  })

  test('marks a custom level as passed through', () => {
    expect(getEffortLevelDescription('xhigh')).toBe(
      'Custom effort level "xhigh" (passed through to the API)',
    )
  })
})

describe('resolveAppliedEffort', () => {
  test('no longer downgrades max on models that were not opus-4-6', () => {
    expect(resolveAppliedEffort('claude-sonnet-4-6', 'max')).toBe('max')
    expect(resolveAppliedEffort('claude-opus-5', 'max')).toBe('max')
  })

  test('forwards a custom level unchanged', () => {
    expect(resolveAppliedEffort('claude-opus-4-6', 'xhigh')).toBe('xhigh')
  })

  test('CLAUDE_CODE_EFFORT_LEVEL wins over the session value', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'xhigh'
    expect(resolveAppliedEffort('claude-opus-4-6', 'low')).toBe('xhigh')
  })

  test('CLAUDE_CODE_EFFORT_LEVEL=unset suppresses the parameter', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'unset'
    expect(resolveAppliedEffort('claude-opus-4-6', 'max')).toBeUndefined()
  })
})

describe('max effort gating', () => {
  // max used to be pinned to opus-4-6, so every later model lost it.
  test.each(['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-5'])(
    '%s offers max whenever it offers effort',
    model => {
      expect(modelSupportsMaxEffort(model)).toBe(modelSupportsEffort(model))
      expect(modelSupportsMaxEffort(model)).toBe(true)
    },
  )

  test('a model without effort support does not offer max', () => {
    expect(modelSupportsMaxEffort('claude-3-5-sonnet-20241022')).toBe(false)
  })
})
