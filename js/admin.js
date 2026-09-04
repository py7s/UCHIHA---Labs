'use strict';

(function() {
    const ADMIN_API = '/api/admin';
    let currentUser = null;
    let settingsCache = {};

    function apiUrlFallback(path) {
        return (typeof apiUrl === 'function') ? apiUrl(path) : path;
    }

    function getToken() {
        try { return sessionStorage.getItem('uchiha_token'); }
        catch (e) { return null; }
    }

    function getStoredUser() {
        try {
            const u = sessionStorage.getItem('uchiha_user');
            return u ? JSON.parse(u) : null;
        } catch (e) { return null; }
    }

    async function adminFetch(path, options) {
        options = options || {};
        const token = getToken();
        const headers = Object.assign({}, options.headers || {}, { 'Content-Type': 'application/json' });
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(apiUrlFallback(ADMIN_API + path), Object.assign({}, options, { headers }));
        if (!res.ok) {
            const body = await res.text();
            throw new Error(res.status + ': ' + (body || res.statusText));
        }
        return res.json();
    }

    function banner(msg, type) {
        const el = document.getElementById('adminBanner');
        if (!el) return;
        el.className = 'admin-banner ' + (type || 'success');
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.display = 'none'; }, 3000);
    }

    function notifySaved(kind) {
        try {
            sessionStorage.setItem('uchiha_admin_saved_ts', String(Date.now()));
            sessionStorage.setItem('uchiha_admin_saved_kind', kind || '');
            window.dispatchEvent(new CustomEvent('uchiha:admin-saved', { detail: { kind: kind } }));
        } catch (e) {}
    }

    function refreshLauncherData() {
        try {
            window.dispatchEvent(new CustomEvent('uchiha:refresh-data'));
        } catch (e) {}
    }

    function fmtTime(ts) {
        if (!ts) return '—';
        try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function roleBadge(perms) {
        const p = String(perms || 'User').toLowerCase();
        return '<span class="role-badge ' + p + '">' + esc(perms || 'User') + '</span>';
    }

    function showSection(name) {
        document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
        const target = document.getElementById('tab-' + name);
        if (target) target.style.display = 'block';
        document.querySelectorAll('.admin-nav-item[data-tab]').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tab') === name);
        });
        const titleEl = document.getElementById('adminTitle');
        const labels = {
            dashboard: 'Dashboard', users: 'Users', products: 'Products',
            coupons: 'Coupons', bank: 'Bank Packs', orders: 'Orders',
            forum: 'Forum', settings: 'Settings', audit: 'Audit Log',
            news: 'News', qa: 'Q&A', partners: 'Partners', launcher: 'Launcher',
        };
        if (titleEl) titleEl.textContent = labels[name] || name;
    }

    function openModal(html) {
        document.getElementById('adminModalInner').innerHTML = html;
        document.getElementById('adminModalOverlay').style.display = 'flex';
    }
    function closeModal() {
        document.getElementById('adminModalOverlay').style.display = 'none';
    }

    async function loadDashboard() {
        try {
            const s = await adminFetch('/stats');
            document.getElementById('statTotalUsers').textContent = s.totalUsers;
            document.getElementById('statTotalOrders').textContent = s.totalOrders;
            document.getElementById('statRevenue').textContent = '$' + Number(s.totalRevenue || 0).toFixed(2);
            document.getElementById('statCoupons').textContent = s.activeCoupons + ' / ' + s.totalCoupons;
            document.getElementById('statProducts').textContent = s.totalProducts;
            document.getElementById('statForum').textContent = s.totalForum;

            const ut = document.querySelector('#recentUsersTable tbody');
            ut.innerHTML = (s.recentUsers || []).map(u =>
                '<tr><td>' + u.id + '</td><td>' + esc(u.username) + '</td><td>' + esc(u.email || '—') + '</td><td>' + roleBadge(u.account_permissions || u.account_type) + '</td><td>' + fmtTime(u.created_at) + '</td></tr>'
            ).join('');

            const ot = document.querySelector('#recentOrdersTable tbody');
            ot.innerHTML = (s.recentOrders || []).map(o =>
                '<tr><td>' + o.id + '</td><td>' + esc(o.username || '—') + '</td><td>' + esc(o.title || '—') + '</td><td>' + esc(String(o.amount)) + ' ' + esc(o.currency) + '</td><td>' + esc(o.status) + '</td></tr>'
            ).join('');
        } catch (e) {
            banner('Failed to load dashboard: ' + e.message, 'error');
        }
    }

    async function loadUsers(q) {
        try {
            const url = q ? ('/users?q=' + encodeURIComponent(q)) : '/users';
            const data = await adminFetch(url);
            const tb = document.querySelector('#usersTable tbody');
            tb.innerHTML = (data.users || []).map(u => {
                const banBtn = u.banned
                    ? '<button class="admin-btn admin-btn-small" data-act="unban" data-id="' + u.id + '">Unban</button>'
                    : '<button class="admin-btn admin-btn-small admin-btn-danger" data-act="ban" data-id="' + u.id + '">Ban</button>';
                return '<tr>' +
                    '<td>' + u.id + '</td>' +
                    '<td><a href="#" data-act="view" data-id="' + u.id + '" style="color:#ffb1b1;">' + esc(u.username) + '</a></td>' +
                    '<td>' + esc(u.email || '—') + '</td>' +
                    '<td>' + roleBadge(u.account_permissions || u.account_type) + '</td>' +
                    '<td>' + (u.lc_balance || 0) + '</td>' +
                    '<td>' + (u.banned ? '<span class="status-pill banned">Banned</span>' : '<span class="status-pill active">Active</span>') + '</td>' +
                    '<td class="row-actions">' + banBtn +
                        '<button class="admin-btn admin-btn-small" data-act="edit" data-id="' + u.id + '">Edit</button>' +
                        '<button class="admin-btn admin-btn-small" data-act="grantlc" data-id="' + u.id + '">Grant LC</button>' +
                    '</td>' +
                    '</tr>';
            }).join('');
        } catch (e) {
            banner('Failed to load users: ' + e.message, 'error');
        }
    }

    async function loadProducts() {
        try {
            const data = await adminFetch('/products');
            const tb = document.querySelector('#productsTable tbody');
            tb.innerHTML = (data.products || []).map(p =>
                '<tr>' +
                '<td>' + p.id + '</td>' +
                '<td>' + esc(p.title) + '</td>' +
                '<td>' + esc(p.category || '—') + '</td>' +
                '<td>$' + Number(p.price || 0).toFixed(2) + '</td>' +
                '<td>' + (p.stock === -1 ? '∞' : p.stock) + '</td>' +
                '<td class="row-actions">' +
                    '<button class="admin-btn admin-btn-small" data-act="editprod" data-id="' + p.id + '">Edit</button>' +
                    '<button class="admin-btn admin-btn-small admin-btn-danger" data-act="delprod" data-id="' + p.id + '">Delete</button>' +
                '</td>' +
                '</tr>'
            ).join('');
        } catch (e) {
            banner('Failed to load products: ' + e.message, 'error');
        }
    }

    async function loadCoupons() {
        try {
            const data = await adminFetch('/coupons');
            const tb = document.querySelector('#couponsTable tbody');
            tb.innerHTML = (data.coupons || []).map(c =>
                '<tr>' +
                '<td><code>' + esc(c.code) + '</code></td>' +
                '<td>' + (c.discount_percent ? c.discount_percent + '%' : '$' + Number(c.discount_amount).toFixed(2)) + '</td>' +
                '<td>' + c.used_count + ' / ' + (c.max_uses === -1 ? '∞' : c.max_uses) + '</td>' +
                '<td>' + esc(c.min_role) + '</td>' +
                '<td>' + (c.expires_at ? fmtTime(c.expires_at) : '—') + '</td>' +
                '<td>' + (c.active ? '<span class="status-pill active">Yes</span>' : '<span class="status-pill inactive">No</span>') + '</td>' +
                '<td class="row-actions">' +
                    '<button class="admin-btn admin-btn-small" data-act="editcoupon" data-id="' + c.id + '">Edit</button>' +
                    '<button class="admin-btn admin-btn-small admin-btn-danger" data-act="delcoupon" data-id="' + c.id + '">Delete</button>' +
                '</td>' +
                '</tr>'
            ).join('');
        } catch (e) {
            banner('Failed to load coupons: ' + e.message, 'error');
        }
    }

    async function loadBankPacks() {
        try {
            const data = await adminFetch('/bank_packs');
            const tb = document.querySelector('#bankPacksTable tbody');
            tb.innerHTML = (data.packs || []).map(p =>
                '<tr>' +
                '<td>' + p.id + '</td>' +
                '<td>' + esc(p.name) + '</td>' +
                '<td>$' + Number(p.price || 0).toFixed(2) + '</td>' +
                '<td>' + (p.lc_amount || 0) + ' LC</td>' +
                '<td>' + (p.badge ? '<span class="role-badge ' + esc(p.badge) + '">' + esc(p.badge) + '</span>' : '—') + '</td>' +
                '<td class="row-actions">' +
                    '<button class="admin-btn admin-btn-small" data-act="editpack" data-id="' + p.id + '">Edit</button>' +
                    '<button class="admin-btn admin-btn-small admin-btn-danger" data-act="delpack" data-id="' + p.id + '">Delete</button>' +
                '</td>' +
                '</tr>'
            ).join('');
        } catch (e) {
            banner('Failed to load bank packs: ' + e.message, 'error');
        }
    }

    async function loadOrders() {
        try {
            const data = await adminFetch('/orders');
            const tb = document.querySelector('#ordersTable tbody');
            tb.innerHTML = (data.orders || []).map(o =>
                '<tr>' +
                '<td>' + o.id + '</td>' +
                '<td>' + esc(o.username || '—') + '</td>' +
                '<td>' + esc(o.title || '—') + '</td>' +
                '<td>' + esc(String(o.amount)) + '</td>' +
                '<td>' + esc(o.currency) + '</td>' +
                '<td>' + esc(o.status) + '</td>' +
                '<td>' + fmtTime(o.created_at) + '</td>' +
                '</tr>'
            ).join('');
        } catch (e) {
            banner('Failed to load orders: ' + e.message, 'error');
        }
    }

    async function loadForum() {
        try {
            const data = await adminFetch('/forum');
            const tb = document.querySelector('#forumTable tbody');
            tb.innerHTML = (data.posts || []).map(p =>
                '<tr>' +
                '<td>' + p.id + '</td>' +
                '<td>' + esc((p.title || '').slice(0, 60)) + '</td>' +
                '<td>' + esc(p.username || '—') + '</td>' +
                '<td>' + (p.likes || 0) + '</td>' +
                '<td>' + (p.pinned ? '�Œ' : '—') + '</td>' +
                '<td class="row-actions">' +
                    '<button class="admin-btn admin-btn-small" data-act="pinpost" data-id="' + p.id + '">Pin</button>' +
                    '<button class="admin-btn admin-btn-small admin-btn-danger" data-act="delpost" data-id="' + p.id + '">Delete</button>' +
                '</td>' +
                '</tr>'
            ).join('');
        } catch (e) {
            banner('Failed to load forum: ' + e.message, 'error');
        }
    }

    async function loadSettings() {
        try {
            const data = await adminFetch('/settings');
            settingsCache = data;
            const form = document.getElementById('settingsForm');
            const fields = [
                ['site_name', 'Site Name', 'text'],
                ['site_tagline', 'Tagline', 'text'],
                ['default_currency', 'Default Currency', 'text'],
                ['discord_invite', 'Discord Invite URL', 'text'],
                ['github_username', 'GitHub Username', 'text'],
                ['maintenance_mode', 'Maintenance Mode (on/off)', 'text'],
                ['maintenance_reason', 'Maintenance Reason (shown to visitors)', 'text'],
                ['registration_enabled', 'Registration Enabled (true/false)', 'text'],
                ['default_lc_new_user', 'Default LC for New Users', 'number'],
                ['store_tab', 'Store Tab', 'text'],
                ['customer_panel_tab', 'Customer Panel Tab', 'text'],
                ['lab_pass_tab', 'Lab-Pass Tab', 'text'],
                ['inventory_tab', 'Inventory Tab', 'text'],
                ['reviews_tab', 'Reviews Tab', 'text'],
                ['partner_tab', 'Partner Tab', 'text'],
                ['forum_tab', 'Forum Tab', 'text'],
                ['bank_tab', 'Bank Tab', 'text'],
                ['q_and_a_tab', 'Q&A Tab', 'text'],
                ['github_page', 'GitHub Page Tab', 'text'],
                ['status_page', 'Status Page Tab', 'text'],
                ['download_button', 'Download Button', 'text'],
                ['join_discord_button', 'Join Discord Button', 'text'],
                ['launcher_version', 'Launcher Version', 'text'],
                ['launcher_changelog', 'Launcher Changelog', 'text'],
                ['launcher_required_role', 'Launcher Required Role (User/VIP/Partner/Beta/UnlockAll/Admin/Owner)', 'text'],
            ];
            form.innerHTML = fields.map(([key, label, type]) => {
                const v = data[key] != null ? data[key] : '';
                return '<div class="admin-form-group"><label>' + esc(label) + '</label><input type="' + type + '" data-key="' + esc(key) + '" value="' + esc(v) + '"></div>';
            }).join('');
        } catch (e) {
            banner('Failed to load settings: ' + e.message, 'error');
        }
    }

    async function saveSettings() {
        const inputs = document.querySelectorAll('#settingsForm input[data-key]');
        const payload = {};
        inputs.forEach(i => { payload[i.getAttribute('data-key')] = i.value; });
        try {
            await adminFetch('/settings/update', { method: 'POST', body: JSON.stringify(payload) });
            banner('Settings saved', 'success');
            notifySaved('settings');
            refreshLauncherData();
        } catch (e) {
            banner('Save failed: ' + e.message, 'error');
        }
    }

    async function loadAudit() {
        try {
            const data = await adminFetch('/audit_log');
            const tb = document.querySelector('#auditTable tbody');
            tb.innerHTML = (data.log || []).map(l =>
                '<tr><td>' + fmtTime(l.created_at) + '</td><td>' + esc(l.username || '—') + '</td><td>' + esc(l.action) + '</td><td>' + esc(l.ip || '—') + '</td></tr>'
            ).join('');
        } catch (e) {
            banner('Failed to load audit log: ' + e.message, 'error');
        }
    }

    async function loadNewsAdmin() {
        try {
            const data = await adminFetch('/news');
            const tb = document.querySelector('#newsTable tbody');
            tb.innerHTML = (data.news || []).map(n =>
                '<tr>' +
                '<td>' + n.id + '</td>' +
                '<td>' + esc(n.title) + '</td>' +
                '<td>' + (n.image_url ? '<img src="' + esc(n.image_url) + '" style="width:48px;height:32px;object-fit:cover;border-radius:4px;">' : '—') + '</td>' +
                '<td>' + fmtTime(n.created_at) + '</td>' +
                '<td class="row-actions">' +
                    '<button class="admin-btn admin-btn-small" data-act="editnews" data-id="' + n.id + '">Edit</button>' +
                    '<button class="admin-btn admin-btn-small admin-btn-danger" data-act="delnews" data-id="' + n.id + '">Delete</button>' +
                '</td>' +
                '</tr>'
            ).join('');
        } catch (e) { banner('Failed to load news: ' + e.message, 'error'); }
    }

    async function loadQaAdmin() {
        try {
            const data = await adminFetch('/qa');
            const tb = document.querySelector('#qaTable tbody');
            tb.innerHTML = (data.qa || []).map(q =>
                '<tr>' +
                '<td>' + esc((q.question || '').slice(0, 60)) + '</td>' +
                '<td>' + esc((q.answer || '').slice(0, 60)) + '</td>' +
                '<td>' + esc(q.category || '—') + '</td>' +
                '<td>' + (q.sort_order || 0) + '</td>' +
                '<td class="row-actions">' +
                    '<button class="admin-btn admin-btn-small" data-act="editqa" data-id="' + q.id + '">Edit</button>' +
                    '<button class="admin-btn admin-btn-small admin-btn-danger" data-act="delqa" data-id="' + q.id + '">Delete</button>' +
                '</td>' +
                '</tr>'
            ).join('');
        } catch (e) { banner('Failed to load qa: ' + e.message, 'error'); }
    }

    async function loadPartnersAdmin() {
        try {
            const data = await adminFetch('/partners');
            const tb = document.querySelector('#partnersAdminTable tbody');
            tb.innerHTML = (data.partners || []).map(p =>
                '<tr>' +
                '<td>' + p.id + '</td>' +
                '<td>' + esc(p.name) + '</td>' +
                '<td>' + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" style="color:#ffb1b1;">link</a>' : '—') + '</td>' +
                '<td>' + esc(p.discord || '—') + '</td>' +
                '<td class="row-actions">' +
                    '<button class="admin-btn admin-btn-small" data-act="editpartner" data-id="' + p.id + '">Edit</button>' +
                    '<button class="admin-btn admin-btn-small admin-btn-danger" data-act="delpartner" data-id="' + p.id + '">Delete</button>' +
                '</td>' +
                '</tr>'
            ).join('');
        } catch (e) { banner('Failed to load partners: ' + e.message, 'error'); }
    }

    async function loadGlobalMaintenanceAdmin() {
        try {
            const data = await adminFetch('/settings');
            const modeEl = document.getElementById('globalMaintenanceMode');
            const reasonEl = document.getElementById('globalMaintenanceReason');
            if (modeEl) modeEl.value = data.maintenance_mode === 'on' ? 'on' : 'off';
            if (reasonEl) reasonEl.value = data.maintenance_reason || '';
        } catch (e) { banner('Failed to load maintenance settings: ' + e.message, 'error'); }
    }

    document.getElementById('saveGlobalMaintenanceBtn')?.addEventListener('click', async () => {
        const mode = document.getElementById('globalMaintenanceMode').value;
        const reason = document.getElementById('globalMaintenanceReason').value;
        try {
            await adminFetch('/settings/update', { method: 'POST', body: JSON.stringify({ maintenance_mode: mode, maintenance_reason: reason }) });
            banner('Maintenance settings saved', 'success');
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    });

    async function loadLauncherAdmin() {
        try {
            const data = await adminFetch('/launcher');
            const verEl = document.getElementById('launcherVersionInput');
            const chEl = document.getElementById('launcherChangelogInput');
            const roleEl = document.getElementById('launcherRoleInput');
            if (verEl) verEl.value = data.version || '';
            if (chEl) chEl.value = data.changelog || '';
            if (roleEl) roleEl.value = data.required_role || 'User';

            const platforms = ['windows', 'macos', 'linux'];
            const statsByP = {};
            (data.stats || []).forEach(s => { statsByP[s.platform] = s; });
            const tb = document.querySelector('#launcherFilesTable tbody');
            if (tb) {
                tb.innerHTML = platforms.map(p => {
                    const f = data.files[p] || {};
                    const s = statsByP[p] || { count: 0, last_at: null };
                    return '<tr>' +
                        '<td>' + p + '</td>' +
                        '<td>' + (f.available ? '<span class="status-pill active">Yes</span>' : '<span class="status-pill inactive">No</span>') + '</td>' +
                        '<td>' + (f.size_bytes ? (f.size_bytes / 1024 / 1024).toFixed(2) + ' MB' : '—') + '</td>' +
                        '<td>' + (f.uploaded_at ? fmtTime(f.uploaded_at) : '—') + '</td>' +
                        '<td>' + (s.count || 0) + '</td>' +
                        '<td>' + (s.last_at ? fmtTime(s.last_at) : '—') + '</td>' +
                    '</tr>';
                }).join('');
            }

            const ddata = await adminFetch('/launcher/downloads?limit=100');
            const dtb = document.querySelector('#launcherDownloadsTable tbody');
            if (dtb) {
                dtb.innerHTML = (ddata.downloads || []).map(d =>
                    '<tr>' +
                    '<td>' + fmtTime(d.created_at) + '</td>' +
                    '<td>' + esc(d.username || ('User #' + (d.user_id || '?'))) + '</td>' +
                    '<td>' + esc(d.platform) + '</td>' +
                    '<td>' + esc(d.version || '—') + '</td>' +
                    '<td>' + esc(d.ip || '—') + '</td>' +
                    '</tr>'
                ).join('') || '<tr><td colspan="5" style="color:#808080;text-align:center;padding:12px;">No downloads yet</td></tr>';
            }
        } catch (e) {
            banner('Failed to load launcher info: ' + e.message, 'error');
        }
    }

    async function saveLauncherSettings() {
        const ver = document.getElementById('launcherVersionInput').value.trim();
        const ch = document.getElementById('launcherChangelogInput').value;
        const role = document.getElementById('launcherRoleInput').value.trim() || 'User';
        try {
            await adminFetch('/launcher/settings', { method: 'POST', body: JSON.stringify({
                version: ver, changelog: ch, required_role: role
            }) });
            banner('Launcher settings saved', 'success');
            notifySaved('launcher');
            loadLauncherAdmin();
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    }

    async function uploadLauncherBinary() {
        const platform = document.getElementById('launcherUploadPlatform').value;
        const fileInput = document.getElementById('launcherUploadFile');
        if (!fileInput.files || !fileInput.files[0]) {
            banner('Please choose a file first', 'error');
            return;
        }
        const fd = new FormData();
        fd.append('file', fileInput.files[0]);
        fd.append('platform', platform);
        fd.append('version', document.getElementById('launcherVersionInput').value.trim() || '');
        fd.append('changelog', document.getElementById('launcherChangelogInput').value || '');
        fd.append('required_role', document.getElementById('launcherRoleInput').value.trim() || 'User');
        const status = document.getElementById('launcherUploadStatus');
        status.textContent = 'Uploading ' + fileInput.files[0].name + '...';
        try {
            const token = getToken();
            const res = await fetch(apiUrlFallback('/api/admin/launcher/upload'), {
                method: 'POST',
                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                body: fd,
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(res.status + ': ' + txt);
            }
            const data = await res.json();
            status.textContent = 'Uploaded: ' + data.file + ' (' + (data.size_bytes / 1024 / 1024).toFixed(2) + ' MB)';
            banner('Launcher uploaded', 'success');
            fileInput.value = '';
            notifySaved('launcher');
            loadLauncherAdmin();
        } catch (e) {
            status.textContent = 'Upload failed: ' + e.message;
            banner('Upload failed: ' + e.message, 'error');
        }
    }

    function newsForm(n) {
        const isEdit = !!n;
        return '<h3>' + (isEdit ? 'Edit News' : 'New News Post') + '</h3>' +
            '<form class="admin-form" id="newsForm">' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Title</label><input name="title" value="' + esc(n && n.title || '') + '" required></div>' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Image URL (optional)</label><input name="image_url" value="' + esc(n && n.image_url || '') + '"></div>' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Body</label><textarea name="body" rows="5">' + esc(n && n.body || '') + '</textarea></div>' +
            '</form>' +
            '<div class="admin-form-actions">' +
                '<button class="admin-btn" id="cancelNewsBtn">Cancel</button>' +
                '<button class="admin-btn admin-btn-primary" id="saveNewsBtn" data-id="' + esc(n && n.id || '') + '">Save</button>' +
            '</div>';
    }

    function qaForm(q) {
        const isEdit = !!q;
        return '<h3>' + (isEdit ? 'Edit Q&amp;A' : 'New Q&amp;A') + '</h3>' +
            '<form class="admin-form" id="qaForm">' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Question</label><input name="question" value="' + esc(q && q.question || '') + '" required></div>' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Answer</label><textarea name="answer" rows="3">' + esc(q && q.answer || '') + '</textarea></div>' +
                '<div class="admin-form-group"><label>Category</label><input name="category" value="' + esc(q && q.category || '') + '"></div>' +
                '<div class="admin-form-group"><label>Sort Order</label><input type="number" name="sort_order" value="' + esc(q && q.sort_order || 0) + '"></div>' +
            '</form>' +
            '<div class="admin-form-actions">' +
                '<button class="admin-btn" id="cancelQaBtn">Cancel</button>' +
                '<button class="admin-btn admin-btn-primary" id="saveQaBtn" data-id="' + esc(q && q.id || '') + '">Save</button>' +
            '</div>';
    }

    function partnerForm(p) {
        const isEdit = !!p;
        return '<h3>' + (isEdit ? 'Edit Partner' : 'New Partner') + '</h3>' +
            '<form class="admin-form" id="partnerForm">' +
                '<div class="admin-form-group"><label>Name</label><input name="name" value="' + esc(p && p.name || '') + '" required></div>' +
                '<div class="admin-form-group"><label>URL</label><input name="url" value="' + esc(p && p.url || '') + '"></div>' +
                '<div class="admin-form-group"><label>Discord</label><input name="discord" value="' + esc(p && p.discord || '') + '"></div>' +
                '<div class="admin-form-group"><label>Logo URL</label><input name="logo_url" value="' + esc(p && p.logo_url || '') + '"></div>' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Description</label><textarea name="description" rows="3">' + esc(p && p.description || '') + '</textarea></div>' +
            '</form>' +
            '<div class="admin-form-actions">' +
                '<button class="admin-btn" id="cancelPartnerBtn">Cancel</button>' +
                '<button class="admin-btn admin-btn-primary" id="savePartnerBtn" data-id="' + esc(p && p.id || '') + '">Save</button>' +
            '</div>';
    }

    function productForm(p) {
        const isEdit = !!p;
        return '<h3>' + (isEdit ? 'Edit Product' : 'New Product') + '</h3>' +
            '<form class="admin-form" id="productForm">' +
                '<div class="admin-form-group"><label>Title</label><input name="title" value="' + esc(p && p.title || '') + '" required></div>' +
                '<div class="admin-form-group"><label>Slug (optional)</label><input name="slug" value="' + esc(p && p.slug || '') + '"></div>' +
                '<div class="admin-form-group"><label>Category</label><input name="category" value="' + esc(p && p.category || '') + '"></div>' +
                '<div class="admin-form-group"><label>Price (USD)</label><input type="number" step="0.01" name="price" value="' + esc(p && p.price || 0) + '"></div>' +
                '<div class="admin-form-group"><label>Stock (-1 = unlimited)</label><input type="number" name="stock" value="' + esc(p && p.stock != null ? p.stock : -1) + '"></div>' +
                '<div class="admin-form-group"><label>Min Role</label><select name="min_role">' +
                    ['User','VIP','Partner','Beta','UnlockAll','Admin','Owner'].map(r =>
                        '<option value="' + r + '"' + ((p && p.min_role === r) ? ' selected' : '') + '>' + r + '</option>'
                    ).join('') +
                '</select></div>' +
                '<div class="admin-form-group"><label>Product Type</label><input name="product_type" value="' + esc(p && p.product_type || 'Tool') + '"></div>' +
                '<div class="admin-form-group"><label>Image URL</label><input name="image_url" value="' + esc(p && p.image_url || '') + '"></div>' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Short Description</label><textarea name="description" rows="2">' + esc(p && p.description || '') + '</textarea></div>' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Full Description</label><textarea name="full_description" rows="4">' + esc(p && p.full_description || '') + '</textarea></div>' +
                '<div class="admin-form-group"><label><input type="checkbox" name="popular"' + (p && p.popular ? ' checked' : '') + '> Popular</label></div>' +
                '<div class="admin-form-group"><label><input type="checkbox" name="is_new"' + (p && p.is_new ? ' checked' : '') + '> New</label></div>' +
            '</form>' +
            '<div class="admin-form-actions">' +
                '<button class="admin-btn" id="cancelProductBtn">Cancel</button>' +
                '<button class="admin-btn admin-btn-primary" id="saveProductBtn" data-id="' + esc(p && p.id || '') + '">Save</button>' +
            '</div>';
    }

    function couponForm(c) {
        const isEdit = !!c;
        return '<h3>' + (isEdit ? 'Edit Coupon' : 'New Coupon') + '</h3>' +
            '<form class="admin-form" id="couponForm">' +
                '<div class="admin-form-group"><label>Code</label><input name="code" value="' + esc(c && c.code || '') + '" required' + (isEdit ? ' disabled' : '') + '></div>' +
                '<div class="admin-form-group"><label>Discount %</label><input type="number" name="discount_percent" value="' + esc(c && c.discount_percent || 0) + '"></div>' +
                '<div class="admin-form-group"><label>Discount Amount (USD)</label><input type="number" step="0.01" name="discount_amount" value="' + esc(c && c.discount_amount || 0) + '"></div>' +
                '<div class="admin-form-group"><label>Max Uses (-1 = unlimited)</label><input type="number" name="max_uses" value="' + esc(c && c.max_uses != null ? c.max_uses : -1) + '"></div>' +
                '<div class="admin-form-group"><label>Min Role</label><select name="min_role">' +
                    ['User','VIP','Partner','Beta','UnlockAll','Admin','Owner'].map(r =>
                        '<option value="' + r + '"' + ((c && c.min_role === r) ? ' selected' : '') + '>' + r + '</option>'
                    ).join('') +
                '</select></div>' +
                '<div class="admin-form-group"><label>Expires At (timestamp, optional)</label><input type="number" name="expires_at" value="' + esc(c && c.expires_at || '') + '" placeholder="leave empty for never"></div>' +
                '<div class="admin-form-group"><label>Product ID (optional, for single product)</label><input type="number" name="product_id" value="' + esc(c && c.product_id || '') + '"></div>' +
                '<div class="admin-form-group"><label><input type="checkbox" name="active"' + (c && c.active === 0 ? '' : ' checked') + '> Active</label></div>' +
            '</form>' +
            '<div class="admin-form-actions">' +
                '<button class="admin-btn" id="cancelCouponBtn">Cancel</button>' +
                '<button class="admin-btn admin-btn-primary" id="saveCouponBtn" data-id="' + esc(c && c.id || '') + '">Save</button>' +
            '</div>';
    }

    function packForm(p) {
        const isEdit = !!p;
        return '<h3>' + (isEdit ? 'Edit Pack' : 'New Pack') + '</h3>' +
            '<form class="admin-form" id="packForm">' +
                '<div class="admin-form-group"><label>Name</label><input name="name" value="' + esc(p && p.name || '') + '" required></div>' +
                '<div class="admin-form-group"><label>Price (USD)</label><input type="number" step="0.01" name="price" value="' + esc(p && p.price || 0) + '"></div>' +
                '<div class="admin-form-group"><label>LC Amount</label><input type="number" name="lc_amount" value="' + esc(p && p.lc_amount || 0) + '"></div>' +
                '<div class="admin-form-group"><label>Badge (optional)</label><input name="badge" value="' + esc(p && p.badge || '') + '" placeholder="popular, vip, ..."></div>' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Description</label><textarea name="description" rows="2">' + esc(p && p.description || '') + '</textarea></div>' +
            '</form>' +
            '<div class="admin-form-actions">' +
                '<button class="admin-btn" id="cancelPackBtn">Cancel</button>' +
                '<button class="admin-btn admin-btn-primary" id="savePackBtn" data-id="' + esc(p && p.id || '') + '">Save</button>' +
            '</div>';
    }

    function userEditForm(u) {
        return '<h3>Edit User #' + u.id + '</h3>' +
            '<form class="admin-form" id="userEditForm">' +
                '<div class="admin-form-group"><label>Username</label><input value="' + esc(u.username) + '" disabled></div>' +
                '<div class="admin-form-group"><label>Email</label><input name="email" value="' + esc(u.email || '') + '"></div>' +
                '<div class="admin-form-group"><label>Phone</label><input name="phone" value="' + esc(u.phone || '') + '"></div>' +
                '<div class="admin-form-group"><label>Account Type</label><select name="account_type">' +
                    ['User','VIP','Partner','Beta','UnlockAll','Admin','Owner'].map(r =>
                        '<option value="' + r + '"' + ((u.account_type === r) ? ' selected' : '') + '>' + r + '</option>'
                    ).join('') +
                '</select></div>' +
                '<div class="admin-form-group"><label>Permissions</label><select name="account_permissions">' +
                    ['User','VIP','Partner','Beta','UnlockAll','Admin','Owner'].map(r =>
                        '<option value="' + r + '"' + ((u.account_permissions === r) ? ' selected' : '') + '>' + r + '</option>'
                    ).join('') +
                '</select></div>' +
                '<div class="admin-form-group"><label>LC Balance</label><input type="number" name="lc_balance" value="' + esc(u.lc_balance || 0) + '"></div>' +
                '<div class="admin-form-group"><label>Discord Coins</label><input type="number" name="user_discord_user_coin_amount" value="' + esc(u.user_discord_user_coin_amount || 0) + '"></div>' +
                '<div class="admin-form-group"><label><input type="checkbox" name="banned"' + (u.banned ? ' checked' : '') + '> Banned</label></div>' +
                '<div class="admin-form-group" style="grid-column:1/-1;"><label>Admin Note</label><textarea name="note" rows="2" placeholder="Optional internal note..."></textarea></div>' +
            '</form>' +
            '<div class="admin-form-actions">' +
                '<button class="admin-btn" id="cancelUserEditBtn">Cancel</button>' +
                '<button class="admin-btn admin-btn-primary" id="saveUserEditBtn" data-id="' + u.id + '">Save</button>' +
            '</div>';
    }

    function grantLcForm(u) {
        return '<h3>Grant LC to ' + esc(u.username) + '</h3>' +
            '<p style="color:#cc8080;margin-bottom:14px;">Current balance: <strong>' + (u.lc_balance || 0) + ' LC</strong></p>' +
            '<div class="admin-form">' +
                '<div class="admin-form-group"><label>Amount (positive or negative)</label><input type="number" id="grantLcAmount" value="100"></div>' +
            '</div>' +
            '<div class="admin-form-actions">' +
                '<button class="admin-btn" id="cancelGrantBtn">Cancel</button>' +
                '<button class="admin-btn admin-btn-primary" id="confirmGrantBtn" data-id="' + u.id + '">Grant</button>' +
            '</div>';
    }

    function collectForm(formEl) {
        const out = {};
        formEl.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
            if (el.type === 'checkbox') out[el.name] = el.checked;
            else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
            else out[el.name] = el.value;
        });
        return out;
    }

    async function viewUser(id) {
        try {
            const data = await adminFetch('/users/' + id);
            const u = data.user;
            const ordersHtml = (data.orders || []).slice(0, 10).map(o =>
                '<tr><td>' + o.id + '</td><td>' + esc(o.title || '—') + '</td><td>' + esc(String(o.amount)) + ' ' + esc(o.currency) + '</td><td>' + esc(o.status) + '</td><td>' + fmtTime(o.created_at) + '</td></tr>'
            ).join('') || '<tr><td colspan="5" style="color:#808080;text-align:center;padding:12px;">No orders</td></tr>';
            const notesHtml = (data.notes || []).map(n =>
                '<div style="padding:8px 0;border-bottom:1px solid var(--border-color);"><div style="font-size:11px;color:#cc8080;">' + esc(n.author_name || '—') + ' • ' + fmtTime(n.created_at) + '</div><div style="margin-top:4px;">' + esc(n.body) + '</div></div>'
            ).join('') || '<p style="color:#808080;">No notes</p>';
            openModal(
                '<h3>User: ' + esc(u.username) + '</h3>' +
                '<div style="margin-bottom:14px;">' + roleBadge(u.account_permissions || u.account_type) + (u.banned ? ' <span class="status-pill banned">BANNED</span>' : '') + '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px;font-size:13px;">' +
                    '<div><strong>ID:</strong> ' + u.id + '</div>' +
                    '<div><strong>UUID:</strong> ' + esc(u.uuid) + '</div>' +
                    '<div><strong>Email:</strong> ' + esc(u.email || '—') + '</div>' +
                    '<div><strong>Phone:</strong> ' + esc(u.phone || '—') + '</div>' +
                    '<div><strong>Discord:</strong> ' + esc(u.discord_username || (u.discord_user_id ? u.discord_user_id : '—')) + '</div>' +
                    '<div><strong>Member since:</strong> ' + fmtTime(u.member_since) + '</div>' +
                    '<div><strong>Last login:</strong> ' + fmtTime(u.last_login) + '</div>' +
                    '<div><strong>LC:</strong> ' + (u.lc_balance || 0) + '</div>' +
                '</div>' +
                '<h4 style="margin:12px 0 8px;color:#ffb1b1;">Recent Orders</h4>' +
                '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>Product</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>' + ordersHtml + '</tbody></table></div>' +
                '<h4 style="margin:16px 0 8px;color:#ffb1b1;">Admin Notes</h4>' + notesHtml
            );
        } catch (e) {
            banner('Failed to view user: ' + e.message, 'error');
        }
    }

    async function saveProduct(id) {
        const form = document.getElementById('productForm');
        const data = collectForm(form);
        try {
            if (id) await adminFetch('/products/' + id + '/update', { method: 'POST', body: JSON.stringify(data) });
            else await adminFetch('/products/create', { method: 'POST', body: JSON.stringify(data) });
            banner('Product saved', 'success');
            closeModal();
            loadProducts();
            notifySaved('products');
            refreshLauncherData();
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    }

    async function saveCoupon(id) {
        const form = document.getElementById('couponForm');
        const data = collectForm(form);
        try {
            if (id) await adminFetch('/coupons/' + id + '/update', { method: 'POST', body: JSON.stringify(data) });
            else await adminFetch('/coupons/create', { method: 'POST', body: JSON.stringify(data) });
            banner('Coupon saved', 'success');
            closeModal();
            loadCoupons();
            notifySaved('coupons');
            refreshLauncherData();
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    }

    async function savePack(id) {
        const form = document.getElementById('packForm');
        const data = collectForm(form);
        try {
            if (id) await adminFetch('/bank_packs/' + id + '/update', { method: 'POST', body: JSON.stringify(data) });
            else await adminFetch('/bank_packs/create', { method: 'POST', body: JSON.stringify(data) });
            banner('Pack saved', 'success');
            closeModal();
            loadBankPacks();
            notifySaved('bank_packs');
            refreshLauncherData();
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    }

    async function saveNewsAdmin(id) {
        const form = document.getElementById('newsForm');
        const data = collectForm(form);
        try {
            if (id) await adminFetch('/news/' + id + '/update', { method: 'POST', body: JSON.stringify(data) });
            else await adminFetch('/news/create', { method: 'POST', body: JSON.stringify(data) });
            banner('News saved', 'success');
            closeModal();
            loadNewsAdmin();
            notifySaved('news');
            refreshLauncherData();
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    }

    async function saveQaAdmin(id) {
        const form = document.getElementById('qaForm');
        const data = collectForm(form);
        try {
            if (id) await adminFetch('/qa/' + id + '/update', { method: 'POST', body: JSON.stringify(data) });
            else await adminFetch('/qa/create', { method: 'POST', body: JSON.stringify(data) });
            banner('Q&A saved', 'success');
            closeModal();
            loadQaAdmin();
            notifySaved('qa');
            refreshLauncherData();
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    }

    async function savePartnerAdmin(id) {
        const form = document.getElementById('partnerForm');
        const data = collectForm(form);
        try {
            if (id) await adminFetch('/partners/' + id + '/update', { method: 'POST', body: JSON.stringify(data) });
            else await adminFetch('/partners/create', { method: 'POST', body: JSON.stringify(data) });
            banner('Partner saved', 'success');
            closeModal();
            loadPartnersAdmin();
            notifySaved('partners');
            refreshLauncherData();
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    }

    async function saveUserEdit(id) {
        const form = document.getElementById('userEditForm');
        const data = collectForm(form);
        try {
            await adminFetch('/users/' + id + '/update', { method: 'POST', body: JSON.stringify(data) });
            banner('User updated', 'success');
            closeModal();
            loadUsers();
        } catch (e) { banner('Save failed: ' + e.message, 'error'); }
    }

    async function grantLcConfirm(id) {
        const v = parseInt(document.getElementById('grantLcAmount').value, 10) || 0;
        if (!v) return banner('Enter amount', 'error');
        try {
            await adminFetch('/users/' + id + '/grant_lc', { method: 'POST', body: JSON.stringify({ amount: v }) });
            banner('LC updated', 'success');
            closeModal();
            loadUsers();
        } catch (e) { banner('Failed: ' + e.message, 'error'); }
    }

    function bindActions() {
        document.body.addEventListener('click', async (e) => {
            const t = e.target.closest('[data-act]');
            if (!t) return;
            const act = t.getAttribute('data-act');
            const id = t.getAttribute('data-id');
            if (act === 'view') { viewUser(id); return; }
            if (act === 'edit') {
                const data = await adminFetch('/users/' + id);
                openModal(userEditForm(data.user));
                document.getElementById('cancelUserEditBtn').onclick = closeModal;
                document.getElementById('saveUserEditBtn').onclick = () => saveUserEdit(id);
                return;
            }
            if (act === 'grantlc') {
                const data = await adminFetch('/users/' + id);
                openModal(grantLcForm(data.user));
                document.getElementById('cancelGrantBtn').onclick = closeModal;
                document.getElementById('confirmGrantBtn').onclick = () => grantLcConfirm(id);
                return;
            }
            if (act === 'ban') {
                if (!confirm('Ban this user?')) return;
                await adminFetch('/users/' + id + '/ban', { method: 'POST' });
                banner('User banned', 'success');
                loadUsers();
                return;
            }
            if (act === 'unban') {
                await adminFetch('/users/' + id + '/unban', { method: 'POST' });
                banner('User unbanned', 'success');
                loadUsers();
                return;
            }
            if (act === 'editprod') {
                const list = (await adminFetch('/products')).products;
                const p = list.find(x => x.id == id);
                openModal(productForm(p));
                document.getElementById('cancelProductBtn').onclick = closeModal;
                document.getElementById('saveProductBtn').onclick = () => saveProduct(id);
                return;
            }
            if (act === 'delprod') {
                if (!confirm('Delete product?')) return;
                await adminFetch('/products/' + id + '/delete', { method: 'POST' });
                banner('Deleted', 'success');
                loadProducts();
                return;
            }
            if (act === 'editcoupon') {
                const list = (await adminFetch('/coupons')).coupons;
                const c = list.find(x => x.id == id);
                openModal(couponForm(c));
                document.getElementById('cancelCouponBtn').onclick = closeModal;
                document.getElementById('saveCouponBtn').onclick = () => saveCoupon(id);
                return;
            }
            if (act === 'delcoupon') {
                if (!confirm('Delete coupon?')) return;
                await adminFetch('/coupons/' + id + '/delete', { method: 'POST' });
                banner('Deleted', 'success');
                loadCoupons();
                return;
            }
            if (act === 'editpack') {
                const list = (await adminFetch('/bank_packs')).packs;
                const p = list.find(x => x.id == id);
                openModal(packForm(p));
                document.getElementById('cancelPackBtn').onclick = closeModal;
                document.getElementById('savePackBtn').onclick = () => savePack(id);
                return;
            }
            if (act === 'delpack') {
                if (!confirm('Delete pack?')) return;
                await adminFetch('/bank_packs/' + id + '/delete', { method: 'POST' });
                banner('Deleted', 'success');
                loadBankPacks();
                return;
            }
            if (act === 'pinpost') {
                await adminFetch('/forum/' + id + '/pin', { method: 'POST' });
                banner('Toggled pin', 'success');
                loadForum();
                return;
            }
            if (act === 'delpost') {
                if (!confirm('Delete forum post?')) return;
                await adminFetch('/forum/' + id + '/delete', { method: 'POST' });
                banner('Deleted', 'success');
                loadForum();
                return;
            }
            if (act === 'editnews') {
                const list = (await adminFetch('/news')).news;
                const n = list.find(x => x.id == id);
                openModal(newsForm(n));
                document.getElementById('cancelNewsBtn').onclick = closeModal;
                document.getElementById('saveNewsBtn').onclick = () => saveNewsAdmin(id);
                return;
            }
            if (act === 'delnews') {
                if (!confirm('Delete news post?')) return;
                await adminFetch('/news/' + id + '/delete', { method: 'POST' });
                banner('Deleted', 'success');
                loadNewsAdmin();
                return;
            }
            if (act === 'editqa') {
                const list = (await adminFetch('/qa')).qa;
                const q = list.find(x => x.id == id);
                openModal(qaForm(q));
                document.getElementById('cancelQaBtn').onclick = closeModal;
                document.getElementById('saveQaBtn').onclick = () => saveQaAdmin(id);
                return;
            }
            if (act === 'delqa') {
                if (!confirm('Delete Q&A?')) return;
                await adminFetch('/qa/' + id + '/delete', { method: 'POST' });
                banner('Deleted', 'success');
                loadQaAdmin();
                return;
            }
            if (act === 'editpartner') {
                const list = (await adminFetch('/partners')).partners;
                const p = list.find(x => x.id == id);
                openModal(partnerForm(p));
                document.getElementById('cancelPartnerBtn').onclick = closeModal;
                document.getElementById('savePartnerBtn').onclick = () => savePartnerAdmin(id);
                return;
            }
            if (act === 'delpartner') {
                if (!confirm('Delete partner?')) return;
                await adminFetch('/partners/' + id + '/delete', { method: 'POST' });
                banner('Deleted', 'success');
                loadPartnersAdmin();
                return;
            }
        });
    }

    async function init() {
        const token = getToken();
        if (!token) {
            window.location.href = './login_register.html';
            return;
        }
        currentUser = getStoredUser();

        if (!currentUser) {
            try {
                const me = await fetch(apiUrlFallback('/api/user'), { headers: { 'Authorization': 'Bearer ' + token } });
                if (me.ok) {
                    currentUser = await me.json();
                    sessionStorage.setItem('uchiha_user', JSON.stringify(currentUser));
                }
            } catch (e) {}
        }

        if (!currentUser) {
            sessionStorage.removeItem('uchiha_token');
            window.location.href = './login_register.html';
            return;
        }
        const perms = String((currentUser && (currentUser.account_permissions || currentUser.account_type)) || 'User');
        const ranks = { User: 0, VIP: 1, Partner: 2, Beta: 3, UnlockAll: 4, Admin: 5, Owner: 6 };
        if ((ranks[perms] || 0) < 5) {
            document.body.innerHTML = '<div style="padding:60px;text-align:center;color:#ff8080;"><h1>403 — Insufficient Permissions</h1><p>You need Admin or Owner role to access this panel.</p><a href="../index.html" style="color:#ff4d4d;">Back to Store</a></div>';
            return;
        }
        document.getElementById('adminUserChip').textContent = (currentUser && currentUser.username) || 'admin';
        document.getElementById('adminRoleBadge').textContent = perms;

        document.querySelectorAll('.admin-nav-item[data-tab]').forEach(b => {
            b.addEventListener('click', () => {
                const tab = b.getAttribute('data-tab');
                showSection(tab);
                if (tab === 'dashboard') loadDashboard();
                if (tab === 'users') loadUsers();
                if (tab === 'products') loadProducts();
                if (tab === 'coupons') loadCoupons();
                if (tab === 'bank') loadBankPacks();
                if (tab === 'orders') loadOrders();
                if (tab === 'forum') loadForum();
                if (tab === 'settings') loadSettings();
                if (tab === 'news') loadNewsAdmin();
                if (tab === 'qa') loadQaAdmin();
                if (tab === 'partners') loadPartnersAdmin();
                if (tab === 'launcher') loadLauncherAdmin();
                if (tab === 'maintenance') loadGlobalMaintenanceAdmin();
                if (tab === 'audit') loadAudit();
            });
        });

        document.getElementById('adminModalClose').addEventListener('click', closeModal);
        document.getElementById('adminModalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'adminModalOverlay') closeModal();
        });

        document.getElementById('newProductBtn').addEventListener('click', () => {
            openModal(productForm(null));
            document.getElementById('cancelProductBtn').onclick = closeModal;
            document.getElementById('saveProductBtn').onclick = () => saveProduct(null);
        });
        document.getElementById('newCouponBtn').addEventListener('click', () => {
            openModal(couponForm(null));
            document.getElementById('cancelCouponBtn').onclick = closeModal;
            document.getElementById('saveCouponBtn').onclick = () => saveCoupon(null);
        });
        document.getElementById('newBankPackBtn').addEventListener('click', () => {
            openModal(packForm(null));
            document.getElementById('cancelPackBtn').onclick = closeModal;
            document.getElementById('savePackBtn').onclick = () => savePack(null);
        });

        document.getElementById('newNewsBtn').addEventListener('click', () => {
            openModal(newsForm(null));
            document.getElementById('cancelNewsBtn').onclick = closeModal;
            document.getElementById('saveNewsBtn').onclick = () => saveNewsAdmin(null);
        });
        document.getElementById('newQaBtn').addEventListener('click', () => {
            openModal(qaForm(null));
            document.getElementById('cancelQaBtn').onclick = closeModal;
            document.getElementById('saveQaBtn').onclick = () => saveQaAdmin(null);
        });
        document.getElementById('newPartnerBtn').addEventListener('click', () => {
            openModal(partnerForm(null));
            document.getElementById('cancelPartnerBtn').onclick = closeModal;
            document.getElementById('savePartnerBtn').onclick = () => savePartnerAdmin(null);
        });

        const saveLauncherBtn = document.getElementById('saveLauncherSettingsBtn');
        if (saveLauncherBtn) saveLauncherBtn.addEventListener('click', saveLauncherSettings);
        const uploadLauncherBtn = document.getElementById('uploadLauncherBtn');
        if (uploadLauncherBtn) uploadLauncherBtn.addEventListener('click', uploadLauncherBinary);

        document.getElementById('userSearchBtn').addEventListener('click', () => {
            loadUsers(document.getElementById('userSearch').value);
        });
        document.getElementById('userSearch').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') loadUsers(e.target.value);
        });

        document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

        document.getElementById('adminLogoutBtn').addEventListener('click', () => {
            fetch(apiUrlFallback('/api/logout'), { method: 'POST', headers: { Authorization: 'Bearer ' + (token || '') } });
            sessionStorage.removeItem('uchiha_token');
            sessionStorage.removeItem('uchiha_user');
            window.location.href = './login_register.html';
        });

        bindActions();
        showSection('dashboard');
        loadDashboard();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();