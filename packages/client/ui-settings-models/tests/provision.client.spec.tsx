// @vitest-environment jsdom
/**
 * The provisioning surfaces: the row's re-pull action and the editor's
 * provision-after-save, over a scripted wire face.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected } from '../src/client/ModelsSection.tsx'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => ru[key]

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `provision-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string, code: string): RpcResponse<T> {
  return {
    rpcId: `provision-${nextRpc++}` as never,
    result: { ok: false, error: { code, message, details: { ns: 'llm-pi-ai' } } as never },
  }
}

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    reasoning: Schema.union(['off', 'low', 'high', 'max']),
  })),
})

function scriptedFace(options: {
  providers?: Record<string, unknown>
  /** Routes the adapter reports as provisionable; the rest come back unmarked. */
  provisionableRoutes?: readonly string[]
  provision?: ReturnType<typeof vi.fn>
  /** Credential references already stored; the rest read unconfigured. */
  credentialsConfigured?: readonly string[]
} = {}) {
  const providers = options.providers
    ?? { zai: { apiKeyEnv: 'ZAI_API_KEY', baseURL: 'https://api.z.ai/api/coding/paas/v4' } }
  const provision = options.provision ?? vi.fn(() => Promise.resolve(ok({ models: 6 })))
  const namespace: SettingsNamespaceView = {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as unknown,
    value: { providers },
    user: { providers },
    applies: 'live',
    secrets: [],
    revision: 3,
  }
  const mutate = vi.fn(() => Promise.resolve(ok(namespace)))
  const set = vi.fn(() => Promise.resolve(ok({})))
  const configured = options.credentialsConfigured ?? ['ZAI_API_KEY']
  const face = {
    llm: {
      providers: vi.fn(() => Promise.resolve(ok({
        providers: Object.keys(providers).map(provider => ({
          provider,
          displayName: provider,
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', provider],
          active: true,
          ...(options.provisionableRoutes?.includes(provider) === true ? { provisionable: true } : {}),
        })),
      }))),
      models: vi.fn(() => Promise.resolve(ok({ groups: [], failures: [] }))),
      provisionProvider: provision,
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [namespace] }))),
      update: vi.fn(),
      replace: vi.fn(),
      mutate,
    },
    credentials: {
      describe: vi.fn((payload: { refs: string[] }) => Promise.resolve(ok({
        credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
          configured: configured.includes(ref),
          writable: true,
        }])),
      }))),
      set,
      unset: vi.fn(),
    },
  }
  return { face, provision, mutate, set }
}

async function mountSection(options: Parameters<typeof scriptedFace>[0] = {}) {
  const scripted = scriptedFace(options)
  const controller = new ModelsSettingsStore(scripted.face as unknown as ConstructorParameters<typeof ModelsSettingsStore>[0])
  await controller.load()
  const injected: ModelsSectionInjected = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    api: scripted.face as never,
    t,
  }
  render(<ModelsSection {...injected} />)
  return scripted
}

/** Open one configured row's editor and dirty a field so Apply unlocks. */
async function openDirtyEditor(provider: string): Promise<void> {
  const row = screen.getByText(provider).closest('li')
  if (row === null) throw new Error(`no row for ${provider}`)
  const edit = [...row.querySelectorAll('button')].find(button => button.textContent === ru.edit)
  if (edit === undefined) throw new Error('no edit button')
  fireEvent.click(edit)
  await screen.findByText(ru.apply)
  fireEvent.click(screen.getByRole('button', { name: ru.addModel }))
  fireEvent.change(screen.getByLabelText(`${ru.modelId} 1`), { target: { value: 'acme-large' } })
}

