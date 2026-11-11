import { describe, expect, it } from 'vitest'
import { splitNoteLinks } from '../noteLinks'

describe('splitNoteLinks', () => {
  it('a label that only introduces the address goes with it', () => {
    expect(splitNoteLinks('Consultar Nota Informativa: https://www.aemps.gob.es/informa/x/')).toEqual({
      text: '',
      urls: ['https://www.aemps.gob.es/informa/x/'],
    })
  })

  it('keeps the sentences that say something, drops only the label', () => {
    expect(splitNoteLinks('Desabastecimiento temporal. Más información: https://a.es/x. Hay alternativas.')).toEqual({
      text: 'Desabastecimiento temporal. Hay alternativas.',
      urls: ['https://a.es/x'],
    })
  })

  it('collects every http(s) address, without sentence punctuation', () => {
    expect(splitNoteLinks('See https://a.es/x, and http://b.es/y.').urls).toEqual(['https://a.es/x', 'http://b.es/y'])
  })

  it('an address with no label leaves the text around it', () => {
    expect(splitNoteLinks('Ver https://a.es/x para más datos')).toEqual({
      text: 'Ver para más datos',
      urls: ['https://a.es/x'],
    })
  })

  it('only web addresses are recognised', () => {
    expect(splitNoteLinks('Escribir a mailto:x@a.es o javascript:alert(1)')).toEqual({
      text: 'Escribir a mailto:x@a.es o javascript:alert(1)',
      urls: [],
    })
  })

  it('text without addresses is returned as is', () => {
    expect(splitNoteLinks('Desabastecimiento temporal.')).toEqual({ text: 'Desabastecimiento temporal.', urls: [] })
  })
})
