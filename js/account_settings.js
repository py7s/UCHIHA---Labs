document.addEventListener('DOMContentLoaded', async () => {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = './login_register.html';
        return;
    }

    await loadAccountSettings(user);
    setupProfileUpload();
    setupSaveCancel();
});

async function loadAccountSettings(user) {
    document.getElementById('username').value = user.username || '';
    document.getElementById('emailAddress').value = user.email || '';
    document.getElementById('phoneNumber').value = user.phone || '';
    document.getElementById('emailNewsletter').checked = !!user.newsletter_opt_in;
    document.getElementById('accountType').textContent = user.account_type || 'User';
    document.getElementById('memberSince').textContent = user.member_since ? new Date(user.member_since).toLocaleDateString() : 'Unknown';
    document.getElementById('lastLogin').textContent = user.last_login ? new Date(user.last_login).toLocaleString() : 'Unknown';
    document.getElementById('devicesConnected').textContent = user.devices_connected || 1;

    const profileImg = document.getElementById('settingsProfileImage');
    if (user.profile_picture_base64) {
        profileImg.src = 'data:image/png;base64,' + user.profile_picture_base64;
    } else if (user.profile_picture) {
        const tok = sessionStorage.getItem('uchiha_token');
        if (tok) profileImg.src = apiUrl('/api/profile_picture/' + encodeURIComponent(user.profile_picture)) + '?token=' + encodeURIComponent(tok);
        else profileImg.src = apiUrl('/api/profile_picture/' + encodeURIComponent(user.profile_picture));
    } else {
        profileImg.src = '';
    }
}

let pendingProfilePictureBase64 = null;

function setupProfileUpload() {
    const uploadBtn = document.getElementById('uploadImageBtn');
    const imageInput = document.getElementById('profileImageInput');

    uploadBtn.addEventListener('click', () => {
        imageInput.click();
    });

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.includes('image')) {
            showBanner('Only image files are allowed.', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            document.getElementById('settingsProfileImage').src = event.target.result;
            const base64Full = event.target.result;
            const base64Data = base64Full.split(',')[1];
            pendingProfilePictureBase64 = base64Data;
        };
        reader.readAsDataURL(file);
    });
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
            await loadAccountSettings(user);
            return user;
        }
    } catch(e) {}
    return null;
}

async function setupSaveCancel() {
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
        const token = sessionStorage.getItem('uchiha_token');
        if (!token) return;

        const user = await getCurrentUser();
        if (!user) return;

        const newUsername = document.getElementById('username').value;
        const newEmail = document.getElementById('emailAddress').value;
        const newPhone = document.getElementById('phoneNumber').value;
        const newsletter = document.getElementById('emailNewsletter').checked;

        const usernameUnchanged = newUsername === (user.username || '');
        if (!usernameUnchanged && !validateUsername(newUsername)) {
            showBanner('Invalid username format! Must be 7-20 characters, start with a letter.', 'error');
            return;
        }

        if (!newEmail || !newEmail.includes('@')) {
            showBanner('Invalid email address!', 'error');
            return;
        }

        const updatePayload = {
            email: newEmail,
            phone: newPhone,
            newsletter_opt_in: newsletter
        };
        if (!usernameUnchanged) updatePayload.username = newUsername;

        if (pendingProfilePictureBase64) {
            const blob = base64ToBlob(pendingProfilePictureBase64, 'image/png');
            const fd = new FormData();
            fd.append('file', blob, 'profile.png');
            try {
                const upRes = await fetch(apiUrl('/api/profile/upload_picture'), {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token },
                    body: fd
                });
                if (!upRes.ok) {
                    const e = await upRes.json().catch(() => ({}));
                    showBanner('Profile picture upload failed: ' + (e.detail || upRes.status), 'error');
                    return;
                }
                const upJson = await upRes.json().catch(() => ({}));
                if (upJson && upJson.profile_picture) {
                    // Update sessionStorage so the dashboard sees the new picture immediately
                    const u0 = await getCurrentUser() || {};
                    u0.profile_picture = upJson.profile_picture;
                    u0.profile_picture_base64 = pendingProfilePictureBase64;
                    sessionStorage.setItem('uchiha_user', JSON.stringify(u0));
                }
            } catch (err) {
                showBanner('Profile picture upload failed: ' + (err.message || 'network'), 'error');
                return;
            }
            pendingProfilePictureBase64 = null;
        }

        const response = await fetch(apiUrl('/api/profile/update'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(updatePayload)
        });

        if (response.ok) {
            const result = await response.json();
            const updatedUser = result.account || result;
            sessionStorage.setItem('uchiha_user', JSON.stringify(updatedUser));
            await refreshUserData();
            showBanner('Settings saved successfully!', 'success');
        } else {
            const errData = await response.json().catch(() => ({}));
            showBanner('Failed to save settings: ' + (errData.detail || 'Unknown error'), 'error');
        }
    });

    document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
        window.location.href = '../index.html';
    });
}

function base64ToBlob(base64, mime) {
    const bin = atob(base64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

function validateUsername(username) {
    if (!username) return false;
    if (username.length < 7 || username.length > 20) return false;
    if (!/^[A-Za-z]/.test(username)) return false;
    if (!/^[A-Za-z0-9._-]+$/.test(username)) return false;
    return true;
}