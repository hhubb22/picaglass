import { describe, expect, it } from 'vitest'
import {
  findDuplicateProfile,
  isProfileDraftDirty,
  parseProfileDraft,
  profileLabel,
  resolveSelectedProfileId,
  sortProfilesByLabel
} from './profile'

describe('profileLabel', () => {
  it('uses the display name when present', () => {
    expect(
      profileLabel({
        displayName: 'prod db',
        username: 'deploy',
        host: '10.0.4.7',
        port: 22
      })
    ).toBe('prod db')
  })

  it('falls back to username@host on the default port', () => {
    expect(
      profileLabel({
        username: 'deploy',
        host: '10.0.4.7',
        port: 22
      })
    ).toBe('deploy@10.0.4.7')
  })

  it('includes :port only when the port is not 22', () => {
    expect(
      profileLabel({
        username: 'deploy',
        host: '10.0.4.7',
        port: 2222
      })
    ).toBe('deploy@10.0.4.7:2222')
  })

  it('brackets an IPv6 destination on the default port', () => {
    expect(
      profileLabel({
        username: 'deploy',
        host: '2001:db8::1',
        port: 22
      })
    ).toBe('deploy@[2001:db8::1]')
  })

  it('brackets an IPv6 destination and appends a non-default port', () => {
    expect(
      profileLabel({
        username: 'deploy',
        host: '2001:db8::1',
        port: 2222
      })
    ).toBe('deploy@[2001:db8::1]:2222')
  })

  it('treats a blank display name as absent', () => {
    expect(
      profileLabel({
        displayName: '   ',
        username: 'alice',
        host: 'example.test',
        port: 22
      })
    ).toBe('alice@example.test')
  })
})

describe('sortProfilesByLabel', () => {
  it('orders profiles alphabetically by Profile Label', () => {
    const zeta = {
      id: 'z',
      displayName: 'zeta',
      username: 'z',
      host: 'z.test',
      port: 22
    }
    const alpha = {
      id: 'a',
      username: 'alice',
      host: 'alpha.test',
      port: 22
    }
    const prod = {
      id: 'p',
      displayName: 'prod db',
      username: 'deploy',
      host: '10.0.4.7',
      port: 22
    }

    expect(sortProfilesByLabel([zeta, prod, alpha]).map((profile) => profile.id)).toEqual([
      'a',
      'p',
      'z'
    ])
  })
})

describe('parseProfileDraft', () => {
  const valid = {
    host: '10.0.4.7',
    username: 'deploy',
    auth: { method: 'password' as const }
  }

  it('defaults port to 22 and automatic discovery to enabled', () => {
    expect(parseProfileDraft(valid)).toEqual({
      ok: true,
      value: {
        host: '10.0.4.7',
        port: 22,
        username: 'deploy',
        auth: { method: 'password' },
        automaticDiscovery: true
      }
    })
  })

  it('omits a blank display name', () => {
    const parsed = parseProfileDraft({ ...valid, displayName: '  ' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.displayName).toBeUndefined()
    }
  })

  it('keeps a trimmed display name', () => {
    const parsed = parseProfileDraft({ ...valid, displayName: '  prod db  ' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.displayName).toBe('prod db')
    }
  })

  it('strips brackets from an IPv6 host', () => {
    const parsed = parseProfileDraft({ ...valid, host: '[2001:db8::1]' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.host).toBe('2001:db8::1')
    }
  })

  it('rejects a missing host, username, and Authentication Method together', () => {
    expect(
      parseProfileDraft({
        host: '',
        username: '  ',
        auth: { method: undefined }
      })
    ).toEqual({
      ok: false,
      fields: {
        host: 'Enter a host',
        username: 'Enter a username',
        auth: 'Choose an Authentication Method'
      }
    })
  })

  it('rejects a host that looks like a URL', () => {
    const parsed = parseProfileDraft({ ...valid, host: 'ssh://10.0.4.7' })
    expect(parsed).toEqual({
      ok: false,
      fields: { host: 'Enter a host without a URL scheme or path' }
    })
  })

  it('rejects a host that includes a path', () => {
    const parsed = parseProfileDraft({ ...valid, host: '10.0.4.7/ssh' })
    expect(parsed).toEqual({
      ok: false,
      fields: { host: 'Enter a host without a URL scheme or path' }
    })
  })

  it('rejects a port outside 1..65535', () => {
    expect(parseProfileDraft({ ...valid, port: 0 })).toEqual({
      ok: false,
      fields: { port: 'Port must be 1..65535' }
    })
    expect(parseProfileDraft({ ...valid, port: 65536 })).toEqual({
      ok: false,
      fields: { port: 'Port must be 1..65535' }
    })
    expect(parseProfileDraft({ ...valid, port: 'abc' })).toEqual({
      ok: false,
      fields: { port: 'Port must be 1..65535' }
    })
  })

  it('accepts a numeric port string', () => {
    const parsed = parseProfileDraft({ ...valid, port: '2222' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.port).toBe(2222)
    }
  })

  it('rejects a private-key method without a picked key', () => {
    expect(
      parseProfileDraft({
        ...valid,
        auth: { method: 'privateKey', keyRef: '' }
      })
    ).toEqual({
      ok: false,
      fields: { auth: 'Choose a private-key file' }
    })
  })

  it('accepts a private-key method with a key ref', () => {
    const parsed = parseProfileDraft({
      ...valid,
      auth: { method: 'privateKey', keyRef: 'key-1' }
    })
    expect(parsed).toEqual({
      ok: true,
      value: {
        host: '10.0.4.7',
        port: 22,
        username: 'deploy',
        auth: { method: 'privateKey', keyRef: 'key-1' },
        automaticDiscovery: true
      }
    })
  })

  it('honors an explicit automatic discovery toggle', () => {
    const parsed = parseProfileDraft({ ...valid, automaticDiscovery: false })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.automaticDiscovery).toBe(false)
    }
  })
})

