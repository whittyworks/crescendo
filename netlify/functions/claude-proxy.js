const { stream } = require("@netlify/functions");

exports.handler = stream(async (event) => {
    if (event.httpMethod !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const body = JSON.parse(event.body);
    body.stream = true;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.text();
        return new Response(error, {
            status: response.status,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }

    return new Response(response.body, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
        },
    });
});