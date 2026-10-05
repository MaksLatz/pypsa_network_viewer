// Network Explore tab: the n.explore() map embedded in an iframe.

// --- Network Explore tab: the map produced by n.explore(), embedded in an iframe ---------
function renderExplore() {
    const view = document.getElementById('exploreView');
    if (view.dataset.rendered) return;  // keep the map (and its zoom) when switching tabs
    view.dataset.rendered = '1';
    const explore = networkData.explore || {};
    let html = `<div class="info-panel"><h3>Network Explore</h3>
        <p>Interactive map from PyPSA's <code>n.explore()</code>. Drag to pan, scroll to zoom, hover over a component for its attributes.
        The base map is loaded from the internet.</p></div>`;
    if (explore.warning) html += `<div class="error-panel">${escapeHtml(explore.warning)}</div>`;
    if (explore.error || !explore.html) {
        html += `<div class="error-panel"><strong>The map could not be created:</strong> ${escapeHtml(explore.error || 'no map data')}</div>`;
        view.innerHTML = html;
        return;
    }
    view.innerHTML = html + '<iframe id="exploreFrame" class="explore-frame" title="Network map"></iframe>';
    document.getElementById('exploreFrame').srcdoc = explore.html;
}