describe('findDuplicateProfile', () => {
  const alice = {
    label: 'alice@db.test',
    host: 'db.test',
    port: 22,
    username: 'alice',
    authKey: 'password'
  }
  const prod = {
    label: 'prod db',
    host: 'db.test',
    port: 22,
    username: 'alice',
    authKey: 'password'
  }

  it('returns the Profile Label of an exact configuration match', () => {
    expect(
      findDuplicateProfile([alice], {
        host: 'db.test',
        port: 22,
        username: 'alice',
        authKey: 'password'
      })
    ).toEqual({ label: 'alice@db.test' })
  })

  it('names the first alphabetical match when several share the configuration', () => {
    expect(
      findDuplicateProfile([alice, prod], {
        host: 'db.test',
        port: 22,
        username: 'alice',
        authKey: 'password'
      })
    ).toEqual({ label: 'alice@db.test' })
  })

  it('does not treat a different username, port, host, or Authentication Method as a duplicate', () => {
    expect(
      findDuplicateProfile([alice], {
        host: 'db.test',
        port: 22,
        username: 'bob',
        authKey: 'password'
      })
    ).toBeUndefined()
    expect(
      findDuplicateProfile([alice], {
        host: 'db.test',
        port: 2222,
        username: 'alice',
        authKey: 'password'
      })
    ).toBeUndefined()
    expect(
      findDuplicateProfile([alice], {
        host: 'other.test',
        port: 22,
        username: 'alice',
        authKey: 'password'
      })
    ).toBeUndefined()
    expect(
      findDuplicateProfile([alice], {
        host: 'db.test',
        port: 22,
        username: 'alice',
        authKey: 'privateKey:/tmp/id_ed25519'
      })
    ).toBeUndefined()
  })
})

describe('resolveSelectedProfileId', () => {
  const zeta = {
    id: 'z',
    displayName: 'zeta',
    username: 'z',
    host: 'z.test',
    port: 22
  }
  const alpha = {
    id: 'a',
    username: 'alice',
    host: 'alpha.test',
    port: 22
  }

  it('restores the last-selected profile when it still exists', () => {
    expect(resolveSelectedProfileId('z', [zeta, alpha])).toBe('z')
  })

  it('falls back to the first alphabetical profile when last-selected is missing', () => {
    expect(resolveSelectedProfileId('gone', [zeta, alpha])).toBe('a')
  })

  it('returns null when there are no profiles', () => {
    expect(resolveSelectedProfileId('a', [])).toBe(null)
  })
})

describe('isProfileDraftDirty', () => {
  it('treats the empty creation form as clean', () => {
    expect(
      isProfileDraftDirty({
        displayName: '',
        host: '',
        port: '',
        username: '',
        authMethod: null,
        automaticDiscovery: true
      })
    ).toBe(false)
  })

  it('treats any filled field, chosen method, or discovery change as dirty', () => {
    expect(
      isProfileDraftDirty({
        displayName: 'x',
        host: '',
        port: '',
        username: '',
        authMethod: null,
        automaticDiscovery: true
      })
    ).toBe(true)
    expect(
      isProfileDraftDirty({
        displayName: '',
        host: 'h',
        port: '',
        username: '',
        authMethod: null,
        automaticDiscovery: true
      })
    ).toBe(true)
    expect(
      isProfileDraftDirty({
        displayName: '',
        host: '',
        port: '22',
        username: '',
        authMethod: null,
        automaticDiscovery: true
      })
    ).toBe(true)
    expect(
      isProfileDraftDirty({
        displayName: '',
        host: '',
        port: '',
        username: 'u',
        authMethod: null,
        automaticDiscovery: true
      })
    ).toBe(true)
    expect(
      isProfileDraftDirty({
        displayName: '',
        host: '',
        port: '',
        username: '',
        authMethod: 'password',
        automaticDiscovery: true
      })
    ).toBe(true)
    expect(
      isProfileDraftDirty({
        displayName: '',
        host: '',
        port: '',
        username: '',
        authMethod: null,
        automaticDiscovery: false
      })
    ).toBe(true)
  })
})
