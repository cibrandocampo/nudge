// `http(s)://` up to the next whitespace. Trailing punctuation that ends a
// sentence ("… see https://x.es/note/.") is left out of the link.
const URL_RE = /(https?:\/\/[^\s]+?)([.,;:!?)]*)(?=\s|$)/g

/**
 * Plain text with its URLs turned into links — and nothing else.
 *
 * For text that comes from outside (an agency's note): it is split into
 * strings and `<a>` elements, never parsed as HTML, so markup in it shows as
 * the literal characters it is. Links open in a new tab, without a referrer
 * or a handle on this page.
 */
export default function LinkifiedText({ text, className, lang }) {
  const parts = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const [, url, trailing] = match
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    )
    if (trailing) parts.push(trailing)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))

  return (
    <span className={className} lang={lang}>
      {parts}
    </span>
  )
}
