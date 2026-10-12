/**
 * Clipboard write with the fallback a phone-first deployment needs: the async
 * clipboard API exists only in secure contexts, and a browser opened over a
 * Tailscale IP on plain HTTP is not one, so the legacy textarea +
 * `execCommand` path stays until the deployment serves TLS.
 */

/**
 * Copy one text to the system clipboard.
 * @param text - the text to place on the clipboard.
 * @returns once the text reached the clipboard; rejects when the legacy
 * engine also refuses the copy.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('clipboard: the copy command was refused')
  } finally {
    area.remove()
  }
}
