"""
Setup script for pypsa_network_viewer
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="pypsa-network-viewer",
    version="0.3.0",
    author="Priyesh Gosai",
    description="Interactive HTML viewer for PyPSA networks",
    long_description=long_description,
    long_description_content_type="text/markdown",
    # Only the package itself: examples/ and archive/ are not installed
    packages=find_packages(include=["pypsa_network_viewer", "pypsa_network_viewer.*"]),
    # The viewer page is assembled from these files at export time (see render.py)
    package_data={"pypsa_network_viewer": ["templates/*.html", "templates/*.css", "templates/js/*.js"]},
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.12",
    ],
    python_requires=">=3.10",
    install_requires=[
        "pypsa>=1.0.0",       # new components API
        "numpy",
        "pandas",
        "plotly>=5.0.0",      # custom plots
        "pydeck",             # Network Explore map (n.explore())
    ],
    extras_require={
        "excel": ["openpyxl"],  # generate_template()
    },
    keywords="pypsa, network, visualization, interactive, html",
    project_urls={
        "Bug Reports": "https://github.com/PriyeshGosai/pypsa_network_viewer/issues",
        "Source": "https://github.com/PriyeshGosai/pypsa_network_viewer",
    },
)