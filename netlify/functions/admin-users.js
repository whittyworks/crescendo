// netlify/functions/admin-users.js
//
// Admin-only API for listing users and updating their display names.
// Uses plain fetch against the Supabase Auth REST endpoints — no npm deps required.
//
// Required Netlify environment variables:
//   SUPABASE_URL                  e.g. https://whpxmygwxdwktnwpzqkt.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY     the sb_secret_... key from Supabase Project Settings → API
//   ADMIN_EMAILS                  comma-separated, e.g. bea@myholycrescendo.com,bea.whitmarsh@gmail.com

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://whpxmygwxdwktnwpzqkt.supabase.co').replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'bea@myholycrescendo.com,bea.whitmarsh@gmail.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

function corsHeaders() {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
}

function resp(statusCode, obj) {
    return { statusCode, headers: corsHeaders(), body: JSON.stringify(obj) };
}

// Hit a Supabase Auth admin endpoint with the service-role key.
async function adminFetch(path, options) {
    options = options || {};
    const headers = Object.assign({
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
    }, options.headers || {});

    const res = await fetch(SUPABASE_URL + path, Object.assign({}, options, { headers }));
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { ok: res.ok, status: res.status, data };
}

// Pull a friendly error message out of whatever Supabase returned.
function pickError(payload, fallback) {
    if (!payload) return fallback;
    if (typeof payload === 'string') return payload;
    return payload.msg || payload.message || payload.error || payload.error_description || fallback;
}

exports.handler = async function (event) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders(), body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return resp(405, { error: 'Method not allowed.' });
    }

    if (!SERVICE_ROLE_KEY) {
        return resp(500, {
            error: 'Server not configured. SUPABASE_SERVICE_ROLE_KEY is missing in Netlify env vars.'
        });
    }

    // 1) Validate caller's bearer token by asking Supabase who it belongs to.
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return resp(401, { error: 'Missing Authorization header.' });
    }
    const callerToken = authHeader.slice(7).trim();

    const meRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
        headers: {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': 'Bearer ' + callerToken,
        }
    });
    if (!meRes.ok) {
        return resp(401, { error: 'Invalid or expired session. Sign in again.' });
    }
    const me = await meRes.json().catch(function () { return {}; });
    const callerEmail = (me.email || '').toLowerCase();
    if (!callerEmail || !ADMIN_EMAILS.includes(callerEmail)) {
        return resp(403, { error: 'Not authorized.' });
    }

    // 2) Parse body.
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (_) { return resp(400, { error: 'Invalid JSON body.' }); }
    const action = body.action;

    // 3) LIST — page through up to ~1000 users.
    if (action === 'list') {
        const all = [];
        for (let page = 1; page <= 5; page++) {
            const r = await adminFetch('/auth/v1/admin/users?page=' + page + '&per_page=200');
            if (!r.ok) {
                return resp(r.status || 500, { error: pickError(r.data, 'List failed.') });
            }
            const batch = (r.data && r.data.users) || [];
            all.push.apply(all, batch);
            if (batch.length < 200) break;
        }
        all.sort(function (a, b) {
            return (b.created_at || '').localeCompare(a.created_at || '');
        });
        const users = all.map(function (u) {
            return {
                id: u.id,
                email: u.email || '',
                full_name: (u.user_metadata && u.user_metadata.full_name) || '',
                created_at: u.created_at,
                last_sign_in_at: u.last_sign_in_at,
                email_confirmed_at: u.email_confirmed_at,
            };
        });
        return resp(200, { users: users });
    }

    // 4) UPDATE NAME — read-merge-write so we don't clobber other metadata fields.
    if (action === 'update_name') {
        const userId = body.user_id;
        const newName = (body.full_name || '').trim();
        if (!userId) return resp(400, { error: 'user_id required.' });

        const getR = await adminFetch('/auth/v1/admin/users/' + encodeURIComponent(userId));
        if (!getR.ok) {
            return resp(getR.status === 404 ? 404 : 500, {
                error: pickError(getR.data, 'User not found.')
            });
        }
        const existing = getR.data || {};
        const merged = Object.assign({}, existing.user_metadata || {}, { full_name: newName });

        const putR = await adminFetch('/auth/v1/admin/users/' + encodeURIComponent(userId), {
            method: 'PUT',
            body: JSON.stringify({ user_metadata: merged }),
        });
        if (!putR.ok) {
            return resp(putR.status || 500, { error: pickError(putR.data, 'Update failed.') });
        }
        const u = putR.data || {};
        return resp(200, {
            user: {
                id: u.id,
                email: u.email,
                full_name: (u.user_metadata && u.user_metadata.full_name) || '',
            }
        });
    }

    return resp(400, { error: 'Unknown action. Expected "list" or "update_name".' });
};