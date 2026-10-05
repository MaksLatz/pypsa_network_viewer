"""Network Explore data: the interactive map of ``network.explore()``."""


def extract_explore(network):
    """
    Render ``network.explore()`` (an interactive pydeck map) to standalone HTML for the
    Network Explore tab. Returns {'html', 'warning', 'error'}; failures never stop the export.
    """
    result = {'html': None, 'warning': None, 'error': None}
    buses = next((c for c in network.components.values() if getattr(c, 'name', '') == 'Bus'), None)
    if buses is not None and not buses.static.empty and {'x', 'y'} <= set(buses.static.columns):
        if (buses.static['x'].fillna(0) == 0).all() and (buses.static['y'].fillna(0) == 0).all():
            result['warning'] = ('All buses have coordinates x = y = 0, so they are drawn on top of each other. '
                                 'Set bus x (longitude) and y (latitude) to see the network layout.')
    try:
        deck = network.explore()
        result['html'] = deck.to_html(as_string=True, notebook_display=False)
    except Exception as e:  # e.g. pydeck not installed
        result['error'] = f'{type(e).__name__}: {e}'
    return result