describe('provider row re-pull action', () => {
  it('offers the action only on a provisionable row', async () => {
    await mountSection({ provisionableRoutes: ['zai'] })
    expect(screen.getByRole('button', { name: ru.refreshModels })).toBeDefined()

    cleanup()
    await mountSection()
    expect(screen.queryByRole('button', { name: ru.refreshModels })).toBeNull()
  })

  it('re-pulls through the wire face and announces how many models returned', async () => {
    const { provision } = await mountSection({ provisionableRoutes: ['zai'] })
    fireEvent.click(screen.getByRole('button', { name: ru.refreshModels }))

    await waitFor(() => {
      expect(provision).toHaveBeenCalledWith({ settingsNs: 'llm-pi-ai', provider: 'zai' })
    })
    expect(await screen.findByText('Модели подтянуты с эндпоинта: 6')).toBeDefined()
  })

  it('reports a failed re-pull on the row and keeps the stored profile alone', async () => {
    const { provision } = await mountSection({
      provisionableRoutes: ['zai'],
      provision: vi.fn(() => Promise.resolve(fail('endpoint answered 401', 'model-provisioning-failed'))),
    })
    fireEvent.click(screen.getByRole('button', { name: ru.refreshModels }))

    expect(await screen.findByText('endpoint answered 401')).toBeDefined()
    expect(screen.queryByText(/Модели подтянуты/)).toBeNull()
    expect(provision).toHaveBeenCalledOnce()
  })

  it('reports a transport rejection of the re-pull on the row', async () => {
    const { provision } = await mountSection({
      provisionableRoutes: ['zai'],
      provision: vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    })
    const row = screen.getByText('zai').closest('li')
    if (row === null) throw new Error('no row for zai')
    const action = [...row.querySelectorAll('button')].find(button => button.textContent === ru.refreshModels)
    if (action === undefined) throw new Error('no refresh action')
    fireEvent.click(action)

    expect(await screen.findByText('fetch failed')).toBeDefined()
    expect(screen.queryByText(/Модели подтянуты/)).toBeNull()
    // The busy state cleared: the action is available again.
    expect(provision).toHaveBeenCalledOnce()
    expect((action as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('provision after a card save', () => {
  it('provisions once the saved key lands and closes the card on success', async () => {
    const { provision, mutate } = await mountSection({ provisionableRoutes: ['zai'] })
    await openDirtyEditor('zai')
    fireEvent.click(screen.getByText(ru.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalled() })
    await waitFor(() => {
      expect(provision).toHaveBeenCalledWith({ settingsNs: 'llm-pi-ai', provider: 'zai' })
    })
    await waitFor(() => { expect(screen.queryByText(ru.apply)).toBeNull() })
  })

  it('keeps the card open on a failed provision and succeeds on Повторить', async () => {
    const provision = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(fail('endpoint answered 401', 'model-provisioning-failed'))
      .mockResolvedValueOnce(ok({ models: 6 }))
    const { mutate } = await mountSection({ provisionableRoutes: ['zai'], provision })
    await openDirtyEditor('zai')
    fireEvent.click(screen.getByText(ru.apply))

    await waitFor(() => { expect(provision).toHaveBeenCalledOnce() })
    expect(await screen.findByText('fetch failed')).toBeDefined()
    expect(screen.getByText(ru.apply)).toBeDefined()

    // A retry that fails again keeps the card open and the message current.
    fireEvent.click(screen.getByRole('button', { name: ru.retry }))
    expect(await screen.findByText('endpoint answered 401')).toBeDefined()
    expect(screen.getByText(ru.apply)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: ru.retry }))
    await waitFor(() => {
      expect(provision).toHaveBeenCalledTimes(3)
    })
    await waitFor(() => { expect(screen.queryByText(ru.apply)).toBeNull() })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('skips provisioning for a card the adapter does not offer it on', async () => {
    const { provision } = await mountSection()
    await openDirtyEditor('zai')
    fireEvent.click(screen.getByText(ru.apply))

    await waitFor(() => { expect(screen.queryByText(ru.apply)).toBeNull() })
    expect(provision).not.toHaveBeenCalled()
  })
})
