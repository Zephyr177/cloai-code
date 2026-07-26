import { describe, expect, test } from 'bun:test'
import { CANONICAL_MODEL_IDS } from './configs.js'
import { isClaudeVersionAtLeast, parseModelVersion } from './modelVersion.js'

describe('parseModelVersion', () => {
  test.each([
    ['claude-opus-4-6', 'opus', 4, 6],
    ['claude-sonnet-4-6', 'sonnet', 4, 6],
    ['claude-haiku-4-5-20251001', 'haiku', 4, 5],
    ['claude-sonnet-4-5-20250929', 'sonnet', 4, 5],
    ['claude-opus-4-1-20250805', 'opus', 4, 1],
  ])('%s parses as %s %d.%d', (model, family, major, minor) => {
    expect(parseModelVersion(model)).toEqual({
      family,
      major,
      minor,
      isClaude: true,
    })
  })

  // The regression this module exists to prevent: models newer than the ones hardcoded
  // in capability checks must parse, including families we have never seen before.
  test.each([
    ['claude-opus-5', 'opus', 5],
    ['claude-fable-5', 'fable', 5],
    ['claude-sonnet-7', 'sonnet', 7],
  ])('%s parses as %s %d.0', (model, family, major) => {
    expect(parseModelVersion(model)).toEqual({
      family,
      major,
      minor: 0,
      isClaude: true,
    })
  })

  test.each([
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'us.anthropic.claude-opus-4-20250514-v1:0',
  ])('reads the trailing date in %s as a date, not a minor version', model => {
    const parsed = parseModelVersion(model)
    expect(parsed.major).toBe(4)
    expect(parsed.minor).toBe(0)
  })

  test.each([
    ['us.anthropic.claude-opus-4-6-v1:0', 'opus', 4, 6],
    ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'sonnet', 3, 5],
    ['claude-opus-4-6@20251101', 'opus', 4, 6],
    ['claude-haiku-4-5@20251001', 'haiku', 4, 5],
    ['claude-opus-4-6[1m]', 'opus', 4, 6],
    ['CLAUDE-OPUS-4-6', 'opus', 4, 6],
  ])('strips provider decoration from %s', (model, family, major, minor) => {
    expect(parseModelVersion(model)).toEqual({
      family,
      major,
      minor,
      isClaude: true,
    })
  })

  test.each([
    ['claude-3-5-sonnet-20241022', 'sonnet', 3, 5],
    ['claude-3-7-sonnet-20250219', 'sonnet', 3, 7],
    ['claude-3-5-haiku-20241022', 'haiku', 3, 5],
    ['claude-3-opus-20240229', 'opus', 3, 0],
  ])('handles the 3.x name order in %s', (model, family, major, minor) => {
    expect(parseModelVersion(model)).toEqual({
      family,
      major,
      minor,
      isClaude: true,
    })
  })

  // Third-party providers mangle model IDs. Reporting these as Claude models would let
  // capability rules apply version logic to a string whose version we invented.
  test.each(['gpt-5', 'gemini-2-5-pro', 'my-proxy-model', ''])(
    'reports %p as not-Claude',
    model => {
      expect(parseModelVersion(model)).toEqual({
        family: undefined,
        major: undefined,
        minor: 0,
        isClaude: false,
      })
    },
  )

  test('every registered canonical model ID parses', () => {
    for (const id of CANONICAL_MODEL_IDS) {
      const parsed = parseModelVersion(id)
      expect({ id, ...parsed }).toMatchObject({
        id,
        isClaude: true,
        family: expect.any(String),
        major: expect.any(Number),
      })
    }
  })
})

describe('isClaudeVersionAtLeast', () => {
  test.each([
    ['claude-opus-4-6', true],
    ['claude-opus-5', true],
    ['claude-fable-5', true],
    ['claude-opus-4-5-20251101', false],
    ['claude-opus-4-20250514', false],
    ['claude-3-5-sonnet-20241022', false],
    ['gpt-5', false],
  ])('%s >= 4.6 is %p', (model, expected) => {
    expect(isClaudeVersionAtLeast(model, 4, 6)).toBe(expected)
  })

  test('compares minor versions within the same major', () => {
    expect(isClaudeVersionAtLeast('claude-opus-4-1-20250805', 4, 1)).toBe(true)
    expect(isClaudeVersionAtLeast('claude-opus-4-20250514', 4, 1)).toBe(false)
    expect(isClaudeVersionAtLeast('claude-haiku-4-5-20251001', 4, 1)).toBe(true)
  })
})
