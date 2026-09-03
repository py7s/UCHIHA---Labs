'use strict';

(function() {
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function fmtTime(ts) { return ts ? new Date(ts).toLocaleString() : '—'; }

    async function init() {
        const token = sessionStorage.getItem('uchiha_token');
        if (!token) { window.location.href = './login_register.html'; return; }

        try {
            const res = await fetch((typeof apiUrl === 'function' ? apiUrl('/api/orders') : '/api/orders'), {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            const grid = document.getElementById('inventoryGrid');
            const licBox = document.getElementById('inventoryLicenses');

            const items = (data.orders || []).filter(o => o.status === 'completed');
            if (items.length === 0) {
                grid.innerHTML = '<p style="color:#808080;padding:20px;">No products yet. Visit the store to get started.</p>';
                licBox.innerHTML = '<p style="color:#808080;">No license keys yet.</p>';
                return;
            }

            const productMap = {};
            items.forEach(o => {
                if (!productMap[o.product_id]) productMap[o.product_id] = { product: o.title || 'Product #' + o.product_id, count: 0, latest: o };
                productMap[o.product_id].count++;
                if (o.created_at > productMap[o.product_id].latest.created_at) productMap[o.product_id].latest = o;
            });

            grid.innerHTML = Object.values(productMap).map(p =>
                '<div class="info-card">' +
                    '<h4>' + esc(p.product) + '</h4>' +
                    '<p>' + p.count + ' license(s)</p>' +
                '</div>'
            ).join('');

            licBox.innerHTML = items.map(o =>
                '<div class="info-card" style="margin-bottom:8px;">' +
                    '<h4>' + esc(o.title || ('Product #' + o.product_id)) + '</h4>' +
                    '<p style="font-family:monospace;color:#ff8080;">' + esc(o.license_key || '—') + '</p>' +
                    '<small style="color:#808080;">' + fmtTime(o.created_at) + '</small>' +
                '</div>'
            ).join('');
        } catch (e) {
            document.getElementById('inventoryGrid').innerHTML = '<p style="color:#ff8080;">Failed to load inventory: ' + esc(e.message) + '</p>';
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})()