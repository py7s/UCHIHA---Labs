let userPreferences = {};

document.addEventListener('DOMContentLoaded', async () => {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = './login_register.html';
        return;
    }

    loadPreferences(user);
    setupSaveCancel();
});

async function getCurrentUser() {
    const token = sessionStorage.getItem('uchiha_token');
    if (!token) return null;
    const stored = sessionStorage.getItem('uchiha_user');
    if (stored) {
        try { return JSON.parse(stored); } catch(e) {}
    }
    try {
        const res = await fetch(apiUrl('/api/user'), {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
            const data = await res.json();
            const user = data.account || data;
            sessionStorage.setItem('uchiha_user', JSON.stringify(user));
            return user;
        }
    } catch(e) {}
    return null;
}

function loadPreferences(user) {
    userPreferences = JSON.parse(localStorage.getItem('user_preferences') || '{}');

    document.getElementById('preferredLanguage').value = user.preferred_language || userPreferences.language || 'en';
    document.getElementById('timeZone').value = user.time_zone || userPreferences.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    document.getElementById('emailNotifications').checked = !!user.email_notifications;
    document.getElementById('productUpdates').checked = !!user.product_updates;
    document.getElementById('promotionalEmails').checked = !!user.newsletter_opt_in;
    document.getElementById('discordNotifications').checked = !!user.discord_notifications;

    document.getElementById('showOnlineStatus').checked = user.show_online_status !== 0;
    document.getElementById('allowDataCollection').checked = user.allow_data_collection !== 0;

    document.getElementById('themeSelect').value = userPreferences.theme || 'dark';
    document.getElementById('compactMode').checked = userPreferences.compactMode || false;
    document.getElementById('animationsEnabled').checked = userPreferences.animationsEnabled !== false;

    document.getElementById('autoInstall').checked = !!user.auto_install;
    document.getElementById('pauseDownloads').checked = !!user.pause_downloads;

    document.getElementById('currentAccountType').textContent = user.account_type || 'User';
    document.getElementById('memberSince').textContent = user.member_since ? new Date(user.member_since).toLocaleDateString() : 'Unknown';

    let totalPurchases = 0;
    if (user.purchased_products) totalPurchases = user.purchased_products.length;
    document.getElementById('totalPurchases').textContent = totalPurchases;
}

async function refreshUserData() {
    const token = sessionStorage.getItem('uchiha_token');
    if (!token) return null;
    try {
        const res = await fetch(apiUrl('/api/user'), {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
            const data = await res.json();
            const user = data.account || data;
            sessionStorage.setItem('uchiha_user', JSON.stringify(user));
            loadPreferences(user);
            return user;
        }
    } catch(e) {}
    return null;
}

async function setupSaveCancel() {
    document.getElementById('savePreferencesBtn').addEventListener('click', async () => {
        const token = sessionStorage.getItem('uchiha_token');
        if (!token) return;

        const user = await getCurrentUser();
        if (!user) return;

        const preferences = {
            language: document.getElementById('preferredLanguage').value,
            emailNotifications: document.getElementById('emailNotifications').checked,
            productUpdates: document.getElementById('productUpdates').checked,
            promotionalEmails: document.getElementById('promotionalEmails').checked,
            discordNotifications: document.getElementById('discordNotifications').checked,
            showOnlineStatus: document.getElementById('showOnlineStatus').checked,
            allowDataCollection: document.getElementById('allowDataCollection').checked,
            theme: document.getElementById('themeSelect').value,
            compactMode: document.getElementById('compactMode').checked,
            animationsEnabled: document.getElementById('animationsEnabled').checked,
            autoInstall: document.getElementById('autoInstall').checked,
            pauseDownloads: document.getElementById('pauseDownloads').checked
        };

        localStorage.setItem('user_preferences', JSON.stringify(preferences));

        const updatePayload = {
            preferred_language: preferences.language,
            email_notifications: preferences.emailNotifications,
            product_updates: preferences.productUpdates,
            newsletter_opt_in: preferences.promotionalEmails,
            discord_notifications: preferences.discordNotifications,
            show_online_status: preferences.showOnlineStatus,
            allow_data_collection: preferences.allowDataCollection,
            auto_install: preferences.autoInstall,
            pause_downloads: preferences.pauseDownloads
        };

        const response = await fetch(apiUrl('/api/profile/update'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(updatePayload)
        });

        if (response.ok) {
            const result = await response.json();
            const updatedUser = result.account || result;
            sessionStorage.setItem('uchiha_user', JSON.stringify(updatedUser));
            await refreshUserData();
            showBanner('Preferences saved successfully!', 'success');
        } else {
            const errData = await response.json().catch(() => ({}));
            showBanner('Failed to save preferences: ' + (errData.detail || 'Unknown error'), 'error');
        }

        if (preferences.language !== userPreferences.language) {
            setTimeout(function() { window.location.reload(); }, 600);
        }
    });

    document.getElementById('cancelPreferencesBtn').addEventListener('click', () => {
        window.location.href = '../index.html';
    });
}