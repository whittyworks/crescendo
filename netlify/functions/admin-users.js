// netlify/functions/admin-users.js
//
// Admin-only API for listing users and updating their display names.
// Uses the Supabase service_role / secret key, which MUST stay server-side.
//
// Required Netlify environment variables:
//   SUPABASE_URL                  e.g. https://whpxmygwxdwktnwpzqkt.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY     the sb_secret_... key from Supabase Project Settings → API
//   ADMIN_EMAILS                  comma-separated list, e.g. bea@myholycrescendo.com

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://whpxmygwxdwktnwpzqkt.supabase.co';
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

    // 1) Validate caller's bearer token.
    const auth = event.headers.authorization || event.headers.Authorization || '';
    if (!auth.startsWith('Bearer ')) {
        return resp(401, { error: 'Missing Authorization header.' });
    }
    const token = auth.slice(7).trim();

    // service-role client: used both to validate the JWT and to perform admin ops
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) {
        return resp(401, { error: 'Invalid or expired session. Sign in again.' });
    }

    const callerEmail = (userData.user.email || '').toLowerCase();
    if (!ADMIN_EMAILS.includes(callerEmail)) {
        return resp(403, { error: 'Not authorized.' });
    }

    // 2) Parse body.
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return resp(400, { error: 'Invalid JSON body.' });
    }
    const action = body.action;

    // 3) LIST
    if (action === 'list') {
        // Page through up to 1000 users (200/page × 5 pages). Plenty for now.
        const all = [];
        for (let page = 1; page <= 5; page++) {
            const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
            if (error) return resp(500, { error: error.message });
            const batch = data?.users || [];
            all.push(...batch);
            if (batch.length < 200) break;
        }
        // Sort newest first.
        all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        const users = all.map(u => ({
            id: u.id,
            email: u.email || '',
            full_name: (u.user_metadata && u.user_metadata.full_name) || '',
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at,
            email_confirmed_at: u.email_confirmed_at,
        }));
        return resp(200, { users });
    }

    // 4) UPDATE NAME
    if (action === 'update_name') {
        const userId = body.user_id;
        const newName = (body.full_name || '').trim();
        if (!userId) return resp(400, { error: 'user_id required.' });

        // Read existing metadata so we don't clobber other fields.
        const { data: existing, error: getErr } = await sb.auth.admin.getUserById(userId);
        if (getErr || !existing?.user) {
            return resp(404, { error: 'User not found.' });
        }
        const merged = { ...(existing.user.user_metadata || {}), full_name: newName };

        const { data, error } = await sb.auth.admin.updateUserById(userId, {
            user_metadata: merged,
        });
        if (error) return resp(500, { error: error.message });

        return resp(200, {
            user: {
                id: data.user.id,
                email: data.user.email,
                full_name: (data.user.user_metadata && data.user.user_metadata.full_name) || '',
            },
        });
    }

    return resp(400, { error: 'Unknown action. Expected "list" or "update_name".' });
};
