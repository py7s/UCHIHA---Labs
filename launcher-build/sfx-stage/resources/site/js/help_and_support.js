document.addEventListener('DOMContentLoaded', async () => {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = './login_register.html';
        return;
    }

    loadConfig().then(() => {
        const discordLink = document.getElementById('discordSupportLink');
        if (discordLink && config.discord_invite) {
            discordLink.href = config.discord_invite;
            discordLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(config.discord_invite, '_blank');
            });
        }
    });
});

async function getCurrentUser() {
    const token = sessionStorage.getItem('uchiha_token');
    if (!token) return null;
    const stored = sessionStorage.getItem('uchiha_user');
    if (stored) {
        try { return JSON.parse(stored); } catch(e) {}
    }
    try {
        const response = await fetch(apiUrl('/api/user'), {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (response.ok) {
            const data = await response.json();
            const user = data.account || data;
            sessionStorage.setItem('uchiha_user', JSON.stringify(user));
            return user;
        }
    } catch {
        return null;
    }
    return null;
}

function toggleFAQ(element) {
    const faqItem = element.parentElement;
    const isActive = faqItem.classList.contains('active');

    document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.remove('active');
    });

    if (!isActive) {
        faqItem.classList.add('active');
    }
}