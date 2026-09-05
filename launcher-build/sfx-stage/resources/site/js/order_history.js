document.addEventListener('DOMContentLoaded', async () => {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = './login_register.html';
        return;
    }

    await loadOrderHistory(user);
});

async function loadOrderHistory(user) {
    const totalPurchasesElem = document.getElementById('totalPurchases');
    const activeSubscriptionsElem = document.getElementById('activeSubscriptions');
    const totalSpentElem = document.getElementById('totalSpent');
    const ordersList = document.getElementById('ordersList');
    const licenseKeysContainer = document.getElementById('licenseKeysContainer');
    const productTypesContainer = document.getElementById('productTypesContainer');
    const pausedLicensesContainer = document.getElementById('pausedLicensesContainer');
    const bannedProductsContainer = document.getElementById('bannedProductsContainer');

    let orders = [];
    let licenseData = [];
    try {
        const token = sessionStorage.getItem('uchiha_token');
        if (token) {
            const res = await fetch(apiUrl('/api/orders'), {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (res.ok) {
                const data = await res.json();
                orders = (data.orders || []).filter(o => o.status === 'completed');
                licenseData = orders.filter(o => o.license_key).map(o => ({
                    id: o.id,
                    license_key: o.license_key,
                    product_name: o.title,
                    duration: o.product_type || 'Tool',
                    expires_at: 'Lifetime',
                    is_valid: true,
                    created_at: o.created_at
                }));
            }
        }
    } catch(e) {}

    const totalSpent = orders.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
    const activeLicenses = licenseData;

    if (totalPurchasesElem) totalPurchasesElem.textContent = orders.length;
    if (activeSubscriptionsElem) activeSubscriptionsElem.textContent = activeLicenses.length;
    if (totalSpentElem) totalSpentElem.textContent = '$' + totalSpent.toFixed(2);

    if (ordersList) {
        if (orders.length === 0) {
            ordersList.innerHTML = '<div class="empty-state"><p>No orders yet</p></div>';
        } else {
            const sorted = orders.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            ordersList.innerHTML = sorted.map(o => {
                const statusClass = o.status === 'completed' ? 'paid' : (o.status === 'pending' ? 'pending' : 'unknown');
                const dateStr = o.created_at ? new Date(o.created_at).toLocaleString() : '';
                const productName = o.title || ('Product #' + o.product_id);
                const coinStr = o.currency && o.currency !== 'USD' ? o.currency.toUpperCase() : '';
                return `
                    <div class="table-row">
                        <span>${escHtmlOH(dateStr)}</span>
                        <span>${escHtmlOH(productName)}</span>
                        <span>$${parseFloat(o.amount || 0).toFixed(2)}${coinStr ? ' (' + escHtmlOH(coinStr) + ')' : ''}</span>
                        <span class="status-badge ${statusClass}">${escHtmlOH(o.status || 'unknown')}</span>
                    </div>
                `;
            }).join('');
        }
    }

    if (licenseKeysContainer) {
        if (licenseData.length === 0) {
            licenseKeysContainer.innerHTML = '<div class="empty-state-small"><p>No active license keys</p></div>';
        } else {
            licenseKeysContainer.innerHTML = licenseData.map(lk => {
                const key = lk.license_key || '';
                const keyDisplay = key.length > 24 ? key.substring(0, 24) + '...' : key;
                const expiry = lk.expires_at === 'Lifetime' ? 'Lifetime' : (lk.expires_at || 'Unknown');
                const isValid = lk.is_valid !== false;
                const validColor = isValid ? '#22c55e' : '#ef4444';
                const validLabel = isValid ? 'Active' : 'Expired';
                const safeKey = String(key).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                return `
                    <div class="license-key-item">
                        <div class="license-key-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                            </svg>
                        </div>
                        <div class="license-key-info">
                            <span class="license-key-text">${escHtmlOH(lk.product_name || 'Product')} &mdash; ${escHtmlOH(lk.duration || '')}</span>
                            <span style="font-size:11px;color:var(--text-tertiary);">Expires: ${escHtmlOH(expiry)}</span>
                            <span style="font-size:11px;color:${validColor};font-weight:600;">${validLabel}</span>
                            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                                <span style="font-size:11px;color:var(--text-tertiary);word-break:break-all;">${escHtmlOH(keyDisplay)}</span>
                                <button class="btn-copy-key" onclick="copyToClipboard('${safeKey}')">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                    </svg>
                                    Copy
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    if (productTypesContainer) {
        const types = Array.from(new Set(orders.map(o => o.product_type).filter(Boolean)));
        if (types.length === 0) {
            productTypesContainer.innerHTML = '<div class="empty-state-small"><p>No product types recorded</p></div>';
        } else {
            productTypesContainer.innerHTML = '<div class="tags-container">' + types.map(type => '<span class="tag">' + escHtmlOH(type) + '</span>').join('') + '</div>';
        }
    }

    if (pausedLicensesContainer) {
        pausedLicensesContainer.innerHTML = '<div class="empty-state-small"><p>No paused licenses</p></div>';
    }

    if (bannedProductsContainer) {
        bannedProductsContainer.innerHTML = '<div class="empty-state-small success"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg><p>No banned products</p></div>';
    }
}

function escHtmlOH(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function copyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        alert('License key copied to clipboard!');
    } catch (err) {
        console.error('Failed to copy:', err);
    }
    document.body.removeChild(textArea);
}