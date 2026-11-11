// `http(s)://` up to the next whitespace. Trailing punctuation that ends a
// sentence ("… see https://x.es/note/.") is not part of the address.
const URL_RE = /(https?:\/\/[^\s]+?)[.,;:!?)]*(?=\s|$)/g

// Where each address stood, while the text around it is cleaned up.
const MARK = '\u0000'

// A label that only introduces an address ("Consultar Nota Informativa:
// <url>"): from the start of its sentence up to the colon before the mark.
const LABEL_RE = new RegExp(`(^|[.!?]\\s+)[^.!?${MARK}]*:\\s*${MARK}`, 'g')

/**
 * An agency's note split into its words and its addresses.
 *
 * The addresses become buttons, never inline text, so a note like
 * "Consultar Nota Informativa: https://…" is left with nothing to say and the
 * label that introduced the address goes with it. Only `http(s)` addresses are
 * recognised, so only web addresses are ever offered. The text stays plain
 * text: it is never parsed as HTML.
 */
export function splitNoteLinks(text) {
  const urls = []
  const marked = text.replace(URL_RE, (_, url) => {
    urls.push(url)
    return MARK
  })
  const rest = marked
    .replace(LABEL_RE, '$1')
    .replaceAll(MARK, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { text: rest, urls }
}
