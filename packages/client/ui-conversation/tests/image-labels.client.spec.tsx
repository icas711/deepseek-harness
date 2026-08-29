// @vitest-environment jsdom
// The conversation-side bridge to the ui-attachment atoms: dictionary strings
// flow through image-labels into the gallery, and assistant images keep their
// block position between text blocks.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ru as commonRu } from '@deepseek-ai/dsh-client-locale/src/locales/ru.ts'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import { attachmentErrorText, imageSizeText } from '../src/client/image-labels.ts'
import { ru } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(ru, commonRu)

const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'history.png',
}

describe('attachment rejection copy', () => {
  const limits = {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    mediaTypes: ['image/png'] as const,
  }

  it('renders megabytes without a trailing fraction unless one exists', () => {
    expect(imageSizeText(10 * 1024 * 1024)).toBe('10MB')
    expect(imageSizeText(2.5 * 1024 * 1024)).toBe('2.5MB')
  })

  it('maps user-solvable reasons to limit-naming copy', () => {
    expect(attachmentErrorText(t, 'MODEL_DOES_NOT_SUPPORT_IMAGES')).toBe('Текущая модель не поддерживает изображения; переключитесь на модель с поддержкой')
    expect(attachmentErrorText(t, 'SUBAGENT_IMAGE_UNSUPPORTED')).toBe('Сессии субагентов пока не поддерживают изображения')
    expect(attachmentErrorText(t, 'IMAGE_TOO_MANY_PIXELS')).toBe('Разрешение изображения слишком велико; сожмите его и попробуйте снова')
    expect(attachmentErrorText(t, 'INVALID_IMAGE')).toBe('Поддерживаются только изображения PNG, JPG, WebP и GIF')
    expect(attachmentErrorText(t, 'IMAGE_TYPE_MISMATCH')).toBe('Поддерживаются только изображения PNG, JPG, WebP и GIF')
    expect(attachmentErrorText(t, 'TOO_MANY_IMAGES', limits)).toBe('В одном сообщении — не больше 20 изображений')
    expect(attachmentErrorText(t, 'IMAGE_TOO_LARGE', limits)).toBe('Каждое изображение должно быть меньше 5MB')
    expect(attachmentErrorText(t, 'IMAGES_TOO_LARGE', limits)).toBe('Суммарный размер изображений превышает 100MB; уберите часть и попробуйте снова')
  })

  it('folds unknown reasons and limit reasons without projected limits into the send-failed line', () => {
    expect(attachmentErrorText(t, 'INVALID_IMAGE_BASE64')).toBe('Не удалось отправить изображения (INVALID_IMAGE_BASE64); добавьте их снова и повторите')
    expect(attachmentErrorText(t, 'TOO_MANY_IMAGES')).toBe('Не удалось отправить изображения (TOO_MANY_IMAGES); добавьте их снова и повторите')
    expect(attachmentErrorText(t, 'IMAGE_TOO_LARGE')).toBe('Не удалось отправить изображения (IMAGE_TOO_LARGE); добавьте их снова и повторите')
    expect(attachmentErrorText(t, 'IMAGES_TOO_LARGE')).toBe('Не удалось отправить изображения (IMAGES_TOO_LARGE); добавьте их снова и повторите')
  })
})

describe('assistant images through the label bridge', () => {
  it('resolves ru dictionary strings and opens the lightbox on a single click', async () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'image', attachment }]}
        streaming={false}
        loadImage={() => Promise.resolve('blob:history')}
      />,
    )
    const frame = await view.findByRole('button', { name: 'history.png, нажмите, чтобы открыть оригинал' })
    expect(frame.getAttribute('title')).toBe('Открыть оригинал')
    await view.findByAltText('history.png')
    fireEvent.click(frame)
    expect(view.getByRole('dialog', { name: 'Просмотр оригинала изображения' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Закрыть просмотр оригинала' }))
    expect(view.queryByRole('dialog', { name: 'Просмотр оригинала изображения' })).toBeNull()
  })

  it('merges consecutive image blocks into one tiled gallery, split by text', async () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'image', attachment },
          { kind: 'image', attachment },
          { kind: 'text', text: 'between' },
          { kind: 'image', attachment },
        ]}
        streaming={false}
        loadImage={() => Promise.resolve('blob:grouped')}
      />,
    )
    await view.findAllByAltText('history.png')
    const galleries = view.container.querySelectorAll('[data-align="start"]')
    expect(galleries).toHaveLength(2)
    expect(galleries[0]?.querySelectorAll('[data-variant="tile"]')).toHaveLength(2)
    expect(galleries[1]?.querySelectorAll('[data-variant="single"]')).toHaveLength(1)
  })

  it('keeps assistant images at their original position between text blocks', async () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'text', text: 'before' },
          { kind: 'image', attachment },
          { kind: 'text', text: 'after' },
        ]}
        streaming={false}
        loadImage={() => Promise.resolve('blob:middle')}
      />,
    )
    const image = await view.findByAltText('history.png')
    const before = view.getByText('before')
    const after = view.getByText('after')
    expect(before.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(image.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })
})
