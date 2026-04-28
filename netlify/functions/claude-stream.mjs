// netlify/functions/claude-stream.mjs
//
// Streaming proxy for the Anthropic Messages API.
// Returns Server-Sent Events (SSE) so long generations don't time out.
//
// The client POSTs the same body shape it would send to claude-proxy
// (model, max_tokens, system, messages). This function forces stream:true
// upstream and pipes the SSE response back to the browser unchanged.
//
// Uses the modern Netlify Functions v2 API (Web Standard Request/Response).
// The .mjs extension forces ESM regardless of package.json type.

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

    // Force streaming upstream — even if the client forgot to set it
    body.stream = true;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    // If Anthropic rejected the request, it returns JSON, not SSE.
    // Pass that error body straight through so the client can surface it.
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
