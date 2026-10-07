"""
PyPSA Network Viewer
Interactive HTML visualization for PyPSA networks

Author: Priyesh Gosai

Package layout:
- viewer.py         : html_network(), the public entry point (this file)
- extract/          : reads the network into JSON-serialisable data, one module per part of the page
- render.py         : inlines templates/ (page.html, viewer.css, js/*.js) and the data into one HTML file
- templates/        : the page's HTML skeleton, CSS and JavaScript modules
- viewer_updated.py : former name of this module, kept for existing imports
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

from .extract import HYDRO_BUS_SUFFIXES, extract_network_data  # noqa: E402  (needs the option above)
from .render import render_html  # noqa: E402

__all__ = ['html_network', 'HYDRO_BUS_SUFFIXES']


def html_network(network, file_path=None, file_name=None, title="PyPSA Network Analyzer",
                 currency='$', custom_plots=None):
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
    """
    if file_name is None:
        file_name = "network_analyzer.html"
    output_file = file_name if file_path is None else os.path.join(file_path, file_name)

    data = extract_network_data(network, currency=currency, custom_plots=custom_plots)
    html_content = render_html(data, title)

    if file_path is not None:
        os.makedirs(file_path, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"Network analyzer generated: {output_file}")
    print(f"Components found: {list(data['components'].keys())}")

    return output_file
