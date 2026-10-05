// Page start-up, tab navigation and the Network Summary tab.

let activeTab = null;
const TAB_STORAGE_KEY = 'pypsa-viewer-tab';

document.addEventListener('DOMContentLoaded', function() {
    populateNetworkSummary();
    populateComponentTypes();
    populateCustomPlots();
    setupEventListeners();
    if (networkData.summary.is_multi_index) {
        document.getElementById('yearGroup').style.display = 'flex';
        const yearSelect = document.getElementById('yearSelect');
        networkData.summary.periods.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            yearSelect.appendChild(opt);
        });
        if (networkData.summary.periods.length > 0) {
            yearSelect.value = networkData.summary.periods[0];
        }
    }
    setupTabs();
});

// --- Tabs -----------------------------------------------------------------------
function tabAvailable(name) {
    if (name === 'balance') return !!networkData.balance;
    if (name === 'custom') return (networkData.summary.custom_plots || []).length > 0;
    return true;
}

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (!tabAvailable(btn.dataset.tab)) btn.style.display = 'none';
        btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });
    // Reopen the tab the viewer last used (per-browser convenience only)
    let saved = null;
    try { saved = localStorage.getItem(TAB_STORAGE_KEY); } catch (e) {}
    activateTab(saved && tabAvailable(saved) && document.getElementById('tab-' + saved) ? saved : 'summary');
}

function activateTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab-btn').forEach(b => {
        const on = b.dataset.tab === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    try { localStorage.setItem(TAB_STORAGE_KEY, name); } catch (e) {}
    // Plots are drawn when their tab is visible so Plotly can size them correctly
    renderTab(name);
}

function renderTab(name) {
    try {
        if (name === 'balance') displayLoadGeneration();
        else if (name === 'components') renderComponentsView();
        else if (name === 'custom') displayCustomPlot(document.getElementById('customPlotSelect').value);
        else if (name === 'explore') renderExplore();
    } catch (error) {
        console.error(error);
        showError('Error loading data: ' + error.message, name);
    }
}

function setupEventListeners() {
    document.getElementById('componentTypeSelect').addEventListener('change', onComponentTypeChange);
    document.getElementById('dataTypeSelect').addEventListener('change', onDataTypeChange);
    document.getElementById('timeseriesSelect').addEventListener('change', renderComponentsView);
    document.getElementById('customPlotSelect').addEventListener('change', function() {
        displayCustomPlot(this.value);
    });
    // The investment period applies to every tab: redraw the one on screen
    document.getElementById('yearSelect').addEventListener('change', () => renderTab(activeTab));
}

// --- Network Summary tab ----------------------------------------------------------
function populateNetworkSummary() {
    const summary = networkData.summary;
    const skip = new Set(['network_info', 'global_constraints', 'custom_plots', 'is_multi_index', 'periods', 'period_index']);

    let html = '';
    Object.entries(summary).forEach(([key, value]) => {
        if (!skip.has(key)) {
            html += `<div class="summary-card"><h3>${value}</h3><p>${key.replace(/_/g, ' ').toUpperCase()}</p></div>`;
        }
    });
    document.getElementById('networkSummary').innerHTML = html;

    const info = summary.network_info || {};
    let details = '<div class="network-details"><h3 class="section-title">Network Details</h3>';
    Object.entries(info).forEach(([key, value]) => {
        details += `<div class="network-details-item"><div class="network-details-label">${escapeHtml(key)}</div><div class="network-details-value">${escapeHtml(value)}</div></div>`;
    });
    document.getElementById('networkDetails').innerHTML = details + '</div>';
}
