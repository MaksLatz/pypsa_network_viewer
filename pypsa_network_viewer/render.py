"""
Assemble the self-contained viewer HTML from the files in ``templates/`` and the
data extracted from the network (see ``extract/``).

The page is a single file: the CSS, the JS modules and the data are all inlined, so
it can be opened or shared without the package (only Plotly is loaded from a CDN).
"""

import html
import json
from importlib import resources

# Concatenated in this order into one <script>, so they share one global scope:
# helpers first, page start-up (app.js) last.
JS_MODULES = (
    'core.js',          # data, constants, colours, CSV and time helpers
    'filters.js',       # multi-select filter bars
    'components.js',    # Network Components tab
    'custom_plots.js',  # Custom Plots tab
    'explore.js',       # Network Explore tab
    'balance.js',       # Power Balance tab
    'permalink.js',     # view settings saved in / restored from the page link
    'app.js',           # start-up, tab navigation, Network Summary tab
)


def _template(*parts):
    return resources.files(__package__).joinpath('templates', *parts).read_text(encoding='utf-8')


def render_html(data, title):
    """Return the viewer page for ``data`` (from ``extract_network_data``) as an HTML string."""
    css = _template('viewer.css')
    js = '\n'.join(_template('js', name) for name in JS_MODULES)
    # The JS is inlined in a <script> block: a literal closing tag would end it early (write '<\/script>')
    if '</script' in js.lower():
        raise ValueError("A JS module in templates/js contains '</script'; write it as '<\\/script>'")
    # '<\/' is valid JSON and stops embedded HTML (e.g. the explore map) from closing the <script> block
    data_json = json.dumps(data, default=str).replace('</', '<\\/')

    page = _template('page.html')
    page = page.replace('__PNV_CSS__', css).replace('__PNV_JS__', js)
    page = page.replace('__PNV_TITLE__', html.escape(title))
    return page.replace('__PNV_DATA__', data_json)  # last: the data may contain any text
