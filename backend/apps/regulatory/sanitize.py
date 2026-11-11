"""Sanitising third-party leaflet HTML before the app renders it.

The leaflet ends up in ``dangerouslySetInnerHTML``, under a CSP that blocks
inline styles and any image that is not ``'self'`` or a ``data:`` URI. So the
HTML is reduced to a strict allowlist here, once, when it is stored: a
structural subset of HTML with no styling, no scripting and no remote content.

Agency-neutral: it knows HTML, not where the HTML came from.
"""

import re

import nh3

ALLOWED_TAGS = {
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "sub",
    "sup",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "img",
    "a",
    "div",
}
# `span` is deliberately missing: with every attribute gone it carries no
# meaning, and a tag outside the allowlist is unwrapped (its text kept). That
# compacts the hundreds of style-only spans of a leaflet without a parser.

# Removed together with everything inside them, not just unwrapped.
REMOVED_WITH_CONTENT = {"script", "style", "iframe", "object", "form", "svg", "math"}

ALLOWED_ATTRIBUTES = {
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
    "img": {"src", "alt"},
    "a": {"href"},
}

_DATA_IMAGE_RE = re.compile(r"data:image/(?:png|jpe?g|gif|webp);base64,", re.IGNORECASE)
_WEB_LINK_RE = re.compile(r"https?://", re.IGNORECASE)
# An `img` as nh3 serialises it: double-quoted attributes, `"` escaped inside.
_IMG_RE = re.compile(r'<img((?:\s+[\w-]+="[^"]*")*)\s*/?>')


# A list typed as paragraphs: "<p>•&nbsp;&nbsp;…&nbsp; Text</p>", one per item
# (word-processor output). The bullet is a bullet or a dash followed by
# spacing; a hyphen is left alone, it starts too many real sentences ("-5 °C").
_FAKE_ITEM = r"<p>\s*[•·▪–](?:&nbsp;|\s)+((?:(?!</p>).)*)</p>"
_FAKE_ITEM_RE = re.compile(_FAKE_ITEM, re.DOTALL)
_FAKE_LIST_RE = re.compile(rf"(?:{_FAKE_ITEM}\s*)+", re.DOTALL)

# A paragraph with nothing to read: spacing, line breaks, or an empty bold or
# italic run. Word processors use them as vertical spacers; the stylesheet
# already spaces paragraphs, so each one only adds a gap.
_EMPTY_P_RE = re.compile(r"<p>(?:\s|&nbsp;|<br\s*/?>|<(strong|b|em|i|u)>(?:\s|&nbsp;)*</\1>)*</p>\s*")


def _filter_attribute(tag, attribute, value):
    """Keep only inline images and web links; ``None`` drops the attribute."""
    if tag == "img" and attribute == "src":
        return value if _DATA_IMAGE_RE.match(value) else None
    if tag == "a" and attribute == "href":
        return value if _WEB_LINK_RE.match(value) else None
    return value


def _drop_image_without_source(match):
    return match.group(0) if ' src="' in match.group(1) else ""


def _real_list(match):
    items = "".join(f"<li>{item.strip()}</li>" for item in _FAKE_ITEM_RE.findall(match.group(0)))
    return f"<ul>{items}</ul>"


def tidy_leaflet_html(html: str) -> str:
    """Layout fixes on sanitised HTML: no spacer paragraphs, real lists.

    Idempotent, so it can also be run again over leaflets already stored.
    """
    return lists_from_bullet_paragraphs(_EMPTY_P_RE.sub("", html))


def lists_from_bullet_paragraphs(html: str) -> str:
    """Consecutive bullet paragraphs turned into one real ``<ul>``.

    Runs on sanitised HTML (nh3 output), so its ``<p>`` tags carry no
    attributes. The leaflet then reads as the lists it already has, instead of
    a bullet followed by a wide run of non-breaking spaces.
    """
    return _FAKE_LIST_RE.sub(_real_list, html)


def sanitize_leaflet_html(html: str) -> str:
    """The leaflet HTML reduced to the allowlist above.

    Links open in a new tab with ``rel="noopener noreferrer"``. An image whose
    source is not an inline raster image is removed entirely rather than left
    as a broken ``<img>``. Empty spacer paragraphs are dropped and paragraphs
    typed as list items become a real list.
    """
    cleaned = nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        clean_content_tags=REMOVED_WITH_CONTENT,
        attributes=ALLOWED_ATTRIBUTES,
        attribute_filter=_filter_attribute,
        url_schemes={"http", "https", "data"},
        link_rel="noopener noreferrer",
        set_tag_attribute_values={"a": {"target": "_blank"}},
    )
    return tidy_leaflet_html(_IMG_RE.sub(_drop_image_without_source, cleaned))
