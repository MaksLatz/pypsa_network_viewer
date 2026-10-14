"""
PyPSA Network Viewer
Interactive HTML visualization for PyPSA networks

Author: Priyesh Gosai

Package layout:
- viewer.py         : html_network(), the public entry point (this file)
- extract/          : reads the network into JSON-serialisable data, one module per part of the page
- render.py         : inlines templates/ (page.html, viewer.css, js/*.js) and the data into one HTML file
- templates/        : the page's HTML skeleton, CSS and JavaScript modules
- excel_template_generator.py : generate_template(), an Excel workbook to define a new network (separate tool)
"""

import os

import pypsa

_PYPSA_MAJOR = int(pypsa.__version__.split('.')[0])
if _PYPSA_MAJOR < 1:
    raise ImportError(
        f"pypsa_network_viewer requires PyPSA >= 1.0.0, but {pypsa.__version__} is installed"
    )

pypsa.options.api.new_components_api = True

from .extract import HYDRO_BUS_SUFFIXES, HYDRO_GENERATOR_CARRIERS, extract_network_data  # noqa: E402  (needs the option above)
from .render import render_html  # noqa: E402

__all__ = ['html_network', 'HYDRO_BUS_SUFFIXES', 'HYDRO_GENERATOR_CARRIERS']


def html_network(network, file_path=None, file_name=None, title="PyPSA Network Analyzer",
                 currency='$', custom_plots=None, bus_size=None,
                 hydro_bus_suffixes=HYDRO_BUS_SUFFIXES, hydro_generator_carriers=HYDRO_GENERATOR_CARRIERS):
    """
    Generate interactive HTML interface for exploring PyPSA network components and timeseries data.

    Parameters:
    -----------
    network : pypsa.Network
        The PyPSA network object to analyze
    file_path : str, optional
        Directory path where the HTML file should be saved (default: None, saves in current directory)
    file_name : str, optional
        Name of the HTML file (default: None, creates "network_analyzer.html")
    title : str, optional
        Title for the HTML page (default: "PyPSA Network Analyzer")
    currency : str, optional
        Currency symbol for cost displays (default: '$')
    custom_plots : str or list, optional
        Either a path to a Python file containing a ``get_plots(network)`` function that
        returns a list of Plotly figure objects, OR a list of Plotly figure objects directly.
        See ``examples/custom_plots_template.py`` in the repository for the expected file format.
    bus_size : float, dict or pandas.Series, optional
        Size of the buses on the Network Explore map, passed to ``n.explore(bus_size=...)``: circle area
        in km², one number for all buses or one value per bus. Use a small value for a small network.
        Takes priority over a ``size`` column of ``n.buses`` (default: None, the column if present, else
        PyPSA's default).
    hydro_bus_suffixes : sequence of str, optional
        A bus whose name ends with one of these (case-insensitive) is a hydro storage bus; the suffix is its
        hydro type (default: 'Open loop pumping', 'Pondage', 'Reservoir', 'Closed loop pumping'). Links from
        a hydro bus to an electrical bus are hydro turbines, links to a hydro bus are pumps. Use ``()`` for
        a network without hydro storage buses.
    hydro_generator_carriers : sequence of str, optional
        Generators with one of these carriers (case-insensitive) on an electrical bus are hydro generators,
        e.g. run of river: the Power Balance counts them as Hydro Generation, by their ``type``
        (default: ('hydro',)).

    Returns:
    --------
    str : Path to generated HTML file

    Examples:
    ---------
    Basic usage:
    >>> import pypsa
    >>> network = pypsa.examples.ac_dc_meshed()
    >>> network.optimize()
    >>> html_network(network, file_name='my_network.html')

    With a custom plots file:
    >>> html_network(network, file_name='full_network.html',
    ...              currency='€', custom_plots='my_custom_plots.py')

    With inline custom plots:
    >>> import plotly.graph_objects as go
    >>> fig = go.Figure()
    >>> html_network(network, custom_plots=[fig])

    With smaller buses on the map:
    >>> html_network(network, bus_size=2)
    """
    if file_name is None:
        file_name = "network_analyzer.html"
    output_file = file_name if file_path is None else os.path.join(file_path, file_name)

    data = extract_network_data(network, currency=currency, custom_plots=custom_plots, bus_size=bus_size,
                                hydro_bus_suffixes=hydro_bus_suffixes,
                                hydro_generator_carriers=hydro_generator_carriers)
    html_content = render_html(data, title)

    if file_path is not None:
        os.makedirs(file_path, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"Network analyzer generated: {output_file}")
    print(f"Components found: {list(data['components'].keys())}")

    return output_file
