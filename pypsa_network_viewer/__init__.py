"""
PyPSA Network Viewer

A tool for creating interactive HTML visualizations of PyPSA networks.
"""

from .viewer import html_network

# Former name of html_network (same arguments), kept so existing code keeps working
html_viewer = html_network


def generate_template(*args, **kwargs):
    """
    Generate an Excel workbook template to define a new PyPSA network.
    See ``excel_template_generator.generate_template`` for the parameters.

    Imported on first use, so the HTML viewer works without openpyxl installed.
    """
    from .excel_template_generator import generate_template as _generate_template
    return _generate_template(*args, **kwargs)


__version__ = "0.3.0"
__author__ = "Priyesh Gosai"

__all__ = ["html_viewer", "html_network", "generate_template"]
