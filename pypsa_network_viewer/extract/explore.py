"""Network Explore data: the interactive map of ``network.explore()``."""

import inspect

import pandas as pd

# Optional styling of the map from custom static columns: (component class, column, n.explore() argument).
# Each one is used when the network has that column with values, e.g. n.buses["size"] -> bus_size.
EXPLORE_STYLE_COLUMNS = (
    ('Bus', 'size', 'bus_size'),
    ('Bus', 'colour', 'bus_color'),
    ('Link', 'width', 'link_width'),
    ('Link', 'colour', 'link_color'),
)


def _explore_style(network):
    """
    n.explore() keyword arguments from the styling columns present in the network. Empty cells get
    n.explore()'s own default (e.g. 'cadetblue' for bus_color), so a partly filled column styles only
    the components that have a value.
    """
    defaults = {name: p.default for name, p in inspect.signature(network.explore).parameters.items()}
    comps = {getattr(c, 'name', ''): c for c in network.components.values()}
    kwargs = {}
    for cls, column, argument in EXPLORE_STYLE_COLUMNS:
        comp = comps.get(cls)
        if comp is None or column not in comp.static.columns:
            continue
        values = comp.static[column]
        empty = values.isna() | (values.astype(str).str.strip() == '')
        if empty.all():
            continue
        if empty.any() and argument in defaults and not isinstance(defaults[argument], (pd.Series, dict)):
            values = values.mask(empty, defaults[argument])
        kwargs[argument] = values
    return kwargs


def extract_explore(network, bus_size=None):
    """
    Render ``network.explore()`` (an interactive pydeck map) to standalone HTML for the
    Network Explore tab. Returns {'html', 'warning', 'error'}; failures never stop the export.

    bus_size (html_network's argument): passed to ``n.explore(bus_size=...)``, overriding n.buses["size"].
    """
    result = {'html': None, 'warning': None, 'error': None}
    warnings = []
    buses = next((c for c in network.components.values() if getattr(c, 'name', '') == 'Bus'), None)
    if buses is not None and not buses.static.empty and {'x', 'y'} <= set(buses.static.columns):
        if (buses.static['x'].fillna(0) == 0).all() and (buses.static['y'].fillna(0) == 0).all():
            warnings.append('All buses have coordinates x = y = 0, so they are drawn on top of each other. '
                            'Set bus x (longitude) and y (latitude) to see the network layout.')
    explicit = {} if bus_size is None else {'bus_size': bus_size}
    style = {**_explore_style(network), **explicit}
    try:
        try:
            deck = network.explore(**style)
        except Exception as e:
            if not style:
                raise
            # The styling could not be used (e.g. text where sizes are expected): keep only the explicit
            # html_network arguments if they work on their own, else the default styling
            fallback = explicit
            try:
                deck = network.explore(**fallback)
            except Exception:
                fallback = {}
                deck = network.explore()
            dropped = [arg for arg in style if arg not in fallback]
            warnings.append(f'The map styling ({", ".join(dropped)}) could not be applied, so the default styling is used '
                            f'for it: {type(e).__name__}: {e}')
        result['html'] = deck.to_html(as_string=True, notebook_display=False)
    except Exception as e:  # e.g. pydeck not installed
        result['error'] = f'{type(e).__name__}: {e}'
    result['warning'] = ' '.join(warnings) or None
    return result
