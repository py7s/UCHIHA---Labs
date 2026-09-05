'use strict';

(function() {
    function fmtTime(ts) { return ts ? new Date(ts).toLocaleString() : '—'; }
    function esc(s) { return String(s == null ? '' : s); }

    async function init() {
        const token = sessionStorage.getItem('uchiha_token');
        if (!token) { window.location.href = './login_register.html'; return; }

        let user = null;
        try { user = JSON.parse(sessionStorage.getItem('uchiha_user') || 'null'); } catch (e) {}

        const perms = String((user && (user.account_permissions || user.account_type)) || 'User');
        const ranks = { User: 0, VIP: 1, Partner: 2, Beta: 3, UnlockAll: 4, Admin: 5, Owner: 6 };
        const rank = ranks[perms] || 0;

        const statusEl = document.getElementById('labPassActive');
        const sinceEl = document.getElementById('labPassSince');
        const renewsEl = document.getElementById('labPassRenews');
        const tierEl = document.getElementById('labPassTier');

        if (rank >= 5) {
            statusEl.innerHTML = '<span style="color:#86efac;">Active (Owner)</span>';
            tierEl.textContent = 'Owner';
            sinceEl.textContent = user && user.member_since ? fmtTime(user.member_since) : '—';
            renewsEl.textContent = 'Never (lifetime)';
        } else if (rank >= 3) {
            statusEl.innerHTML = '<span style="color:#86efac;">Active</span>';
            tierEl.textContent = perms;
            sinceEl.textContent = user && user.member_since ? fmtTime(user.member_since) : '—';
            renewsEl.textContent = 'Next season';
        } else {
            statusEl.innerHTML = '<span style="color:#ff8080;">Not active</span>';
            tierEl.textContent = 'None';
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();