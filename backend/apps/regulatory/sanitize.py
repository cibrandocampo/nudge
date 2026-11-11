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


def _filter_attribute(tag, attribute, value):
    """Keep only inline images and web links; ``None`` drops the attribute."""
    if tag == "img" and attribute == "src":
        return value if _DATA_IMAGE_RE.match(value) else None
    if tag == "a" and attribute == "href":
        return value if _WEB_LINK_RE.match(value) else None
    return value


def _drop_image_without_source(match):
    return match.group(0) if ' src="' in match.group(1) else ""


def sanitize_leaflet_html(html: str) -> str:
    """The leaflet HTML reduced to the allowlist above.

    Links open in a new tab with ``rel="noopener noreferrer"``. An image whose
    source is not an inline raster image is removed entirely rather than left
    as a broken ``<img>``.
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
    return _IMG_RE.sub(_drop_image_without_source, cleaned)
