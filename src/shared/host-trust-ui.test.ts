import { describe, expect, it } from 'vitest'
import {
  HOST_TRUST_ACTION_LABEL,
  HOST_TRUST_STATUS_LABEL,
  changedHostPrompt,
  forgetConfirmCopy,
  forgetConfirmPrompt,
  formatTrustDestination,
  hostTrustCard,
  replaceConfirmCopy,
  requestReplaceConfirm,
  unknownHostPrompt
} from './host-trust-ui'

describe('Host Trust card', () => {
  it('shows Not remembered with no fingerprint and no forget action', () => {
    expect(hostTrustCard({ status: 'not-remembered' })).toEqual({
      statusLabel: 'Not remembered',
      algorithm: null,
      fingerprint: null,
      canForget: false
    })
    expect(HOST_TRUST_STATUS_LABEL['not-remembered']).toBe('Not remembered')
  })

  it('shows Trusted for this session with the session-only algorithm and fingerprint', () => {
    expect(
      hostTrustCard({
        status: 'session',
        algorithm: 'ssh-ed25519',
        fingerprint: 'SHA256:abc'
      })
    ).toEqual({
      statusLabel: 'Trusted for this session',
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
      canForget: false
    })
  })

  it('shows remembered algorithm and fingerprint and offers Forget trusted host key', () => {
    expect(
      hostTrustCard({
        status: 'remembered',
        algorithm: 'ssh-ed25519',
        fingerprint: 'SHA256:def'
      })
    ).toEqual({
      statusLabel: 'Remembered',
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:def',
      canForget: true
    })
    expect(HOST_TRUST_ACTION_LABEL.forget).toBe('Forget trusted host key')
  })
})

describe('Host Trust dialogs', () => {
  it('formats the endpoint destination including port', () => {
    expect(formatTrustDestination('example.test', 22)).toBe('example.test:22')
    expect(formatTrustDestination('2001:db8::1', 2222)).toBe('[2001:db8::1]:2222')
  })

  it('shows destination, algorithm, and fingerprint for an unknown host', () => {
    expect(
      unknownHostPrompt('127.0.0.1:2200', {
        kind: 'unknown',
        sessionId: 's1',
        algorithm: 'ssh-ed25519',
        fingerprint: 'SHA256:abc'
      })
    ).toEqual({
      kind: 'unknown',
      destination: '127.0.0.1:2200',
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:abc'
    })
    expect(HOST_TRUST_ACTION_LABEL.trustOnce).toBe('Trust once')
    expect(HOST_TRUST_ACTION_LABEL.trustAlways).toBe('Trust and remember')
    expect(HOST_TRUST_ACTION_LABEL.cancel).toBe('Cancel')
  })

  it('shows old and new algorithms and fingerprints for a changed host key', () => {
    const changed = changedHostPrompt('example.test:22', {
      kind: 'changed',
      sessionId: 's1',
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:new',
      previousAlgorithm: 'ssh-ed25519',
      previousFingerprint: 'SHA256:old'
    })
    expect(changed).toEqual({
      kind: 'changed',
      destination: 'example.test:22',
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:new',
      previousAlgorithm: 'ssh-ed25519',
      previousFingerprint: 'SHA256:old'
    })
    expect(HOST_TRUST_ACTION_LABEL.replace).toBe('Replace and Connect')
  })

  it('Replace and Connect requires a second confirmation before the replace action', () => {
    const changed = changedHostPrompt('example.test:22', {
      kind: 'changed',
      sessionId: 's1',
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:new',
      previousAlgorithm: 'ssh-ed25519',
      previousFingerprint: 'SHA256:old'
    })
    expect(requestReplaceConfirm(changed)).toEqual({
      kind: 'replace-confirm',
      destination: 'example.test:22'
    })
    expect(replaceConfirmCopy('example.test:22')).toBe(
      'Replace the trusted host key for example.test:22? This updates Host Trust for every Connection Profile that uses this destination. Live SSH Sessions stay connected.'
    )
  })

  it('Forget trusted host key confirms the endpoint scope', () => {
    expect(forgetConfirmPrompt('example.test:22')).toEqual({
      kind: 'forget-confirm',
      destination: 'example.test:22'
    })
    expect(forgetConfirmCopy('example.test:22')).toBe(
      'Forget the trusted host key for example.test:22? Every Connection Profile that uses this destination will verify the Trusted Host Key on the next SSH Session. Live SSH Sessions stay connected.'
    )
  })
})
