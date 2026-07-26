import { afterEach, describe, expect, test } from 'bun:test'
import { modelHasCapability } from './capabilities.js'

const MANAGED_ENV = [
  'USER_TYPE',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
] as const

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

describe('modelHasCapability', () => {
  // The bug that motivated this module: a model released after the hardcoded
  // `includes('opus-4-6')` checks were written was treated as legacy and silently
  // downgraded. Both a newer version and an unseen family must inherit the capability.
  test.each(['claude-opus-5', 'claude-fable-5', 'claude-sonnet-7'])(
    '%s inherits effort and adaptive thinking',
    model => {
      expect(modelHasCapability(model, 'effort')).toBe(true)
      expect(modelHasCapability(model, 'adaptiveThinking')).toBe(true)
    },
  )

  test.each([
    ['claude-opus-4-6', true],
    ['claude-sonnet-4-6', true],
    ['claude-opus-5', true],
    ['claude-opus-4-5-20251101', false],
    ['claude-3-5-sonnet-20241022', false],
  ])('effort on %s is %p', (model, expected) => {
    expect(modelHasCapability(model, 'effort')).toBe(expected)
  })

  test.each([
    ['claude-opus-4-6', true],
    ['claude-opus-4-1-20250805', true],
    ['claude-haiku-4-5-20251001', true],
    ['claude-opus-4-20250514', false],
    ['claude-3-7-sonnet-20250219', false],
  ])('structured outputs on %s is %p', (model, expected) => {
    expect(modelHasCapability(model, 'structuredOutputs')).toBe(expected)
  })

  describe('family gates', () => {
    // fastMode and autoMode are pinned to the families they were validated on, unlike
    // effort — enabling them on an unvalidated family errors or weakens a control.
    test('fast mode is opus-only', () => {
      expect(modelHasCapability('claude-opus-4-6', 'fastMode')).toBe(true)
      expect(modelHasCapability('claude-opus-5', 'fastMode')).toBe(true)
      expect(modelHasCapability('claude-sonnet-4-6', 'fastMode')).toBe(false)
      expect(modelHasCapability('claude-fable-5', 'fastMode')).toBe(false)
    })

    test('auto mode and advisor are opus/sonnet only', () => {
      for (const capability of ['autoMode', 'advisor'] as const) {
        expect(modelHasCapability('claude-opus-4-6', capability)).toBe(true)
        expect(modelHasCapability('claude-sonnet-4-6', capability)).toBe(true)
        expect(modelHasCapability('claude-haiku-4-5-20251001', capability)).toBe(
          false,
        )
        expect(modelHasCapability('claude-fable-5', capability)).toBe(false)
      }
    })
  })

  describe('provider gates', () => {
    test('unknown model strings are trusted on first party only', () => {
      expect(modelHasCapability('my-proxy-model', 'effort')).toBe(true)

      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      // anthropics/claude-code#30795: third-party providers hand us mangled IDs, and
      // assuming support for them is what broke real users.
      expect(modelHasCapability('my-proxy-model', 'effort')).toBe(false)
      expect(modelHasCapability('my-proxy-model', 'adaptiveThinking')).toBe(
        false,
      )
    })

    test('foundry gets adaptive thinking for unknown models, bedrock does not', () => {
      process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
      expect(modelHasCapability('my-proxy-model', 'adaptiveThinking')).toBe(true)
    })

    test('structured outputs and auto mode are unavailable off first party', () => {
      process.env.CLAUDE_CODE_USE_VERTEX = '1'
      expect(modelHasCapability('claude-opus-4-6', 'structuredOutputs')).toBe(
        false,
      )
      expect(modelHasCapability('claude-opus-4-6', 'autoMode')).toBe(false)
      // foundry is explicitly allowed for structured outputs.
      delete process.env.CLAUDE_CODE_USE_VERTEX
      process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
      expect(modelHasCapability('claude-opus-4-6', 'structuredOutputs')).toBe(
        true,
      )
    })

    test('a version-gated capability still applies on third-party providers', () => {
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      expect(
        modelHasCapability('us.anthropic.claude-opus-4-6-v1:0', 'effort'),
      ).toBe(true)
      expect(
        modelHasCapability('us.anthropic.claude-opus-4-20250514-v1:0', 'effort'),
      ).toBe(false)
    })
  })

  describe('escape hatches', () => {
    test('CLAUDE_CODE_ALWAYS_ENABLE_EFFORT overrides the version floor', () => {
      expect(modelHasCapability('claude-3-5-sonnet-20241022', 'effort')).toBe(
        false,
      )
      process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT = '1'
      expect(modelHasCapability('claude-3-5-sonnet-20241022', 'effort')).toBe(
        true,
      )
    })

    test('ants get the advisor on unversioned internal models', () => {
      expect(modelHasCapability('some-internal-model', 'advisor')).toBe(false)
      process.env.USER_TYPE = 'ant'
      expect(modelHasCapability('some-internal-model', 'advisor')).toBe(true)
    })
  })
})
