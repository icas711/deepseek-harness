// @vitest-environment jsdom
/** First-run Z.ai prompt behavior over the shared Models join. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { OnboardingDialog } from '../src/client/OnboardingDialog.tsx'
import type { OnboardingDialogProps } from '../src/client/OnboardingDialog.tsx'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { ru } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `onboarding-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return {
    rpcId: `onboarding-${nextRpc++}` as never,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }
}

const ProfileSchema = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string().pattern(/^https:\/\//),
  displayName: Schema.string(),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string(),
    description: Schema.string(),
    contextWindow: Schema.number().step(1).min(1),
  })),
})

function zaiNamespace(apiKeyEnv: string | null): SettingsNamespaceView {
  const profile = apiKeyEnv === null
    ? {}
    : { apiKeyEnv, baseURL: 'https://api.z.ai/api/paas/v4' }
  const value = { providers: { zai: profile } }
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(Schema.object({ providers: Schema.dict(ProfileSchema) }).toJSON())) as unknown,
    value,
    base: value,
    user: {},
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function harness(options: {
  provider?: boolean
  providerSettingsNs?: string
  providerActive?: boolean
  providerProvisionable?: boolean
  settingsNamespace?: boolean
  apiKeyEnv?: string | null
  configured?: () => boolean
  credential?: { source?: string; writable: boolean }
  describeFailure?: string
  settingsWritable?: boolean
  providersReject?: boolean
  setFailure?: string
  setReject?: string
} = {}) {
  if (document.getElementById('root') === null) {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
  }
  let fileConfigured = false
  const configured = options.configured ?? (() => fileConfigured)
  const apiKeyEnv = options.apiKeyEnv === undefined ? 'ZAI_API_KEY' : options.apiKeyEnv
  const mutate = vi.fn(() => Promise.resolve(ok(zaiNamespace(apiKeyEnv))))
  const provision = vi.fn(() => Promise.resolve(ok({ models: 6 })))
  const set = vi.fn((_payload: { ref: string; value: string }) => {
    if (options.setReject !== undefined) return Promise.reject(new Error(options.setReject))
    if (options.setFailure !== undefined) return Promise.resolve(fail(options.setFailure))
    fileConfigured = true
    return Promise.resolve(ok({}))
  })
  const face = {
    llm: {
      providers: () => {
        if (options.providersReject === true) return Promise.reject(new Error('provider transport unavailable'))
        return Promise.resolve(ok({
          providers: options.provider === false
            ? []
            : [{
              provider: 'zai',
              displayName: 'Z.ai',
              settingsNs: options.providerSettingsNs ?? 'llm-pi-ai',
              settingsPath: ['providers', 'zai'],
              active: options.providerActive ?? true,
              ...(options.providerProvisionable === true ? { provisionable: true } : {}),
            }],
        }))
      },
      provisionProvider: provision,
    },
    settings: {
      describe: () => Promise.resolve(ok({
        writable: options.settingsWritable ?? true,
        hasDocument: false,
        namespaces: options.settingsNamespace === false ? [] : [zaiNamespace(apiKeyEnv)],
      })),
      mutate,
    },
    credentials: {
      describe: () => options.describeFailure === undefined
        ? Promise.resolve(ok({
          credentials: {
            ZAI_API_KEY: {
              configured: configured(),
              ...configured() && options.credential?.source !== undefined
                ? { source: options.credential.source }
                : {},
              writable: options.credential?.writable ?? true,
            },
          },
        }))
        : Promise.resolve(fail(options.describeFailure)),
      set,
    },
  }
  const controller = new ModelsSettingsStore(face as never)
  const openSection = vi.fn()
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: OnboardingDialogProps = {
    stepId: 'zai',
    complete,
    openSection,
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    controller,
    useModels: bindSnapshotSelector(controller.store),
    api: face as never,
    t: key => ru[key],
  }
  return {
    controller, complete, openSection, props, mutate, set, provision,
    configure: () => { fileConfigured = true },
  }
}

describe('OnboardingDialog', () => {
  it('renders when the shell root is absent', async () => {
    const h = harness()
    document.getElementById('root')!.remove()
    render(<OnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: ru.onboardingTitle })).toBeTruthy()
  })

  it('loads a credential-only modal, inerts the product, and focuses the key', async () => {
    const h = harness()
    render(<OnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: ru.onboardingTitle })).toBeTruthy()
    expect(document.getElementById('root')?.inert).toBe(true)
    expect(screen.getByText(ru.onboardingDescription)).toBeTruthy()
    const key = screen.getByLabelText<HTMLInputElement>(ru.keyInput)
    await waitFor(() => { expect(document.activeElement).toBe(key) })
    expect(screen.queryByText(ru.customized)).toBeNull()
  })

  it('cannot be dismissed implicitly and restores the previous inert state', async () => {
    const h = harness()
    const appRoot = document.getElementById('root')!
    appRoot.inert = true
    const view = render(<OnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()

    view.unmount()
    expect(appRoot.inert).toBe(true)
  })

  it('requires a non-blank key before Save and continue is available', async () => {
    const h = harness()
    render(<OnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    const save = screen.getByRole<HTMLButtonElement>('button', { name: ru.onboardingSave })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(ru.keyInput), { target: { value: '   ' } })
    expect(save.disabled).toBe(true)
    expect(screen.getByText(ru.keyRequired)).toBeTruthy()
    expect(h.set).not.toHaveBeenCalled()
  })

  it('keeps the modal open and reports rejected and failed credential writes', async () => {
    for (const [options, message] of [
      [{ setFailure: 'credential was rejected' }, 'credential was rejected'],
      [{ setReject: 'connection lost' }, 'connection lost'],
    ] as const) {
      const h = harness(options)
      const view = render(<OnboardingDialog {...h.props} />)
      await screen.findByRole('dialog')
      fireEvent.change(screen.getByLabelText(ru.keyInput), { target: { value: 'sk-live' } })
      fireEvent.click(screen.getByRole('button', { name: ru.onboardingSave }))
      expect(await screen.findByText(message)).toBeTruthy()
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByRole<HTMLButtonElement>('button', { name: ru.onboardingSave }).disabled).toBe(false)
      expect(h.complete).not.toHaveBeenCalled()
      expect(h.mutate).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('allows configure-later dismissal without opening settings', async () => {
    const h = harness()
    render(<OnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: ru.onboardingLater }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.openSection).not.toHaveBeenCalled()
    expect(h.set).not.toHaveBeenCalled()
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('does not block the product when Z.ai setup is unavailable', async () => {
    for (const h of [
      harness({ describeFailure: 'credentials service is absent' }),
      harness({ credential: { writable: false } }),
      harness({ settingsWritable: false }),
      harness({ providersReject: true }),
      harness({ providerActive: false }),
      harness({ settingsNamespace: false }),
      harness({ apiKeyEnv: null }),
    ]) {
      const view = render(<OnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      expect(h.openSection).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('skips an absent adapter and an already-configured environment credential', async () => {
    for (const h of [
      harness({ provider: false }),
      harness({ providerSettingsNs: '' }),
      harness({ configured: () => true, credential: { source: 'env', writable: false } }),
    ]) {
      const view = render(<OnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      view.unmount()
    }
  })

  it('closes when an external credential invalidation refreshes the shared join', async () => {
    const h = harness()
    render(<OnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    h.configure()
    await act(async () => { await h.controller.load() })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('provisions the shipped route after the key save when the adapter offers it', async () => {
    const h = harness({ providerProvisionable: true })
    render(<OnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText(ru.keyInput), { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByRole('button', { name: ru.onboardingSave }))

    // The key is stored first; the profile the host builds from it ends the
    // step the same way a plain save does.
    await waitFor(() => {
      expect(h.provision).toHaveBeenCalledWith({ settingsNs: 'llm-pi-ai', provider: 'zai' })
    })
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(h.mutate).not.toHaveBeenCalled()
  })
})
