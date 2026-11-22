import { useRef, useState } from 'react'
import { useInstallPrompt } from './useInstallPrompt'

/**
 * What tapping «Install» does, for the banner and the Settings card: the
 * browser's own install dialog when it offers one, otherwise the instructions
 * sheet. A second tap while the first is in progress is ignored, or it would
 * find the prompt already used and open the sheet over the dialog.
 */
export function useInstallAction() {
  const { triggerNativePrompt, waitForNativePrompt } = useInstallPrompt()
  const [sheetOpen, setSheetOpen] = useState(false)
  const inProgress = useRef(false)

  const install = async () => {
    if (inProgress.current) return
    inProgress.current = true
    try {
      if (await waitForNativePrompt()) {
        await triggerNativePrompt()
        return
      }
    } catch {
      // The captured event was already used: the instructions still work.
    } finally {
      inProgress.current = false
    }
    setSheetOpen(true)
  }

  return { install, sheetOpen, closeSheet: () => setSheetOpen(false) }
}
