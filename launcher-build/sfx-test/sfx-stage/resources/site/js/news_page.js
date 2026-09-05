'use strict';

(function() {
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function fmt(ts) { return ts ? new Date(ts).toLocaleString() : ''; }

    async function init() {
        const list = document.getElementById('newsList');
        if (!list) return;
        list.innerHTML = '<p style="color:#808080;">Loading news...</p>';

        try {
            const res = await fetch((typeof apiUrl === 'function' ? apiUrl('/api/news') : '/api/news'));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const items = data.news || [];
            if (items.length === 0) {
                list.innerHTML = '<p style="color:#808080;">No news posts yet.</p>';
                return;
            }
            list.innerHTML = items.map(function(n) {
                return '<div class="news-card">' +
                    (n.image_url ? '<img src="' + esc(n.image_url) + '" alt="">' : '') +
                    '<h2>' + esc(n.title) + '</h2>' +
                    '<div class="meta">' + fmt(n.created_at) + '</div>' +
                    '<p>' + esc(n.body || '') + '</p>' +
                '</div>';
            }).join('');
        } catch (e) {
            list.innerHTML = '<p style="color:#ff8080;">Failed to load news: ' + esc(e.message) + '</p>';
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();