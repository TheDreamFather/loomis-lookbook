// The migrations/ folder holds D1 SQL for operators (wrangler d1 execute). Never serve it from the site.
export const onRequest = () => new Response('Not found', { status: 404 });
