'use strict';

(function() {
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    async function init() {
        const list = document.getElementById('qaList');
        if (!list) return;
        list.innerHTML = '<p style="color:#808080;">Loading Q&amp;A...</p>';

        let data = null;
        try {
            const res = await fetch((typeof apiUrl === 'function' ? apiUrl('/api/qa') : '/api/qa'));
            if (res.ok) data = await res.json();
        } catch (e) {}

        if (!data) {
            list.innerHTML = '<p style="color:#ff8080;">Could not load Q&amp;A. Make sure the backend is running.</p>';
            return;
        }

        const items = (data.qa || []).sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
        if (items.length === 0) {
            list.innerHTML = '<p style="color:#808080;">No Q&amp;A entries yet.</p>';
            return;
        }

        list.innerHTML = items.map(function(q) {
            return '<div class="qa-item" style="background:rgba(220,0,0,0.06);border:1px solid rgba(220,0,0,0.20);border-radius:10px;padding:16px 18px;margin-bottom:10px;">' +
                '<h3 style="color:#ffb1b1;margin:0 0 8px;">' + esc(q.question) + '</h3>' +
                '<p style="color:#cc8080;margin:0;">' + esc(q.answer || '—') + '</p>' +
                (q.category ? '<small style="color:#808080;display:block;margin-top:8px;">Category: ' + esc(q.category) + '</small>' : '') +
            '</div>';
        }).join('');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();