/* ZAGROOO Panel — event log page. */

const events = document.getElementById('events');
const filterInput = document.getElementById('filter');
const levelSelect = document.getElementById('level');
const refreshButton = document.getElementById('refresh');
const clearButton = document.getElementById('clear');

let log = [];

document.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('#theme-toggle');
    if (!button) return;
    var root = document.documentElement;
    var isDark = root.classList.toggle('dark');
    try { localStorage.setItem('zag-theme', isDark ? 'dark' : 'light'); } catch (err) { }
});

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function fmtTime(ts) {
    const date = new Date(ts);
    return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

function render() {
    const query = (filterInput.value || '').trim().toLowerCase();
    const level = levelSelect.value;

    const visible = log.filter(event => {
        if (level && event.level !== level) return false;
        if (!query) return true;
        return `${event.source} ${event.message} ${event.detail}`.toLowerCase().includes(query);
    });

    if (!visible.length) {
        events.innerHTML = `<div class="empty">${log.length ? 'No events match the filter.' : 'Nothing has been logged yet.'}</div>`;
        return;
    }

    events.innerHTML = visible.map(event => {
        const detail = event.detail
            ? `<div class="event-detail">${escapeHtml(event.detail)}</div>`
            : '';

        return `<div class="event is-${event.level}">
            <div class="event-head">
                <span class="event-level">${event.level === 'error' ? 'ERROR' : 'WARN'}</span>
                <span class="event-source">${escapeHtml(event.source)}</span>
                <span class="event-time">${fmtTime(event.ts)}</span>
            </div>
            <div class="event-message">${escapeHtml(event.message)}</div>
            ${detail}
        </div>`;
    }).join('');
}

async function load() {
    try {
        // The page is served at /{securePath}/log, so this resolves to
        // /{securePath}/log/api — a bare 'api/log' would land on the
        // /{securePath}/api/* machine routes instead.
        const res = await fetch('log/api', { credentials: 'same-origin' });
        const data = await res.json();

        if (!data.success) throw new Error(data.message || `HTTP ${res.status}`);
        log = data.body?.events ?? [];
    } catch (error) {
        log = [];
        events.innerHTML = `<div class="empty">Could not load the log — ${escapeHtml(error.message || error)}</div>`;
        return;
    }

    render();
}

refreshButton.addEventListener('click', load);
filterInput.addEventListener('input', render);
levelSelect.addEventListener('change', render);

clearButton.addEventListener('click', async () => {
    if (!confirm('Clear the whole event log? This cannot be undone.')) return;

    try {
        const res = await fetch('log/api', {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || `HTTP ${res.status}`);

        log = [];
        render();
    } catch (error) {
        alert(`Could not clear the log — ${error.message || error}`);
    }
});

load();
