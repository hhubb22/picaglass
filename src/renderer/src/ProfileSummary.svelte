<script lang="ts">
  import type { RendererProfile } from '../../shared/profile'

  let { profile }: { profile: RendererProfile } = $props()

  const authSummary = $derived(
    profile.auth.method === 'password' ? 'Password' : `Private-key file (${profile.auth.label})`
  )
</script>

<section class="summary">
  <h1>{profile.label}</h1>
  <dl>
    <div>
      <dt>Host</dt>
      <dd>{profile.host}</dd>
    </div>
    <div>
      <dt>Port</dt>
      <dd>{profile.port}</dd>
    </div>
    <div>
      <dt>Username</dt>
      <dd>{profile.username}</dd>
    </div>
    <div>
      <dt>Authentication Method</dt>
      <dd>{authSummary}</dd>
    </div>
    <div>
      <dt>Automatic discovery</dt>
      <dd>{profile.automaticDiscovery ? 'Enabled' : 'Disabled'}</dd>
    </div>
  </dl>
</section>

<style>
  .summary {
    display: grid;
    align-content: start;
    gap: 16px;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  dl {
    display: grid;
    gap: 12px;
    margin: 0;
  }

  div {
    display: grid;
    gap: 2px;
  }

  dt {
    font-size: 0.8rem;
    color: var(--muted);
  }

  dd {
    margin: 0;
  }
</style>
