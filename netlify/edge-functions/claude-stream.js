// netlify/edge-functions/claude-stream.js
//
// Edge Function streaming proxy for the Anthropic Messages API.
// Runs on Deno at the edge with NATIVE streaming (not buffered like
// Lambda-based Netlify Functions). Time spent waiting on the upstream
// fetch does not count against the 50-second execution cap, so long
// generations work reliably.
//
// Routed at /api/claude-stream via the export const config below.

export default async (request) => {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return new Response(
            JSON.stringify({ error: { message: 'Invalid JSON in request body' } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // Force streaming upstream
    body.stream = true;

    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
        return new Response(
            JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY not configured in Netlify env' } }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    // If Anthropic rejected the request, it returns JSON not SSE — pass through
    if (!upstream.ok) {
        const errText = await upstream.text();
        return new Response(errText, {
            status: upstream.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }

    // Pipe the SSE stream straight to the browser
    return new Response(upstream.body, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no',
        },
    });
};

export const config = {
    path: '/api/claude-stream',
};
